// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { seamJump, largestStep } from '../dsp/loop';
import { HOST_FILE_BYTES, limiterDelayFrames, LIMITER_SETTLE_SECONDS, maxExportSeconds, planExport, tailSeconds } from './exportPlan';
import { durationRatio, prepareLoop, withRoom, type TimeTransform } from './pipeline';
import {
  bakeKey, BOUNDS, changesTime, clampSetting, DEFAULT_SETTINGS, driveCurve, filterFor, limiterMakeupDb, parseSettings, reverbImpulse,
} from './settings';

const SR = 48000;
const sine = (frames: number, hz = 220) => Float32Array.from({ length: frames }, (_, i) => 0.8 * Math.sin((2 * Math.PI * hz * i) / SR));

describe('settings', () => {
  it('reads back each field on its own: one bad value does not lose the others', () => {
    const s = parseSettings({ low: 6, mid: 'loud', high: 99, reverse: true, keepPitch: 'yes', speed: 0.1 });
    expect(s).toMatchObject({ low: 6, mid: 0, high: 12, reverse: true, keepPitch: true, speed: 0.5 });
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it('holds a value inside its bounds, and takes the default for what is not a number', () => {
    expect(clampSetting('echoFeedback', 3)).toBe(BOUNDS.echoFeedback.max);
    expect(clampSetting('gainDb', -40)).toBe(-12);
    expect(clampSetting('fadeMs', NaN)).toBe(DEFAULT_SETTINGS.fadeMs);
  });

  it('untouched settings ask for nothing: no boost, no effect heard, no change of time', () => {
    const d = DEFAULT_SETTINGS;
    expect([d.low, d.mid, d.high, d.gainDb, d.filter, d.drive, d.echoMix, d.reverbMix, d.semitones]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(d.speed).toBe(1);
    expect(changesTime(d)).toBe(false);
  });

  it('rebuilds the loop for the settings that rewrite the buffer, and only for them', () => {
    const key = bakeKey(DEFAULT_SETTINGS);
    expect(bakeKey({ ...DEFAULT_SETTINGS, low: 9, echoMix: 0.5, gainDb: 3, filter: -0.5 })).toBe(key);
    for (const change of [{ fadeMs: 5 }, { reverse: true }, { speed: 1.2 }, { keepPitch: false }, { semitones: 2 }]) {
      expect(bakeKey({ ...DEFAULT_SETTINGS, ...change }), JSON.stringify(change)).not.toBe(key);
    }
    expect(changesTime({ speed: 1, semitones: 3 })).toBe(true);
    expect(changesTime({ speed: 0.9, semitones: 0 })).toBe(true);
  });

  it('places the filter: off in the middle, a low-pass down to 200 Hz, a high-pass up to 5 kHz', () => {
    expect(filterFor(0).type).toBe('allpass');
    expect(filterFor(0.01).type).toBe('allpass');
    expect(filterFor(-1)).toEqual({ type: 'lowpass', frequency: 200 });
    expect(filterFor(-0.5).frequency).toBeCloseTo(2000, 6);
    const high = filterFor(1);
    expect(high.type).toBe('highpass');
    expect(high.frequency).toBeCloseTo(5000, 6);
    expect(filterFor(NaN).type).toBe('allpass');
  });

  it('shapes the drive as tanh(k·x)/√k: off at 0, odd, quiet sounds raised by √k and full scale lowered by √k', () => {
    expect(driveCurve(0)).toBeNull();
    const curve = driveCurve(1, 2001)!;
    const k = 12;
    expect(curve[1000]).toBeCloseTo(0, 6);
    expect(curve[2000]).toBeCloseTo(Math.tanh(k) / Math.sqrt(k), 6);
    expect(curve[0]).toBeCloseTo(-curve[2000]!, 6);
    // Slope at the centre: k/√k = √k.
    expect((curve[1001]! - curve[1000]!) / 0.001).toBeCloseTo(Math.sqrt(k), 1);
  });

  it('knows the make-up gain the browser limiter adds (the two values measured on 2026-11-19)', () => {
    expect(limiterMakeupDb(-3, 20)).toBeCloseTo(1.71, 2);
    expect(limiterMakeupDb(-1, 20)).toBeCloseTo(0.57, 2);
    expect(limiterMakeupDb(0, 20)).toBe(0);
  });

  it('generates a reverb tail that is the same twice, dies away, and carries unit energy at any length', () => {
    const a = reverbImpulse(SR, 1.5);
    const b = reverbImpulse(SR, 1.5);
    expect(Array.from(a[0]!.subarray(0, 50))).toEqual(Array.from(b[0]!.subarray(0, 50)));
    expect(a[0]![10]).not.toBe(a[1]![10]);
    const energy = (ch: Float32Array, from: number, to: number) => { let e = 0; for (let i = from; i < to; i++) e += ch[i]! * ch[i]!; return e; };
    const frames = a[0]!.length;
    expect(energy(a[0]!, 0, frames / 10)).toBeGreaterThan(energy(a[0]!, (frames * 9) / 10, frames) * 1000);
    for (const seconds of [0.5, 5]) {
      const [l, r] = reverbImpulse(SR, seconds);
      expect((energy(l!, 0, l!.length) + energy(r!, 0, r!.length)) / 2).toBeCloseTo(1, 3);
    }
  });
});

describe('pipeline', () => {
  const src = [sine(SR * 4), sine(SR * 4, 330)];
  const region = { start: 50000, end: 50000 + 60011 };
  const never: TimeTransform = () => Promise.reject(new Error('the transform must not run'));

  it('at the original speed, bakes the region straight from the source', async () => {
    const loop = await prepareLoop(src, SR, region, DEFAULT_SETTINGS, never);
    expect(loop.channels[0]).toHaveLength(60011);
    expect(loop.seconds).toBeCloseTo(60011 / SR, 9);
    expect(loop.seam).toBe('pre');
    expect(loop.fadeFrames).toBe(Math.round(0.02 * SR));
    expect(seamJump(loop.channels)).toBeLessThanOrEqual(largestStep(src) * 1.001);
  });

  it('plays the loop backwards when asked', async () => {
    const forward = await prepareLoop(src, SR, region, DEFAULT_SETTINGS, never);
    const back = await prepareLoop(src, SR, region, { ...DEFAULT_SETTINGS, reverse: true }, never);
    expect(back.channels[0]![0]).toBe(forward.channels[0]![60010]);
  });

  it('hands the transform the region with room on both sides, then maps the region to the new speed', async () => {
    let seen: { frames: number; speed: number } | null = null;
    // A stand-in that reads the stretch at another speed, sample for sample.
    const resample: TimeTransform = async (channels, _rate, change) => {
      seen = { frames: channels[0]!.length, speed: change.speed };
      const ratio = durationRatio(change);
      const out = Math.round(channels[0]!.length / ratio);
      return channels.map((ch) => Float32Array.from({ length: out }, (_, i) => ch[Math.min(ch.length - 1, Math.round(i * ratio))]!));
    };
    const loop = await prepareLoop(src, SR, region, { ...DEFAULT_SETTINGS, speed: 0.5 }, resample);
    // Half the speed: twice the frames.
    expect(loop.channels[0]).toHaveLength(60011 * 2);
    expect(seen!.speed).toBe(0.5);
    expect(seen!.frames).toBeGreaterThan(60011);
    // The lap starts on the frame the region started on.
    expect(loop.channels[0]![0]).toBeCloseTo(src[0]![region.start]!, 5);
    expect(loop.seam).toBe('pre');
  });

  it('counts the pitch as a speed when the pitch is not kept', () => {
    expect(durationRatio({ speed: 0.8, semitones: 12, keepPitch: true })).toBe(0.8);
    expect(durationRatio({ speed: 1, semitones: 12, keepPitch: false })).toBeCloseTo(2, 9);
    expect(durationRatio({ speed: 0, semitones: 0, keepPitch: true })).toBe(1);
  });

  it('takes no more room than the source has', () => {
    expect(withRoom({ start: 100, end: 900 }, 1000, 500)).toEqual({ from: 0, to: 1000, pre: 100, post: 100 });
    expect(withRoom({ start: 0, end: 1000 }, 1000, 500)).toEqual({ from: 0, to: 1000, pre: 0, post: 0 });
  });

  it('reports a transform that fails, so the screen keeps the loop it had', async () => {
    const broken: TimeTransform = () => Promise.reject(new Error('STRETCH_FAILED'));
    await expect(prepareLoop(src, SR, region, { ...DEFAULT_SETTINGS, speed: 1.5 }, broken)).rejects.toThrow('STRETCH_FAILED');
  });
});

describe('planExport', () => {
  const lap = SR * 2;

  it('a timed file renders the settle silence and the limiter delay in front, and keeps exactly the length asked', () => {
    const plan = planExport(lap, SR, DEFAULT_SETTINGS, 15, false);
    expect(plan.keepFrames).toBe(15 * SR);
    expect(plan.startSeconds).toBe(LIMITER_SETTLE_SECONDS);
    expect(plan.skipFrames).toBe(LIMITER_SETTLE_SECONDS * SR + 288);
    expect(plan.renderFrames).toBe(plan.skipFrames + plan.keepFrames);
  });

  it('knows the delay measured at both common rates', () => {
    expect(limiterDelayFrames(44100)).toBe(264);
    expect(limiterDelayFrames(48000)).toBe(288);
  });

  it('a one-lap file keeps the lap that follows a settled one', () => {
    const plan = planExport(lap, SR, DEFAULT_SETTINGS, 0, true);
    expect(plan).toEqual({ startSeconds: 0, renderFrames: 288 + 2 * lap, skipFrames: 288 + lap, keepFrames: lap });
  });

  it('settles for as many laps as the echo and the reverb ring, up to twelve seconds', () => {
    const ringing = { ...DEFAULT_SETTINGS, reverbMix: 0.4, reverbSeconds: 5 };
    expect(tailSeconds(ringing)).toBe(5);
    expect(planExport(lap, SR, ringing, 0, true).skipFrames).toBe(288 + 3 * lap);
    const echo = { ...DEFAULT_SETTINGS, echoMix: 0.5, echoMs: 500, echoFeedback: 0.5 };
    expect(tailSeconds(echo)).toBeCloseTo(5, 6); // 10 repeats to lose 60 dB
    expect(tailSeconds({ ...echo, echoFeedback: 0 })).toBeCloseTo(0.5, 6);
    expect(tailSeconds(DEFAULT_SETTINGS)).toBe(0);
    const long = { ...DEFAULT_SETTINGS, echoMix: 0.5, echoMs: 1000, echoFeedback: 0.85 };
    expect(planExport(lap, SR, long, 0, true).skipFrames).toBe(288 + 6 * lap);
  });

  it('the longest file is four minutes, or what fits in the 50 MB the host takes at this sample rate', () => {
    expect(maxExportSeconds(44100)).toBe(240);
    expect(maxExportSeconds(48000)).toBe(240);
    // At 96 kHz four minutes would be 92 MB: refused by the host after the whole render.
    const at96 = maxExportSeconds(96000);
    expect(at96).toBe(136);
    expect(44 + at96 * 96000 * 4).toBeLessThanOrEqual(HOST_FILE_BYTES);
    expect(44 + (at96 + 1) * 96000 * 4).toBeGreaterThan(HOST_FILE_BYTES);
    expect(maxExportSeconds(0)).toBe(240);
  });

  it('a very short lap still settles for a quarter of a second', () => {
    const short = SR / 10;
    expect(planExport(short, SR, DEFAULT_SETTINGS, 0, true).skipFrames).toBe(288 + 3 * short);
  });
});
