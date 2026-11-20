/**
 * passage.ts — a stretch of a sound too long to be decoded whole.
 *
 * A browser decodes a sound entirely into memory: ten minutes are 230 MB, two
 * hours would be 2.7 GB. A long sound is therefore never decoded whole. The
 * person listens to it through a media element (the host serves the file by
 * byte ranges), picks where to work, and only that passage is loaded:
 *
 *   - a PCM WAV: the exact frames, read by a byte range under a header of our own;
 *   - an MP3: a byte range. An MP3 frame decodes on its own, so any stretch of
 *     the file is a sound. Where the passage is in the bytes is read from the
 *     table of times the encoder left in the first frame; without one, the
 *     bytes are taken as spread evenly over the time. The passage can start a
 *     few seconds off, and it is the same passage every time it is asked for;
 *   - anything else (M4A, a film…): played through a media element and
 *     recorded as it plays, in real time.
 *
 * The arithmetic is pure and tested; the fetches and the recording are
 * verified in a browser on real files.
 */
import type { DecodedSource } from './engine';

/** A stretch of a long sound, in seconds of the whole file. */
export interface Passage {
  from: number;
  seconds: number;
  /** The length of the whole file, so opening the passage again asks nothing. */
  total: number;
}

/** The lengths a passage can be taken at, in seconds. */
export const PASSAGE_LENGTHS = [120, 300, 600] as const;
export const DEFAULT_PASSAGE_SECONDS = 300;
/** How long the length of a sound is waited for before it is opened as an ordinary one. */
export const PROBE_TIMEOUT_MS = 15_000;
/** A WAV keeps its chunks at its start; this much is read to find them. */
const WAV_HEAD_BYTES = 65_536;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A stored passage, or null when it is not one. */
export function parsePassage(raw: unknown): Passage | null {
  if (!isRecord(raw)) return null;
  const { from, seconds, total } = raw;
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (!ok(from) || !ok(seconds) || !ok(total) || from < 0 || !(seconds > 0) || !(total > 0) || from >= total) return null;
  return { from, seconds: Math.min(seconds, total - from), total };
}

/** A passage of `seconds` starting at `at`, kept inside the file. */
export function passageAt(at: number, seconds: number, total: number): Passage {
  const length = Math.min(Math.max(1, seconds), total);
  const from = Math.min(Math.max(0, Number.isFinite(at) ? at : 0), Math.max(0, total - length));
  return { from, seconds: length, total };
}

/** The bytes of a file that hold `passage`, when the bytes are spread evenly over the time. */
export function byteWindow(size: number, passage: Passage): { from: number; to: number } {
  const share = (seconds: number) => Math.floor((Math.min(Math.max(0, seconds), passage.total) / passage.total) * size);
  const from = Math.min(share(passage.from), Math.max(0, size - 1));
  const to = Math.max(from + 1, Math.min(size, share(passage.from + passage.seconds)));
  return { from, to };
}

/** The first frame of an MP3 is read this far to find its table of times. */
const MP3_FIRST_FRAME_BYTES = 2048;

/** The length of the ID3v2 tag at the start of an MP3, 0 when there is none. */
export function id3Bytes(head: Uint8Array): number {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0;
  const size = ((head[6]! & 0x7f) << 21) | ((head[7]! & 0x7f) << 14) | ((head[8]! & 0x7f) << 7) | (head[9]! & 0x7f);
  return 10 + size + ((head[5]! & 0x10) ? 10 : 0);
}

/**
 * The table an encoder leaves in the first frame of a variable-bitrate MP3
 * (the « Xing » or « Info » header): for each hundredth of the time, where it
 * is in the bytes, in 256ths. null when the frame carries none.
 */
export function xingTable(frame: Uint8Array): Uint8Array | null {
  const limit = Math.min(frame.length - 120, 256);
  for (let at = 4; at < limit; at++) {
    const x = frame[at] === 0x58 && frame[at + 1] === 0x69 && frame[at + 2] === 0x6e && frame[at + 3] === 0x67;
    const i = frame[at] === 0x49 && frame[at + 1] === 0x6e && frame[at + 2] === 0x66 && frame[at + 3] === 0x6f;
    if (!x && !i) continue;
    const flags = frame[at + 7]!;
    if (!(flags & 0x04)) return null;
    const toc = at + 8 + ((flags & 0x01) ? 4 : 0) + ((flags & 0x02) ? 4 : 0);
    return toc + 100 <= frame.length ? frame.slice(toc, toc + 100) : null;
  }
  return null;
}

/** The bytes of an MP3 that hold `passage`: by its table of times when it has one, by an even share otherwise. */
export function mp3Window(size: number, audioFrom: number, table: Uint8Array | null, passage: Passage): { from: number; to: number } {
  const audio = Math.max(1, size - audioFrom);
  const at = (seconds: number): number => {
    const share = Math.min(Math.max(0, seconds / passage.total), 1);
    // The end of the time is the end of the file, whatever the table says of its last hundredth.
    if (share >= 1) return size;
    if (!table) return audioFrom + Math.floor(share * audio);
    const hundredth = Math.min(share * 100, 99.999);
    const i = Math.floor(hundredth);
    const a = table[i]!;
    const b = i < 99 ? table[i + 1]! : 256;
    return audioFrom + Math.floor(((a + (b - a) * (hundredth - i)) / 256) * audio);
  };
  const from = Math.min(at(passage.from), Math.max(0, size - 1));
  const to = Math.max(from + 1, Math.min(size, at(passage.from + passage.seconds)));
  return { from, to };
}

/** Where the samples of a PCM WAV are, read from its first bytes. */
export interface WavLayout {
  /** The `fmt ` chunk, as it is in the file. */
  fmt: Uint8Array;
  /** Bytes of one frame (all channels). */
  blockAlign: number;
  sampleRate: number;
  dataOffset: number;
  dataBytes: number;
}

/** The layout of a WAV whose chunks start in `head`, or null when it is not a WAV we can cut. */
export function wavLayout(head: Uint8Array, fileSize: number): WavLayout | null {
  if (head.length < 12) return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const tag = (at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let at = 12;
  let fmt: Uint8Array | null = null;
  let blockAlign = 0;
  let sampleRate = 0;
  while (at + 8 <= head.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + size > head.length) return null;
      fmt = head.slice(body, body + size);
      sampleRate = view.getUint32(body + 4, true);
      blockAlign = view.getUint16(body + 12, true);
    } else if (id === 'data') {
      if (!fmt || !blockAlign || !sampleRate) return null;
      // A recorder that was cut short leaves 0 or 0xFFFFFFFF here: the file size says the truth.
      const dataBytes = Math.min(size > 0 && size !== 0xffffffff ? size : fileSize - body, Math.max(0, fileSize - body));
      return { fmt, blockAlign, sampleRate, dataOffset: body, dataBytes };
    }
    at = body + size + (size % 2);
  }
  return null;
}

/** The byte range of `passage` in a WAV, on whole frames. */
export function wavWindow(layout: WavLayout, passage: Passage): { from: number; to: number } {
  const frames = Math.floor(layout.dataBytes / layout.blockAlign);
  const first = Math.min(Math.max(0, Math.round(passage.from * layout.sampleRate)), Math.max(0, frames - 1));
  const last = Math.min(frames, first + Math.max(1, Math.round(passage.seconds * layout.sampleRate)));
  return { from: layout.dataOffset + first * layout.blockAlign, to: layout.dataOffset + last * layout.blockAlign };
}

/** A whole WAV file made of `layout`'s format and `data`. */
export function wavOf(layout: WavLayout, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(20 + layout.fmt.length + 8 + data.length);
  const view = new DataView(out.buffer);
  const put = (at: number, text: string) => { for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i); };
  put(0, 'RIFF');
  view.setUint32(4, out.length - 8, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, layout.fmt.length, true);
  out.set(layout.fmt, 20);
  const dataAt = 20 + layout.fmt.length;
  put(dataAt, 'data');
  view.setUint32(dataAt + 4, data.length, true);
  out.set(data, dataAt + 8);
  return out;
}

/** How a passage of this file is loaded, by the extension of its name. */
export function passageWay(path: string): 'wav' | 'mp3' | 'live' {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(path)?.[1]?.toLowerCase() ?? '';
  return ext === 'wav' ? 'wav' : ext === 'mp3' ? 'mp3' : 'live';
}

/**
 * The length of the sound behind `url`, in seconds, read from its header by a
 * media element. Rejects with NOT_PROBED when it is not known in time.
 */
export function probeSeconds(url: string, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    const done = (fn: () => void) => {
      clearTimeout(timer);
      audio.removeAttribute('src');
      audio.load();
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error('NOT_PROBED'))), timeoutMs);
    audio.onloadedmetadata = () => {
      const seconds = audio.duration;
      done(() => (Number.isFinite(seconds) && seconds > 0 ? resolve(seconds) : reject(new Error('NOT_PROBED'))));
    };
    audio.onerror = () => done(() => reject(new Error('NOT_PROBED')));
    audio.src = url;
  });
}

/** Bytes `from` (included) to `to` (excluded) of `url`, and the size of the whole file. */
export async function fetchRange(url: string, from: number, to: number, signal?: AbortSignal): Promise<{ bytes: Uint8Array; size: number }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Range: `bytes=${from}-${Math.max(from, to - 1)}` }, signal });
  } catch (err) {
    console.error('[music-loop] a part of the sound was not fetched', err);
    throw new Error('FETCH_FAILED');
  }
  if (res.status !== 206) {
    // A server that answers the whole file to a range would hand over gigabytes.
    console.error('[music-loop] the sound was not served by parts: status', res.status);
    throw new Error('FETCH_FAILED');
  }
  const total = /\/(\d+)\s*$/.exec(res.headers.get('Content-Range') ?? '')?.[1];
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, size: total ? Number(total) : 0 };
}

export interface PassagePorts {
  decode: (bytes: ArrayBuffer) => Promise<DecodedSource>;
  /** Records a passage as it plays; `onProgress` is told the seconds recorded so far. */
  live?: (url: string, passage: Passage, onProgress?: (seconds: number) => void, signal?: AbortSignal) => Promise<DecodedSource>;
  onProgress?: (seconds: number) => void;
  signal?: AbortSignal;
}

/** Loads `passage` of the file at `path`, served at `url`, the way its format allows. */
export async function loadPassage(url: string, path: string, passage: Passage, ports: PassagePorts): Promise<DecodedSource> {
  const way = passageWay(path);
  if (way === 'wav') {
    const head = await fetchRange(url, 0, WAV_HEAD_BYTES, ports.signal);
    const layout = wavLayout(head.bytes, head.size);
    if (layout) {
      const cut = wavWindow(layout, passage);
      const data = await fetchRange(url, cut.from, cut.to, ports.signal);
      const file = wavOf(layout, data.bytes);
      return ports.decode(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
    }
    // Not a WAV we can cut (compressed inside, or its chunks are elsewhere): record it as it plays.
  }
  if (way === 'mp3') {
    const start = await fetchRange(url, 0, 10, ports.signal);
    if (!(start.size > 0)) throw new Error('FETCH_FAILED');
    // The sound starts after the tag (a cover picture can weigh megabytes), and its
    // first frame may carry a table of where each hundredth of the time is.
    const audioFrom = id3Bytes(start.bytes);
    const first = await fetchRange(url, audioFrom, Math.min(start.size, audioFrom + MP3_FIRST_FRAME_BYTES), ports.signal);
    const cut = mp3Window(start.size, audioFrom, xingTable(first.bytes), passage);
    const part = await fetchRange(url, cut.from, cut.to, ports.signal);
    return ports.decode(part.bytes.buffer.slice(part.bytes.byteOffset, part.bytes.byteOffset + part.bytes.byteLength) as ArrayBuffer);
  }
  return (ports.live ?? recordLive)(url, passage, ports.onProgress, ports.signal);
}

/**
 * Plays `passage` through a media element into an audio context of its own
 * and keeps what comes out. It takes as long as the passage lasts. Nothing is
 * heard: the recorder writes silence to the output.
 */
export function recordLive(url: string, passage: Passage, onProgress?: (seconds: number) => void, signal?: AbortSignal): Promise<DecodedSource> {
  return new Promise<DecodedSource>((resolve, reject) => {
    const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) { reject(new Error('NO_WEB_AUDIO')); return; }
    const ctx = new Ctor();
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    const node = ctx.createMediaElementSource(audio);
    const tap = ctx.createScriptProcessor(4096, 2, 2);
    const left: Float32Array[] = [];
    const right: Float32Array[] = [];
    const wanted = Math.round(passage.seconds * ctx.sampleRate);
    let frames = 0;
    let settled = false;
    let lastTold = -1;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      tap.onaudioprocess = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      try { node.disconnect(); tap.disconnect(); } catch (err) { console.warn('[music-loop] the live recorder was already disconnected', err); }
      ctx.close().catch((err) => console.warn('[music-loop] the live recorder did not close', err));
      fn();
    };
    const deliver = () => finish(() => {
      if (frames < 2) { reject(new Error('EMPTY_SOUND')); return; }
      const join = (blocks: Float32Array[]) => {
        const out = new Float32Array(Math.min(frames, wanted));
        let at = 0;
        for (const block of blocks) {
          if (at >= out.length) break;
          out.set(out.length - at >= block.length ? block : block.subarray(0, out.length - at), at);
          at += block.length;
        }
        return out;
      };
      const channels = [join(left), join(right)];
      resolve({ channels, sampleRate: ctx.sampleRate, seconds: channels[0]!.length / ctx.sampleRate });
    });
    const onAbort = () => finish(() => reject(new Error('ABORTED')));
    signal?.addEventListener('abort', onAbort);

    tap.onaudioprocess = (event) => {
      if (settled || audio.paused) return;
      left.push(event.inputBuffer.getChannelData(0).slice());
      right.push(event.inputBuffer.getChannelData(event.inputBuffer.numberOfChannels > 1 ? 1 : 0).slice());
      frames += event.inputBuffer.length;
      const told = Math.floor(frames / ctx.sampleRate);
      if (told !== lastTold) { lastTold = told; onProgress?.(told); }
      if (frames >= wanted) deliver();
    };
    node.connect(tap);
    tap.connect(ctx.destination);
    audio.onended = deliver;
    audio.onerror = () => finish(() => reject(new Error('NOT_DECODED')));
    audio.onloadedmetadata = () => { audio.currentTime = passage.from; };
    audio.onseeked = () => {
      ctx.resume().then(() => audio.play()).catch((err) => {
        console.error('[music-loop] the passage did not start playing', err);
        finish(() => reject(new Error('AUDIO_ASLEEP')));
      });
    };
    audio.src = url;
  });
}
