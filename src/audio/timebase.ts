/**
 * timebase.ts — a stretch of sound rewritten at another speed or pitch, off line.
 *
 * Two ways, the person picks (settings.keepPitch):
 *
 *  - the record way: the sound is simply read faster or slower by the
 *    browser's own resampler. Speed and pitch move together.
 *  - pitch kept: Signalsmith Stretch (Geraint Luff, MIT), vendored as one
 *    file in src/vendor/signalsmith-stretch and never modified. It is an
 *    AudioWorklet node running WebAssembly; here it runs inside an
 *    OfflineAudioContext, so the result is a buffer like any other and the
 *    seam is baked after it (audio/pipeline.ts).
 *
 * Both render exactly `round(length / ratio)` frames: the pipeline maps the
 * region by that same ratio.
 *
 * The vendored file is NOT bundled. It builds its worklet by turning one of
 * its own functions into text; a minifier renames what that function reaches
 * outside itself, and the worklet then dies on "ae is not defined" while the
 * page waits for ever (seen on the production build, 2026-11-19; the dev
 * server does not minify and showed nothing). So the file is shipped as an
 * asset, byte for byte, read as text and imported from a Blob: the bytes that
 * run are the bytes of src/vendor, whatever type the host serves `.mjs` with.
 */
import stretchUrl from '../vendor/signalsmith-stretch/SignalsmithStretch.mjs?url';
import { bufferOf, offlineContext, stereoOf, withDeadline } from './engine';
import { durationRatio, type TimeChange, type TimeTransform } from './pipeline';

/** A stretch that has not answered by then is reported: a worklet that never loads would wait for ever. */
export const STRETCH_TIMEOUT_MS = 45_000;

/** What audio/timebase.ts calls of the node; its full interface is in the README of the npm package. */
interface StretchNode extends AudioNode {
  addBuffers(channels: Float32Array[]): Promise<number>;
  schedule(change: { output?: number; active?: boolean; input?: number; rate?: number; semitones?: number }): void;
}
type StretchFactory = (context: BaseAudioContext, options?: AudioWorkletNodeOptions) => Promise<StretchNode>;

let loading: Promise<StretchFactory> | null = null;

/** The vendored module, loaded once. A failed load is forgotten, so the next change of speed tries again. */
function loadStretch(): Promise<StretchFactory> {
  loading ??= (async () => {
    const res = await fetch(new URL(stretchUrl, document.baseURI));
    if (!res.ok) throw new Error(`stretch module not fetched (${res.status})`);
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
    try {
      const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown };
      if (typeof mod.default !== 'function') throw new Error('stretch module has no default export');
      return mod.default as StretchFactory;
    } finally {
      URL.revokeObjectURL(url);
    }
  })().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

async function recordWay(channels: Float32Array[], sampleRate: number, ratio: number): Promise<Float32Array[]> {
  const frames = Math.max(2, Math.round((channels[0]?.length ?? 0) / ratio));
  const ctx = offlineContext(2, frames, sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = bufferOf(ctx, channels, sampleRate);
  source.playbackRate.value = ratio;
  source.connect(ctx.destination);
  source.start();
  return stereoOf(await ctx.startRendering());
}

async function pitchKept(channels: Float32Array[], sampleRate: number, change: TimeChange): Promise<Float32Array[]> {
  const createStretch = await loadStretch();
  const length = channels[0]?.length ?? 0;
  const frames = Math.max(2, Math.round(length / change.speed));
  const ctx = offlineContext(2, frames, sampleRate);
  const node = await createStretch(ctx, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  await node.addBuffers(channels);
  // `output: 0` is the first frame rendered; the node makes up for its own latency.
  node.schedule({ output: 0, active: true, input: 0, rate: change.speed, semitones: change.semitones });
  node.connect(ctx.destination);
  return stereoOf(await ctx.startRendering());
}

/**
 * The transform the screen uses. Rejects with STRETCH_TIMEOUT or
 * STRETCH_FAILED; the caller says so and keeps the loop it had. Both ways are
 * bounded: an offline render that never ends would leave the screen on
 * "preparing the loop" for ever.
 */
export const browserTransform: TimeTransform = async (channels, sampleRate, change) => {
  const ratio = durationRatio(change);
  try {
    if (!change.keepPitch) return await withDeadline(recordWay(channels, sampleRate, ratio), STRETCH_TIMEOUT_MS, 'STRETCH_TIMEOUT');
    return await withDeadline(pitchKept(channels, sampleRate, change), STRETCH_TIMEOUT_MS, 'STRETCH_TIMEOUT');
  } catch (err) {
    if (err instanceof Error && err.message === 'STRETCH_TIMEOUT') throw err;
    console.error('[music-loop] Signalsmith Stretch did not run', err);
    throw new Error('STRETCH_FAILED');
  }
};
