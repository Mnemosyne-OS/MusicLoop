/**
 * What the cold verification of 2026-11-19 found on the screen, each under a
 * test (doc 249 §13): a capture that lost its name once opened, a kept list
 * written over after a failed read, a capture too long to open, the tempo
 * that is only to check, and the fixes of the first cold read that no test
 * held.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { type Studio } from './App';
import { MAX_SOURCE_SECONDS, type DecodedSource } from './audio/engine';
import type { PreparedLoop, TimeTransform } from './audio/pipeline';
import { DEFAULT_SETTINGS, type LoopSettings } from './audio/settings';
import { detectTempo, MIN_TEMPO_CONFIDENCE } from './dsp/tempo';
import { sdk, TAKES_REFRESH_MS } from './host';

const SR = 48000;

/** Twenty seconds: a click on every beat at 120 BPM, or silence under a tone when `pulse` is false. */
function sound(pulse = true): DecodedSource {
  const frames = SR * 20;
  const make = (hz: number) => {
    const ch = Float32Array.from({ length: frames }, (_, i) => 0.1 * Math.sin((2 * Math.PI * hz * i) / SR));
    if (pulse) for (let at = 0; at < frames; at += SR / 2) for (let i = 0; i < 400; i++) ch[at + i] = (ch[at + i] ?? 0) + 0.8 * Math.sin(i * 0.5) * Math.exp(-i / 80);
    return ch;
  };
  return { channels: [make(220), make(330)], sampleRate: SR, seconds: 20 };
}

function fakeStudio(decode: () => Promise<DecodedSource> = async () => sound()) {
  const state = { playing: false, loops: [] as (PreparedLoop | null)[], stops: 0 };
  const studio: Studio = {
    decode: vi.fn(decode),
    setLoop: (loop) => { state.loops.push(loop); },
    setSettings: () => undefined,
    play: async () => { state.playing = true; },
    stop: () => { state.playing = false; state.stops++; },
    get playing() { return state.playing; },
    position: () => 0,
    dispose: async () => undefined,
  };
  return { studio, state };
}

const identity: TimeTransform = async (channels) => channels;
const TAKE = { path: 'C:/Users/me/.mnemosyne/recordings/2026-11-19_0230-ab12/mix.wav', name: 'mix.wav', seconds: 42.5, sampleRate: 48000, channels: 2, startedAt: '2026-11-19T02:30:00.000Z' };
const NAMED = { ...TAKE, path: 'C:/Users/me/.mnemosyne/recordings/2026-11-19_0300-cd34/mix.wav', name: 'Sultans of swing', startedAt: '2026-11-19T03:00:00.000Z' };

const realParent = window.parent;
let hostState: Record<string, unknown> | null = null;
let answer: (action: string, payload?: unknown) => unknown = () => undefined;
let written: { rel: string }[] = [];

beforeEach(() => {
  hostState = null;
  written = [];
  answer = () => undefined;
  window.localStorage.clear();
  Object.defineProperty(window, 'parent', { configurable: true, value: {} });
  vi.spyOn(sdk, 'invoke').mockImplementation(async (action: string, payload?: unknown) => {
    const own = answer(action, payload);
    if (own !== undefined) return own;
    switch (action) {
      case 'state.get': return { state: hostState };
      case 'state.set': hostState = (payload as { state: Record<string, unknown> }).state; return {};
      case 'dialog.selectFile': return 'C:/Users/me/Music/track one.mp3';
      case 'dialog.mediaUrl': return { success: true, data: { url: 'mnemo-media://f/abc?k=1', kind: 'audio' } };
      case 'dialog.appFolder': return { folder: 'C:/Users/me/Mnemosyne Apps/MusicLoop' };
      case 'dialog.writeAppBytes': {
        const p = payload as { rel: string; base64: string };
        written.push(p);
        return { path: `C:/Users/me/Mnemosyne Apps/MusicLoop/${p.rel}`, bytes: 100 };
      }
      case 'recorder.musicTakes': return { takes: [] };
      default: return null;
    }
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'parent', { configurable: true, value: realParent });
});

const calls = (action: string) => vi.mocked(sdk.invoke).mock.calls.filter((c) => c[0] === action);
const quickRender = vi.fn(async (loop: PreparedLoop, _s: LoopSettings, seconds: number, _lap?: boolean) => [new Float32Array(Math.round(seconds * loop.sampleRate)), new Float32Array(Math.round(seconds * loop.sampleRate))]);
const openByButton = async () => {
  fireEvent.click(screen.getAllByRole('button', { name: 'Open a sound' })[0]!);
  await screen.findByText('track one.mp3 · 0:20.000');
};

describe('a capture keeps its name once it is open', () => {
  beforeEach(() => {
    answer = (action) => (action === 'recorder.musicTakes' ? { takes: [TAKE, NAMED] } : undefined);
  });

  it('an unnamed capture is called by its date in the bar, in the exported file and in a kept loop, never « mix »', async () => {
    const { studio } = fakeStudio();
    render(<App deps={{ engine: studio, transform: identity, render: quickRender }} />);
    const row = await screen.findByRole('button', { name: /^Open .*2026/ });
    const label = row.querySelector('.n')!.textContent!;
    fireEvent.click(row);
    expect(await screen.findByText(`${label} · 0:20.000`)).toBeInTheDocument();
    expect(screen.queryByText(/mix\.wav · /)).toBeNull();
    // The name offered for a kept loop is the date too.
    expect((screen.getByRole('textbox', { name: 'Name of the loop' }) as HTMLInputElement).value).not.toMatch(/^mix$/);
    const save = screen.getByRole('button', { name: 'Save the WAV' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '15 s' }));
    fireEvent.click(save);
    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]!.rel).not.toMatch(/^mix_/);
    expect(written[0]!.rel).toMatch(/2026.*_15s\.wav$/);
  });

  it('a capture the person named keeps that name', async () => {
    const { studio } = fakeStudio();
    render(<App deps={{ engine: studio, transform: identity, render: quickRender }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Sultans of swing' }));
    expect(await screen.findByText('Sultans of swing · 0:20.000')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save the WAV' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '15 s' }));
    fireEvent.click(save);
    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]!.rel).toBe('Sultans-of-swing_120bpm_15s.wav');
  });

  it('a kept loop of a capture opens again under the name its source was shown with', async () => {
    const { studio } = fakeStudio();
    const view = render(<App deps={{ engine: studio, transform: identity }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Sultans of swing' }));
    await screen.findByText('Sultans of swing · 0:20.000');
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the loop' }), { target: { value: 'riff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep this loop' }));
    await waitFor(() => expect((hostState?.loops as unknown[])?.length).toBe(1));
    expect((hostState!.loops as Record<string, unknown>[])[0]).toMatchObject({ name: 'riff', source: 'Sultans of swing', captured: true });
    view.unmount();
    answer = (action) => (action === 'recorder.musicTakes' ? { takes: [] } : undefined);
    render(<App deps={{ engine: fakeStudio().studio, transform: identity }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open riff' }));
    expect(await screen.findByText('Sultans of swing · 0:20.000')).toBeInTheDocument();
    expect(screen.getByText('Captured from the computer')).toBeInTheDocument();
  });

  it('the captures are also listed while a sound is open, and open from there', async () => {
    const { studio } = fakeStudio();
    render(<App deps={{ engine: studio, transform: identity }} />);
    await openByButton();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Sultans of swing' }));
    expect(await screen.findByText('Sultans of swing · 0:20.000')).toBeInTheDocument();
    expect(calls('dialog.mediaUrl').at(-1)![1]).toEqual({ filePath: NAMED.path });
  });
});

describe('a capture longer than a source may be', () => {
  it('is listed, says why it does not open, and is never fetched', async () => {
    const long = { ...NAMED, seconds: MAX_SOURCE_SECONDS + 300 };
    answer = (action) => (action === 'recorder.musicTakes' ? { takes: [long] } : undefined);
    render(<App deps={{ engine: fakeStudio().studio, transform: identity }} />);
    const row = await screen.findByRole('button', { name: 'Sultans of swing: longer than 10 minutes' });
    expect(row).toBeDisabled();
    fireEvent.click(row);
    expect(calls('dialog.mediaUrl')).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a file refused for what it is offers no « Try again »; a file that was slow does', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { studio } = fakeStudio(() => Promise.reject(new Error('TOO_LONG')));
    const view = render(<App deps={{ engine: studio, transform: identity }} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Open a sound' })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('longer than 10 minutes');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    view.unmount();
    const slow = fakeStudio(() => Promise.reject(new Error('DECODE_TIMEOUT')));
    render(<App deps={{ engine: slow.studio, transform: identity }} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Open a sound' })[0]!);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('the kept loops after a read that failed', () => {
  it('nothing is written over a list that was never read; « Try again » reads it and gives Keep back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    hostState = { loops: [{ id: 'old1', name: 'older loop', path: 'C:/Users/me/Music/a.mp3', start: 1, end: 3, bpm: 100, captured: false, settings: DEFAULT_SETTINGS }] };
    let fail = true;
    answer = (action) => {
      if (action === 'state.get' && fail) throw new Error('Host did not reply to "state.get" within 15s');
      return undefined;
    };
    render(<App deps={{ engine: fakeStudio().studio, transform: identity }} />);
    await openByButton();
    expect(await screen.findByRole('alert')).toHaveTextContent('Kept loops not read.');
    const keep = screen.getByRole('button', { name: 'Keep this loop' });
    expect(keep).toBeDisabled();
    fireEvent.click(keep);
    expect(calls('state.set')).toHaveLength(0);
    // The empty list is not announced as « no kept loop »: it is unknown.
    expect(screen.queryByText('No kept loop')).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Open older loop' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep this loop' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Keep this loop' }));
    await waitFor(() => expect(calls('state.set')).toHaveLength(1));
    // The loop kept before is still there, behind the new one.
    expect((hostState!.loops as { id: string }[]).map((l) => l.id)).toContain('old1');
    expect(hostState!.loops as unknown[]).toHaveLength(2);
  });

  it('the kept loops are listed while a sound is open too, and one opens from there', async () => {
    hostState = { loops: [{ id: 'k1', name: 'chorus', path: 'C:/Users/me/Music/b.mp3', start: 2, end: 6, bpm: 120, captured: false, settings: { ...DEFAULT_SETTINGS, low: 6 } }] };
    render(<App deps={{ engine: fakeStudio().studio, transform: identity }} />);
    await openByButton();
    fireEvent.click(await screen.findByRole('button', { name: 'Open chorus' }));
    expect(await screen.findByText('b.mp3 · 0:20.000')).toBeInTheDocument();
    expect((screen.getByRole('slider', { name: 'Bass' }) as HTMLInputElement).value).toBe('6');
    expect(screen.queryByText('Captured from the computer')).toBeNull();
  });

  it('a kept loop of a capture, opened while another sound is open, is still a capture', async () => {
    hostState = { loops: [{ id: 'k2', name: 'night riff', path: 'C:/Users/me/.mnemosyne/recordings/2026-11-19_0300-cd34/mix.wav', source: 'Sultans of swing', start: 2, end: 6, bpm: 120, captured: true, settings: DEFAULT_SETTINGS }] };
    render(<App deps={{ engine: fakeStudio().studio, transform: identity }} />);
    await openByButton();
    expect(screen.queryByText('Captured from the computer')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Open night riff' }));
    expect(await screen.findByText('Sultans of swing · 0:20.000')).toBeInTheDocument();
    expect(screen.getByText('Captured from the computer')).toBeInTheDocument();
    expect(screen.getByText(/taken down or demonetised/)).toBeInTheDocument();
  });
});

describe('the permission, once refused', () => {
  it('is said in its own sentence, and is not asked for again each time the window comes back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    answer = (action) => {
      if (action === 'recorder.musicTakes') throw new Error('Unauthorized: This cartridge does not have the "dialog:open" permission.');
      return undefined;
    };
    render(<App deps={{ engine: fakeStudio().studio, transform: identity }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('has not given this app access to files');
    expect(calls('recorder.musicTakes')).toHaveLength(1);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + TAKES_REFRESH_MS * 10);
    fireEvent.focus(window);
    fireEvent.focus(window);
    expect(calls('recorder.musicTakes')).toHaveLength(1);
  });
});

describe('the tempo is a help, and says when it is only to check', () => {
  it('a sound with no pulse gets no tempo, no beat tiles, and a loop of four seconds', async () => {
    const { studio } = fakeStudio(async () => sound(false));
    render(<App deps={{ engine: studio, transform: identity }} />);
    await openByButton();
    expect(screen.getByText('No tempo found')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'BPM' })).toBeNull();
    expect(screen.queryByText('Beats')).toBeNull();
    const end = screen.getByRole('slider', { name: 'End of the loop' });
    expect(Number(end.getAttribute('aria-valuenow'))).toBeCloseTo(4, 2);
  });

  it('a pulse found with little confidence is shown as one to check, and the magnet starts off', async () => {
    // A beat at 120 BPM under 180 clicks thrown at random: the beat is there, and it is not clean.
    const weak = (): DecodedSource => {
      let seed = 12345;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const ch = new Float32Array(SR * 20);
      const hit = (at: number) => { for (let i = 0; i < 400; i++) ch[at + i] = (ch[at + i] ?? 0) + 0.8 * Math.sin(i * 0.5) * Math.exp(-i / 80); };
      for (let at = 0; at < ch.length; at += SR / 2) hit(at);
      for (let k = 0; k < 180; k++) hit(Math.floor(rnd() * (ch.length - 500)));
      return { channels: [ch, ch.slice()], sampleRate: SR, seconds: 20 };
    };
    // The premise, measured: found, and between the floor and the level that is trusted.
    const found = detectTempo(weak().channels, SR)!;
    expect(found.confidence).toBeGreaterThan(MIN_TEMPO_CONFIDENCE);
    expect(found.confidence).toBeLessThan(0.2);
    const { studio } = fakeStudio(async () => weak());
    render(<App deps={{ engine: studio, transform: identity }} />);
    await openByButton();
    expect(screen.getByText('Tempo to check')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Snap the handles to the beats', pressed: false })).toBeInTheDocument();
    // A tempo the person types is theirs: it is no longer one to check.
    const bpm = screen.getByRole('spinbutton', { name: 'BPM' });
    fireEvent.focus(bpm);
    fireEvent.input(bpm, { target: { value: '121' }, inputType: 'insertText' });
    fireEvent.blur(bpm);
    await waitFor(() => expect(screen.queryByText('Tempo to check')).toBeNull());
  });

  it('a steady pulse is trusted: the magnet is on and nothing says « to check »', async () => {
    render(<App deps={{ engine: fakeStudio().studio, transform: identity }} />);
    await openByButton();
    expect(screen.getByRole('button', { name: 'Snap the handles to the beats', pressed: true })).toBeInTheDocument();
    expect(screen.queryByText('Tempo to check')).toBeNull();
  });
});

describe('what the first cold read fixed, now held by a test', () => {
  it('a sound that is replaced stops at once, even when the new file is refused', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let refuse = false;
    const { studio, state } = fakeStudio(() => (refuse ? Promise.reject(new Error('NOT_DECODED')) : Promise.resolve(sound())));
    render(<App deps={{ engine: studio, transform: identity }} />);
    await openByButton();
    const play = screen.getByRole('button', { name: 'Play the loop' });
    await waitFor(() => expect(play).toBeEnabled());
    fireEvent.click(play);
    await screen.findByRole('button', { name: 'Stop' });
    expect(state.playing).toBe(true);
    refuse = true;
    fireEvent.click(screen.getAllByRole('button', { name: 'Open a sound' })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('not a sound this app can read');
    expect(state.playing).toBe(false);
  });

  it('an answer that comes late does not replace the sound opened after it', async () => {
    let release: (d: DecodedSource) => void = () => undefined;
    let first = true;
    const { studio } = fakeStudio(() => {
      if (first) { first = false; return new Promise<DecodedSource>((resolve) => { release = resolve; }); }
      return Promise.resolve(sound());
    });
    let pick = 'C:/Users/me/Music/slow.mp3';
    answer = (action) => (action === 'dialog.selectFile' ? pick : undefined);
    render(<App deps={{ engine: studio, transform: identity }} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Open a sound' })[0]!);
    await screen.findByText('Reading slow.mp3');
    pick = 'C:/Users/me/Music/fast.mp3';
    fireEvent.click(screen.getAllByRole('button', { name: 'Open a sound' })[0]!);
    await screen.findByText('fast.mp3 · 0:20.000');
    await act(async () => { release(sound()); await Promise.resolve(); });
    expect(screen.getByText('fast.mp3 · 0:20.000')).toBeInTheDocument();
    expect(screen.queryByText(/slow\.mp3/)).toBeNull();
  });

  it('nothing is played or written from a loop that is being rebuilt', async () => {
    const hang: TimeTransform = () => new Promise(() => undefined);
    render(<App deps={{ engine: fakeStudio().studio, transform: hang }} />);
    await openByButton();
    const play = screen.getByRole('button', { name: 'Play the loop' });
    const save = screen.getByRole('button', { name: 'Save the WAV' });
    await waitFor(() => expect(play).toBeEnabled());
    expect(save).toBeEnabled();
    fireEvent.change(screen.getByRole('slider', { name: 'Speed' }), { target: { value: '0.8' } });
    await screen.findByText('Preparing the loop');
    expect(play).toBeDisabled();
    expect(save).toBeDisabled();
  });

  it('a file that is not written after two minutes is said, instead of « writing » for ever', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const never = vi.fn(() => new Promise<Float32Array[]>(() => undefined));
    render(<App deps={{ engine: fakeStudio().studio, transform: identity, render: never }} />);
    await openByButton();
    const save = screen.getByRole('button', { name: 'Save the WAV' });
    await waitFor(() => expect(save).toBeEnabled());
    vi.useFakeTimers();
    fireEvent.click(save);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_001); });
    vi.useRealTimers();
    expect(await screen.findByRole('alert')).toHaveTextContent('not written after 2 minutes');
    expect(never).toHaveBeenCalledTimes(1);
  });
});
