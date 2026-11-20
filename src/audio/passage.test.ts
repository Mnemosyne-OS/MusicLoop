// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeWav16 } from '../dsp/wav';
import type { DecodedSource } from './engine';
import { byteWindow, fetchRange, id3Bytes, loadPassage, mp3Window, xingTable, parsePassage, passageAt, passageWay, wavLayout, wavOf, wavWindow, type Passage } from './passage';

const SR = 8000;
/** A stereo WAV of `seconds`, where sample n of the left channel is n (mod 30000) / 32768. */
function ramp(seconds: number): Uint8Array {
  const left = Float32Array.from({ length: SR * seconds }, (_, i) => (i % 30000) / 32768);
  return encodeWav16([left, left.map((x) => -x)], SR);
}

/** A stand-in of the host's file door: it answers byte ranges of `file` with 206 and the size. */
function serve(file: Uint8Array) {
  const asked: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
    const range = init?.headers?.Range ?? '';
    asked.push(range);
    const m = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!m) return { status: 200, headers: { get: () => null }, arrayBuffer: async () => file.buffer.slice(0) };
    const from = Number(m[1]);
    const to = Math.min(file.length - 1, Number(m[2]));
    const part = file.slice(from, to + 1);
    return { status: 206, headers: { get: (h: string) => (h === 'Content-Range' ? `bytes ${from}-${to}/${file.length}` : null) }, arrayBuffer: async () => part.buffer };
  }));
  return asked;
}

afterEach(() => vi.unstubAllGlobals());

describe('a passage of a long sound', () => {
  it('stays inside the file: a start past the end is pulled back, a length longer than the file is the file', () => {
    expect(passageAt(100, 300, 7200)).toEqual({ from: 100, seconds: 300, total: 7200 });
    expect(passageAt(7100, 300, 7200)).toEqual({ from: 6900, seconds: 300, total: 7200 });
    expect(passageAt(-5, 300, 7200).from).toBe(0);
    expect(passageAt(NaN, 300, 7200).from).toBe(0);
    expect(passageAt(10, 600, 200)).toEqual({ from: 0, seconds: 200, total: 200 });
  });

  it('reads back a stored passage, and nothing from what is not one', () => {
    expect(parsePassage({ from: 60, seconds: 300, total: 7200 })).toEqual({ from: 60, seconds: 300, total: 7200 });
    expect(parsePassage({ from: 7000, seconds: 300, total: 7200 })?.seconds).toBe(200);
    for (const bad of [null, 3, {}, { from: -1, seconds: 3, total: 9 }, { from: 9, seconds: 3, total: 9 }, { from: 0, seconds: 0, total: 9 }, { from: 0, seconds: 3, total: NaN }, { from: '0', seconds: 3, total: 9 }]) {
      expect(parsePassage(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('takes the same share of the bytes as of the time', () => {
    const p: Passage = { from: 3600, seconds: 600, total: 7200 };
    expect(byteWindow(144_000_000, p)).toEqual({ from: 72_000_000, to: 84_000_000 });
    const end = byteWindow(1000, { from: 7100, seconds: 600, total: 7200 });
    expect(end.to).toBe(1000);
    expect(end.to).toBeGreaterThan(end.from);
  });

  it('chooses the way by the extension of the file', () => {
    expect(passageWay('C:/a/Mix.WAV')).toBe('wav');
    expect(passageWay('C:/a/set.mp3')).toBe('mp3');
    for (const other of ['C:/a/film.mp4', 'C:/a/song.m4a', 'C:/a/x.flac', 'C:/a/noext']) expect(passageWay(other)).toBe('live');
  });
});

describe('a passage of a WAV', () => {
  it('finds the samples behind other chunks, and trusts the file size when the data size was never written', () => {
    const plain = ramp(1);
    const layout = wavLayout(plain.slice(0, 200), plain.length)!;
    expect(layout).toMatchObject({ blockAlign: 4, sampleRate: SR, dataOffset: 44, dataBytes: SR * 4 });

    // A LIST chunk of 10 bytes between `fmt ` and `data`.
    const list = new Uint8Array(18);
    list.set([0x4c, 0x49, 0x53, 0x54, 10, 0, 0, 0]);
    const withList = new Uint8Array(plain.length + 18);
    withList.set(plain.slice(0, 36), 0);
    withList.set(list, 36);
    withList.set(plain.slice(36), 54);
    expect(wavLayout(withList.slice(0, 200), withList.length)).toMatchObject({ dataOffset: 62, dataBytes: SR * 4 });

    // A recorder cut short left 0 as the data size.
    const cut = plain.slice();
    new DataView(cut.buffer).setUint32(40, 0, true);
    expect(wavLayout(cut.slice(0, 200), cut.length)?.dataBytes).toBe(SR * 4);

    expect(wavLayout(new Uint8Array(200), 200)).toBeNull();
  });

  it('cuts on whole frames and never past the end', () => {
    const layout = wavLayout(ramp(10).slice(0, 200), 44 + SR * 10 * 4)!;
    expect(wavWindow(layout, { from: 2, seconds: 3, total: 10 })).toEqual({ from: 44 + 2 * SR * 4, to: 44 + 5 * SR * 4 });
    const end = wavWindow(layout, { from: 9.5, seconds: 3, total: 10 });
    expect(end.to).toBe(44 + SR * 10 * 4);
    expect((end.to - end.from) % 4).toBe(0);
  });

  it('loads exactly the frames asked for, by two small reads and never the whole file', async () => {
    const file = ramp(20);
    const asked = serve(file);
    let handed: Uint8Array | null = null;
    const decode = async (bytes: ArrayBuffer): Promise<DecodedSource> => {
      handed = new Uint8Array(bytes);
      return { channels: [new Float32Array(2), new Float32Array(2)], sampleRate: SR, seconds: 3 };
    };
    await loadPassage('mnemo-media://f/x', 'C:/a/long.wav', { from: 5, seconds: 3, total: 20 }, { decode });
    const out = handed as unknown as Uint8Array;
    // A whole WAV of three seconds: its header, then the frames from second 5 to second 8.
    expect(out.length).toBe(44 + 3 * SR * 4);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getUint32(40, true)).toBe(3 * SR * 4);
    expect(view.getInt16(44, true)).toBe((5 * SR) % 30000);
    expect(view.getInt16(44 + 4, true)).toBe((5 * SR + 1) % 30000);
    expect(view.getInt16(out.length - 4, true)).toBe((8 * SR - 1) % 30000);
    expect(asked).toEqual(['bytes=0-65535', `bytes=${44 + 5 * SR * 4}-${44 + 8 * SR * 4 - 1}`]);
  });

  it('writes a header a decoder reads: the format of the file, the size of the passage', () => {
    const file = ramp(2);
    const layout = wavLayout(file.slice(0, 200), file.length)!;
    const out = wavOf(layout, file.slice(44, 44 + 400));
    const again = wavLayout(out, out.length)!;
    expect(again).toMatchObject({ blockAlign: 4, sampleRate: SR, dataOffset: 44, dataBytes: 400 });
  });
});

describe('a passage of an MP3, and of anything else', () => {
  it('reads the size, then the bytes at the same share of the file as of the time', async () => {
    const file = new Uint8Array(100_000).map((_, i) => i % 251);
    const asked = serve(file);
    let got = 0;
    await loadPassage('u', 'C:/a/set.mp3', { from: 3600, seconds: 720, total: 7200 }, {
      decode: async (bytes) => { got = bytes.byteLength; return { channels: [new Float32Array(2), new Float32Array(2)], sampleRate: SR, seconds: 1 }; },
    });
    expect(asked).toEqual(['bytes=0-9', 'bytes=0-2047', 'bytes=50000-59999']);
    expect(got).toBe(10_000);
  });

  it('skips the tag at the start of the file: the share is taken of the sound, not of a cover picture', () => {
    // « ID3 », version 2.4.0, no flags, a size of 0x00 0x00 0x02 0x01 in 7-bit bytes = 257.
    expect(id3Bytes(Uint8Array.of(0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 2, 1))).toBe(267);
    expect(id3Bytes(Uint8Array.of(0x49, 0x44, 0x33, 4, 0, 0x10, 0, 0, 2, 1))).toBe(277);
    expect(id3Bytes(Uint8Array.of(0xff, 0xfb, 0x90, 0, 0, 0, 0, 0, 0, 0))).toBe(0);
    expect(mp3Window(1_001_000, 1000, null, { from: 500, seconds: 100, total: 1000 })).toEqual({ from: 501_000, to: 601_000 });
  });

  it('follows the table of times of a variable-bitrate file, and says none when the frame has no table', () => {
    // A frame with « Xing », flags frames + bytes + table, and a table where the
    // first half of the time takes a quarter of the bytes.
    const frame = new Uint8Array(400);
    frame.set([0xff, 0xfb, 0x90, 0x00]);
    frame.set([0x58, 0x69, 0x6e, 0x67, 0, 0, 0, 0x07], 36);
    for (let i = 0; i < 100; i++) frame[36 + 16 + i] = i < 50 ? Math.round(i * 1.28) : Math.round(64 + (i - 50) * 3.84);
    const table = xingTable(frame)!;
    expect(table).toHaveLength(100);
    expect(table[50]).toBe(64);
    const half = mp3Window(256_000, 0, table, { from: 500, seconds: 250, total: 1000 });
    expect(half.from).toBe(64_000);
    expect(half.to).toBeGreaterThan(155_000);
    expect(half.to).toBeLessThan(165_000);
    // The end of the last hundredth is the end of the file.
    expect(mp3Window(256_000, 0, table, { from: 990, seconds: 10, total: 1000 }).to).toBe(256_000);

    const noTable = frame.slice();
    noTable[36 + 7] = 0x03;
    expect(xingTable(noTable)).toBeNull();
    expect(xingTable(new Uint8Array(400))).toBeNull();
  });

  it('a file of another kind is recorded as it plays', async () => {
    serve(new Uint8Array(10));
    const live = vi.fn(async () => ({ channels: [new Float32Array(2), new Float32Array(2)], sampleRate: SR, seconds: 1 }));
    const p = { from: 10, seconds: 60, total: 900 };
    await loadPassage('u', 'C:/a/film.mp4', p, { decode: async () => { throw new Error('never'); }, live });
    expect(live).toHaveBeenCalledWith('u', p, undefined, undefined);
  });

  it('refuses a server that answers the whole file to a range: gigabytes must never arrive', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(8) })));
    await expect(fetchRange('u', 0, 10)).rejects.toThrow('FETCH_FAILED');
  });
});
