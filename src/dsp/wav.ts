/**
 * wav.ts — channels of floats written as a 16-bit PCM WAV, and its header read back.
 *
 * 16-bit little-endian PCM is what every editor, every network and ffmpeg
 * take without a question. The header is written whole, with its two sizes:
 * the bytes are built in one go, never appended to.
 */

export const WAV_HEADER_BYTES = 44;

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Bytes of samples the header declares. */
  dataBytes: number;
  frames: number;
  seconds: number;
}

/** Float [-1, 1] to a signed 16-bit value, clamped: an overshoot must clip, never wrap around. */
export function floatToPcm16(x: number): number {
  const c = Number.isFinite(x) ? (x < -1 ? -1 : x > 1 ? 1 : x) : 0;
  return Math.round(c < 0 ? c * 0x8000 : c * 0x7fff);
}

/** Interleaved 16-bit PCM WAV of `channels` (all the same length) at `sampleRate`. */
export function encodeWav16(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const count = channels.length;
  if (count === 0) throw new Error('NO_CHANNEL');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('BAD_SAMPLE_RATE');
  const frames = channels[0]!.length;
  if (channels.some((ch) => ch.length !== frames)) throw new Error('UNEVEN_CHANNELS');
  const rate = Math.round(sampleRate);
  const blockAlign = count * 2;
  const dataBytes = frames * blockAlign;
  const bytes = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);          // size of the fmt chunk
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, count, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  let at = WAV_HEADER_BYTES;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      view.setInt16(at, floatToPcm16(channels[c]![i] ?? 0), true);
      at += 2;
    }
  }
  return bytes;
}

/** The header of a canonical 44-byte PCM WAV, or null when the bytes are not one. */
export function readWavHeader(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < WAV_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ' || tag(36) !== 'data') return null;
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataBytes = view.getUint32(40, true);
  const frameBytes = channels * (bitsPerSample / 8);
  if (!channels || !sampleRate || !frameBytes) return null;
  const frames = Math.floor(dataBytes / frameBytes);
  return { sampleRate, channels, bitsPerSample, dataBytes, frames, seconds: frames / sampleRate };
}

/** Bytes as base64, by slices: `String.fromCharCode(...bytes)` overflows the stack on a real file. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const SLICE = 0x8000;
  for (let i = 0; i < bytes.length; i += SLICE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE) as unknown as number[]);
  }
  return btoa(binary);
}
