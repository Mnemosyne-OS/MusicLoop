/**
 * padMixer.ts — the Web Audio side of the pad: several loops at once, one mix.
 *
 * Each pad that plays is its own looping source through its own chain of
 * effects (the settings the loop was kept with), and every chain lands on one
 * master gain. The recorder taps that master: what is written is what is
 * heard. No loop is aligned on another one: a pad starts at the click.
 *
 * jsdom has no Web Audio: the screen is tested against a stand-in of
 * `PadDeck`, and this file is verified by ear and by numbers in a browser.
 */
import { buildChain, type Chain } from '../audio/chain';
import { LoopEngine, RESUME_TIMEOUT_MS, bufferOf, withDeadline, type DecodedSource } from '../audio/engine';
import { maxExportSeconds } from '../audio/exportPlan';
import type { PreparedLoop } from '../audio/pipeline';
import { DEFAULT_SETTINGS, type LoopSettings } from '../audio/settings';

/** The master sits under full level: several limited loops added together still have room. */
export const MASTER_GAIN = 0.7;
/** A tile that is switched off fades out over this long instead of stopping on a click. */
export const FADE_OUT_SECONDS = 0.35;
/** Frames per block handed to the recorder. */
const TAP_FRAMES = 4096;

/** A recorded mix, ready for the WAV writer. */
export interface RecordedMix {
  channels: Float32Array[];
  sampleRate: number;
}

/** What the pad screen asks of the audio side. */
export interface PadDeck {
  decode(bytes: ArrayBuffer): Promise<DecodedSource>;
  /**
   * Starts the loop of pad `id`; a pad already playing is restarted. With
   * `laps`, the loop plays that many times then stops by itself and `onEnd`
   * is called; without, it plays until it is stopped.
   */
  start(id: string, loop: PreparedLoop, settings: LoopSettings, laps?: number | null, onEnd?: () => void): Promise<void>;
  /** Fades the pad out, then stops it. */
  stop(id: string): void;
  stopAll(): void;
  /** Starts recording the mix. `onFull` is called once when the longest file is reached. */
  startRecording(onFull: () => void): Promise<void>;
  /** Stops recording and hands the mix over; null when nothing was being recorded. */
  stopRecording(): RecordedMix | null;
  /** The longest mix that can be saved, in seconds. */
  maxSeconds(): number;
  dispose(): Promise<void>;
}

interface Voice {
  source: AudioBufferSourceNode;
  chain: Chain;
  /** The voice's own level: where the fade-out happens. */
  fade: GainNode;
}

/** Joins recorded blocks into one channel of `frames` frames. */
export function joinBlocks(blocks: readonly Float32Array[], frames: number): Float32Array {
  const out = new Float32Array(Math.max(0, frames));
  let at = 0;
  for (const block of blocks) {
    if (at >= out.length) break;
    const room = out.length - at;
    out.set(room >= block.length ? block : block.subarray(0, room), at);
    at += block.length;
  }
  return out;
}

/** The real deck: one AudioContext, one master, one voice per pad that plays. */
export class PadMixer implements PadDeck {
  private readonly engine = new LoopEngine(DEFAULT_SETTINGS);
  private master: GainNode | null = null;
  private readonly voices = new Map<string, Voice>();
  private tap: ScriptProcessorNode | null = null;
  private left: Float32Array[] = [];
  private right: Float32Array[] = [];
  private frames = 0;

  decode(bytes: ArrayBuffer): Promise<DecodedSource> {
    return this.engine.decode(bytes);
  }

  maxSeconds(): number {
    return maxExportSeconds(this.engine.sampleRate);
  }

  private async awake(): Promise<AudioContext> {
    const ctx = this.engine.context();
    if (ctx.state === 'suspended') await withDeadline(ctx.resume(), RESUME_TIMEOUT_MS, 'AUDIO_ASLEEP');
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.gain.value = MASTER_GAIN;
      this.master.connect(ctx.destination);
    }
    return ctx;
  }

  async start(id: string, loop: PreparedLoop, settings: LoopSettings, laps: number | null = null, onEnd?: () => void): Promise<void> {
    const ctx = await this.awake();
    this.cut(id);
    const chain = buildChain(ctx, settings);
    const fade = ctx.createGain();
    chain.output.connect(fade);
    fade.connect(this.master!);
    const source = ctx.createBufferSource();
    source.buffer = bufferOf(ctx, loop.channels, loop.sampleRate);
    source.loop = true;
    source.connect(chain.input);
    const voice: Voice = { source, chain, fade };
    source.onended = () => {
      // Only a voice that reached the end of its laps by itself reports it:
      // one that was stopped or replaced has already left the map.
      if (this.voices.get(id) !== voice) return;
      this.voices.delete(id);
      this.release(voice);
      onEnd?.();
    };
    source.start();
    if (laps && laps > 0) source.stop(ctx.currentTime + laps * source.buffer.duration);
    this.voices.set(id, voice);
  }

  stop(id: string): void {
    const voice = this.voices.get(id);
    if (!voice) return;
    this.voices.delete(id);
    const ctx = this.engine.context();
    const now = ctx.currentTime;
    voice.fade.gain.setValueAtTime(voice.fade.gain.value, now);
    voice.fade.gain.linearRampToValueAtTime(0, now + FADE_OUT_SECONDS);
    voice.source.onended = () => this.release(voice);
    try {
      voice.source.stop(now + FADE_OUT_SECONDS);
    } catch (err) {
      console.warn('[music-loop] a pad had already stopped', err);
      this.release(voice);
    }
  }

  /** Stops a voice at once, with no fade: the tile is being restarted or the screen is closing. */
  private cut(id: string): void {
    const voice = this.voices.get(id);
    if (!voice) return;
    this.voices.delete(id);
    voice.source.onended = null;
    try {
      voice.source.stop();
    } catch (err) {
      console.warn('[music-loop] a pad had already stopped', err);
    }
    this.release(voice);
  }

  private release(voice: Voice): void {
    voice.source.disconnect();
    voice.chain.dispose();
    voice.fade.disconnect();
  }

  stopAll(): void {
    for (const id of [...this.voices.keys()]) this.stop(id);
  }

  async startRecording(onFull: () => void): Promise<void> {
    const ctx = await this.awake();
    this.dropTap();
    this.left = [];
    this.right = [];
    this.frames = 0;
    const limit = Math.floor(this.maxSeconds() * ctx.sampleRate);
    let full = false;
    const tap = ctx.createScriptProcessor(TAP_FRAMES, 2, 2);
    tap.onaudioprocess = (event) => {
      if (full) return;
      this.left.push(event.inputBuffer.getChannelData(0).slice());
      this.right.push(event.inputBuffer.getChannelData(1).slice());
      this.frames += event.inputBuffer.length;
      if (this.frames >= limit) {
        full = true;
        onFull();
      }
    };
    // A script node only runs while it reaches the output; it writes silence there.
    this.master!.connect(tap);
    tap.connect(ctx.destination);
    this.tap = tap;
  }

  stopRecording(): RecordedMix | null {
    if (!this.tap) return null;
    const sampleRate = this.engine.sampleRate;
    const frames = Math.min(this.frames, Math.floor(this.maxSeconds() * sampleRate));
    this.dropTap();
    const channels = [joinBlocks(this.left, frames), joinBlocks(this.right, frames)];
    this.left = [];
    this.right = [];
    this.frames = 0;
    return { channels, sampleRate };
  }

  private dropTap(): void {
    if (!this.tap) return;
    this.tap.onaudioprocess = null;
    try {
      this.master?.disconnect(this.tap);
      this.tap.disconnect();
    } catch (err) {
      console.warn('[music-loop] the recorder was already disconnected', err);
    }
    this.tap = null;
  }

  async dispose(): Promise<void> {
    for (const id of [...this.voices.keys()]) this.cut(id);
    this.dropTap();
    this.master?.disconnect();
    this.master = null;
    await this.engine.dispose();
  }
}
