/**
 * pipeline.ts — from the source and a region to the buffer that loops.
 *
 *   region of the source (+ room on both sides)
 *     → speed and pitch, when they are asked for (audio/timebase.ts)
 *     → the seam (dsp/loop.ts)
 *     → reversed, when asked for
 *
 * The seam is baked AFTER the speed change: a stretcher does not give back
 * the two frames that met, so a seam made before it would click again. The
 * region is therefore handed over with room on both sides, and the room is
 * mapped to the new speed before the crossfade reads it.
 *
 * No Web Audio here except through `transform`, which is passed in: the
 * arithmetic of the region is tested without a browser.
 */
import { bakeLoop, clampRegion, reverseChannels, type SeamMode } from '../dsp/loop';
import { changesTime, type LoopSettings } from './settings';

/** The loop inside the source. */
export interface Region {
  /** Frames of the source. */
  start: number;
  end: number;
}

/** What is asked of the time transform. */
export interface TimeChange {
  speed: number;
  semitones: number;
  keepPitch: boolean;
}

/** Rewrites a stretch of sound at another speed or pitch. Resolves to channels at the same sample rate. */
export type TimeTransform = (channels: Float32Array[], sampleRate: number, change: TimeChange) => Promise<Float32Array[]>;

/** The buffer that loops: what is played and what is exported. */
export interface PreparedLoop {
  channels: Float32Array[];
  sampleRate: number;
  seam: SeamMode;
  fadeFrames: number;
  /** Seconds of one lap. */
  seconds: number;
}

/**
 * How many times shorter the sound becomes. With the pitch kept, only the
 * speed counts. Without, the pitch IS a speed (a record turning faster), and
 * the two multiply.
 */
export function durationRatio(change: TimeChange): number {
  const speed = change.speed > 0 ? change.speed : 1;
  return change.keepPitch ? speed : speed * Math.pow(2, change.semitones / 12);
}

/** The stretch handed to the transform: the region and up to `room` frames on each side. */
export function withRoom(region: Region, length: number, room: number): { from: number; to: number; pre: number; post: number } {
  const r = clampRegion(region.start, region.end, length);
  const pre = Math.min(Math.max(0, Math.floor(room)), r.start);
  const post = Math.min(Math.max(0, Math.floor(room)), length - r.end);
  return { from: r.start - pre, to: r.end + post, pre, post };
}

/**
 * The region of `source` as a loop: at the speed and pitch of `settings`, its
 * seam crossfaded, reversed when asked. Rejects with what `transform` rejects
 * with; the settings that only move knobs of the chain are not read here.
 */
export async function prepareLoop(
  source: readonly Float32Array[],
  sampleRate: number,
  region: Region,
  settings: LoopSettings,
  transform: TimeTransform,
): Promise<PreparedLoop> {
  const length = source[0]?.length ?? 0;
  const fade = Math.round((settings.fadeMs / 1000) * sampleRate);
  let baked;
  if (!changesTime(settings)) {
    const r = clampRegion(region.start, region.end, length);
    baked = bakeLoop(source, r.start, r.end, fade);
  } else {
    const change: TimeChange = { speed: settings.speed, semitones: settings.semitones, keepPitch: settings.keepPitch };
    const ratio = durationRatio(change);
    // Room for the crossfade once at the new speed, plus a tenth of a second
    // for the stretcher to settle before the region starts.
    const room = Math.ceil(fade * ratio) + Math.ceil(sampleRate * 0.1 * Math.max(1, ratio));
    const cut = withRoom(region, length, room);
    const stretch = source.map((ch) => ch.slice(cut.from, cut.to));
    const out = await transform(stretch, sampleRate, change);
    const outLength = out[0]?.length ?? 0;
    const r = clampRegion(region.start, region.end, length);
    const start = Math.min(Math.round(cut.pre / ratio), Math.max(0, outLength - 2));
    const end = Math.min(start + Math.max(2, Math.round((r.end - r.start) / ratio)), outLength);
    baked = bakeLoop(out, start, end, fade);
  }
  const channels = settings.reverse ? reverseChannels(baked.channels) : baked.channels;
  return {
    channels,
    sampleRate,
    seam: baked.mode,
    fadeFrames: baked.fadeFrames,
    seconds: (channels[0]?.length ?? 0) / sampleRate,
  };
}
