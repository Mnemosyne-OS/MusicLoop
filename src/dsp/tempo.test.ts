// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { detectTempo, MIN_TEMPO_CONFIDENCE, snapToGrid } from './tempo';

const SR = 44100;

/** A click every beat, the first one at `first` seconds, with a quieter click on the half beat. */
function clicks(bpm: number, seconds: number, first = 0): Float32Array {
  const out = new Float32Array(Math.floor(SR * seconds));
  const beat = (60 / bpm) * SR;
  const hit = (at: number, level: number) => {
    for (let i = 0; i < 400 && at + i < out.length; i++) out[at + i] = (out[at + i] ?? 0) + level * Math.sin(i * 0.5) * Math.exp(-i / 80);
  };
  for (let k = 0; ; k++) {
    const at = Math.round(first * SR + k * beat);
    if (at >= out.length) break;
    hit(at, 0.9);
    const half = Math.round(at + beat / 2);
    if (half < out.length) hit(half, 0.25);
  }
  return out;
}

describe('detectTempo', () => {
  it.each([93, 120, 140, 174])('finds %i BPM within one beat a minute', (bpm) => {
    const tempo = detectTempo([clicks(bpm, 20)], SR);
    expect(tempo).not.toBeNull();
    expect(Math.abs(tempo!.bpm - bpm)).toBeLessThan(1);
  });

  it('places the first beat where the first click is', () => {
    const tempo = detectTempo([clicks(120, 20, 0.2)], SR)!;
    const beat = 60 / tempo.bpm;
    const off = Math.abs(((tempo.firstBeat - 0.2) % beat + beat) % beat);
    expect(Math.min(off, beat - off)).toBeLessThan(0.02);
  });

  it('says null for silence, for a steady tone and for too short a sound', () => {
    expect(detectTempo([new Float32Array(SR * 10)], SR)).toBeNull();
    const tone = Float32Array.from({ length: SR * 10 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR));
    expect(detectTempo([tone], SR)).toBeNull();
    expect(detectTempo([clicks(120, 2)], SR)).toBeNull();
    expect(detectTempo([], SR)).toBeNull();
  });
});

describe('detectTempo, where there is no pulse', () => {
  const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  it('says null for white noise, which once read as 143 BPM with a confidence of 0.85', () => {
    const r = rng(7);
    const noise = Float32Array.from({ length: SR * 20 }, () => 0.5 * (r() * 2 - 1));
    expect(detectTempo([noise], SR)).toBeNull();
  });

  it('says null for clicks thrown at random, whatever their number', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = rng(seed * 7919);
      const out = new Float32Array(SR * 40);
      const count = 30 + (seed % 5) * 40;
      for (let k = 0; k < count; k++) {
        const at = Math.floor(g() * (out.length - 500));
        for (let i = 0; i < 400; i++) out[at + i] = (out[at + i] ?? 0) + 0.9 * Math.sin(i * 0.5) * Math.exp(-i / 80);
      }
      expect(detectTempo([out], SR), `seed ${seed}`).toBeNull();
    }
  });

  it('says null for a held bass note, at both common sample rates', () => {
    for (const rate of [44100, 48000]) {
      for (const hz of [41, 55, 82, 110, 220]) {
        const tone = Float32Array.from({ length: rate * 20 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * hz * i) / rate));
        expect(detectTempo([tone], rate), `${hz} Hz at ${rate}`).toBeNull();
      }
    }
  });

  it('is sure of a steady pulse: its confidence is far above the floor', () => {
    const tempo = detectTempo([clicks(120, 20)], SR)!;
    expect(tempo.confidence).toBeGreaterThan(0.8);
    expect(MIN_TEMPO_CONFIDENCE).toBeLessThan(0.2);
  });
});

describe('snapToGrid', () => {
  const tempo = { bpm: 120, firstBeat: 0.1 };

  it('moves a time to the nearest beat, half beat or quarter beat', () => {
    expect(snapToGrid(1.02, tempo)).toBeCloseTo(1.1, 9);
    expect(snapToGrid(1.3, tempo, 2)).toBeCloseTo(1.35, 9);
    expect(snapToGrid(1.2, tempo, 4)).toBeCloseTo(1.225, 9);
  });

  it('never goes before the start, and leaves a time alone without a tempo', () => {
    expect(snapToGrid(0.01, { bpm: 120, firstBeat: 0.4 })).toBe(0);
    expect(snapToGrid(1.23, { bpm: 0, firstBeat: 0 })).toBe(1.23);
  });
});
