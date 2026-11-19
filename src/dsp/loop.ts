/**
 * loop.ts — a stretch of a sound turned into a buffer that loops without a click.
 *
 * Pure functions over Float32Array channels: what plays and what is exported
 * are the same baked buffer (doc 249 §5), so one test of the seam covers both.
 *
 * The seam. Cutting [start, end) and repeating it puts sample `end - 1` right
 * before sample `start`: two unrelated values, heard as a click. The bake
 * crossfades so that the two neighbours of the wrap are neighbours in the
 * source too:
 *
 *  - 'pre'  : the last `fade` frames blend into what PRECEDES `start`. The
 *             loop then ends on `source[start - 1]` and wraps to
 *             `source[start]`.
 *  - 'post' : the first `fade` frames blend from what FOLLOWS `end`. The loop
 *             then starts on `source[end]`, right after `source[end - 1]`.
 *  - 'none' : no room on either side (the region is the whole file), or a
 *             fade of 0 was asked for.
 *
 * The gains are equal-power (sin / cos): the two stretches are not the same
 * signal, and a linear crossfade of unrelated material dips by 3 dB in the
 * middle.
 */

export type SeamMode = 'pre' | 'post' | 'none';

export interface LoopBake {
  /** One Float32Array per channel, each `end - start` frames long. */
  channels: Float32Array[];
  /** The crossfade really applied, in frames (0 for 'none'). */
  fadeFrames: number;
  mode: SeamMode;
}

/** A region of `length` frames made legal: whole numbers, at least 2 frames, inside the source. */
export function clampRegion(start: number, end: number, length: number): { start: number; end: number } {
  const len = Math.max(0, Math.floor(length));
  if (len < 2) return { start: 0, end: len };
  let s = Number.isFinite(start) ? Math.floor(start) : 0;
  let e = Number.isFinite(end) ? Math.floor(end) : len;
  if (s > e) [s, e] = [e, s];
  s = Math.min(Math.max(0, s), len - 2);
  e = Math.min(Math.max(s + 2, e), len);
  return { start: s, end: e };
}

/**
 * Bakes [start, end) of `source` into a loop. `fade` is the crossfade asked
 * for, in frames; it is cut down to half the loop and to the room there is
 * around the region.
 */
export function bakeLoop(source: readonly Float32Array[], start: number, end: number, fade: number): LoopBake {
  const length = source[0]?.length ?? 0;
  const r = clampRegion(start, end, length);
  const n = r.end - r.start;
  const wanted = Math.max(0, Math.min(Math.floor(Number.isFinite(fade) ? fade : 0), Math.floor(n / 2)));
  const pre = Math.min(wanted, r.start);
  const post = Math.min(wanted, length - r.end);
  const mode: SeamMode = wanted === 0 || (pre === 0 && post === 0) ? 'none' : pre >= post ? 'pre' : 'post';
  const f = mode === 'pre' ? pre : mode === 'post' ? post : 0;

  const channels = source.map((ch) => {
    const out = ch.slice(r.start, r.end);
    if (mode === 'pre') {
      // t reaches 1 on the last frame, which is then exactly source[start - 1].
      for (let i = 0; i < f; i++) {
        const t = (i + 1) / f;
        const a = (Math.PI / 2) * t;
        out[n - f + i] = (ch[r.end - f + i] ?? 0) * Math.cos(a) + (ch[r.start - f + i] ?? 0) * Math.sin(a);
      }
    } else if (mode === 'post') {
      // t is 0 on the first frame, which is then exactly source[end].
      for (let i = 0; i < f; i++) {
        const t = i / f;
        const a = (Math.PI / 2) * t;
        out[i] = (ch[r.end + i] ?? 0) * Math.cos(a) + (ch[r.start + i] ?? 0) * Math.sin(a);
      }
    }
    return out;
  });
  return { channels, fadeFrames: f, mode };
}

/** The loop played backwards. A reversed loop keeps its seam: the same two frames meet. */
export function reverseChannels(channels: readonly Float32Array[]): Float32Array[] {
  return channels.map((ch) => {
    const out = new Float32Array(ch.length);
    for (let i = 0, j = ch.length - 1; j >= 0; i++, j--) out[i] = ch[j] ?? 0;
    return out;
  });
}

/** The loop laid end to end until `totalFrames` frames are filled; the last lap is cut where the length ends. */
export function repeatToLength(loop: readonly Float32Array[], totalFrames: number): Float32Array[] {
  const total = Math.max(0, Math.floor(totalFrames));
  return loop.map((ch) => {
    const out = new Float32Array(total);
    if (ch.length === 0) return out;
    for (let at = 0; at < total; at += ch.length) {
      const room = total - at;
      out.set(room >= ch.length ? ch : ch.subarray(0, room), at);
    }
    return out;
  });
}

/** Fades the last `frames` frames to silence, in place: an export that stops mid-lap does not end on a click. */
export function fadeOutTail(channels: readonly Float32Array[], frames: number): void {
  for (const ch of channels) {
    const f = Math.max(0, Math.min(Math.floor(frames), ch.length));
    for (let i = 0; i < f; i++) {
      const at = ch.length - f + i;
      ch[at] = (ch[at] ?? 0) * (1 - (i + 1) / f);
    }
  }
}

/** The jump heard when the loop wraps: the largest |first - last| over the channels. */
export function seamJump(channels: readonly Float32Array[]): number {
  let worst = 0;
  for (const ch of channels) {
    if (ch.length < 2) continue;
    worst = Math.max(worst, Math.abs((ch[0] ?? 0) - (ch[ch.length - 1] ?? 0)));
  }
  return worst;
}

/** The largest step between two neighbouring frames inside the loop: what the seam jump is judged against. */
export function largestStep(channels: readonly Float32Array[]): number {
  let worst = 0;
  for (const ch of channels) {
    for (let i = 1; i < ch.length; i++) worst = Math.max(worst, Math.abs((ch[i] ?? 0) - (ch[i - 1] ?? 0)));
  }
  return worst;
}
