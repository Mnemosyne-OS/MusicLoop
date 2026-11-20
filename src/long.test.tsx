/**
 * A sound too long to be read whole: the screen offers a passage of it, loads
 * only that passage, and a loop kept from it opens the same passage again.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { type AppDeps, type Studio } from './App';
import type { DecodedSource } from './audio/engine';
import type { Passage } from './audio/passage';
import type { TimeTransform } from './audio/pipeline';
import { sdk } from './host';
import type { KeptLoop } from './state/loops';

const SR = 48000;
const sound = (seconds: number): DecodedSource => {
  const ch = Float32Array.from({ length: SR * seconds }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 220 * i) / SR));
  return { channels: [ch, ch.slice()], sampleRate: SR, seconds };
};
const identity: TimeTransform = async (channels) => channels;

const realParent = window.parent;
let hostState: Record<string, unknown> | null = null;
let picked = 'C:/Users/me/Music/night set.mp3';
let decodes = 0;
let asked: { url: string; path: string; passage: Passage }[] = [];

const studio = (): Studio => ({
  decode: async () => { decodes++; return sound(20); }, setLoop: () => undefined, setSettings: () => undefined, play: async () => undefined,
  stop: () => undefined, playing: false, position: () => 0, dispose: async () => undefined,
});
const deps = (over: Partial<AppDeps> = {}): AppDeps => ({
  engine: studio(),
  transform: identity,
  probe: async () => 7200,
  passage: async (url, path, passage) => { asked.push({ url, path, passage }); return sound(20); },
  ...over,
});

beforeEach(() => {
  hostState = null;
  picked = 'C:/Users/me/Music/night set.mp3';
  decodes = 0;
  asked = [];
  Object.defineProperty(window, 'parent', { configurable: true, value: {} });
  vi.spyOn(sdk, 'invoke').mockImplementation(async (action: string, payload?: unknown) => {
    switch (action) {
      case 'state.get': return { state: hostState };
      case 'state.set': hostState = (payload as { state: Record<string, unknown> }).state; return {};
      case 'dialog.selectFile': return picked;
      case 'dialog.mediaUrl': return { success: true, data: { url: 'mnemo-media://f/abc?k=1', kind: 'audio' } };
      case 'recorder.musicTakes': return { takes: [] };
      default: return null;
    }
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'parent', { configurable: true, value: realParent });
});

const open = () => fireEvent.click(screen.getAllByRole('button', { name: 'Open a sound' })[0]!);
const keptNow = () => ((hostState as { loops?: KeptLoop[] } | null)?.loops ?? []);
const player = () => document.querySelector('audio.ml-long-player') as HTMLAudioElement;

describe('a sound longer than ten minutes', () => {
  it('is not read whole: the screen says how long it is and offers to take a passage', async () => {
    render(<App deps={deps()} />);
    open();
    const card = await screen.findByRole('region', { name: 'This sound lasts 2:00:00' });
    expect(within(card).getByRole('button', { name: 'Take this passage' })).toBeInTheDocument();
    expect(player().getAttribute('src')).toBe('mnemo-media://f/abc?k=1');
    // Nothing of the file was fetched or decoded.
    expect(decodes).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(asked).toEqual([]);
  });

  it('loads the passage that starts where the player is, at the length chosen', async () => {
    render(<App deps={deps()} />);
    open();
    await screen.findByRole('button', { name: 'Take this passage' });
    Object.defineProperty(player(), 'currentTime', { configurable: true, value: 3725 });
    fireEvent.click(within(screen.getByRole('group', { name: 'Length of the passage' })).getByRole('button', { name: '10 min' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take this passage' }));
    expect(await screen.findByText('Passage at 1:02:05 of 2:00:00')).toBeInTheDocument();
    expect(asked).toEqual([{ url: 'mnemo-media://f/abc?k=1', path: picked, passage: { from: 3725, seconds: 600, total: 7200 } }]);
    // The studio is open on the passage: the loop can be sent to the pad.
    expect(screen.getByRole('button', { name: 'Send to the pad' })).toBeEnabled();
  });

  it('a passage asked for near the end is pulled back inside the file', async () => {
    render(<App deps={deps()} />);
    open();
    await screen.findByRole('button', { name: 'Take this passage' });
    Object.defineProperty(player(), 'currentTime', { configurable: true, value: 7190 });
    fireEvent.click(screen.getByRole('button', { name: 'Take this passage' }));
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]!.passage).toEqual({ from: 6900, seconds: 300, total: 7200 });
  });

  it('a loop kept from a passage carries it, and opens the same passage again without asking the length', async () => {
    const probe = vi.fn(async () => 7200);
    render(<App deps={deps({ probe })} />);
    open();
    await screen.findByRole('button', { name: 'Take this passage' });
    Object.defineProperty(player(), 'currentTime', { configurable: true, value: 600 });
    fireEvent.click(screen.getByRole('button', { name: 'Take this passage' }));
    await screen.findByText('Passage at 10:00 of 2:00:00');
    fireEvent.click(screen.getByRole('button', { name: 'Send to the pad' }));
    await waitFor(() => expect(keptNow()).toHaveLength(1));
    const kept = keptNow()[0]!;
    expect(kept.passage).toEqual({ from: 600, seconds: 300, total: 7200 });
    expect(kept.end).toBeLessThanOrEqual(20);

    probe.mockClear();
    fireEvent.click(await screen.findByRole('button', { name: `Open ${kept.name}` }));
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1]!.passage).toEqual(kept.passage);
    expect(probe).not.toHaveBeenCalled();
    expect(await screen.findByText('Passage at 10:00 of 2:00:00')).toBeInTheDocument();
  });

  it('« Another passage » goes back to the player of the same sound', async () => {
    render(<App deps={deps()} />);
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Take this passage' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Another passage' }));
    expect(await screen.findByRole('region', { name: 'This sound lasts 2:00:00' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to the pad' })).toBeNull();
  });

  it('a film says its passage is read as it plays, and shows how far the reading is', async () => {
    picked = 'C:/Users/me/Videos/concert.mp4';
    let tell: (seconds: number) => void = () => undefined;
    let finish: (d: DecodedSource) => void = () => undefined;
    render(<App deps={deps({ passage: (_u, _p, _passage, onProgress) => { tell = onProgress; return new Promise<DecodedSource>((r) => { finish = r; }); } })} />);
    open();
    expect(await screen.findByText(/read as it plays/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Take this passage' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Reading concert.mp4'));
    tell(42);
    expect(await screen.findByText('Reading the passage as it plays: 0:42 of 5:00')).toBeInTheDocument();
    finish(sound(20));
    expect(await screen.findByRole('button', { name: 'Send to the pad' })).toBeInTheDocument();
  });

  it('a passage that is refused is said in words', async () => {
    render(<App deps={deps({ passage: async () => { throw new Error('NOT_DECODED'); } })} />);
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Take this passage' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This file is not a sound this app can read.');
  });
});

describe('a small file that is a long sound', () => {
  it('is offered by passage once the decoder has found it too long and its length is known', async () => {
    const engine: Studio = { ...studio(), decode: async () => { throw new Error('TOO_LONG'); } };
    render(<App deps={deps({ engine, probe: async () => null, lengthOf: async () => 2400 })} />);
    open();
    expect(await screen.findByRole('region', { name: 'This sound lasts 40:00' })).toBeInTheDocument();
  });
});

describe('a sound of ordinary length', () => {
  it('opens whole as before when its length is short or not known', async () => {
    for (const length of [180, null]) {
      render(<App deps={deps({ probe: async () => length })} />);
      open();
      expect(await screen.findByText('night set.mp3 · 0:20.000')).toBeInTheDocument();
      expect(screen.queryByText(/^Passage at/)).toBeNull();
      cleanup();
    }
    expect(asked).toEqual([]);
    expect(decodes).toBe(2);
  });
});
