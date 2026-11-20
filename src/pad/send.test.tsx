/**
 * From the studio to the pad: one click by the loop keeps it, the pad's own
 * window shows it without being asked, and the pad opens beside the studio.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { type Studio } from '../App';
import type { DecodedSource } from '../audio/engine';
import type { TimeTransform } from '../audio/pipeline';
import { DEFAULT_SETTINGS } from '../audio/settings';
import { isPadWindow, MAIN_WIDGET, PAD_CHANNEL, PAD_WIDGET, sdk } from '../host';
import Root from '../Root';
import type { KeptLoop } from '../state/loops';
import Pad from './Pad';
import type { PadDeck } from './padMixer';

const SR = 48000;
const sound = (): DecodedSource => {
  const ch = Float32Array.from({ length: SR * 20 }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 220 * i) / SR));
  return { channels: [ch, ch.slice()], sampleRate: SR, seconds: 20 };
};
const identity: TimeTransform = async (channels) => channels;
const studio = (): Studio => ({
  decode: async () => sound(), setLoop: () => undefined, setSettings: () => undefined, play: async () => undefined,
  stop: () => undefined, playing: false, position: () => 0, dispose: async () => undefined,
});
const deck = (): PadDeck => ({
  decode: async () => sound(), start: async () => undefined, stop: () => undefined, stopAll: () => undefined,
  startRecording: async () => undefined, stopRecording: () => null, maxSeconds: () => 240, dispose: async () => undefined,
});

/** A BroadcastChannel that reaches the other channels of the same name in this test. */
class FakeChannel {
  static all: FakeChannel[] = [];
  private fns: ((e: MessageEvent) => void)[] = [];
  constructor(readonly name: string) { FakeChannel.all.push(this); }
  postMessage(data: unknown) {
    for (const ch of FakeChannel.all) if (ch !== this && ch.name === this.name) ch.fns.forEach((fn) => fn({ data } as MessageEvent));
  }
  addEventListener(_: string, fn: (e: MessageEvent) => void) { this.fns.push(fn); }
  removeEventListener(_: string, fn: (e: MessageEvent) => void) { this.fns = this.fns.filter((f) => f !== fn); }
  close() { FakeChannel.all = FakeChannel.all.filter((c) => c !== this); }
}

const realParent = window.parent;
let hostState: Record<string, unknown> | null = null;
let board: unknown[] = [];
let boardRefused = false;

beforeEach(() => {
  hostState = null;
  board = [];
  boardRefused = false;
  FakeChannel.all = [];
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  Object.defineProperty(window, 'parent', { configurable: true, value: {} });
  vi.spyOn(sdk, 'invoke').mockImplementation(async (action: string, payload?: unknown) => {
    switch (action) {
      case 'state.get': return { state: hostState };
      case 'state.set': hostState = (payload as { state: Record<string, unknown> }).state; return {};
      case 'dialog.selectFile': return 'C:/Users/me/Music/track one.mp3';
      case 'dialog.mediaUrl': return { success: true, data: { url: 'mnemo-media://f/abc?k=1', kind: 'audio' } };
      case 'recorder.musicTakes': return { takes: [] };
      case 'canvas.openBoard':
        if (boardRefused) throw new Error('BOARD_UNHEARD');
        board.push(payload);
        return { opened: true, here: true };
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

const openSound = async () => {
  fireEvent.click(screen.getAllByRole('button', { name: 'Open a sound' })[0]!);
  await screen.findByText('track one.mp3 · 0:20.000');
};
const keptNow = () => ((hostState as { loops?: KeptLoop[] } | null)?.loops ?? []);

describe('sending a loop to the pad', () => {
  it('one click keeps the loop under where it starts and the name of its sound, and says so', async () => {
    render(<App deps={{ engine: studio(), transform: identity }} />);
    await openSound();
    fireEvent.click(screen.getByRole('button', { name: 'Send to the pad' }));
    await waitFor(() => expect(keptNow()).toHaveLength(1));
    const first = keptNow()[0]!;
    expect(first.path).toBe('C:/Users/me/Music/track one.mp3');
    expect(first.name).toMatch(/^\d:\d\d\.\d{3} track-one$/);
    expect(first.end).toBeGreaterThan(first.start);
    expect(screen.getByText(`In the pad: ${first.name}`)).toBeInTheDocument();
    // A second loop of the same sound is a second tile, not a replacement.
    fireEvent.click(screen.getByRole('button', { name: 'Send to the pad' }));
    await waitFor(() => expect(keptNow()).toHaveLength(2));
  });

  it('the pad shows a loop the studio sends, without being asked', async () => {
    render(<Pad deps={{ deck: deck(), transform: identity }} />);
    expect(await screen.findByText(/A loop kept in the studio becomes a pad here/)).toBeInTheDocument();
    render(<App deps={{ engine: studio(), transform: identity }} />);
    await openSound();
    fireEvent.click(screen.getByRole('button', { name: 'Send to the pad' }));
    expect(await screen.findByRole('button', { name: /^Play \d:\d\d\.\d{3} track-one$/ })).toBeInTheDocument();
  });

  it('a message that is not the one expected does not make the pad read again', async () => {
    hostState = { loops: [] };
    render(<Pad deps={{ deck: deck(), transform: identity }} />);
    await screen.findByText(/A loop kept in the studio becomes a pad here/);
    const reads = () => vi.mocked(sdk.invoke).mock.calls.filter((c) => c[0] === 'state.get').length;
    const before = reads();
    new FakeChannel(PAD_CHANNEL).postMessage({ kind: 'something else' });
    new FakeChannel(PAD_CHANNEL).postMessage('kept-changed');
    await new Promise((r) => setTimeout(r, 20));
    expect(reads()).toBe(before);
  });
});

describe('the pad window', () => {
  it('opens beside the studio: the studio on the left half, the pad on the right, on the desktop on screen', async () => {
    render(<Root />);
    fireEvent.click(await screen.findByRole('button', { name: 'Loop pad' }));
    await waitFor(() => expect(board).toHaveLength(1));
    expect(board[0]).toEqual({
      windows: [{ id: MAIN_WIDGET, x: 0, y: 0, w: 0.5, h: 1 }, { id: PAD_WIDGET, x: 0.5, y: 0, w: 0.5, h: 1 }],
      fill: true, zoom: 1, here: true,
    });
    // The studio stays: the pad is another window.
    expect(screen.getAllByRole('button', { name: 'Open a sound' }).length).toBeGreaterThan(0);
  });

  it('shows the pad in place of the studio when the host does not open the window', async () => {
    boardRefused = true;
    render(<Root />);
    fireEvent.click(await screen.findByRole('button', { name: 'Loop pad' }));
    expect(await screen.findByRole('button', { name: 'Back to the loop' })).toBeInTheDocument();
  });

  it('knows its own window by the widget the host names, and that window has no way back', async () => {
    expect(isPadWindow(`?widget=${PAD_WIDGET}&lang=fr`)).toBe(true);
    expect(isPadWindow(`?widget=${MAIN_WIDGET}`)).toBe(false);
    expect(isPadWindow('')).toBe(false);
    hostState = { loops: [{ id: 'a', name: 'kick', path: 'C:/a.mp3', start: 0, end: 2, settings: DEFAULT_SETTINGS }] };
    render(<Pad deps={{ deck: deck(), transform: identity }} />);
    await screen.findByRole('button', { name: 'Play kick' });
    expect(screen.queryByRole('button', { name: 'Back to the loop' })).toBeNull();
  });
});
