// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bytesToBase64, encodeWav16, floatToPcm16, readWavHeader, WAV_HEADER_BYTES } from './wav';

describe('encodeWav16', () => {
  it('writes a header a reader gets the exact duration from', () => {
    const frames = 48000 * 15;
    const bytes = encodeWav16([new Float32Array(frames), new Float32Array(frames)], 48000);
    expect(bytes.length).toBe(WAV_HEADER_BYTES + frames * 4);
    expect(readWavHeader(bytes)).toEqual({ sampleRate: 48000, channels: 2, bitsPerSample: 16, dataBytes: frames * 4, frames, seconds: 15 });
    // RIFF size is the file minus its first 8 bytes.
    expect(new DataView(bytes.buffer).getUint32(4, true)).toBe(bytes.length - 8);
    // Byte rate and block align, which a strict reader checks.
    expect(new DataView(bytes.buffer).getUint32(28, true)).toBe(48000 * 4);
    expect(new DataView(bytes.buffer).getUint16(32, true)).toBe(4);
  });

  it('interleaves left then right, little-endian', () => {
    const bytes = encodeWav16([Float32Array.from([1, 0]), Float32Array.from([-1, 0.5])], 44100);
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(0);
    expect(view.getInt16(50, true)).toBe(16384);
  });

  it('clips an overshoot and never wraps around', () => {
    expect(floatToPcm16(1.7)).toBe(32767);
    expect(floatToPcm16(-3)).toBe(-32768);
    expect(floatToPcm16(NaN)).toBe(0);
  });

  it('refuses what is not a sound', () => {
    expect(() => encodeWav16([], 48000)).toThrow('NO_CHANNEL');
    expect(() => encodeWav16([new Float32Array(2), new Float32Array(3)], 48000)).toThrow('UNEVEN_CHANNELS');
    expect(() => encodeWav16([new Float32Array(2)], 0)).toThrow('BAD_SAMPLE_RATE');
  });
});

describe('readWavHeader', () => {
  it('says null for bytes that are not a WAV', () => {
    expect(readWavHeader(new Uint8Array(10))).toBeNull();
    expect(readWavHeader(new Uint8Array(64))).toBeNull();
  });
});

describe('bytesToBase64', () => {
  it('encodes more bytes than one call of fromCharCode takes', () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 251);
    const back = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0));
    expect(back.length).toBe(bytes.length);
    expect(back[199_999]).toBe(bytes[199_999]);
    expect(back[32768]).toBe(bytes[32768]);
  });
});
