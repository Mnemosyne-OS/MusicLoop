/**
 * level.ts — how loud a buffer is, and the last guard before a file is written.
 */

/** dB to a linear gain. */
export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** A linear gain to dB; silence reads -Infinity. */
export const gainToDb = (gain: number): number => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);

/** The largest absolute sample over every channel. */
export function peakOf(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i] ?? 0);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/** Root mean square over every channel: the level an ear follows. */
export function rmsOf(channels: readonly Float32Array[]): number {
  let sum = 0;
  let count = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i] ?? 0;
      sum += v * v;
    }
    count += ch.length;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

/** The ceiling an exported file is held under: -0.2 dBFS, so no 16-bit sample clips. */
export const EXPORT_CEILING = 0.977;

/**
 * Scales the buffer down, in place, when its peak passes `ceiling`. Never up:
 * a quiet loop stays as quiet as the person made it. Returns the gain applied
 * (1 when nothing moved).
 *
 * The compressor at the end of the chain holds the level, but its attack lets
 * the first milliseconds of a hit through; pushed bass does pass 1.0 there.
 */
export function holdUnderCeiling(channels: readonly Float32Array[], ceiling: number = EXPORT_CEILING): number {
  const peak = peakOf(channels);
  if (!(peak > ceiling) || !(ceiling > 0)) return 1;
  const gain = ceiling / peak;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) ch[i] = (ch[i] ?? 0) * gain;
  }
  return gain;
}
