/**
 * peaks.ts — the lowest and highest sample of each column of a waveform.
 *
 * A ten-minute file is 58 million samples in stereo; scanning them on every
 * redraw of a zoom or a drag is what makes a waveform stutter. So the file is
 * scanned once into blocks of PEAK_BLOCK frames, and a view wide enough reads
 * the blocks. A view zoomed in past the blocks reads the samples themselves,
 * and there are few of them by then.
 */

export const PEAK_BLOCK = 256;

export interface Peaks {
  min: Float32Array;
  max: Float32Array;
}

export interface PeakCache extends Peaks {
  /** Frames of the source the cache was built from. */
  length: number;
}

/** One pass over the whole source: min and max of every PEAK_BLOCK frames, all channels together. */
export function buildPeakCache(channels: readonly Float32Array[]): PeakCache {
  const length = channels[0]?.length ?? 0;
  const blocks = Math.ceil(length / PEAK_BLOCK);
  const min = new Float32Array(blocks);
  const max = new Float32Array(blocks);
  for (let b = 0; b < blocks; b++) {
    let lo = Infinity;
    let hi = -Infinity;
    const from = b * PEAK_BLOCK;
    const to = Math.min(length, from + PEAK_BLOCK);
    for (const ch of channels) {
      for (let i = from; i < to; i++) {
        const v = ch[i] ?? 0;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    min[b] = lo === Infinity ? 0 : lo;
    max[b] = hi === -Infinity ? 0 : hi;
  }
  return { min, max, length };
}

/**
 * The peaks of frames [from, to) drawn over `columns` columns. An empty
 * column (a view wider than the sound) holds 0 and 0.
 */
export function viewPeaks(channels: readonly Float32Array[], cache: PeakCache | null, from: number, to: number, columns: number): Peaks {
  const cols = Math.max(0, Math.floor(columns));
  const min = new Float32Array(cols);
  const max = new Float32Array(cols);
  const length = channels[0]?.length ?? 0;
  const span = to - from;
  if (cols === 0 || !(span > 0) || length === 0) return { min, max };
  const perColumn = span / cols;
  const useCache = cache !== null && cache.length === length && perColumn >= PEAK_BLOCK * 2;
  for (let c = 0; c < cols; c++) {
    const a = Math.max(0, Math.floor(from + c * perColumn));
    const b = Math.min(length, Math.max(a + 1, Math.floor(from + (c + 1) * perColumn)));
    if (a >= length || b <= 0) continue;
    let lo = Infinity;
    let hi = -Infinity;
    if (useCache) {
      const b0 = Math.floor(a / PEAK_BLOCK);
      const b1 = Math.min(cache.min.length, Math.ceil(b / PEAK_BLOCK));
      for (let k = b0; k < b1; k++) {
        const l = cache.min[k] ?? 0;
        const h = cache.max[k] ?? 0;
        if (l < lo) lo = l;
        if (h > hi) hi = h;
      }
    } else {
      for (const ch of channels) {
        for (let i = a; i < b; i++) {
          const v = ch[i] ?? 0;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    min[c] = lo === Infinity ? 0 : lo;
    max[c] = hi === -Infinity ? 0 : hi;
  }
  return { min, max };
}
