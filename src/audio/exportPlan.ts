/**
 * exportPlan.ts — how many frames to render for a file, and which of them to keep.
 *
 * Two facts decide it, both measured in a browser on 2026-11-19 (doc 249 §12):
 *
 *  - the limiter at the end of the chain delays the sound by 6 ms (264 frames
 *    at 44.1 kHz, 288 at 48 kHz). Rendering exactly the length asked for
 *    would start the file on 6 ms of silence and lose its last 6 ms.
 *  - an echo or a reverb rings past the end of the loop. A file of one lap is
 *    kept to be looped in an editor: its start must already carry the tail of
 *    the lap before, or the loop clicks when it wraps.
 *
 *  - the same limiter wakes up holding the sound down: the first frames of
 *    a render came out at a sixth of their level, and the level was back
 *    after a few hundredths of a second. A quarter of a second of silence
 *    in front lets it settle before the sound starts.
 *
 * So a timed file renders the silence and the delay in front and drops them;
 * a one-lap file renders enough laps for the tails to settle and keeps the
 * last one.
 */
import type { LoopSettings } from './settings';

/** The look-ahead of Chromium's DynamicsCompressorNode, in seconds. */
export const LIMITER_DELAY_SECONDS = 0.006;
/** Silence rendered before the sound starts, for the limiter to settle. */
export const LIMITER_SETTLE_SECONDS = 0.25;
/** No more than this much sound is rendered in front of a one-lap file. */
export const MAX_SETTLE_SECONDS = 12;

/** The limiter's delay in frames at this rate: 264 at 44.1 kHz, 288 at 48 kHz (measured). */
export const limiterDelayFrames = (sampleRate: number): number => Math.floor(LIMITER_DELAY_SECONDS * sampleRate);

/** How long the effects ring after the sound stops, down to -60 dB, in seconds. */
export function tailSeconds(s: Pick<LoopSettings, 'echoMix' | 'echoMs' | 'echoFeedback' | 'reverbMix' | 'reverbSeconds'>): number {
  let tail = 0;
  if (s.echoMix > 0) {
    const feedback = Math.min(0.95, Math.max(0, s.echoFeedback));
    // One repeat when nothing comes back; else the repeats it takes to lose 60 dB.
    const repeats = feedback > 0.001 ? Math.ceil(Math.log(0.001) / Math.log(feedback)) : 1;
    tail = Math.max(tail, (s.echoMs / 1000) * repeats);
  }
  if (s.reverbMix > 0) tail = Math.max(tail, s.reverbSeconds);
  return tail;
}

/** Which frames a render makes and which of them the file keeps. */
export interface ExportPlan {
  /** When the source starts in the render, in seconds: the silence in front of it. */
  startSeconds: number;
  /** Frames the offline context renders. */
  renderFrames: number;
  /** Frames dropped at the start of what was rendered. */
  skipFrames: number;
  /** Frames written to the file. */
  keepFrames: number;
}

/** The plan for a file of `seconds`, or of one settled lap when `wholeLap`. */
export function planExport(lapFrames: number, sampleRate: number, settings: LoopSettings, seconds: number, wholeLap: boolean): ExportPlan {
  const delay = limiterDelayFrames(sampleRate);
  if (!wholeLap) {
    const keepFrames = Math.max(1, Math.round(seconds * sampleRate));
    const settle = Math.round(LIMITER_SETTLE_SECONDS * sampleRate);
    return { startSeconds: settle / sampleRate, renderFrames: settle + delay + keepFrames, skipFrames: settle + delay, keepFrames };
  }
  const lap = Math.max(1, Math.floor(lapFrames));
  const lapSeconds = lap / sampleRate;
  const wanted = Math.max(1, Math.ceil(Math.max(LIMITER_SETTLE_SECONDS, tailSeconds(settings)) / lapSeconds));
  const settle = Math.max(1, Math.min(wanted, Math.floor(MAX_SETTLE_SECONDS / lapSeconds) || 1));
  return { startSeconds: 0, renderFrames: delay + (settle + 1) * lap, skipFrames: delay + settle * lap, keepFrames: lap };
}

/** The bytes the host door takes for one file (`main/ipc/appFileBytes.ts`, APP_BYTES_MAX). */
export const HOST_FILE_BYTES = 50 * 1024 * 1024;
/** The longest export, whatever the sound card: four minutes. */
export const LONGEST_EXPORT_SECONDS = 240;

/**
 * The longest file this sample rate allows, in whole seconds: four minutes,
 * or less when four minutes of 16-bit stereo would pass the 50 MB the host
 * takes. 240 s at 44.1 and 48 kHz; 136 s at 96 kHz, where 240 s would be
 * 92 MB and the save would be refused after the whole render.
 */
export function maxExportSeconds(sampleRate: number): number {
  if (!(sampleRate > 0)) return LONGEST_EXPORT_SECONDS;
  const fits = Math.floor((HOST_FILE_BYTES - 44) / (sampleRate * 4));
  return Math.max(1, Math.min(LONGEST_EXPORT_SECONDS, fits));
}
