/**
 * The engine's own logic, against a stand-in of Web Audio: when it plays,
 * what it does to a loop that is replaced, how it answers a file it cannot
 * read, that it lets go of the sound card. jsdom has no Web Audio, so nothing
 * here says what a sound SOUNDS like: that is measured in a browser (doc 249
 * §12).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoopEngine, MAX_SOURCE_SECONDS, RESUME_TIMEOUT_MS, stereoOf, withDeadline } from './engine';
import type { PreparedLoop } from './pipeline';
import { DEFAULT_SETTINGS } from './settings';

const SR = 48000;

class FakeParam {
  value = 0;
  targets: number[] = [];
  setTargetAtTime(v: number) { this.targets.push(v); this.value = v; }
}

class FakeNode {
  static made: FakeNode[] = [];
  connections: unknown[] = [];
  disconnected = 0;
  started = 0;
  stopped = 0;
  loop = false;
  buffer: unknown = null;
  type = '';
  curve: Float32Array | null = null;
  oversample = '';
  normalize = true;
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  delayTime = new FakeParam();
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  playbackRate = new FakeParam();
  constructor(readonly kind: string) { FakeNode.made.push(this); }
  connect(to: unknown) { this.connections.push(to); return to; }
  disconnect() { this.disconnected++; }
  start() { this.started++; }
  stop() { this.stopped++; }
}

class FakeBuffer {
  private data: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(i: number) { return this.data[i]!; }
}

class FakeContext {
  static made: FakeContext[] = [];
  static decodeAnswer: (() => Promise<FakeBuffer>) | null = null;
  /** A sound card that never wakes: resume() stays pending. */
  static asleep = false;
  sampleRate = SR;
  currentTime = 0;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination = new FakeNode('destination');
  resumed = 0;
  constructor() { FakeContext.made.push(this); }
  createGain() { return new FakeNode('gain'); }
  createBiquadFilter() { return new FakeNode('biquad'); }
  createWaveShaper() { return new FakeNode('shaper'); }
  createDelay() { return new FakeNode('delay'); }
  createConvolver() { return new FakeNode('convolver'); }
  createDynamicsCompressor() { return new FakeNode('compressor'); }
  createBufferSource() { return new FakeNode('source'); }
  createBuffer(channels: number, length: number, rate: number) { return new FakeBuffer(channels, length, rate); }
  decodeAudioData() { return FakeContext.decodeAnswer!(); }
  resume(): Promise<void> {
    this.resumed++;
    if (FakeContext.asleep) return new Promise(() => undefined);
    this.state = 'running';
    return Promise.resolve();
  }
  async close() { this.state = 'closed'; }
}

const loopOf = (frames: number): PreparedLoop => ({
  channels: [new Float32Array(frames).fill(0.25), new Float32Array(frames).fill(-0.25)],
  sampleRate: SR, seam: 'pre', fadeFrames: 100, seconds: frames / SR,
});
const sources = () => FakeNode.made.filter((n) => n.kind === 'source');

beforeEach(() => {
  FakeNode.made = [];
  FakeContext.made = [];
  FakeContext.decodeAnswer = null;
  FakeContext.asleep = false;
  vi.stubGlobal('AudioContext', FakeContext);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoopEngine', () => {
  it('makes no audio context until it is asked for sound', () => {
    const engine = new LoopEngine(DEFAULT_SETTINGS);
    engine.setSettings({ ...DEFAULT_SETTINGS, low: 6 });
    expect(engine.playing).toBe(false);
    expect(engine.position()).toBe(0);
    expect(FakeContext.made).toHaveLength(0);
  });

  it('plays the loop, looping, after waking a context the browser kept asleep', async () => {
    const engine = new LoopEngine(DEFAULT_SETTINGS);
    engine.setLoop(loopOf(SR * 2));
    expect(engine.playing).toBe(false);
    await engine.play();
    const ctx = FakeContext.made[0]!;
    expect(ctx.resumed).toBe(1);
    expect(engine.playing).toBe(true);
    const source = sources().at(-1)!;
    expect(source.loop).toBe(true);
    expect(source.started).toBe(1);
    expect((source.buffer as FakeBuffer).getChannelData(1)[10]).toBe(-0.25);
  });

  it('says AUDIO_ASLEEP when the sound card does not wake, instead of waiting for ever', async () => {
    vi.useFakeTimers();
    FakeContext.asleep = true;
    const engine = new LoopEngine(DEFAULT_SETTINGS);
    engine.setLoop(loopOf(SR));
    const played = expect(engine.play()).rejects.toThrow('AUDIO_ASLEEP');
    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS + 1);
    await played;
    expect(engine.playing).toBe(false);
    expect(sources().filter((n) => n.started > 0)).toHaveLength(0);
    vi.useRealTimers();
  });

  it('does nothing when asked to play with no loop', async () => {
    const engine = new LoopEngine(DEFAULT_SETTINGS);
    await engine.play();
    expect(engine.playing).toBe(false);
    expect(sources()).toHaveLength(0);
  });

  it('says where the playhead is inside the lap, and 0 once stopped', async () => {
    const engine = new LoopEngine(DEFAULT_SETTINGS);
    engine.setLoop(loopOf(SR * 2));
    await engine.play();
    const ctx = FakeContext.made[0]!;
    ctx.currentTime = 5.5; // two laps and a half
    expect(engine.position()).toBeCloseTo(1.5, 6);
    engine.stop();
    expect(engine.position()).toBe(0);
    expect(sources().at(-1)!.stopped).toBe(1);
  });

  it('a loop replaced while it plays keeps playing; replaced while stopped, it stays stopped', async () => {
    const engine = new LoopEngine(DEFAULT_SETTINGS);
    engine.setLoop(loopOf(SR));
    await engine.play();
    const first = sources().at(-1)!;
    engine.setLoop(loopOf(SR * 3));
    await Promise.resolve();
    await Promise.resolve();
    expect(first.stopped).toBe(1);
    expect(engine.playing).toBe(true);
    expect((sources().at(-1)!.buffer as FakeBuffer).length).toBe(SR * 3);
    engine.stop();
    const count = sources().length;
    engine.setLoop(loopOf(SR));
    await Promise.resolve();
    expect(engine.playing).toBe(false);
    expect(sources()).toHaveLength(count);
  });

  it('builds the chain once and moves its knobs when a setting changes', async () => {
    const engine = new LoopEngine(DEFAULT_SETTINGS);
    engine.setLoop(loopOf(SR));
    await engine.play();
    const compressors = () => FakeNode.made.filter((n) => n.kind === 'compressor').length;
    expect(compressors()).toBe(1);
    engine.stop();
    await engine.play();
    expect(compressors()).toBe(1);
    engine.setSettings({ ...DEFAULT_SETTINGS, low: 9, gainDb: 6 });
    const shelves = FakeNode.made.filter((n) => n.kind === 'biquad' && n.type === 'lowshelf');
    expect(shelves[0]!.gain.value).toBe(9);
  });

  it('lets go of the sound card, and can be used again afterwards', async () => {
    const engine = new LoopEngine(DEFAULT_SETTINGS);
    engine.setLoop(loopOf(SR));
    await engine.play();
    await engine.dispose();
    expect(FakeContext.made[0]!.state).toBe('closed');
    expect(engine.playing).toBe(false);
    engine.setLoop(loopOf(SR));
    await engine.play();
    expect(FakeContext.made).toHaveLength(2);
    expect(engine.playing).toBe(true);
  });

  it('decodes a file into two channels: a mono file plays on both sides', async () => {
    const mono = new FakeBuffer(1, SR * 3, SR);
    mono.getChannelData(0).fill(0.5);
    FakeContext.decodeAnswer = async () => mono;
    const decoded = await new LoopEngine(DEFAULT_SETTINGS).decode(new ArrayBuffer(8));
    expect(decoded.channels).toHaveLength(2);
    expect(decoded.channels[1]![100]).toBe(0.5);
    expect(decoded.seconds).toBe(3);
    // Copies: nothing holds the decoded buffer.
    decoded.channels[0]![0] = 0.9;
    expect(mono.getChannelData(0)[0]).toBe(0.5);
  });

  it('says in a code why a file was refused', async () => {
    const engine = new LoopEngine(DEFAULT_SETTINGS);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    FakeContext.decodeAnswer = () => Promise.reject(new Error('EncodingError'));
    await expect(engine.decode(new ArrayBuffer(8))).rejects.toThrow('NOT_DECODED');
    FakeContext.decodeAnswer = async () => new FakeBuffer(2, SR * (MAX_SOURCE_SECONDS + 1), SR);
    await expect(engine.decode(new ArrayBuffer(8))).rejects.toThrow('TOO_LONG');
    FakeContext.decodeAnswer = async () => new FakeBuffer(2, 1, SR);
    await expect(engine.decode(new ArrayBuffer(8))).rejects.toThrow('EMPTY_SOUND');
  });

  it('says NO_WEB_AUDIO in a browser without it', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => new LoopEngine(DEFAULT_SETTINGS).context()).toThrow('NO_WEB_AUDIO');
  });
});

describe('helpers', () => {
  it('takes the first two channels of a buffer', () => {
    const b = new FakeBuffer(6, 4, SR);
    b.getChannelData(1).fill(0.3);
    const [left, right] = stereoOf(b as unknown as AudioBuffer);
    expect(left).toHaveLength(4);
    expect(right![0]).toBeCloseTo(0.3, 6);
  });

  it('rejects with its code what has not settled in time, and passes on what has', async () => {
    vi.useFakeTimers();
    const slow = withDeadline(new Promise(() => undefined), 1000, 'TOO_SLOW');
    const caught = expect(slow).rejects.toThrow('TOO_SLOW');
    await vi.advanceTimersByTimeAsync(1001);
    await caught;
    await expect(withDeadline(Promise.resolve(7), 1000, 'TOO_SLOW')).resolves.toBe(7);
    await expect(withDeadline(Promise.reject(new Error('BOOM')), 1000, 'TOO_SLOW')).rejects.toThrow('BOOM');
    vi.useRealTimers();
  });
});
