// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../audio/settings';
import { freshId, loadKept, MAX_KEPT, parseKept, parseKeptList, saveKept, STORAGE_KEY, withKept, withoutKept, type KeptLoop } from './loops';
import { clampSpan, formatTime, moveLoop, panSpan, secondsAt, viewOfLoop, withEdge, xAt, zoomSpan, MIN_SPAN } from '../ui/viewMath';

const loop = (id: string, over: Partial<KeptLoop> = {}): KeptLoop => ({
  id, name: `loop ${id}`, path: `C:/Music/${id}.mp3`, start: 1, end: 3, bpm: 120, captured: false, settings: DEFAULT_SETTINGS, savedAt: '2026-11-19T00:00:00.000Z', ...over,
});

describe('kept loops', () => {
  it('drops a stored loop that cannot be opened again, and keeps the others', () => {
    const list = parseKeptList({ loops: [loop('a'), { id: 'b' }, { ...loop('c'), start: 5, end: 2 }, 'junk', { ...loop('d'), path: '' }, loop('a'), loop('e')] });
    expect(list.map((l) => l.id)).toEqual(['a', 'e']);
    expect(parseKeptList(null)).toEqual([]);
    expect(parseKeptList([loop('z')])).toHaveLength(1);
  });

  it('reads back no more than the limit, however many were stored', () => {
    const many = Array.from({ length: MAX_KEPT + 50 }, (_, i) => loop(`n${i}`));
    const read = parseKeptList({ loops: many });
    expect(read).toHaveLength(MAX_KEPT);
    expect(read[0]!.id).toBe('n0');
  });

  it('keeps what the source of a loop was called on screen, when it was not its file name', () => {
    expect(parseKept({ ...loop('c'), source: '  Sultans of swing ' })!.source).toBe('Sultans of swing');
    expect('source' in parseKept(loop('d'))!).toBe(false);
    expect('source' in parseKept({ ...loop('e'), source: 42 })!).toBe(false);
  });

  it('repairs what it can of a loop: settings field by field, a missing name, a tempo that is not one', () => {
    const k = parseKept({ id: 'x', path: 'C:/a.wav', start: 0, end: 1, settings: { low: 30, reverse: true }, bpm: -4, captured: 'yes' })!;
    expect(k.name).toBe('x');
    expect(k.settings.low).toBe(12);
    expect(k.settings.reverse).toBe(true);
    expect(k.bpm).toBeNull();
    expect(k.captured).toBe(false);
  });

  it('puts a kept loop first, replaces the one of the same id, and stops at the limit', () => {
    const list = withKept([loop('a'), loop('b')], loop('b', { name: 'new' }));
    expect(list.map((l) => l.name)).toEqual(['new', 'loop a']);
    const many = Array.from({ length: MAX_KEPT }, (_, i) => loop(`n${i}`));
    expect(withKept(many, loop('one-more'))).toHaveLength(MAX_KEPT);
    expect(withoutKept(list, 'a').map((l) => l.id)).toEqual(['b']);
  });

  it('inside the OS, reads and writes the host state', async () => {
    const hostGet = vi.fn().mockResolvedValue({ loops: [loop('a')] });
    const hostSet = vi.fn().mockResolvedValue(undefined);
    expect(await loadKept({ hostGet, hostSet })).toHaveLength(1);
    await saveKept({ hostGet, hostSet }, [loop('a'), loop('b')]);
    expect(hostSet).toHaveBeenCalledWith({ loops: [loop('a'), loop('b')] });
  });

  it('lets a host that does not answer be heard', async () => {
    await expect(loadKept({ hostGet: () => Promise.reject(new Error('TIMEOUT')) })).rejects.toThrow('TIMEOUT');
    await expect(saveKept({ hostSet: () => Promise.reject(new Error('TIMEOUT')) }, [])).rejects.toThrow('TIMEOUT');
  });

  it('outside the OS, uses the frame storage; unreadable storage shows no loop', async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    await saveKept({ storage }, [loop('a')]);
    expect(JSON.parse(store.get(STORAGE_KEY)!).loops).toHaveLength(1);
    expect(await loadKept({ storage })).toHaveLength(1);
    store.set(STORAGE_KEY, '{not json');
    expect(await loadKept({ storage })).toEqual([]);
    await expect(saveKept({ storage: null }, [])).rejects.toThrow('NO_STORAGE');
  });

  it('never gives an id twice', () => {
    const taken = [loop(`${(1000).toString(36)}-${(0).toString(36)}`)];
    const rolls = [0, 0.5];
    expect(freshId(taken, 1000, () => rolls.shift()!)).not.toBe(taken[0]!.id);
  });
});

describe('view math', () => {
  it('maps pixels to seconds and back', () => {
    const view = { from: 10, to: 20 };
    expect(secondsAt(250, 1000, view)).toBe(12.5);
    expect(xAt(12.5, 1000, view)).toBe(250);
    expect(secondsAt(5, 0, view)).toBe(10);
  });

  it('keeps a span inside the sound and at least 20 ms long', () => {
    expect(clampSpan({ from: -2, to: 3 }, 10)).toEqual({ from: 0, to: 5 });
    expect(clampSpan({ from: 8, to: 14 }, 10)).toEqual({ from: 4, to: 10 });
    expect(clampSpan({ from: 5, to: 5 }, 10).to - 5).toBeCloseTo(MIN_SPAN, 9);
    expect(clampSpan({ from: 7, to: 2 }, 10)).toEqual({ from: 2, to: 7 });
    expect(clampSpan({ from: 0, to: 100 }, 10)).toEqual({ from: 0, to: 10 });
  });

  it('zooms around the pointer, which stays where it was', () => {
    const view = { from: 0, to: 10 };
    const zoomed = zoomSpan(view, 0.5, 2.5, 60);
    expect(zoomed.to - zoomed.from).toBeCloseTo(5, 9);
    expect(xAt(2.5, 1000, zoomed)).toBeCloseTo(xAt(2.5, 1000, view), 6);
    expect(zoomSpan(view, 100, 5, 60)).toEqual({ from: 0, to: 60 });
  });

  it('slides the view and the loop up to the ends, keeping their length', () => {
    expect(panSpan({ from: 2, to: 4 }, -5, 10)).toEqual({ from: 0, to: 2 });
    expect(moveLoop({ from: 2, to: 4 }, 100, 10)).toEqual({ from: 8, to: 10 });
  });

  it('moves one edge of the loop, which never crosses the other', () => {
    expect(withEdge({ from: 2, to: 4 }, 'from', 9, 10).from).toBeCloseTo(4 - MIN_SPAN, 9);
    expect(withEdge({ from: 2, to: 4 }, 'to', 0, 10).to).toBeCloseTo(2 + MIN_SPAN, 9);
    expect(withEdge({ from: 2, to: 4 }, 'to', 99, 10)).toEqual({ from: 2, to: 10 });
    expect(withEdge({ from: 2, to: 4 }, 'from', -1, 10)).toEqual({ from: 0, to: 4 });
  });

  it('shows the loop with a margin on both sides', () => {
    const v = viewOfLoop({ from: 6, to: 12 }, 60);
    expect(v).toEqual({ from: 5, to: 13 });
    expect(viewOfLoop({ from: 0, to: 60 }, 60)).toEqual({ from: 0, to: 60 });
  });

  it('writes a time as minutes, seconds and thousandths', () => {
    expect(formatTime(83.4567)).toBe('1:23.457');
    expect(formatTime(7.25)).toBe('0:07.250');
    expect(formatTime(59.9996)).toBe('1:00.000');
    expect(formatTime(-3)).toBe('0:00.000');
    expect(formatTime(NaN)).toBe('0:00.000');
  });
});
