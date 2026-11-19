/**
 * Waveform.tsx — the sound drawn over the full width, and the loop's two handles.
 *
 * The wave is a canvas, redrawn only when the view, the loop, the size or the
 * theme changes. The handles and the playhead are DOM elements above it: a
 * handle is a real `slider` (keyboard, screen reader), and the playhead moves
 * by `transform` alone, so a loop that plays for minutes repaints nothing
 * (style-cartouche §7).
 *
 * Gestures: drag a handle; drag inside the loop to slide it; drag anywhere
 * else to draw a new loop; wheel to zoom on the pointer; Shift + wheel to
 * slide the view. Alt held leaves the grid.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { viewPeaks, type PeakCache } from '../dsp/peaks';
import { beatSeconds, snapToGrid, type Tempo } from '../dsp/tempo';
import type { T } from '../i18n/strings';
import { clampSpan, formatTime, MIN_SPAN, moveLoop, panSpan, secondsAt, withEdge, xAt, zoomSpan, type Span } from './viewMath';
import { readThemeColors, type ThemeColors } from './themeColors';

interface Props {
  channels: readonly Float32Array[];
  cache: PeakCache | null;
  sampleRate: number;
  /** Seconds of the whole sound. */
  total: number;
  view: Span;
  loop: Span;
  tempo: Pick<Tempo, 'bpm' | 'firstBeat'> | null;
  snap: boolean;
  /** Seconds of the source under the playhead, or null when nothing plays. Read on every frame while `playing`. */
  playheadAt: () => number | null;
  playing: boolean;
  onLoop: (loop: Span) => void;
  onView: (view: Span) => void;
  /** The small strip that shows the whole sound: no handles, a drag moves the view. */
  overview?: boolean;
  label: string;
  t: T;
}

type Drag =
  | { kind: 'from' | 'to' }
  | { kind: 'move'; grab: number; loop: Span }
  | { kind: 'draw'; anchor: number; startX: number; moved: boolean }
  | { kind: 'view' };

const HEIGHT = 168;
const OVERVIEW_HEIGHT = 44;
/** A drag shorter than this, in pixels, is a click: it does not replace the loop. */
const DRAW_THRESHOLD = 4;

/** The waveform strip, or the overview strip when `overview`. */
export function Waveform(props: Props) {
  const { channels, cache, sampleRate, total, view, loop, tempo, snap, playheadAt, playing, onLoop, onView, overview = false, label, t } = props;
  const wrap = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const playhead = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [width, setWidth] = useState(0);
  const [colors, setColors] = useState<ThemeColors | null>(null);
  const height = overview ? OVERVIEW_HEIGHT : HEIGHT;
  // The overview always shows the whole sound, whatever the zoom.
  const shown: Span = overview ? { from: 0, to: Math.max(MIN_SPAN, total) } : view;

  // The width of the strip, followed.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The theme's colours, read at mount and again whenever the host changes
  // them. Not batched by requestAnimationFrame: a hidden window gets none
  // (Pixel FX, 2026-11-14), and the observer already groups the changes.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const read = () => setColors(readThemeColors(el));
    read();
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme', 'class'] });
    return () => observer.disconnect();
  }, []);

  // The wave itself.
  useEffect(() => {
    const el = canvas.current;
    if (!el || width <= 0 || !colors) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.round(width * ratio);
    el.height = Math.round(height * ratio);
    const g = el.getContext('2d');
    if (!g) return;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, width, height);

    const x0 = xAt(loop.from, width, shown);
    const x1 = xAt(loop.to, width, shown);
    g.fillStyle = colors.loopFill;
    g.fillRect(x0, 0, Math.max(1, x1 - x0), height);

    // Beat lines, when a beat is wide enough to be told from its neighbour.
    if (!overview && tempo && tempo.bpm > 0) {
      const beat = beatSeconds(tempo.bpm);
      const beatPx = (beat / (shown.to - shown.from)) * width;
      if (beatPx >= 8) {
        g.fillStyle = colors.grid;
        const first = Math.ceil((shown.from - tempo.firstBeat) / beat);
        for (let k = first; ; k++) {
          const x = Math.round(xAt(tempo.firstBeat + k * beat, width, shown));
          if (x > width) break;
          g.fillRect(x, 0, 1, height);
        }
      }
    }

    const peaks = viewPeaks(channels, cache, shown.from * sampleRate, shown.to * sampleRate, width);
    const mid = height / 2;
    const scale = mid - 2;
    for (let x = 0; x < width; x++) {
      const inside = x >= x0 && x < x1;
      g.fillStyle = inside ? colors.waveLoop : colors.wave;
      const top = mid - (peaks.max[x] ?? 0) * scale;
      const bottom = mid - (peaks.min[x] ?? 0) * scale;
      g.fillRect(x, Math.min(top, bottom), 1, Math.max(1, Math.abs(bottom - top)));
    }

    if (overview) {
      // The part the main view shows.
      g.strokeStyle = colors.viewBox;
      g.lineWidth = 1;
      const v0 = xAt(view.from, width, shown);
      const v1 = xAt(view.to, width, shown);
      g.strokeRect(Math.round(v0) + 0.5, 0.5, Math.max(2, Math.round(v1 - v0) - 1), height - 1);
    }
  }, [channels, cache, sampleRate, width, height, colors, shown.from, shown.to, loop.from, loop.to, view.from, view.to, tempo?.bpm, tempo?.firstBeat, overview]); // eslint-disable-line react-hooks/exhaustive-deps

  // The playhead: one frame loop while something plays, cancelled when it stops.
  useEffect(() => {
    const el = playhead.current;
    if (!el) return;
    // "Reduce motion" (style-cartouche §7): no line travels across the wave.
    // The transport button still says that the loop plays.
    const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!playing || width <= 0 || still) {
      el.style.opacity = '0';
      return;
    }
    let frame = 0;
    const tick = () => {
      const at = playheadAt();
      if (at === null || at < shown.from || at > shown.to) el.style.opacity = '0';
      else {
        el.style.opacity = '1';
        el.style.transform = `translateX(${xAt(at, width, shown).toFixed(1)}px)`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.style.opacity = '0';
    };
  }, [playing, playheadAt, width, shown.from, shown.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const secondsOf = useCallback((clientX: number): number => {
    const rect = wrap.current?.getBoundingClientRect();
    return secondsAt(clientX - (rect?.left ?? 0), rect?.width || width, shown);
  }, [width, shown.from, shown.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const gridded = useCallback((seconds: number, free: boolean): number =>
    (snap && tempo && !free ? snapToGrid(seconds, tempo) : seconds), [snap, tempo]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const at = secondsOf(e.clientX);
    const edge = (e.target as HTMLElement).dataset.edge as 'from' | 'to' | undefined;
    if (overview) drag.current = { kind: 'view' };
    else if (edge) drag.current = { kind: edge };
    else if (at > loop.from && at < loop.to) drag.current = { kind: 'move', grab: at, loop };
    else drag.current = { kind: 'draw', anchor: at, startX: e.clientX, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (overview) onView(panSpan(view, at - (view.from + view.to) / 2, total));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const at = secondsOf(e.clientX);
    if (d.kind === 'view') onView(panSpan(view, at - (view.from + view.to) / 2, total));
    else if (d.kind === 'from' || d.kind === 'to') onLoop(withEdge(loop, d.kind, gridded(at, e.altKey), total));
    else if (d.kind === 'move') {
      const slid = moveLoop(d.loop, at - d.grab, total);
      const from = gridded(slid.from, e.altKey);
      onLoop(moveLoop(d.loop, from - d.loop.from, total));
    } else if (d.kind === 'draw') {
      if (!d.moved && Math.abs(e.clientX - d.startX) < DRAW_THRESHOLD) return;
      d.moved = true;
      onLoop(clampSpan({ from: gridded(Math.min(d.anchor, at), e.altKey), to: gridded(Math.max(d.anchor, at), e.altKey) }, total));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  // Wheel: zoom on the pointer, Shift slides. Registered by hand: React's
  // wheel listener is passive and cannot stop the page from scrolling.
  useEffect(() => {
    const el = wrap.current;
    if (!el || overview) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const span = view.to - view.from;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        onView(panSpan(view, ((e.deltaX || e.deltaY) / Math.max(1, width)) * span, total));
      } else {
        onView(zoomSpan(view, e.deltaY > 0 ? 1.25 : 0.8, secondsOf(e.clientX), total));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [overview, view, total, width, onView, secondsOf]);

  const onHandleKey = (edge: 'from' | 'to') => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = tempo && snap && !e.altKey ? beatSeconds(tempo.bpm) : (view.to - view.from) / Math.max(50, width);
    const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    const now = edge === 'from' ? loop.from : loop.to;
    onLoop(withEdge(loop, edge, gridded(now + dir * step * (e.shiftKey ? 10 : 1), e.altKey), total));
  };

  const handle = (edge: 'from' | 'to') => {
    const seconds = edge === 'from' ? loop.from : loop.to;
    const x = xAt(seconds, width, shown);
    if (x < -1 || x > width + 1) return null;
    return (
      <div
        className={`ml-handle ${edge}`}
        data-edge={edge}
        role="slider"
        tabIndex={0}
        aria-label={t(edge === 'from' ? 'wave.start' : 'wave.end')}
        aria-valuemin={0}
        aria-valuemax={Number(total.toFixed(3))}
        aria-valuenow={Number(seconds.toFixed(3))}
        aria-valuetext={formatTime(seconds)}
        style={{ transform: `translateX(${x.toFixed(1)}px)` }}
        onKeyDown={onHandleKey(edge)}
      />
    );
  };

  return (
    <div
      ref={wrap}
      className={overview ? 'ml-wave-strip overview' : 'ml-wave-strip'}
      style={{ height }}
      role="group"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvas} style={{ width: '100%', height }} />
      {!overview && handle('from')}
      {!overview && handle('to')}
      <div ref={playhead} className="ml-playhead" aria-hidden="true" />
    </div>
  );
}
