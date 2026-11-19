/**
 * loops.ts — the loops the person kept: a source file, a region, the settings.
 *
 * A kept loop holds the PATH of its source, never a copy of the sound (doc
 * 249 §5). Inside the OS the list lives in the cartridge's durable state
 * (doc 73), which survives an update of the cartridge; outside it, in the
 * frame's localStorage. A loop made from a dropped file has no path: it
 * cannot be opened again, and it is not written anywhere.
 */
import { parseSettings, type LoopSettings } from '../audio/settings';

export interface KeptLoop {
  id: string;
  name: string;
  /** Absolute path of the source file. */
  path: string;
  /**
   * What the source is called on screen, when its file name does not say it:
   * every capture of the Recorder is a file named `mix.wav`. Absent, the file
   * name is shown.
   */
  source?: string;
  /** The region, in seconds of the source. */
  start: number;
  end: number;
  /** The tempo the person saw, or null. */
  bpm: number | null;
  /** The source is a capture of the computer's sound (doc 249 §8). */
  captured: boolean;
  settings: LoopSettings;
  savedAt: string;
}

export const MAX_KEPT = 200;
export const STORAGE_KEY = 'music-loop.kept';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** One stored loop, or null when it cannot be opened again (no path, no region). */
export function parseKept(raw: unknown): KeptLoop | null {
  if (!isRecord(raw)) return null;
  const { id, name, path, start, end } = raw;
  if (typeof id !== 'string' || !id || typeof path !== 'string' || !path) return null;
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || !(end > start) || start < 0) return null;
  return {
    id,
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : id,
    path,
    ...(typeof raw.source === 'string' && raw.source.trim() ? { source: raw.source.trim().slice(0, 120) } : {}),
    start,
    end,
    bpm: typeof raw.bpm === 'number' && raw.bpm > 0 && Number.isFinite(raw.bpm) ? raw.bpm : null,
    captured: raw.captured === true,
    settings: parseSettings(raw.settings),
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
  };
}

/** The stored list, each loop checked on its own; a broken one is dropped and the others kept. */
export function parseKeptList(raw: unknown): KeptLoop[] {
  const list = isRecord(raw) ? raw.loops : raw;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: KeptLoop[] = [];
  for (const item of list) {
    const loop = parseKept(item);
    if (!loop || seen.has(loop.id)) continue;
    seen.add(loop.id);
    out.push(loop);
    if (out.length >= MAX_KEPT) break;
  }
  return out;
}

/** The list with `loop` first; a loop of the same id is replaced. */
export function withKept(list: readonly KeptLoop[], loop: KeptLoop): KeptLoop[] {
  return [loop, ...list.filter((l) => l.id !== loop.id)].slice(0, MAX_KEPT);
}

export const withoutKept = (list: readonly KeptLoop[], id: string): KeptLoop[] => list.filter((l) => l.id !== id);

export interface KeptPorts {
  /** Inside the OS. */
  hostGet?: () => Promise<Record<string, unknown> | null>;
  hostSet?: (state: Record<string, unknown>) => Promise<void>;
  /** Outside it. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

/** Reads the kept loops. Throws when the host does not answer: the screen says so, and keeps what it shows. */
export async function loadKept(ports: KeptPorts): Promise<KeptLoop[]> {
  if (ports.hostGet) return parseKeptList(await ports.hostGet());
  const raw = ports.storage?.getItem(STORAGE_KEY) ?? null;
  if (!raw) return [];
  try {
    return parseKeptList(JSON.parse(raw));
  } catch (err) {
    console.warn('[music-loop] stored loops unreadable, none shown', err);
    return [];
  }
}

/** Writes the kept loops. Throws when they were not written. */
export async function saveKept(ports: KeptPorts, list: readonly KeptLoop[]): Promise<void> {
  if (ports.hostSet) {
    await ports.hostSet({ loops: list });
    return;
  }
  if (!ports.storage) throw new Error('NO_STORAGE');
  ports.storage.setItem(STORAGE_KEY, JSON.stringify({ loops: list }));
}

/** An id no other loop of the list carries. */
export function freshId(list: readonly KeptLoop[], now: number = Date.now(), random: () => number = Math.random): string {
  for (;;) {
    const id = `${now.toString(36)}-${Math.floor(random() * 0xffffff).toString(36)}`;
    if (!list.some((l) => l.id === id)) return id;
  }
}
