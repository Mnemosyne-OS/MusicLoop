/**
 * Pad.tsx — the loop pad: every kept loop is a big tile, sorted by category.
 * A click starts the loop, a click stops it, the loops that play are mixed,
 * and the mix can be recorded to a WAV.
 *
 * Three states for the list: being read, not read (with « Try again »), read.
 * A loop is fetched and prepared at its first click, then kept ready for the
 * life of the screen. No loop is aligned on another: a tile starts at the click.
 *
 * The audio deck and the reading of a sound are passed in (`deps`): the
 * screen is tested in jsdom against stand-ins.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DecodedSource } from '../audio/engine';
import { loadPassage, type Passage } from '../audio/passage';
import { prepareLoop, type PreparedLoop, type TimeTransform } from '../audio/pipeline';
import { browserTransform } from '../audio/timebase';
import { holdUnderCeiling } from '../dsp/level';
import { bytesToBase64, encodeWav16 } from '../dsp/wav';
import { downloadBytes, fetchBytes, hostStateGet, hostStateSet, inHost, onKeptAnnounced, saveInAppFolder, soundUrl } from '../host';
import { errorText, exportRefusal, type Key } from '../i18n/strings';
import { useI18n } from '../i18n/useI18n';
import { loadKept, PAD_CATEGORIES, PAD_LAPS, saveKept, type KeptLoop, type KeptPorts, type PadCategory } from '../state/loops';
import { IconButton, Tiles } from '../ui/controls';
import { Back, Close, Pencil, Record, Stop } from '../ui/icons';
import { formatTime } from '../ui/viewMath';
import { PadMixer, type PadDeck } from './padMixer';

/** What a test passes in place of Web Audio and of the host. */
export interface PadDeps {
  deck?: PadDeck;
  transform?: TimeTransform;
  /** The bytes of the sound at `path`. */
  readSound?: (path: string) => Promise<ArrayBuffer>;
  ports?: KeptPorts;
  /** A passage of the long sound at `path`, decoded. */
  readPassage?: (path: string, passage: Passage) => Promise<DecodedSource>;
  /** Writes the recorded WAV; resolves to the name it was saved under. */
  saveMix?: (bytes: Uint8Array, name: string) => Promise<string>;
}

type TileState = 'idle' | 'preparing' | 'on';
type MixState =
  | { status: 'idle' }
  | { status: 'recording'; since: number; seconds: number }
  | { status: 'saving' }
  | { status: 'saved'; name: string; full: boolean }
  | { status: 'error'; code: string };

const CATEGORY_KEY: Record<PadCategory, Key> = { beat: 'pad.cat.beat', background: 'pad.cat.background', voice: 'pad.cat.voice', other: 'pad.cat.other' };

const codeOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** `pad-mix_2026-11-19_1612.wav`, and `_2`, `_3`… when the name is taken. */
export function mixName(now: Date, copy = 1): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
  return `pad-mix_${stamp}${copy > 1 ? `_${copy}` : ''}.wav`;
}

async function saveMixFile(bytes: Uint8Array, name: string): Promise<string> {
  if (!inHost()) {
    downloadBytes(bytes, name);
    return name;
  }
  const now = new Date();
  const base64 = bytesToBase64(bytes);
  let last = name;
  const out = await saveInAppFolder(base64, (copy) => (last = mixName(now, copy)));
  if (out.kind === 'refused') throw new Error(out.code);
  return last;
}

export default function Pad({ onBack, deps = {} }: { onBack?: () => void; deps?: PadDeps }) {
  const { t } = useI18n();
  const deckRef = useRef<PadDeck | null>(null);
  if (!deckRef.current) deckRef.current = deps.deck ?? new PadMixer();
  const deck = deckRef.current;
  const transform = deps.transform ?? browserTransform;
  const readSound = deps.readSound ?? (async (path: string) => fetchBytes(await soundUrl(path)));
  const saveMix = deps.saveMix ?? saveMixFile;
  const readPassage = deps.readPassage ?? (async (path: string, passage: Passage) => loadPassage(await soundUrl(path), path, passage, { decode: (bytes) => deck.decode(bytes) }));

  const ports = useMemo<KeptPorts>(() => deps.ports ?? (inHost()
    ? { hostGet: hostStateGet, hostSet: hostStateSet }
    : { storage: (() => { try { return window.localStorage; } catch (err) { console.warn('[music-loop] no localStorage in this frame', err); return null; } })() }), [deps.ports]);

  const [kept, setKept] = useState<KeptLoop[] | null>(null);
  const [listError, setListError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [tiles, setTiles] = useState<Record<string, TileState>>({});
  const [failed, setFailed] = useState<{ name: string; code: string } | null>(null);
  const [categoryError, setCategoryError] = useState(false);
  const [mix, setMix] = useState<MixState>({ status: 'idle' });
  const [editing, setEditing] = useState<string | null>(null);
  const ready = useRef(new Map<string, PreparedLoop>());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      deck.dispose().catch((err) => console.warn('[music-loop] the pad did not release the sound card', err));
    };
  }, [deck]);

  useEffect(() => {
    let current = true;
    setListError(false);
    loadKept(ports).then(
      (list) => { if (current) setKept(list); },
      (err) => {
        console.error('[music-loop] kept loops not read for the pad', err);
        if (current) setListError(true);
      },
    );
    return () => { current = false; };
  }, [ports, attempt]);

  // A loop sent from the studio shows up here by itself.
  useEffect(() => onKeptAnnounced(() => setAttempt((n) => n + 1)), []);

  const setTile = useCallback((id: string, state: TileState) => setTiles((all) => ({ ...all, [id]: state })), []);

  const toggle = useCallback(async (loop: KeptLoop) => {
    const state = tiles[loop.id] ?? 'idle';
    if (state === 'preparing') return;
    if (state === 'on') {
      deck.stop(loop.id);
      setTile(loop.id, 'idle');
      return;
    }
    setFailed(null);
    setTile(loop.id, 'preparing');
    try {
      let prepared = ready.current.get(loop.id);
      if (!prepared) {
        const source = loop.passage
          ? await readPassage(loop.path, loop.passage)
          : await deck.decode(await readSound(loop.path));
        const region = { start: Math.round(loop.start * source.sampleRate), end: Math.round(loop.end * source.sampleRate) };
        prepared = await prepareLoop(source.channels, source.sampleRate, region, loop.settings, transform);
        ready.current.set(loop.id, prepared);
      }
      if (!alive.current) return;
      await deck.start(loop.id, prepared, loop.settings, loop.laps ?? null, () => { if (alive.current) setTile(loop.id, 'idle'); });
      if (alive.current) setTile(loop.id, 'on');
    } catch (err) {
      console.error('[music-loop] a pad did not start', err);
      if (!alive.current) return;
      setTile(loop.id, 'idle');
      setFailed({ name: loop.name, code: codeOf(err) });
    }
  }, [tiles, deck, readSound, readPassage, transform, setTile]);

  const stopAll = useCallback(() => {
    deck.stopAll();
    setTiles((all) => Object.fromEntries(Object.entries(all).map(([id, s]) => [id, s === 'on' ? 'idle' : s])));
  }, [deck]);

  // A change to a tile (its category, its number of laps) is written with the whole list.
  const change = useCallback((loop: KeptLoop, patch: { category?: PadCategory; laps?: number }) => {
    if (!kept) return;
    const next = kept.map((l) => {
      if (l.id !== loop.id) return l;
      const { laps: before, ...rest } = { ...l, ...(patch.category ? { category: patch.category } : {}) };
      const laps = patch.laps === undefined ? before : patch.laps;
      return laps ? { ...rest, laps } : rest;
    });
    setKept(next);
    setCategoryError(false);
    saveKept(ports, next).catch((err) => {
      console.error('[music-loop] the tile was not saved', err);
      if (alive.current) setCategoryError(true);
    });
  }, [kept, ports]);

  const finish = useCallback(async (full: boolean) => {
    const recorded = deck.stopRecording();
    if (!recorded) return;
    setMix({ status: 'saving' });
    try {
      holdUnderCeiling(recorded.channels);
      const bytes = encodeWav16(recorded.channels, recorded.sampleRate);
      const name = await saveMix(bytes, mixName(new Date()));
      if (alive.current) setMix({ status: 'saved', name, full });
    } catch (err) {
      console.error('[music-loop] the mix was not saved', err);
      if (alive.current) setMix({ status: 'error', code: codeOf(err) });
    }
  }, [deck, saveMix]);

  const record = useCallback(async () => {
    try {
      await deck.startRecording(() => { finish(true).catch((err) => console.error('[music-loop] the full mix was not saved', err)); });
      if (alive.current) setMix({ status: 'recording', since: Date.now(), seconds: 0 });
    } catch (err) {
      console.error('[music-loop] recording did not start', err);
      if (alive.current) setMix({ status: 'error', code: codeOf(err) });
    }
  }, [deck, finish]);

  // The clock of a recording, once a second.
  const recordingSince = mix.status === 'recording' ? mix.since : null;
  useEffect(() => {
    if (recordingSince === null) return undefined;
    const timer = setInterval(() => {
      setMix((m) => (m.status === 'recording' ? { ...m, seconds: Math.floor((Date.now() - m.since) / 1000) } : m));
    }, 1000);
    return () => clearInterval(timer);
  }, [recordingSince]);

  const edited = editing ? (kept ?? []).find((l) => l.id === editing) ?? null : null;
  const anyOn = Object.values(tiles).some((s) => s === 'on');
  const shelves = PAD_CATEGORIES
    .map((category) => ({ category, loops: (kept ?? []).filter((l) => (l.category ?? 'other') === category) }))
    .filter((shelf) => shelf.loops.length > 0);

  return (
    <div className="ml-root">
      <header className="ml-bar">
        {onBack && <IconButton label={t('pad.back')} onClick={onBack}><Back /></IconButton>}
        <h1>{t('pad.title')}</h1>
        <span className="ml-grow" />
        {mix.status === 'recording' && <span className="ml-badge rec" role="status">{t('pad.recording', { time: formatTime(mix.seconds) })}</span>}
        {mix.status === 'recording'
          ? <button type="button" className="primary" onClick={() => { finish(false).catch((err) => console.error('[music-loop] the mix was not saved', err)); }}><Stop />{t('pad.recordStop')}</button>
          : <button type="button" onClick={() => { record().catch((err) => console.error('[music-loop] recording did not start', err)); }} disabled={mix.status === 'saving' || !kept || kept.length === 0}><Record />{t('pad.record')}</button>}
        <button type="button" onClick={stopAll} disabled={!anyOn}><Stop />{t('pad.stopAll')}</button>
      </header>

      {mix.status === 'saving' && <p className="ml-notice busy" role="status">{t('pad.saving')}</p>}
      {mix.status === 'saved' && <p className="ml-notice" role="status">{mix.full ? `${t('pad.full')} ` : ''}{t('pad.saved', { name: mix.name })}</p>}
      {mix.status === 'error' && <p className="ml-notice warn" role="alert">{t('pad.notSaved', { why: exportRefusal(t, mix.code) })}</p>}
      {failed && <p className="ml-notice warn" role="alert">{t('pad.failed', { name: failed.name, why: errorText(t, failed.code) })}</p>}
      {categoryError && <p className="ml-notice warn" role="alert">{t('pad.categoryError')}</p>}

      {listError && (
        <p className="ml-notice warn" role="alert">
          {t('pad.error')}
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>{t('error.retry')}</button>
        </p>
      )}
      {!kept && !listError && <p className="ml-notice busy" role="status">{t('pad.loading')}</p>}
      {kept && kept.length === 0 && <p className="ml-notice">{t('pad.empty')}</p>}

      {edited && (
        <>
          <div className="ml-pad-veil" onClick={() => setEditing(null)} />
          <section className="ml-card ml-pad-panel" aria-label={t('pad.edit', { name: edited.name })}>
            <div className="ml-row">
              <h2 className="ml-grow">{edited.name}</h2>
              <IconButton label={t('pad.editClose')} onClick={() => setEditing(null)}><Close /></IconButton>
            </div>
            <span className="lab">{t('pad.categoryLabel')}</span>
            <Tiles
              label={t('pad.categoryLabel')}
              value={edited.category ?? 'other'}
              options={PAD_CATEGORIES.map((c) => ({ value: c, text: t(CATEGORY_KEY[c]) }))}
              onChange={(c) => change(edited, { category: c })}
            />
            <span className="lab">{t('pad.laps')}</span>
            <Tiles
              label={t('pad.laps')}
              value={edited.laps ?? 0}
              options={[{ value: 0, text: '∞', title: t('pad.laps.endless') }, ...PAD_LAPS.map((n) => ({ value: n as number, text: String(n) }))]}
              onChange={(n) => change(edited, { laps: n })}
            />
          </section>
        </>
      )}

      {shelves.map((shelf) => (
        <section key={shelf.category} className={`ml-shelf cat-${shelf.category}`} aria-label={t(`pad.cat.${shelf.category}`)}>
          <h2>{t(`pad.cat.${shelf.category}`)}</h2>
          <div className="ml-pads">
            {shelf.loops.map((loop) => {
              const state = tiles[loop.id] ?? 'idle';
              return (
                <div key={loop.id} className="ml-pad-cell">
                  <button
                    type="button"
                    className={state === 'on' ? 'ml-pad on' : 'ml-pad'}
                    aria-pressed={state === 'on'}
                    aria-label={t(state === 'on' ? 'pad.stop' : 'pad.play', { name: loop.name })}
                    title={loop.name}
                    disabled={state === 'preparing'}
                    onClick={() => { toggle(loop).catch((err) => console.error('[music-loop] a pad did not answer', err)); }}
                  >
                    <span className="n">{loop.name}</span>
                    <span className="lab">
                      {state === 'preparing' ? t('pad.preparing') : formatTime(loop.end - loop.start)}
                      {loop.laps ? ' · × ' + loop.laps : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={editing === loop.id ? 'icon-btn ml-pad-edit chosen' : 'icon-btn ml-pad-edit'}
                    aria-label={t('pad.edit', { name: loop.name })}
                    aria-expanded={editing === loop.id}
                    title={t('pad.edit', { name: loop.name })}
                    onClick={() => setEditing((id) => (id === loop.id ? null : loop.id))}
                  >
                    <Pencil />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
