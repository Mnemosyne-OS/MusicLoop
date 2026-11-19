// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { holdUnderCeiling, peakOf, rmsOf, dbToGain, gainToDb, EXPORT_CEILING } from './level';
import { buildPeakCache, PEAK_BLOCK, viewPeaks } from './peaks';

describe('peaks', () => {
  const ramp = Float32Array.from({ length: PEAK_BLOCK * 40 }, (_, i) => i / (PEAK_BLOCK * 40));
  const spike = new Float32Array(PEAK_BLOCK * 40);
  spike[PEAK_BLOCK * 17 + 5] = -0.9;

  it('reads the same columns from the blocks as from the samples', () => {
    const cache = buildPeakCache([ramp]);
    const wide = viewPeaks([ramp], cache, 0, ramp.length, 10);
    const exact = viewPeaks([ramp], null, 0, ramp.length, 10);
    expect(Array.from(wide.max)).toEqual(Array.from(exact.max));
    expect(Array.from(wide.min)).toEqual(Array.from(exact.min));
  });

  it('keeps a one-sample spike visible at any zoom, from any channel', () => {
    const cache = buildPeakCache([ramp, spike]);
    const far = viewPeaks([ramp, spike], cache, 0, ramp.length, 8);
    expect(Math.min(...far.min)).toBeCloseTo(-0.9, 6);
    const near = viewPeaks([ramp, spike], cache, PEAK_BLOCK * 17, PEAK_BLOCK * 18, 64);
    expect(Math.min(...near.min)).toBeCloseTo(-0.9, 6);
  });

  it('draws silence past the end of the sound and for an empty view', () => {
    const past = viewPeaks([ramp], null, ramp.length - 10, ramp.length + 30, 4);
    expect(past.max[3]).toBe(0);
    expect(past.max[0]).toBeGreaterThan(0.99);
    expect(viewPeaks([ramp], null, 5, 5, 4).max).toHaveLength(4);
    expect(viewPeaks([], null, 0, 10, 4).min).toHaveLength(4);
  });

  it('ignores a cache built from another sound', () => {
    const cache = buildPeakCache([new Float32Array(PEAK_BLOCK * 40)]);
    const stale = { ...cache, length: 3 };
    expect(viewPeaks([ramp], stale, 0, ramp.length, 4).max[3]).toBeGreaterThan(0.9);
  });
});

describe('level', () => {
  it('measures peak and RMS over every channel', () => {
    const a = Float32Array.from([0.5, -0.5]);
    const b = Float32Array.from([0.1, -0.8]);
    expect(peakOf([a, b])).toBeCloseTo(0.8, 6);
    expect(rmsOf([a])).toBeCloseTo(0.5, 6);
    expect(rmsOf([])).toBe(0);
  });

  it('converts dB both ways', () => {
    expect(dbToGain(6)).toBeCloseTo(1.9953, 3);
    expect(gainToDb(0.5)).toBeCloseTo(-6.02, 2);
    expect(gainToDb(0)).toBe(-Infinity);
  });

  it('scales a buffer that passes the ceiling down to it, every channel by the same gain', () => {
    const a = Float32Array.from([1.6, -0.4]);
    const b = Float32Array.from([0.8, 0.2]);
    const gain = holdUnderCeiling([a, b]);
    expect(gain).toBeCloseTo(EXPORT_CEILING / 1.6, 6);
    expect(peakOf([a, b])).toBeCloseTo(EXPORT_CEILING, 6);
    expect(b[0]! / a[0]!).toBeCloseTo(0.5, 6);
  });

  it('never raises a quiet buffer', () => {
    const a = Float32Array.from([0.2, -0.1]);
    expect(holdUnderCeiling([a])).toBe(1);
    expect(a[0]).toBeCloseTo(0.2, 6);
  });
});
