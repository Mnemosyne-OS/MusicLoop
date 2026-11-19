/**
 * chain.ts — the effects, as one Web Audio graph built from the settings.
 *
 * The same function builds the graph that plays (an AudioContext) and the
 * graph that writes the file (an OfflineAudioContext): what is exported is
 * what was heard.
 *
 *   in → bass → middle → treble ─┬→ filter ─┬→ drive ─┬──────────────┬─→ sum
 *                                └──────────┘         └→ echo (loop) ┘
 *   sum ─┬────────────┬─→ level → limiter → trim → out
 *        └→ reverb ───┘
 *
 * Every node is native: three BiquadFilterNode for the equaliser, one for
 * the filter, a WaveShaperNode, a DelayNode with its feedback, a
 * ConvolverNode fed a generated tail, a DynamicsCompressorNode as limiter.
 */
import { dbToGain } from '../dsp/level';
import { driveCurve, filterFor, limiterMakeupDb, LIMITER_RATIO, LIMITER_THRESHOLD_DB, reverbImpulse, type LoopSettings } from './settings';

/** The three bands of the equaliser: a low shelf, a bell, a high shelf. */
export const EQ_LOW_HZ = 120;
export const EQ_MID_HZ = 1000;
export const EQ_HIGH_HZ = 4000;

/** The graph of effects, with its two ends and the way to move its knobs. */
export interface Chain {
  input: AudioNode;
  output: AudioNode;
  /** Moves the knobs to new settings; smooth on a live context. */
  update(settings: LoopSettings): void;
  /** Disconnects every node. */
  dispose(): void;
}

/** Builds the chain in `ctx`, live or offline, set to `initial`. The caller connects `input` and `output`. */
export function buildChain(ctx: BaseAudioContext, initial: LoopSettings): Chain {
  const input = ctx.createGain();
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = EQ_LOW_HZ;
  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = EQ_MID_HZ;
  mid.Q.value = 0.9;
  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = EQ_HIGH_HZ;
  // The filter has a way round it: switched off, the sound does not go
  // through a biquad at all, so nothing shifts its phase.
  const filter = ctx.createBiquadFilter();
  filter.Q.value = 0.9;
  const filtered = ctx.createGain();
  const unfiltered = ctx.createGain();
  const drive = ctx.createWaveShaper();
  drive.oversample = '4x';

  const sum = ctx.createGain();
  const delay = ctx.createDelay(1.5);
  const feedback = ctx.createGain();
  const echoOut = ctx.createGain();

  const convolver = ctx.createConvolver();
  const reverbOut = ctx.createGain();
  const level = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER_THRESHOLD_DB;
  limiter.knee.value = 0;
  limiter.ratio.value = LIMITER_RATIO;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  // The browser's compressor adds a make-up gain of its own, even to a sound
  // far under its threshold. This takes it back. Measured with untouched
  // settings (doc 249 §12): the level moves by less than 0.1 dB, the sound
  // comes out 6 ms later (audio/exportPlan.ts makes up for it in a file), and
  // what differs from the source sits 30 dB under it.
  const trim = ctx.createGain();
  trim.gain.value = dbToGain(-limiterMakeupDb(LIMITER_THRESHOLD_DB, LIMITER_RATIO));

  input.connect(low).connect(mid).connect(high);
  high.connect(filter).connect(filtered).connect(drive);
  high.connect(unfiltered).connect(drive);
  drive.connect(sum);
  drive.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(echoOut).connect(sum);
  sum.connect(level);
  sum.connect(convolver).connect(reverbOut).connect(level);
  level.connect(limiter).connect(trim);
  convolver.normalize = false; // the generated tail already carries unit energy

  let reverbSeconds = -1;
  const set = (param: AudioParam, value: number) => {
    // A ramp on a live context (no zipper noise under a dragged slider); a
    // plain value on an offline one, where time has not started.
    if (ctx.state === 'running') param.setTargetAtTime(value, ctx.currentTime, 0.015);
    else param.value = value;
  };

  const update = (s: LoopSettings) => {
    set(low.gain, s.low);
    set(mid.gain, s.mid);
    set(high.gain, s.high);
    const f = filterFor(s.filter);
    const off = f.type === 'allpass';
    if (!off) {
      filter.type = f.type;
      set(filter.frequency, f.frequency);
    }
    set(filtered.gain, off ? 0 : 1);
    set(unfiltered.gain, off ? 1 : 0);
    drive.curve = driveCurve(s.drive);
    set(delay.delayTime, s.echoMs / 1000);
    set(feedback.gain, s.echoMix > 0 ? s.echoFeedback : 0);
    set(echoOut.gain, s.echoMix);
    if (s.reverbMix > 0 && s.reverbSeconds !== reverbSeconds) {
      const [left, right] = reverbImpulse(ctx.sampleRate, s.reverbSeconds);
      const buffer = ctx.createBuffer(2, left!.length, ctx.sampleRate);
      buffer.copyToChannel(left!, 0);
      buffer.copyToChannel(right!, 1);
      convolver.buffer = buffer;
      reverbSeconds = s.reverbSeconds;
    }
    set(reverbOut.gain, s.reverbMix);
    set(level.gain, dbToGain(s.gainDb));
  };
  update(initial);

  const nodes: AudioNode[] = [input, low, mid, high, filter, filtered, unfiltered, drive, sum, delay, feedback, echoOut, convolver, reverbOut, level, limiter, trim];
  return {
    input,
    output: trim,
    update,
    dispose() {
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch (err) {
          console.warn('[music-loop] a node of the chain was already disconnected', err);
        }
      }
    },
  };
}
