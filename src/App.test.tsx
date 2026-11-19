import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { type Studio } from './App';
import type { DecodedSource } from './audio/engine';
import type { PreparedLoop, TimeTransform } from './audio/pipeline';
import { DEFAULT_SETTINGS, type LoopSettings } from './audio/settings';
import { readWavHeader } from './dsp/wav';
import { sdk } from './host';

const SR = 48000;

/** Twenty seconds at 120 BPM: a click on every beat over a quiet tone. */
function clickTrack(): DecodedSource {
  const frames = SR * 20;
  const make = (hz: number) => {
    const ch = Float32Array.from({ length: frames }, (_, i) => 0.1 * Math.sin((2 * Math.PI * hz * i) / SR));
    for (let at = 0; at < frames; at += SR / 2) {
      for (let i = 0; i < 400; i++) ch[at + i] = (ch[at + i] ?? 0) + 0.8 * Math.sin(i * 0.5) * Math.exp(-i / 80);
    }
    return ch;
  };
  return { channels: [make(220), make(330)], sampleRate: SR, seconds: 20 };
}

/** A stand-in for the audio engine: jsdom has no Web Audio. */
function fakeStudio(decoded: DecodedSource | Error = clickTrack()) {
  const state = { playing: false, loops: [] as (PreparedLoop | null)[], settings: [] as LoopSettings[], disposed: 0 };
  const studio: Studio = {
    decode: vi.fn(async () => { if (decoded instanceof Error) throw decoded; return decoded; }),
    setLoop: (loop) => { state.loops.push(loop); },
    setSettings: (s) => { state.settings.push(s); },
    play: async () => { state.playing = true; },
    stop: () => { state.playing = false; },
    get playing() { return state.playing; },
    position: () => 0,
    dispose: async () => { state.disposed++; },
  };
  return { studio, state };
}

const identity: TimeTransform = async (channels) => channels;

function dropFile(name = 'my song.mp3') {
  const file = new File([new Uint8Array(8)], name, { type: 'audio/mpeg' });
  file.arrayBuffer = async () => new ArrayBuffer(8);
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MusicLoop outside the OS', () => {
  it('starts on one wide target to open a sound', () => {
    const { studio } = fakeStudio();
    render(<App deps={{ engine: studio, transform: identity }} />);
    expect(screen.getByRole('button', { name: 'Open a sound, or drop one here' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Start of the loop' })).toBeNull();
  });

  it('opens a file: its tempo is found, the loop is four beats, and the loop is handed to the engine', async () => {
    const { studio, state } = fakeStudio();
    render(<App deps={{ engine: studio, transform: identity }} />);
    dropFile();
    expect(await screen.findByText('my song.mp3 · 0:20.000')).toBeInTheDocument();
    expect((screen.getByRole('spinbutton', { name: 'BPM' }) as HTMLInputElement).value).toBe('120');
    const start = screen.getByRole('slider', { name: 'Start of the loop' });
    const end = screen.getByRole('slider', { name: 'End of the loop' });
    expect(Number(end.getAttribute('aria-valuenow')) - Number(start.getAttribute('aria-valuenow'))).toBeCloseTo(2, 2);
    expect(screen.getByRole('button', { name: '4', pressed: true })).toBeInTheDocument();
    await waitFor(() => expect((state.loops.at(-1)?.channels[0]?.length ?? 0) / SR).toBeCloseTo(2, 2));
    expect(state.loops.at(-1)?.seam).not.toBe('none');
  });

  it('says in words why a file was refused', async () => {
    const { studio } = fakeStudio(new Error('NOT_DECODED'));
    render(<App deps={{ engine: studio, transform: identity }} />);
    dropFile('notes.txt');
    expect(await screen.findByRole('alert')).toHaveTextContent('This file is not a sound this app can read.');
  });

  it('plays and stops; the button says what a press does', async () => {
    const { studio, state } = fakeStudio();
    render(<App deps={{ engine: studio, transform: identity }} />);
    dropFile();
    const play = await screen.findByRole('button', { name: 'Play the loop' });
    await waitFor(() => expect(play).toBeEnabled());
    fireEvent.click(play);
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(state.playing).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(state.playing).toBe(false);
    expect(screen.getByRole('button', { name: 'Play the loop' })).toBeInTheDocument();
  });

  it('a beats tile sets the length of the loop from its start', async () => {
    const { studio, state } = fakeStudio();
    render(<App deps={{ engine: studio, transform: identity }} />);
    dropFile();
    fireEvent.click(await screen.findByRole('button', { name: '8' }));
    await waitFor(() => expect((state.loops.at(-1)?.channels[0]?.length ?? 0) / SR).toBeCloseTo(4, 2));
    expect(screen.getByRole('button', { name: '8', pressed: true })).toBeInTheDocument();
  });

  it('a knob reaches the engine at once and does not rebuild the loop; the speed rebuilds it', async () => {
    const { studio, state } = fakeStudio();
    const transform = vi.fn(identity);
    render(<App deps={{ engine: studio, transform }} />);
    dropFile();
    await waitFor(() => expect(state.loops.length).toBeGreaterThan(0));
    const built = state.loops.length;
    fireEvent.change(screen.getByRole('slider', { name: 'Bass' }), { target: { value: '6' } });
    expect(state.settings.at(-1)?.low).toBe(6);
    expect(screen.getByText('+6 dB')).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
    expect(state.loops.length).toBe(built);
    expect(transform).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('slider', { name: 'Speed' }), { target: { value: '0.8' } });
    await waitFor(() => expect(transform).toHaveBeenCalled());
    expect(transform.mock.calls[0]![2]).toMatchObject({ speed: 0.8, keepPitch: true });
    await waitFor(() => expect(state.loops.length).toBe(built + 1));
  });

  it('shows the echo and the reverb settings only when they are heard', async () => {
    const { studio } = fakeStudio();
    render(<App deps={{ engine: studio, transform: identity }} />);
    dropFile();
    await screen.findByRole('slider', { name: 'Echo' });
    expect(screen.queryByRole('slider', { name: 'Echo time' })).toBeNull();
    fireEvent.change(screen.getByRole('slider', { name: 'Echo' }), { target: { value: '0.4' } });
    expect(screen.getByRole('slider', { name: 'Echo time' })).toBeInTheDocument();
    // Half a beat at 120 BPM is 250 ms: the default delay sits on that tile.
    expect(screen.getByRole('button', { name: '½', pressed: true })).toBeInTheDocument();
  });

  it('keeps the loop it had and says so when the speed change fails', async () => {
    const { studio, state } = fakeStudio();
    const transform: TimeTransform = () => Promise.reject(new Error('STRETCH_FAILED'));
    render(<App deps={{ engine: studio, transform }} />);
    dropFile();
    await waitFor(() => expect(state.loops.length).toBeGreaterThan(0));
    const built = state.loops.length;
    fireEvent.change(screen.getByRole('slider', { name: 'Speed' }), { target: { value: '1.3' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('The loop plays as it was.');
    expect(state.loops.length).toBe(built);
  });

  it('writes the file at the length chosen and names it after the sound, its tempo and its length', async () => {
    const { studio } = fakeStudio();
    const rendered = vi.fn(async (loop: PreparedLoop, _s: LoopSettings, seconds: number, _wholeLap?: boolean) => [new Float32Array(Math.round(seconds * loop.sampleRate)), new Float32Array(Math.round(seconds * loop.sampleRate))]);
    let saved: { bytes: Uint8Array; name: string } | null = null;
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saved = { bytes: new Uint8Array(0), name: this.download }; });
    render(<App deps={{ engine: studio, transform: identity, render: rendered }} />);
    dropFile('My Song (final).mp3');
    const save = await screen.findByRole('button', { name: 'Save the WAV' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '15 s' }));
    fireEvent.click(save);
    expect(await screen.findByText('Downloaded: My-Song-final_120bpm_15s.wav')).toBeInTheDocument();
    expect(rendered.mock.calls[0]![2]).toBe(15);
    expect(rendered.mock.calls[0]![3]).toBe(false);
    expect(click).toHaveBeenCalledTimes(1);
    expect(saved!.name).toBe('My-Song-final_120bpm_15s.wav');
  });

  it('one lap is exported as a whole lap, named a loop', async () => {
    const { studio } = fakeStudio();
    const rendered = vi.fn(async (loop: PreparedLoop, _s: LoopSettings, _seconds: number, _wholeLap?: boolean) => loop.channels);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<App deps={{ engine: studio, transform: identity, render: rendered }} />);
    dropFile('beat.wav');
    const save = await screen.findByRole('button', { name: 'Save the WAV' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '1 lap' }));
    fireEvent.click(save);
    expect(await screen.findByText('Downloaded: beat_120bpm_loop.wav')).toBeInTheDocument();
    expect(rendered.mock.calls[0]![3]).toBe(true);
  });

  it('a dropped file has no path: the screen says how to keep a loop, and offers no keep button', async () => {
    const { studio } = fakeStudio();
    render(<App deps={{ engine: studio, transform: identity }} />);
    dropFile();
    expect(await screen.findByText('To keep a loop, open its file with the button.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep this loop' })).toBeNull();
    expect(screen.queryByText(/taken down or demonetised/)).toBeNull();
  });

  it('releases the sound card when the window closes', async () => {
    const { studio, state } = fakeStudio();
    const view = render(<App deps={{ engine: studio, transform: identity }} />);
    view.unmount();
    expect(state.disposed).toBe(1);
  });
});

describe('MusicLoop inside the OS', () => {
  const realParent = window.parent;
  let calls: { action: string; payload: unknown }[] = [];
  let hostState: Record<string, unknown> | null = null;
  let written: { rel: string; base64: string }[] = [];
  let refuse: string | null = null;

  beforeEach(() => {
    calls = [];
    hostState = null;
    written = [];
    refuse = null;
    Object.defineProperty(window, 'parent', { configurable: true, value: {} });
    vi.spyOn(sdk, 'invoke').mockImplementation(async (action: string, payload?: unknown) => {
      calls.push({ action, payload });
      switch (action) {
        case 'state.get': return { state: hostState };
        case 'state.set': hostState = (payload as { state: Record<string, unknown> }).state; return {};
        case 'dialog.selectFile': return 'C:/Users/me/Music/track one.mp3';
        case 'dialog.mediaUrl': return { success: true, data: { url: 'mnemo-media://f/abc?k=1', kind: 'audio' } };
        case 'dialog.appFolder': return { folder: 'C:/Users/me/Mnemosyne Apps/MusicLoop' };
        case 'dialog.writeAppBytes': {
          if (refuse) throw new Error(refuse);
          const p = payload as { rel: string; base64: string };
          written.push(p);
          return { path: `C:/Users/me/Mnemosyne Apps/MusicLoop/${p.rel}`, bytes: atob(p.base64).length };
        }
        default: return null;
      }
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
  });
  afterEach(() => {
    Object.defineProperty(window, 'parent', { configurable: true, value: realParent });
    vi.unstubAllGlobals();
  });

  const openByButton = async () => {
    fireEvent.click(screen.getAllByRole('button', { name: 'Open a sound' })[0]!);
    await screen.findByText('track one.mp3 · 0:20.000');
  };

  it('opens the file the person picked, through a URL made for that one file', async () => {
    const { studio } = fakeStudio();
    render(<App deps={{ engine: studio, transform: identity }} />);
    await openByButton();
    expect(calls.find((c) => c.action === 'dialog.mediaUrl')?.payload).toEqual({ filePath: 'C:/Users/me/Music/track one.mp3' });
    expect(fetch).toHaveBeenCalledWith('mnemo-media://f/abc?k=1', expect.anything());
  });

  it('saves a real WAV in the app folder and says its name, its length and its size', async () => {
    const { studio } = fakeStudio();
    const rendered = vi.fn(async (loop: PreparedLoop, _s: LoopSettings, seconds: number, _wholeLap?: boolean) => [new Float32Array(Math.round(seconds * loop.sampleRate)), new Float32Array(Math.round(seconds * loop.sampleRate))]);
    render(<App deps={{ engine: studio, transform: identity, render: rendered }} />);
    await openByButton();
    const save = screen.getByRole('button', { name: 'Save the WAV' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '15 s' }));
    fireEvent.click(save);
    expect(await screen.findByText(/Saved: track-one_120bpm_15s\.wav · 15\.00 s · 2\.7 MB/)).toBeInTheDocument();
    expect(written[0]!.rel).toBe('track-one_120bpm_15s.wav');
    const bytes = Uint8Array.from(atob(written[0]!.base64), (c) => c.charCodeAt(0));
    expect(readWavHeader(bytes)).toMatchObject({ sampleRate: SR, channels: 2, seconds: 15 });
    // The folder is asked for before the bytes are sent, with no time limit.
    const order = calls.map((c) => c.action).filter((a) => a.startsWith('dialog.'));
    expect(order.indexOf('dialog.appFolder')).toBeLessThan(order.indexOf('dialog.writeAppBytes'));
  });

  it('says why the host refused the file', async () => {
    refuse = 'EXTENSION_NOT_ALLOWED';
    const { studio } = fakeStudio();
    const rendered = vi.fn(async () => [new Float32Array(10), new Float32Array(10)]);
    render(<App deps={{ engine: studio, transform: identity, render: rendered }} />);
    await openByButton();
    const save = screen.getByRole('button', { name: 'Save the WAV' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(await screen.findByRole('alert')).toHaveTextContent('does not let an app write a WAV');
  });

  it('keeps a loop in the host state with its path, its region and its settings, and opens it again', async () => {
    const { studio, state } = fakeStudio();
    const view = render(<App deps={{ engine: studio, transform: identity }} />);
    await openByButton();
    fireEvent.change(screen.getByRole('slider', { name: 'Bass' }), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: '8' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the loop' }), { target: { value: 'drop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep this loop' }));
    await waitFor(() => expect((hostState?.loops as unknown[])?.length).toBe(1));
    const kept = (hostState!.loops as Record<string, unknown>[])[0]!;
    expect(kept).toMatchObject({ name: 'drop', path: 'C:/Users/me/Music/track one.mp3', captured: false });
    expect(kept.bpm as number).toBeCloseTo(120, 0);
    expect((kept.end as number) - (kept.start as number)).toBeCloseTo(4, 2);
    expect((kept.settings as LoopSettings).low).toBe(9);
    view.unmount();

    // A new window: the kept loop is listed before any sound is open, and opens with what it had.
    const again = fakeStudio();
    render(<App deps={{ engine: again.studio, transform: identity }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open drop' }));
    await screen.findByText('track one.mp3 · 0:20.000');
    expect((screen.getByRole('slider', { name: 'Bass' }) as HTMLInputElement).value).toBe('9');
    expect(screen.getByRole('button', { name: '8', pressed: true })).toBeInTheDocument();
    await waitFor(() => expect((again.state.loops.at(-1)?.channels[0]?.length ?? 0) / SR).toBeCloseTo(4, 2));
    expect(state.disposed).toBe(1);
  });

  it('says the kept loops are being read until the host answers, and never "no kept loop" before', async () => {
    const { studio } = fakeStudio();
    let answer: (v: { state: Record<string, unknown> | null }) => void = () => undefined;
    const base = vi.mocked(sdk.invoke).getMockImplementation()!;
    vi.mocked(sdk.invoke).mockImplementation(async (action: string, payload?: unknown) => {
      if (action === 'state.get') return new Promise((resolve) => { answer = resolve; });
      return base(action, payload);
    });
    render(<App deps={{ engine: studio, transform: identity }} />);
    await openByButton();
    expect(screen.getByText('Reading the kept loops')).toBeInTheDocument();
    expect(screen.queryByText('No kept loop')).toBeNull();
    answer({ state: null });
    expect(await screen.findByText('No kept loop')).toBeInTheDocument();
    expect(screen.queryByText('Reading the kept loops')).toBeNull();
  });

  it('says so when the kept loops were not read, even with no sound open', async () => {
    const { studio } = fakeStudio();
    vi.mocked(sdk.invoke).mockImplementation(async (action: string) => {
      if (action === 'state.get') throw new Error('Host did not reply to "state.get" within 15s');
      return null;
    });
    render(<App deps={{ engine: studio, transform: identity }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Kept loops not read.');
  });

  it('says so when a kept loop was not saved, and keeps it on screen', async () => {
    const { studio } = fakeStudio();
    render(<App deps={{ engine: studio, transform: identity }} />);
    await openByButton();
    const base = vi.mocked(sdk.invoke).getMockImplementation()!;
    vi.mocked(sdk.invoke).mockImplementation(async (action: string, payload?: unknown) => {
      if (action === 'state.set') throw new Error('Host did not reply to "state.set" within 15s');
      return base(action, payload);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Keep this loop' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kept loops not saved.');
    expect(screen.getByRole('button', { name: 'Open track-one' })).toBeInTheDocument();
  });

  it('shows the line about rights only for a sound captured from the computer', async () => {
    hostState = { loops: [{ id: 'c1', name: 'capture', path: 'C:/Users/me/rec/mix.wav', start: 0, end: 2, bpm: 120, captured: true, settings: DEFAULT_SETTINGS }] };
    const { studio } = fakeStudio();
    render(<App deps={{ engine: studio, transform: identity }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open capture' }));
    expect(await screen.findByText(/taken down or demonetised/)).toBeInTheDocument();
    expect(screen.getByText('Captured from the computer')).toBeInTheDocument();
  });
});
