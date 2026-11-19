/**
 * settings.ts — everything the person sets on a loop, with its bounds.
 *
 * One plain object, so a kept loop is its region plus this (state/loops.ts),
 * and so the live graph and the exported file are built from the same values
 * (audio/chain.ts). Every field is checked on its own when read back: a
 * loop kept by an older version, or a value edited by hand, loses the one
 * field that is wrong and keeps the rest.
 */

/** Every setting of a loop. A kept loop stores exactly this. */
export interface LoopSettings {
  /** Bass, middle and treble, in dB. */
  low: number;
  mid: number;
  high: number;
  /** One knob, like a DJ filter: below 0 closes a low-pass, above 0 opens a high-pass, 0 is off. */
  filter: number;
  /** Saturation, 0 (off) to 1. */
  drive: number;
  /** Echo: delay in milliseconds, how much comes back, how much is heard (0 is off). */
  echoMs: number;
  echoFeedback: number;
  echoMix: number;
  /** Reverb: length of its tail in seconds, how much is heard (0 is off). */
  reverbSeconds: number;
  reverbMix: number;
  /** Output level in dB, before the limiter. */
  gainDb: number;
  /** Crossfade at the seam of the loop, in milliseconds. */
  fadeMs: number;
  /** The loop played backwards. */
  reverse: boolean;
  /** Speed: 1 is the original, 0.5 half as fast. */
  speed: number;
  /** Speed changed without the pitch following (Signalsmith Stretch); off, it sounds like a record slowed down. */
  keepPitch: boolean;
  /** Pitch in semitones, on its own. */
  semitones: number;
}

/** The range of a numeric setting, and the step of its slider. */
export interface Bound { min: number; max: number; step: number }

/** The bounds of every numeric setting. */
export const BOUNDS: Record<Exclude<keyof LoopSettings, 'reverse' | 'keepPitch'>, Bound> = {
  low: { min: -12, max: 12, step: 0.5 },
  mid: { min: -12, max: 12, step: 0.5 },
  high: { min: -12, max: 12, step: 0.5 },
  filter: { min: -1, max: 1, step: 0.01 },
  drive: { min: 0, max: 1, step: 0.01 },
  echoMs: { min: 40, max: 1000, step: 1 },
  echoFeedback: { min: 0, max: 0.85, step: 0.01 },
  echoMix: { min: 0, max: 1, step: 0.01 },
  reverbSeconds: { min: 0.3, max: 6, step: 0.1 },
  reverbMix: { min: 0, max: 1, step: 0.01 },
  gainDb: { min: -12, max: 12, step: 0.5 },
  fadeMs: { min: 0, max: 200, step: 1 },
  speed: { min: 0.5, max: 2, step: 0.01 },
  semitones: { min: -12, max: 12, step: 1 },
};

/** Settings that change nothing: no boost, no effect heard, the original speed. */
export const DEFAULT_SETTINGS: LoopSettings = {
  low: 0, mid: 0, high: 0,
  filter: 0,
  drive: 0,
  echoMs: 250, echoFeedback: 0.35, echoMix: 0,
  reverbSeconds: 1.8, reverbMix: 0,
  gainDb: 0,
  fadeMs: 20,
  reverse: false,
  speed: 1,
  keepPitch: true,
  semitones: 0,
};

const NUMERIC = Object.keys(BOUNDS) as (keyof typeof BOUNDS)[];

/** A value held inside the bounds of its field; anything that is not a number becomes the default. */
export function clampSetting(key: keyof typeof BOUNDS, value: unknown): number {
  const b = BOUNDS[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS[key];
  return Math.min(b.max, Math.max(b.min, value));
}

/** Whatever was stored, each field checked on its own. */
export function parseSettings(raw: unknown): LoopSettings {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: LoopSettings = { ...DEFAULT_SETTINGS };
  for (const key of NUMERIC) out[key] = clampSetting(key, v[key]);
  out.reverse = typeof v.reverse === 'boolean' ? v.reverse : DEFAULT_SETTINGS.reverse;
  out.keepPitch = typeof v.keepPitch === 'boolean' ? v.keepPitch : DEFAULT_SETTINGS.keepPitch;
  return out;
}

/** The fields that change the baked buffer itself; the others only move knobs of the graph. */
export const bakeKey = (s: LoopSettings): string =>
  [s.fadeMs, s.reverse, s.speed, s.keepPitch, s.semitones].join('|');

/** Whether the speed or the pitch asks for the buffer to be rewritten. */
export const changesTime = (s: Pick<LoopSettings, 'speed' | 'semitones'>): boolean =>
  Math.abs(s.speed - 1) > 1e-6 || s.semitones !== 0;

/** Where the DJ filter sits for a knob value: its type and its cutoff in Hz. */
export function filterFor(knob: number): { type: 'allpass' | 'lowpass' | 'highpass'; frequency: number } {
  const k = Math.min(1, Math.max(-1, Number.isFinite(knob) ? knob : 0));
  if (Math.abs(k) < 0.02) return { type: 'allpass', frequency: 1000 };
  // Low-pass: 20 kHz down to 200 Hz. High-pass: 20 Hz up to 5 kHz. Both by equal ratios, as an ear hears.
  return k < 0
    ? { type: 'lowpass', frequency: 20000 * Math.pow(0.01, -k) }
    : { type: 'highpass', frequency: 20 * Math.pow(250, k) };
}

/** The limiter at the end of the chain: what passes -1 dBFS is held, 20 to 1. */
export const LIMITER_THRESHOLD_DB = -1;
export const LIMITER_RATIO = 20;

/**
 * The gain Chromium's DynamicsCompressorNode adds on its own, in dB, with a
 * knee of 0: 0.6 × the dB a full-scale sound would lose. Measured in a
 * browser on 2026-11-19 with a sine 40 dB under the threshold: +1.71 dB at
 * -3 dB / 20:1 and +0.57 dB at -1 dB / 20:1, the two values this gives.
 */
export const limiterMakeupDb = (thresholdDb: number, ratio: number): number =>
  0.6 * Math.max(0, -thresholdDb) * (1 - 1 / Math.max(1, ratio));

/**
 * The saturation curve of the wave shaper for a drive of 0 to 1, or null when
 * it is off: `tanh(k·x) / √k`. A quiet sound comes out √k times louder and a
 * full-scale one √k times lower, so the knob adds grit without adding 20 dB
 * (the first curve did: +19.3 dB of RMS at 0.8, measured). At a drive near 0
 * the curve is `tanh(x)`: the knob starts where "off" leaves.
 */
export function driveCurve(drive: number, points = 1024): Float32Array | null {
  if (!(drive > 0.005)) return null;
  const k = 1 + Math.min(1, drive) * 11;
  const norm = Math.sqrt(k);
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

/**
 * The tail of a reverb: noise that dies away by 60 dB over `seconds`, two
 * channels that do not match so the tail is wide. Seeded: the same settings
 * give the same file twice.
 */
export function reverbImpulse(sampleRate: number, seconds: number, seed = 0x9e3779b9): Float32Array[] {
  const frames = Math.max(1, Math.floor(sampleRate * Math.max(0.05, seconds)));
  let state = seed >>> 0;
  const next = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const make = () => {
    const ch = new Float32Array(frames);
    for (let i = 0; i < frames; i++) ch[i] = (next() * 2 - 1) * Math.exp((-6.908 * i) / frames);
    return ch;
  };
  const left = make();
  const right = make();
  // Same energy whatever the length, so the mix knob means the same thing at 0.5 s and at 5 s.
  let energy = 0;
  for (let i = 0; i < frames; i++) energy += left[i]! * left[i]! + right[i]! * right[i]!;
  const scale = energy > 0 ? 1 / Math.sqrt(energy / 2) : 1;
  for (let i = 0; i < frames; i++) { left[i] = left[i]! * scale; right[i] = right[i]! * scale; }
  return [left, right];
}
