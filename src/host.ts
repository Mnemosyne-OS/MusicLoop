/**
 * host.ts — MusicLoop's one SDK client, and the host doors it uses.
 *
 * - `dialog.selectFile` then `dialog.mediaUrl`: a sound picked by the person,
 *   read by byte ranges (`dialog.readFile` stops at 50 MB). The URL opens that
 *   one file. Gated by `dialog:open`, the only permission of this cartridge.
 * - `dialog.appFolder` then `dialog.writeAppBytes` (doc 179 §12): the WAV,
 *   saved in the folder the OS gives the app, never over an existing file.
 * - `dialog.openInOS`: shows a saved file in its folder.
 * - `state.get` / `state.set` (doc 73): the kept loops. Ungated.
 * - `shell.openExternal`: the credits' link.
 * - `recorder.musicTakes` (doc 249 §6): the sounds the Recorder captured in
 *   its music mode. A cartridge cannot capture the computer's sound itself
 *   (doc 112 §4); it is handed the files. Gated by `dialog:open` too.
 */
import { MnemoCartridgeSDK } from './sdk/mnemo-sdk';

/** The bridge to the host. The id must match "name" in mnemo-plugin.json: the host keys the state on it. */
export const sdk = new MnemoCartridgeSDK('@mnemosyne-plugins/music-loop');

/** Inside a Mnemosyne OS window (a frame with a parent), not a plain browser tab. */
export const inHost = (): boolean => window.parent !== window;

/** The page of the one library this cartridge carries (credits). */
export const STRETCH_URL = 'https://signalsmith-audio.co.uk/code/stretch/';

/**
 * What the picker offers: sounds, and films for their sound track. Every one
 * of them is a kind `dialog.mediaUrl` serves (`main/explorer/explorerModel.ts`).
 * `.weba` was offered and refused there (NOT_A_FILM_OR_SOUND): a file the
 * person can pick must be a file that opens.
 */
export const SOUND_EXTENSIONS = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'webm', 'mp4', 'm4v', 'mov', 'mkv'] as const;

const codeOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The path of a sound the person picks in the OS dialog, or null when they close it. No time limit: they are reading. */
export async function pickSound(filterName: string): Promise<string | null> {
  const picked = await sdk.invoke<string | null>('dialog.selectFile', { filters: [{ name: filterName, extensions: [...SOUND_EXTENSIONS] }] }, 0);
  return typeof picked === 'string' && picked ? picked : null;
}

/** A URL that reads this one file. Throws the host's code (PATH_OUTSIDE_HOME, NOT_A_FILM_OR_SOUND, NOT_FOUND…). */
export async function soundUrl(path: string): Promise<string> {
  const res = await sdk.invoke<{ success?: boolean; data?: { url?: string }; error?: string } | null>('dialog.mediaUrl', { filePath: path });
  const url = res?.success ? res.data?.url : undefined;
  if (!url) throw new Error(res?.error || 'FETCH_FAILED');
  return url;
}

/** The bytes behind a URL, whole. Bounded: a file that never arrives is reported. */
export async function fetchBytes(url: string, timeoutMs = 60_000): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('FETCH_FAILED');
    return await res.arrayBuffer();
  } catch (err) {
    console.error('[music-loop] the sound was not fetched', err);
    throw new Error('FETCH_FAILED');
  } finally {
    clearTimeout(timer);
  }
}

export type SaveOutcome =
  | { kind: 'saved'; path: string; bytes: number }
  | { kind: 'refused'; code: string };

/** How many names are tried when the file already exists (EXISTS): -2, -3, … */
export const NAME_TRIES = 20;
/** One write of the file's bytes; the host's own bound is 30 s too. */
export const WRITE_TIMEOUT_MS = 30_000;

/**
 * Saves bytes in the app's own folder under the first free name.
 * `nameFor(copy)` gives the relative path for the 1st, 2nd, … try.
 *
 * The folder is asked for first, with no time limit: the first time, the host
 * asks the person for `dialog:open` in a native dialog, and a clock running
 * while they read it would say "not saved" for a file that is then written
 * (measured on Pixel FX, 2026-11-14). The writes themselves are bounded.
 */
export async function saveInAppFolder(base64: string, nameFor: (copy: number) => string): Promise<SaveOutcome> {
  try {
    await sdk.invoke<{ folder: string }>('dialog.appFolder', {}, 0);
  } catch (err) {
    console.error('[music-loop] no app folder for the file', err);
    return { kind: 'refused', code: codeOf(err) };
  }
  for (let copy = 1; copy <= NAME_TRIES; copy++) {
    try {
      const res = await sdk.invoke<{ path: string; bytes: number }>('dialog.writeAppBytes', { rel: nameFor(copy), base64 }, WRITE_TIMEOUT_MS);
      return { kind: 'saved', path: res.path, bytes: res.bytes };
    } catch (err) {
      const code = codeOf(err);
      if (code === 'EXISTS') continue;
      console.error('[music-loop] file not saved', err);
      return { kind: 'refused', code };
    }
  }
  return { kind: 'refused', code: 'EXISTS' };
}

/** Outside the OS: the file handed to the browser as a download. */
export function downloadBytes(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/wav' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Shows a saved file selected in its folder, in the OS's file manager. */
export async function showInFolder(path: string): Promise<void> {
  const res = await sdk.invoke<{ success?: boolean; error?: string } | null>('dialog.openInOS', { filePath: path });
  if (res && res.success === false) throw new Error(res.error || 'OPEN_FAILED');
}

/** Opens a link in the person's browser (inside the OS), or a new tab outside it. */
export async function openLink(url: string): Promise<void> {
  if (!inHost()) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  await sdk.invoke('shell.openExternal', { url });
}

/** The cartridge's durable state (doc 73), or null when the host holds none yet. */
export async function hostStateGet(): Promise<Record<string, unknown> | null> {
  const res = await sdk.invoke<{ state?: unknown } | null>('state.get');
  const state = res?.state;
  return state && typeof state === 'object' && !Array.isArray(state) ? (state as Record<string, unknown>) : null;
}

/** Replaces the cartridge's durable state. Rejects when the host did not take it. */
export async function hostStateSet(state: Record<string, unknown>): Promise<void> {
  await sdk.invoke('state.set', { state });
}

/**
 * A file name made of what every file system takes: letters, digits, dash,
 * underscore. The host refuses a segment that ends on a dot or a space.
 */
export function safeName(raw: string, fallback = 'loop'): string {
  const base = raw.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const clean = base.normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
  return clean || fallback;
}

/** A sound captured from the computer by the Recorder's music mode. */
export interface MusicTake {
  path: string;
  name: string;
  seconds: number;
  sampleRate: number;
  channels: number;
  startedAt: string;
}

/** One entry of the host's answer, or null when it is not a take that can be opened. */
export function parseTake(raw: unknown): MusicTake | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.path !== 'string' || !v.path) return null;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
  return {
    path: v.path,
    // A take is `<session folder>/mix.wav`: without a name, the folder says more than the file.
    name: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : v.path.split(/[\\/]/).slice(-2, -1)[0] || v.path,
    seconds: num(v.seconds),
    sampleRate: num(v.sampleRate),
    channels: num(v.channels),
    startedAt: typeof v.startedAt === 'string' ? v.startedAt : '',
  };
}

/** A host that does not know the action answers this (usePluginBridge): an older Mnemosyne OS, not a failure. */
const NOT_SUPPORTED = /is not supported or not permitted/i;

/**
 * The captured sounds, newest first. `null` when this Mnemosyne OS has no
 * music mode yet: the screen then shows nothing about captures. Throws for a
 * host that has it and did not answer.
 */
export async function musicTakes(): Promise<MusicTake[] | null> {
  let res: unknown;
  try {
    res = await sdk.invoke<unknown>('recorder.musicTakes');
  } catch (err) {
    if (NOT_SUPPORTED.test(codeOf(err))) {
      console.info('[music-loop] this Mnemosyne OS has no music mode: no captured sounds to list');
      return null;
    }
    throw err;
  }
  const body = res && typeof res === 'object' && !Array.isArray(res) ? (res as Record<string, unknown>) : null;
  if (body && body.success === false) throw new Error(typeof body.error === 'string' ? body.error : 'TAKES_FAILED');
  const list: unknown[] = Array.isArray(res) ? res : Array.isArray(body?.data) ? body.data : Array.isArray(body?.takes) ? body.takes : [];
  return list.map(parseTake).filter((take): take is MusicTake => take !== null);
}

/**
 * What a take is called on screen. The Recorder names every take it was not
 * given a name for after its file, `mix.wav`: a list of those tells nothing
 * apart. Such a take is called by the day and time it was captured, written
 * the way `lang` writes dates.
 */
export function takeLabel(take: Pick<MusicTake, 'name' | 'path' | 'startedAt'>, lang: string): string {
  const file = take.path.split(/[\\/]/).pop() ?? '';
  if (take.name !== file) return take.name;
  const when = Date.parse(take.startedAt);
  if (!Number.isFinite(when)) return take.name;
  try {
    return new Date(when).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });
  } catch (err) {
    console.warn('[music-loop] date not written in this language, the take keeps its file name', err);
    return take.name;
  }
}

/**
 * The captured sounds are not asked for again sooner than this. The host's
 * list is the Recorder's own: each call repairs the header of a recording a
 * crash left open and probes the transcription engine (recorderMusicTakes.ts).
 * A window that takes the focus ten times in a minute must not do that ten times.
 */
export const TAKES_REFRESH_MS = 5_000;

/** Whether a refusal is the person saying no to the permission, not a failure to try again. */
export const isPermissionRefusal = (code: string): boolean => /does not have the .* permission|Unauthorized|PERMISSION_DENIED/i.test(code);

/** Whether opening the same file again could end differently: the host or the disk was slow, nothing about the file itself. */
export const isWorthRetrying = (code: string): boolean => /FETCH_FAILED|TIMEOUT|did not reply|within \d+s/i.test(code);
