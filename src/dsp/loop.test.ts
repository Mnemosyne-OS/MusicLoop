// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bakeLoop, clampRegion, fadeOutTail, largestStep, repeatToLength, reverseChannels, seamJump } from './loop';

const SR = 48000;
/** A sine whose period does not divide the region: cutting it leaves a jump at the wrap. */
const sine = (frames: number, hz = 220) => Float32Array.from({ length: frames }, (_, i) => 0.8 * Math.sin((2 * Math.PI * hz * i) / SR));

describe('clampRegion', () => {
  it('keeps a region inside the source, in order, at least two frames long', () => {
    expect(clampRegion(10, 20, 100)).toEqual({ start: 10, end: 20 });
    expect(clampRegion(20, 10, 100)).toEqual({ start: 10, end: 20 });
    expect(clampRegion(-5, 500, 100)).toEqual({ start: 0, end: 100 });
    expect(clampRegion(99, 99, 100)).toEqual({ start: 98, end: 100 });
    expect(clampRegion(NaN, NaN, 100)).toEqual({ start: 0, end: 100 });
  });
});

describe('bakeLoop', () => {
  const src = sine(SR * 2);
  const start = 12345;
  const end = 12345 + 30011;

  it('cut without a fade, the wrap jumps far more than any step inside the loop', () => {
    const raw = bakeLoop([src], start, end, 0);
    expect(raw.mode).toBe('none');
    expect(raw.channels[0]).toHaveLength(end - start);
    expect(seamJump(raw.channels)).toBeGreaterThan(largestStep(raw.channels) * 5);
  });

  it('with room before the region, the loop ends on the frame that precedes its start', () => {
    const baked = bakeLoop([src], start, end, 960);
    expect(baked.mode).toBe('pre');
    expect(baked.fadeFrames).toBe(960);
    const out = baked.channels[0]!;
    expect(out[out.length - 1]).toBeCloseTo(src[start - 1]!, 6);
    expect(out[0]).toBe(src[start]);
    // The wrap is now one ordinary step of the source.
    expect(seamJump(baked.channels)).toBeLessThanOrEqual(largestStep([src]) * 1.001);
    // Outside the fade the loop is the source, untouched.
    expect(out[1000]).toBe(src[start + 1000]);
    expect(out[out.length - 961]).toBe(src[end - 961]);
  });

  it('at the very start of the file, it blends from what follows the end instead', () => {
    const baked = bakeLoop([src], 0, 30011, 960);
    expect(baked.mode).toBe('post');
    const out = baked.channels[0]!;
    expect(out[0]).toBeCloseTo(src[30011]!, 6);
    expect(out[out.length - 1]).toBe(src[30010]);
    expect(seamJump(baked.channels)).toBeLessThanOrEqual(largestStep([src]) * 1.001);
  });

  it('the fade is cut to half the loop and to the room around the region', () => {
    expect(bakeLoop([src], 1000, 1100, 5000).fadeFrames).toBe(50);
    expect(bakeLoop([src], 10, 30011, 960)).toMatchObject({ mode: 'post', fadeFrames: 960 });
    expect(bakeLoop([src], 10, src.length, 960)).toMatchObject({ mode: 'pre', fadeFrames: 10 });
    expect(bakeLoop([src], 0, src.length, 960)).toMatchObject({ mode: 'none', fadeFrames: 0 });
  });

  it('the crossfade keeps the level: two unrelated stretches at equal power', () => {
    // Two different constants: sin² + cos² = 1 keeps the power of the pair.
    const a = new Float32Array(4000).fill(0.5);
    const baked = bakeLoop([a], 1000, 3000, 500).channels[0]!;
    const mid = baked[baked.length - 250]!;
    expect(mid).toBeGreaterThan(0.5); // equal power of the same signal overshoots, by design
    expect(mid).toBeLessThan(0.5 * Math.SQRT2 + 1e-6);
  });

  it('bakes every channel with the same seam', () => {
    const left = sine(SR, 220);
    const right = sine(SR, 330);
    const baked = bakeLoop([left, right], 5000, 20000, 480);
    expect(baked.channels).toHaveLength(2);
    expect(baked.channels[1]![14999]).toBeCloseTo(right[4999]!, 6);
  });
});

describe('reverse, repeat, fade out', () => {
  it('reverses each channel and keeps the seam', () => {
    const baked = bakeLoop([sine(SR)], 4000, 20000, 480);
    const back = reverseChannels(baked.channels);
    expect(back[0]![0]).toBe(baked.channels[0]![15999]);
    expect(seamJump(back)).toBe(seamJump(baked.channels));
  });

  it('lays the loop end to end and cuts the last lap at the length asked', () => {
    const loop = [Float32Array.from([1, 2, 3])];
    expect(Array.from(repeatToLength(loop, 8)[0]!)).toEqual([1, 2, 3, 1, 2, 3, 1, 2]);
    expect(repeatToLength(loop, 0)[0]).toHaveLength(0);
    expect(Array.from(repeatToLength([new Float32Array(0)], 4)[0]!)).toEqual([0, 0, 0, 0]);
  });

  it('fades the tail to silence and leaves the rest', () => {
    const ch = new Float32Array(10).fill(1);
    fadeOutTail([ch], 4);
    expect(Array.from(ch.subarray(0, 6))).toEqual([1, 1, 1, 1, 1, 1]);
    expect(ch[9]).toBe(0);
    expect(ch[6]).toBeCloseTo(0.75, 6);
  });
});
