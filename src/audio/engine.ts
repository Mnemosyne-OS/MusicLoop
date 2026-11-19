/**
 * engine.ts — the Web Audio side: decoding a file, playing the loop, writing the export.
 *
 * One AudioContext for the whole window, created at the first gesture (a
 * browser refuses sound before one). Everything is decoded AT that context's
 * sample rate: `decodeAudioData` resamples, so the source, the loop and the
 * exported file all share one rate and nothing is resampled twice.
 *
 * jsdom has no Web Audio: this file is verified by numbers in a real browser
 * (doc 249 §12), and the screen is tested against a stand-in of it.
 */
import { fadeOutTail } from '../dsp/loop';
import { holdUnderCeiling } from '../dsp/level';
import { buildChain, type Chain } from './chain';
import { maxExportSeconds, planExport } from './exportPlan';
import type { PreparedLoop } from './pipeline';
import type { LoopSettings } from './settings';

/** Longest source taken: ten minutes is 230 MB of samples in memory at 48 kHz stereo. */
export const MAX_SOURCE_SECONDS = 600;
/** Longest export: four minutes of 16-bit stereo at 48 kHz stays under the 50 MB the host door takes. */
export const MAX_EXPORT_SECONDS = 240;
/** A decode that has not answered by then is reported; the browser cannot be told to stop it. */
export const DECODE_TIMEOUT_MS = 60_000;
/** A sound card that has not woken after this long is reported: `resume()` can stay pending for ever. */
export const RESUME_TIMEOUT_MS = 5_000;
/** The file stops on a fade this long, so it does not end on a click. */
const EXPORT_FADE_SECONDS = 0.01;

/** A sound file, decoded: what the screen draws and cuts a loop from. */
export interface DecodedSource {
  /** Always two channels: a mono file is played on both sides. */
  channels: Float32Array[];
  sampleRate: number;
  seconds: number;
}

type ContextCtor = new (options?: AudioContextOptions) => AudioContext;
type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

const contextCtor = (): ContextCtor | null => {
  const w = window as unknown as { AudioContext?: ContextCtor; webkitAudioContext?: ContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
};
const offlineCtor = (): OfflineCtor | null => {
  const w = window as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  return w.OfflineAudioContext ?? w.webkitOfflineAudioContext ?? null;
};

/** A context that renders to a buffer instead of the sound card. Throws NO_WEB_AUDIO in a browser without it. */
export function offlineContext(channels: number, frames: number, sampleRate: number): OfflineAudioContext {
  const Ctor = offlineCtor();
  if (!Ctor) throw new Error('NO_WEB_AUDIO');
  return new Ctor(channels, Math.max(1, frames), sampleRate);
}

/** Rejects with `code` when `promise` has not settled after `ms`. */
export function withDeadline<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** An AudioBuffer as two plain channels, copied out so nothing holds the buffer. */
export function stereoOf(buffer: AudioBuffer): Float32Array[] {
  const left = buffer.getChannelData(0).slice();
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : left.slice();
  return [left, right];
}

/** Plain channels as an AudioBuffer of `ctx`. */
export function bufferOf(ctx: BaseAudioContext, channels: readonly Float32Array[], sampleRate: number): AudioBuffer {
  const frames = Math.max(1, channels[0]?.length ?? 0);
  const buffer = ctx.createBuffer(Math.max(1, channels.length), frames, sampleRate);
  channels.forEach((ch, i) => buffer.getChannelData(i).set(ch));
  return buffer;
}

/**
 * The audio engine of the window: one context, one chain of effects, the loop
 * that plays. Nothing is created before sound is asked for, and `dispose()`
 * gives the sound card back.
 */
export class LoopEngine {
  private ctx: AudioContext | null = null;
  private chain: Chain | null = null;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private startedAt = 0;
  private settings: LoopSettings;

  constructor(settings: LoopSettings) {
    this.settings = settings;
  }

  /** The context, created at the first call. Throws NO_WEB_AUDIO in a browser without it. */
  context(): AudioContext {
    if (!this.ctx) {
      const Ctor = contextCtor();
      if (!Ctor) throw new Error('NO_WEB_AUDIO');
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    }
    return this.ctx;
  }

  get sampleRate(): number {
    return this.context().sampleRate;
  }

  /** The bytes of a sound file as two channels at the context's rate. */
  async decode(bytes: ArrayBuffer): Promise<DecodedSource> {
    const ctx = this.context();
    let buffer: AudioBuffer;
    try {
      buffer = await withDeadline(ctx.decodeAudioData(bytes), DECODE_TIMEOUT_MS, 'DECODE_TIMEOUT');
    } catch (err) {
      if (err instanceof Error && err.message === 'DECODE_TIMEOUT') throw err;
      console.error('[music-loop] the file was not decoded', err);
      throw new Error('NOT_DECODED');
    }
    if (buffer.duration > MAX_SOURCE_SECONDS) throw new Error('TOO_LONG');
    if (buffer.length < 2) throw new Error('EMPTY_SOUND');
    return { channels: stereoOf(buffer), sampleRate: buffer.sampleRate, seconds: buffer.duration };
  }

  /** The loop to play from now on. A loop already playing is replaced without a gap in the transport. */
  setLoop(loop: PreparedLoop | null): void {
    const wasPlaying = this.playing;
    this.stopSource();
    this.buffer = loop ? bufferOf(this.context(), loop.channels, loop.sampleRate) : null;
    if (wasPlaying && this.buffer) {
      this.play().catch((err) => console.error('[music-loop] the replaced loop did not start again', err));
    }
  }

  /** The settings from now on; the knobs of a chain that exists move at once. */
  setSettings(settings: LoopSettings): void {
    this.settings = settings;
    this.chain?.update(settings);
  }

  /** Whether a loop is playing right now. */
  get playing(): boolean {
    return this.source !== null;
  }

  /** Seconds into the current lap, for the playhead; 0 when stopped. */
  position(): number {
    if (!this.source || !this.buffer || !this.ctx) return 0;
    const elapsed = this.ctx.currentTime - this.startedAt;
    return elapsed > 0 ? elapsed % this.buffer.duration : 0;
  }

  /**
   * Plays the loop from its start. Wakes a context the browser kept asleep;
   * rejects with AUDIO_ASLEEP when it does not wake.
   */
  async play(): Promise<void> {
    if (!this.buffer) return;
    const ctx = this.context();
    if (ctx.state === 'suspended') await withDeadline(ctx.resume(), RESUME_TIMEOUT_MS, 'AUDIO_ASLEEP');
    this.stopSource();
    if (!this.chain) {
      this.chain = buildChain(ctx, this.settings);
      this.chain.output.connect(ctx.destination);
    }
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true;
    source.connect(this.chain.input);
    source.start();
    this.source = source;
    this.startedAt = ctx.currentTime;
  }

  /** Stops the loop. The context and the chain stay, ready for the next play. */
  stop(): void {
    this.stopSource();
  }

  private stopSource(): void {
    if (!this.source) return;
    try {
      this.source.stop();
    } catch (err) {
      console.warn('[music-loop] the source had already stopped', err);
    }
    this.source.disconnect();
    this.source = null;
  }

  /** Releases the sound card. The engine can be used again afterwards: it makes a new context. */
  async dispose(): Promise<void> {
    this.stopSource();
    this.chain?.dispose();
    this.chain = null;
    this.buffer = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== 'closed') {
      await ctx.close().catch((err) => console.warn('[music-loop] the audio context did not close', err));
    }
  }
}

/**
 * The loop repeated for `seconds`, through the same chain as the one that
 * plays, as two channels ready for the WAV writer. `wholeLap` writes one lap
 * instead, taken once the effects have settled: it loops in an editor, tails
 * included, and gets no fade at its end. Which frames are rendered and which
 * are kept: audio/exportPlan.ts.
 */
export async function renderExport(loop: PreparedLoop, settings: LoopSettings, seconds: number, wholeLap = false): Promise<Float32Array[]> {
  const total = Math.min(maxExportSeconds(loop.sampleRate), Math.max(0.05, seconds));
  const plan = planExport(loop.channels[0]?.length ?? 0, loop.sampleRate, settings, total, wholeLap);
  const ctx = offlineContext(2, plan.renderFrames, loop.sampleRate);
  const chain = buildChain(ctx, settings);
  const source = ctx.createBufferSource();
  source.buffer = bufferOf(ctx, loop.channels, loop.sampleRate);
  source.loop = true;
  source.connect(chain.input);
  chain.output.connect(ctx.destination);
  source.start(plan.startSeconds);
  const rendered = await ctx.startRendering();
  const channels = stereoOf(rendered).map((ch) => ch.slice(plan.skipFrames, plan.skipFrames + plan.keepFrames));
  holdUnderCeiling(channels);
  if (!wholeLap) fadeOutTail(channels, Math.round(EXPORT_FADE_SECONDS * loop.sampleRate));
  return channels;
}
