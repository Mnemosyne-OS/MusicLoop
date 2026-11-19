/**
 * tempo.ts — the tempo of a stretch of music, and the grid of its beats.
 *
 * No library: an onset envelope (how much the energy rises, 400 times a
 * second), its autocorrelation over the lags of 70 to 180 BPM, and the lag
 * whose multiples line up best. It answers for music with a steady pulse and
 * says null for silence. A tempo is a help to place the two handles, never a
 * truth: the person can always move a handle off the grid.
 */

export interface Tempo {
  bpm: number;
  /** Where the first beat falls, in seconds from the start of what was analysed. */
  firstBeat: number;
  /** 0 to 1: how much of the envelope's energy the pulse explains. */
  confidence: number;
}

export const MIN_BPM = 70;
export const MAX_BPM = 180;
/** Envelope samples per second. At 120 BPM a beat is 200 of them. */
const ENVELOPE_RATE = 400;
/** No more than this much sound is analysed: the tempo of a song is in its first minute and a half. */
const MAX_ANALYSED_SECONDS = 90;

/** The energy of a hop is read over this many hops: 20 ms, a full period of a 50 Hz bass note. */
const ENERGY_HOPS = 8;

/**
 * How much the energy rises from one hop to the next, never negative.
 *
 * The energy is read over a window of 20 ms that slides by one hop. Read over
 * one hop alone (2.5 ms), a low held note fills a hop with a different part
 * of its wave each time: its energy then rises and falls on its own, at a
 * rate that has nothing to do with a beat, and the detector found a tempo in
 * a bass drone (cold verification of 2026-11-19).
 */
export function onsetEnvelope(channels: readonly Float32Array[], sampleRate: number): Float32Array {
  const length = Math.min(channels[0]?.length ?? 0, Math.floor(sampleRate * MAX_ANALYSED_SECONDS));
  const hop = Math.max(1, Math.round(sampleRate / ENVELOPE_RATE));
  const hops = Math.floor(length / hop);
  const energies = new Float64Array(hops);
  for (let h = 0; h < hops; h++) {
    let energy = 0;
    const from = h * hop;
    for (const ch of channels) {
      for (let i = from; i < from + hop; i++) {
        const v = ch[i] ?? 0;
        energy += v * v;
      }
    }
    energies[h] = energy;
  }
  const env = new Float32Array(hops);
  const perWindow = hop * ENERGY_HOPS * Math.max(1, channels.length);
  let windowed = 0;
  let previous = 0;
  for (let h = 0; h < hops; h++) {
    windowed += energies[h] ?? 0;
    if (h >= ENERGY_HOPS) windowed -= energies[h - ENERGY_HOPS] ?? 0;
    // Log compression: a loud passage must not outweigh every quiet beat.
    const level = Math.log1p(1000 * (Math.max(0, windowed) / perWindow));
    // The first window has nothing before it: a sound that simply starts is not an onset.
    env[h] = h < ENERGY_HOPS ? 0 : Math.max(0, level - previous);
    previous = level;
  }
  return smooth(env);
}

/**
 * Each onset spread over a few hops (a triangle, 7 hops wide). A beat almost
 * never lasts a whole number of hops; an onset one hop wide then lines up
 * with its neighbour one lag in two, and the wrong tempo wins (120 BPM read
 * as 80 in the first version of this file).
 */
function smooth(env: Float32Array): Float32Array {
  const weights = [1, 2, 3, 4, 3, 2, 1];
  const out = new Float32Array(env.length);
  for (let i = 0; i < env.length; i++) {
    let sum = 0;
    for (let k = 0; k < weights.length; k++) sum += (env[i + k - 3] ?? 0) * weights[k]!;
    out[i] = sum / 16;
  }
  return out;
}

/**
 * An envelope whose strongest onset stays under this is a drone or a hum, not
 * a rhythm. Measured on 2026-11-19: a held bass note (41 to 110 Hz) ripples
 * up to 0.075 and repeats so exactly that it reads as a tempo; four real
 * tracks have a strongest onset of 0.39 to 0.88.
 */
const MIN_ONSET = 0.15;

/**
 * Under this, no pulse is announced. Measured on 2026-11-19 with this file's
 * normalised measure, on 40 seconds of sound: steady clicks at 70 to 174 BPM
 * read 0.93 to 0.97, four real tracks 0.26 to 0.55, and sixty series of
 * clicks thrown at random never pass 0.062 (doc 249 §12.6).
 */
export const MIN_TEMPO_CONFIDENCE = 0.12;

/** A mild preference for tempos near 120 BPM: it settles a tie between a tempo and its double, and nothing else. */
const tempoPrior = (bpm: number): number => Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.2, 2));

/**
 * The tempo of `channels`, or null when no pulse stands out (silence, a
 * drone, noise, onsets with no regularity, less than four seconds).
 *
 * How it decides. The onset envelope has its mean taken out, so a sound that
 * is merely busy (white noise, a crowd) correlates with nothing. Its
 * autocorrelation is divided by its own energy: 1 would be a perfect repeat.
 * Each candidate beat is scored as a comb, by how well the sound repeats one,
 * two, three and four beats later. `confidence` is that normalised repeat at
 * one and two beats. The first version of this file used the raw envelope,
 * always positive: white noise then read as 143 BPM with a confidence of 0.85
 * (cold verification of 2026-11-19).
 */
export function detectTempo(channels: readonly Float32Array[], sampleRate: number): Tempo | null {
  if (!channels.length || !(sampleRate > 0)) return null;
  const raw = onsetEnvelope(channels, sampleRate);
  const rate = sampleRate / Math.max(1, Math.round(sampleRate / ENVELOPE_RATE));
  if (raw.length < rate * 4) return null;
  let strongest = 0;
  let mean = 0;
  for (let i = 0; i < raw.length; i++) {
    strongest = Math.max(strongest, raw[i] ?? 0);
    mean += raw[i] ?? 0;
  }
  if (strongest < MIN_ONSET) return null;
  mean /= raw.length;
  const env = new Float32Array(raw.length);
  let energy = 0;
  for (let i = 0; i < raw.length; i++) {
    const v = (raw[i] ?? 0) - mean;
    env[i] = v;
    energy += v * v;
  }
  if (!(energy > 0)) return null;

  const minLag = Math.floor((60 * rate) / MAX_BPM);
  const maxLag = Math.ceil((60 * rate) / MIN_BPM);
  const top = Math.min(env.length - 1, maxLag * 4 + 1);
  const ac = new Float64Array(top + 1);
  for (let lag = minLag - 1; lag <= top; lag++) {
    let sum = 0;
    for (let i = lag; i < env.length; i++) sum += (env[i] ?? 0) * (env[i - lag] ?? 0);
    ac[lag] = sum / energy;
  }
  const at = (lag: number): number => (lag <= top ? ac[lag] ?? 0 : 0);

  let best = -1;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const comb = at(lag) + at(lag * 2) / 2 + at(lag * 3) / 3 + at(lag * 4) / 4;
    const score = comb * tempoPrior((60 * rate) / lag);
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  if (best < 0) return null;

  // Parabola through the peak and its two neighbours: a lag finer than one hop.
  const y0 = at(best - 1);
  const y1 = at(best);
  const y2 = at(best + 1);
  const bend = y0 - 2 * y1 + y2;
  const shift = bend < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / bend)) : 0;
  const lag = best + shift;
  const confidence = Math.max(0, Math.min(1, (y1 + at(best * 2)) / 2));
  if (confidence < MIN_TEMPO_CONFIDENCE) return null;

  // The phase: the offset whose grid collects the most onsets.
  let offset = 0;
  let offsetScore = -Infinity;
  const whole = Math.round(lag);
  for (let o = 0; o < whole; o++) {
    let sum = 0;
    for (let k = 0; ; k++) {
      const hit = Math.round(o + k * lag);
      if (hit >= raw.length) break;
      sum += raw[hit] ?? 0;
    }
    if (sum > offsetScore) { offsetScore = sum; offset = o; }
  }
  return { bpm: (60 * rate) / lag, firstBeat: offset / rate, confidence };
}

/** Seconds of one beat. */
export const beatSeconds = (bpm: number): number => 60 / bpm;

/**
 * `seconds` moved to the nearest line of the grid. `division` cuts a beat:
 * 1 snaps to beats, 2 to half beats, 4 to quarter beats.
 */
export function snapToGrid(seconds: number, tempo: Pick<Tempo, 'bpm' | 'firstBeat'>, division = 1): number {
  if (!(tempo.bpm > 0) || !(division > 0)) return seconds;
  const step = beatSeconds(tempo.bpm) / division;
  const snapped = tempo.firstBeat + Math.round((seconds - tempo.firstBeat) / step) * step;
  return Math.max(0, snapped);
}
