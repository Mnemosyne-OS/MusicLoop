/**
 * The loop pad against a stand-in of its audio deck: the tiles and their
 * shelves, a click that starts and a click that stops, the mix that is
 * recorded and saved, and what the screen says when something is refused.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecodedSource } from '../audio/engine';
import type { TimeTransform } from '../audio/pipeline';
import { DEFAULT_SETTINGS } from '../audio/settings';
import { readWavHeader } from '../dsp/wav';
import type { KeptLoop, KeptPorts } from '../state/loops';
import Pad, { mixName, type PadDeps } from './Pad';
import { joinBlocks, type PadDeck } from './padMixer';

const SR = 48000;
const sound = (): DecodedSource => {
  const ch = Float32Array.from({ length: SR * 10 }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 220 * i) / SR));
  return { channels: [ch, ch.slice()], sampleRate: SR, seconds: 10 };
};
const identity: TimeTransform = async (channels) => channels;

const loop = (id: string, name: string, extra: Partial<KeptLoop> = {}): KeptLoop => ({
  id, name, path: `C:/Users/me/Music/${id}.mp3`, start: 1, end: 3, bpm: 120, captured: false, settings: DEFAULT_SETTINGS, savedAt: '', ...extra,
});

function fakeDeck() {
  const log: string[] = [];
  const ends = new Map<string, () => void>();
  let onFull: (() => void) | null = null;
  let recording = false;
  const deck: PadDeck = {
    decode: vi.fn(async () => sound()),
    start: async (id, _loop, _settings, laps, onEnd) => { log.push(laps ? `start ${id} x${laps}` : `start ${id}`); ends.set(id, onEnd ?? (() => undefined)); },
    stop: (id) => { log.push(`stop ${id}`); },
    stopAll: () => { log.push('stopAll'); },
    startRecording: async (full) => { recording = true; onFull = full; log.push('rec'); },
    stopRecording: () => {
      if (!recording) return null;
      recording = false;
      const ch = Float32Array.from({ length: SR }, () => 0.5);
      return { channels: [ch, ch.slice()], sampleRate: SR };
    },
    maxSeconds: () => 240,
    dispose: async () => { log.push('dispose'); },
  };
  return { deck, log, full: () => onFull?.(), end: (id: string) => ends.get(id)?.() };
}

function setup(loops: KeptLoop[], over: Partial<PadDeps> = {}) {
  const store = { loops: loops as unknown[] };
  const sets: Record<string, unknown>[] = [];
  const ports: KeptPorts = {
    hostGet: async () => store,
    hostSet: async (state) => { sets.push(state); },
  };
  const d = fakeDeck();
  const saved: { name: string; bytes: Uint8Array }[] = [];
  const onBack = vi.fn();
  render(<Pad onBack={onBack} deps={{ deck: d.deck, transform: identity, readSound: async () => new ArrayBuffer(8), ports, saveMix: async (bytes, name) => { saved.push({ name, bytes }); return name; }, ...over }} />);
  return { ...d, sets, saved, onBack };
}

afterEach(cleanup);

describe('the loop pad', () => {
  it('shows one tile per kept loop, on the shelf of its category; a loop with none sits on Other', async () => {
    setup([loop('a', 'kick', { category: 'beat' }), loop('b', 'rain', { category: 'background' }), loop('c', 'hey', { category: 'voice' }), loop('d', 'misc')]);
    const beat = await screen.findByRole('region', { name: 'Beat' });
    expect(within(beat).getByRole('button', { name: 'Play kick' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Background' })).getByRole('button', { name: 'Play rain' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Voice' })).getByRole('button', { name: 'Play hey' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Other' })).getByRole('button', { name: 'Play misc' })).toBeInTheDocument();
  });

  it('a click starts the loop, a second click stops it, and two tiles play together', async () => {
    const { log, deck } = setup([loop('a', 'kick'), loop('b', 'rain')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Play kick' }));
    const kick = await screen.findByRole('button', { name: 'Stop kick', pressed: true });
    fireEvent.click(screen.getByRole('button', { name: 'Play rain' }));
    await screen.findByRole('button', { name: 'Stop rain', pressed: true });
    expect(log).toEqual(['start a', 'start b']);
    fireEvent.click(kick);
    expect(await screen.findByRole('button', { name: 'Play kick', pressed: false })).toBeInTheDocument();
    expect(log).toEqual(['start a', 'start b', 'stop a']);
    // The sound of a tile is read once: starting it again does not fetch it again.
    fireEvent.click(screen.getByRole('button', { name: 'Play kick' }));
    await screen.findByRole('button', { name: 'Stop kick' });
    expect(deck.decode).toHaveBeenCalledTimes(2);
  });

  it('« Stop all » stops every tile and is off when nothing plays', async () => {
    const { log } = setup([loop('a', 'kick'), loop('b', 'rain')]);
    const all = await screen.findByRole('button', { name: 'Stop all' });
    expect(all).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: 'Play kick' }));
    await screen.findByRole('button', { name: 'Stop kick' });
    fireEvent.click(all);
    expect(log).toContain('stopAll');
    expect(await screen.findByRole('button', { name: 'Play kick', pressed: false })).toBeInTheDocument();
  });

  it('says which tile did not start and why, and leaves it ready for another try', async () => {
    setup([loop('a', 'kick')], { readSound: async () => { throw new Error('FETCH_FAILED'); } });
    fireEvent.click(await screen.findByRole('button', { name: 'Play kick' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^kick: /);
    expect(screen.getByRole('button', { name: 'Play kick' })).toBeEnabled();
  });

  it('the pencil of a tile opens its settings: another category moves it and writes the whole list', async () => {
    const { sets } = setup([loop('a', 'kick'), loop('b', 'rain', { category: 'background' })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings of kick' }));
    const panel = screen.getByRole('region', { name: 'Settings of kick' });
    fireEvent.click(within(within(panel).getByRole('group', { name: 'Category' })).getByRole('button', { name: 'Voice' }));
    expect(within(await screen.findByRole('region', { name: 'Voice' })).getByRole('button', { name: 'Play kick' })).toBeInTheDocument();
    await waitFor(() => expect(sets).toHaveLength(1));
    const written = (sets[0] as { loops: KeptLoop[] }).loops;
    expect(written.map((l) => [l.id, l.category])).toEqual([['a', 'voice'], ['b', 'background']]);
    // The settings close on their button, and the pencil opens them again.
    fireEvent.click(within(panel).getByRole('button', { name: 'Close the settings' }));
    expect(screen.queryByRole('region', { name: 'Settings of kick' })).toBeNull();
  });

  it('a number of repeats is kept with the tile, shown on it, and handed to the deck; « until stopped » takes it away', async () => {
    const { sets, log } = setup([loop('a', 'kick')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings of kick' }));
    const repeats = within(screen.getByRole('region', { name: 'Settings of kick' })).getByRole('group', { name: 'Repeats' });
    expect(within(repeats).getByRole('button', { name: '∞', pressed: true })).toBeInTheDocument();
    fireEvent.click(within(repeats).getByRole('button', { name: '4' }));
    await waitFor(() => expect((sets[0] as { loops: KeptLoop[] }).loops[0]!.laps).toBe(4));
    fireEvent.click(screen.getByRole('button', { name: 'Close the settings' }));
    expect(screen.getByRole('button', { name: 'Play kick' })).toHaveTextContent('× 4');
    fireEvent.click(screen.getByRole('button', { name: 'Play kick' }));
    await screen.findByRole('button', { name: 'Stop kick' });
    expect(log).toEqual(['start a x4']);
    fireEvent.click(screen.getByRole('button', { name: 'Settings of kick' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Repeats' })).getByRole('button', { name: '∞' }));
    await waitFor(() => expect(sets).toHaveLength(2));
    expect((sets[1] as { loops: KeptLoop[] }).loops[0]).not.toHaveProperty('laps');
  });

  it('a tile whose repeats are over switches itself off', async () => {
    const { end } = setup([loop('a', 'kick', { laps: 2 })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Play kick' }));
    await screen.findByRole('button', { name: 'Stop kick', pressed: true });
    act(() => end('a'));
    expect(await screen.findByRole('button', { name: 'Play kick', pressed: false })).toBeInTheDocument();
  });

  it('records the mix and saves a real WAV under a dated name', async () => {
    const { saved, log } = setup([loop('a', 'kick')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Record the mix' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop and save' }));
    expect(await screen.findByText(/^Saved: pad-mix_\d{4}-\d\d-\d\d_\d{4}\.wav$/)).toBeInTheDocument();
    expect(log).toContain('rec');
    expect(readWavHeader(saved[0]!.bytes)).toMatchObject({ sampleRate: SR, channels: 2 });
    // One second of sound: the header and 48 000 frames of two 16-bit samples.
    expect(saved[0]!.bytes.length).toBe(44 + SR * 4);
  });

  it('saves the mix by itself when the longest file is reached, and says so', async () => {
    const { full, saved } = setup([loop('a', 'kick')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Record the mix' }));
    await screen.findByRole('button', { name: 'Stop and save' });
    full();
    expect(await screen.findByText(/The longest file is reached/)).toBeInTheDocument();
    expect(saved).toHaveLength(1);
  });

  it('says in words that the mix was not saved', async () => {
    setup([loop('a', 'kick')], { saveMix: async () => { throw new Error('EXTENSION_NOT_ALLOWED'); } });
    fireEvent.click(await screen.findByRole('button', { name: 'Record the mix' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop and save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Mix not saved\. /);
  });

  it('with no kept loop, says where a tile comes from; a list that was not read offers another try', async () => {
    setup([]);
    expect(await screen.findByText(/A loop kept in the studio becomes a pad here/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record the mix' })).toBeDisabled();
    cleanup();
    let calls = 0;
    setup([], { ports: { hostGet: async () => { if (calls++ === 0) throw new Error('did not reply'); return { loops: [loop('a', 'kick')] }; }, hostSet: async () => undefined } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Kept loops not read.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Play kick' })).toBeInTheDocument();
  });

  it('gives the sound card back when the screen closes, and goes back to the studio on its button', async () => {
    const { log, onBack } = setup([loop('a', 'kick')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to the loop' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    cleanup();
    expect(log).toContain('dispose');
  });
});

describe('pad helpers', () => {
  it('names a mix by its minute, and a copy by its number', () => {
    const at = new Date(2026, 10, 19, 16, 5);
    expect(mixName(at)).toBe('pad-mix_2026-11-19_1605.wav');
    expect(mixName(at, 3)).toBe('pad-mix_2026-11-19_1605_3.wav');
  });

  it('joins recorded blocks and cuts at the length asked', () => {
    const blocks = [Float32Array.of(1, 2, 3), Float32Array.of(4, 5, 6)];
    expect(Array.from(joinBlocks(blocks, 6))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(joinBlocks(blocks, 4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(joinBlocks(blocks, 0))).toEqual([]);
  });
});
