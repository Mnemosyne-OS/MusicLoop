/**
 * viewMath.ts — the arithmetic of the waveform: which seconds a pixel shows,
 * how a zoom or a drag moves the view and the region. No DOM, no React.
 */

/** A stretch of the sound, in seconds: the view on screen, or the loop. */
export interface Span {
  from: number;
  to: number;
}

/** The shortest view and the shortest loop: 20 ms. */
export const MIN_SPAN = 0.02;

/** A span held inside [0, total], at least MIN_SPAN long, keeping its length when it can. */
export function clampSpan(span: Span, total: number): Span {
  const max = Math.max(MIN_SPAN, total);
  let from = Number.isFinite(span.from) ? span.from : 0;
  let to = Number.isFinite(span.to) ? span.to : max;
  if (from > to) [from, to] = [to, from];
  let length = Math.min(max, Math.max(MIN_SPAN, to - from));
  if (from < 0) from = 0;
  if (from + length > max) from = Math.max(0, max - length);
  length = Math.min(length, max - from);
  return { from, to: from + length };
}

/** The second shown at pixel `x` of a view `width` pixels wide. */
export const secondsAt = (x: number, width: number, view: Span): number =>
  view.from + (width > 0 ? x / width : 0) * (view.to - view.from);

/** The pixel where `seconds` is drawn. */
export const xAt = (seconds: number, width: number, view: Span): number =>
  (view.to > view.from ? (seconds - view.from) / (view.to - view.from) : 0) * width;

/** The view zoomed by `factor` (below 1 zooms in) around `anchor`, which stays under the pointer. */
export function zoomSpan(view: Span, factor: number, anchor: number, total: number): Span {
  const length = Math.min(Math.max(MIN_SPAN, (view.to - view.from) * factor), Math.max(MIN_SPAN, total));
  const ratio = view.to > view.from ? (anchor - view.from) / (view.to - view.from) : 0.5;
  return clampSpan({ from: anchor - ratio * length, to: anchor + (1 - ratio) * length }, total);
}

/** The view slid by `seconds`, stopped at both ends of the sound. */
export const panSpan = (view: Span, seconds: number, total: number): Span =>
  clampSpan({ from: view.from + seconds, to: view.to + seconds }, total);

/** A view that shows the loop with a sixth of its length on each side. */
export function viewOfLoop(loop: Span, total: number): Span {
  const margin = Math.max(MIN_SPAN, (loop.to - loop.from) / 6);
  return clampSpan({ from: loop.from - margin, to: loop.to + margin }, total);
}

/** The loop slid by `seconds` without changing its length. */
export const moveLoop = (loop: Span, seconds: number, total: number): Span =>
  clampSpan({ from: loop.from + seconds, to: loop.to + seconds }, total);

/** One edge of the loop moved to `seconds`; it never crosses the other edge. */
export function withEdge(loop: Span, edge: 'from' | 'to', seconds: number, total: number): Span {
  const max = Math.max(MIN_SPAN, total);
  if (edge === 'from') return { from: Math.min(Math.max(0, seconds), loop.to - MIN_SPAN), to: loop.to };
  return { from: loop.from, to: Math.max(Math.min(max, seconds), loop.from + MIN_SPAN) };
}

/** 83.4567 → "1:23.457"; under a minute "0:07.250". */
export function formatTime(seconds: number): string {
  // Rounded to the millisecond first: 59.9996 s is 1:00.000, never 0:60.000.
  const ms = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 1000);
  const minutes = Math.floor(ms / 60000);
  return `${minutes}:${((ms - minutes * 60000) / 1000).toFixed(3).padStart(6, '0')}`;
}

/** 1536000 → "1.5 MB", in the units of the reader's language left to the caller: only the number is formatted here. */
export function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
