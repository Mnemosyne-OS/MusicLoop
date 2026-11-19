/**
 * The sounds the Recorder captured, as MusicLoop shows them (doc 249 §6):
 * listed when the host has a music mode, silent on a host that has none,
 * said in words when the host has it and does not answer.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { type Studio } from './App';
import type { DecodedSource } from './audio/engine';
import type { TimeTransform } from './audio/pipeline';
import { musicTakes, parseTake, sdk, takeLabel, TAKES_REFRESH_MS } from './host';

const SR = 48000;
const decoded: DecodedSource = { channels: [new Float32Array(SR * 6), new Float32Array(SR * 6)], sampleRate: SR, seconds: 6 };
const identity: TimeTransform = async (channels) => channels;

function studio(): Studio {
  return {
    decode: async () => decoded,
    setLoop: () => undefined,
    setSettings: () => undefined,
    play: async () => undefined,
    stop: () => undefined,
    playing: false,
    position: () => 0,
    dispose: async () => undefined,
  };
}

const TAKE = { path: 'C:/Users/me/.mnemosyne/recordings/2026-11-19_0230-ab12/mix.wav', name: 'Night capture', seconds: 42.5, sampleRate: 48000, channels: 2, startedAt: '2026-11-19T02:30:00.000Z' };

describe('parseTake', () => {
  it('keeps a take that can be opened and repairs what is missing around its path', () => {
    expect(parseTake(TAKE)).toEqual(TAKE);
    expect(parseTake({ path: 'C:\\rec\\2026-11-19_0230-ab12\\mix.wav' })).toEqual({
      path: 'C:\\rec\\2026-11-19_0230-ab12\\mix.wav', name: '2026-11-19_0230-ab12', seconds: 0, sampleRate: 0, channels: 0, startedAt: '',
    });
    expect(parseTake({ name: 'no path' })).toBeNull();
    expect(parseTake('mix.wav')).toBeNull();
    expect(parseTake({ ...TAKE, seconds: -3, sampleRate: NaN })).toMatchObject({ seconds: 0, sampleRate: 0 });
  });
});

describe('takeLabel', () => {
  const unnamed = { path: 'C:/rec/2026-11-19_0230-ab12/mix.wav', name: 'mix.wav', startedAt: '2026-11-19T02:30:00.000Z' };

  it('calls a take the Recorder left unnamed by the day it was captured', () => {
    const label = takeLabel(unnamed, 'en');
    expect(label).not.toContain('mix.wav');
    expect(label).toMatch(/2026/);
    expect(takeLabel(unnamed, 'fr')).toMatch(/nov/);
  });

  it('keeps the name the person gave, and the file name when the date is unreadable', () => {
    expect(takeLabel({ ...unnamed, name: 'Night capture' }, 'en')).toBe('Night capture');
    expect(takeLabel({ ...unnamed, startedAt: '' }, 'en')).toBe('mix.wav');
    expect(takeLabel({ ...unnamed, startedAt: 'yesterday' }, 'en')).toBe('mix.wav');
  });
});

describe('the captured sounds', () => {
  const realParent = window.parent;
  let answer: (action: string) => unknown;

  beforeEach(() => {
    Object.defineProperty(window, 'parent', { configurable: true, value: {} });
    answer = () => null;
    vi.spyOn(sdk, 'invoke').mockImplementation(async (action: string) => {
      if (action === 'state.get') return { state: null };
      if (action === 'dialog.mediaUrl') return { success: true, data: { url: 'mnemo-media://f/x?k=1', kind: 'audio' } };
      return answer(action);
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'parent', { configurable: true, value: realParent });
  });

  it('reads the list in the two shapes a host action answers in', async () => {
    answer = () => [TAKE, { name: 'broken' }];
    expect(await musicTakes()).toEqual([TAKE]);
    answer = () => ({ takes: [TAKE] });
    expect(await musicTakes()).toEqual([TAKE]);
    answer = () => ({ success: true, data: [TAKE] });
    expect(await musicTakes()).toEqual([TAKE]);
    answer = () => ({ success: false, error: 'RECORDINGS_UNREADABLE' });
    await expect(musicTakes()).rejects.toThrow('RECORDINGS_UNREADABLE');
  });

  it('lists a capture before any sound is open, and opens it as a captured sound', async () => {
    answer = (action) => (action === 'recorder.musicTakes' ? { takes: [TAKE] } : null);
    render(<App deps={{ engine: studio(), transform: identity }} />);
    const open = await screen.findByRole('button', { name: 'Open Night capture' });
    expect(open).toHaveTextContent('0:42.500 · 48 kHz');
    fireEvent.click(open);
    expect(await screen.findByText('Captured from the computer')).toBeInTheDocument();
    // The line about rights sits in the export card, for a captured sound only.
    expect(screen.getByText(/taken down or demonetised/)).toBeInTheDocument();
    expect(vi.mocked(sdk.invoke).mock.calls.find((c) => c[0] === 'dialog.mediaUrl')?.[1]).toEqual({ filePath: TAKE.path });
  });

  it('shows nothing about captures on a Mnemosyne OS that has no music mode', async () => {
    answer = (action) => {
      if (action === 'recorder.musicTakes') throw new Error('Action recorder.musicTakes is not supported or not permitted.');
      return null;
    };
    render(<App deps={{ engine: studio(), transform: identity }} />);
    await waitFor(() => expect(sdk.invoke).toHaveBeenCalledWith('recorder.musicTakes'));
    expect(screen.queryByText('Captured sounds')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when the host has the music mode and does not answer', async () => {
    answer = (action) => {
      if (action === 'recorder.musicTakes') throw new Error('Host did not reply to "recorder.musicTakes" within 15s');
      return null;
    };
    render(<App deps={{ engine: studio(), transform: identity }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Captured sounds not read.');
  });

  it('reads the list again when the window comes back to the front', async () => {
    let list: unknown[] = [];
    answer = (action) => (action === 'recorder.musicTakes' ? list : null);
    render(<App deps={{ engine: studio(), transform: identity }} />);
    await waitFor(() => expect(sdk.invoke).toHaveBeenCalledWith('recorder.musicTakes'));
    expect(screen.queryByRole('button', { name: 'Open Night capture' })).toBeNull();
    list = [TAKE];
    const asked = () => vi.mocked(sdk.invoke).mock.calls.filter((c) => c[0] === 'recorder.musicTakes').length;
    // A focus that follows at once asks nothing: the host's list is not free.
    fireEvent.focus(window);
    fireEvent.focus(window);
    expect(asked()).toBe(1);
    const later = Date.now() + TAKES_REFRESH_MS + 1;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    fireEvent.focus(window);
    expect(asked()).toBe(2);
    expect(await screen.findByRole('button', { name: 'Open Night capture' })).toBeInTheDocument();
  });
});
