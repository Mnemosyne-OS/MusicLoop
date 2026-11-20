/**
 * App.tsx — MusicLoop's one screen (doc 249).
 *
 * A sound is opened; its wave fills the width; two handles mark the loop; the
 * cards under it shape the sound; the last card writes a WAV at the length of
 * a short. Three states for the sound: being read, refused in words, ready.
 *
 * The audio engine, the time transform and the export are passed in (`deps`):
 * the screen is tested in jsdom against stand-ins, and the real ones are
 * verified by numbers in a browser.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { LoopEngine, MAX_SOURCE_SECONDS, renderExport, withDeadline, type DecodedSource } from './audio/engine';
import { maxExportSeconds } from './audio/exportPlan';
import { DEFAULT_PASSAGE_SECONDS, fetchRange, loadPassage, passageAt, passageWay, PASSAGE_LENGTHS, probeSeconds, type Passage } from './audio/passage';
import { durationRatio, prepareLoop, type PreparedLoop, type TimeTransform } from './audio/pipeline';
import { bakeKey, BOUNDS, changesTime, clampSetting, DEFAULT_SETTINGS, filterFor, type LoopSettings } from './audio/settings';
import { browserTransform } from './audio/timebase';
import { buildPeakCache, type PeakCache } from './dsp/peaks';
import { beatSeconds, detectTempo } from './dsp/tempo';
import { bytesToBase64, encodeWav16 } from './dsp/wav';
import {
  announceKept, downloadBytes, fetchBytes, hostStateGet, hostStateSet, inHost, musicTakes, openLink, pickSound, safeName, saveInAppFolder, showInFolder, soundUrl, takeLabel, TAKES_REFRESH_MS, isPermissionRefusal, isWorthRetrying,
  type MusicTake,
} from './host';
import { errorText, exportRefusal, type Key } from './i18n/strings';
import { useI18n } from './i18n/useI18n';
import { freshId, loadKept, saveKept, withKept, withoutKept, type KeptLoop, type KeptPorts } from './state/loops';
import { IconButton, IconToggle, NumberField, Slider, Tiles } from './ui/controls';
import { Credits } from './ui/Credits';
import { Backwards, Bookmark, Close, FitAll, FitLoop, FolderOpen, Grid, Info, Magnet, Play, Reset, Reveal, Save, Stop, ZoomIn, ZoomOut } from './ui/icons';
import { clampSpan, formatClock, formatTime, megabytes, viewOfLoop, zoomSpan, type Span } from './ui/viewMath';
import { Waveform } from './ui/Waveform';

/** What the screen asks of the audio engine. */
export interface Studio {
  decode(bytes: ArrayBuffer): Promise<DecodedSource>;
  setLoop(loop: PreparedLoop | null): void;
  setSettings(settings: LoopSettings): void;
  play(): Promise<void>;
  stop(): void;
  readonly playing: boolean;
  position(): number;
  dispose(): Promise<void>;
}

/** What a test passes in place of Web Audio. */
export interface AppDeps {
  engine?: Studio;
  transform?: TimeTransform;
  render?: typeof renderExport;
  /** The length of a sound, in seconds; null when it is not known. */
  probe?: (url: string) => Promise<number | null>;
  /** The length of a sound the decoder refused as too long; null when it is not known. */
  lengthOf?: (url: string) => Promise<number | null>;
  /** Loads a passage of a long sound. */
  passage?: (url: string, path: string, passage: Passage, onProgress: (seconds: number) => void, signal: AbortSignal) => Promise<DecodedSource>;
}

/** A sound too long to be read whole: the screen offers to take a passage of it. */
class LongSound extends Error {
  constructor(readonly url: string, readonly seconds: number) {
    super('TOO_LONG');
  }
}

/** From this size up, the length of a file is asked before it is decoded: a long sound decoded whole would not fit in memory. */
const PROBE_FROM_BYTES = 20 * 1024 * 1024;

/** The length of the sound behind `url`, or null when it is not known in time. */
async function knownLength(url: string): Promise<number | null> {
  try {
    return await probeSeconds(url);
  } catch (err) {
    console.warn('[music-loop] the length of the long sound is not known', err);
    return null;
  }
}

/** The length of the sound behind `url` when its size says it may be a long one; null otherwise, or when it is not known. */
async function lengthIfLarge(url: string): Promise<number | null> {
  let size = 0;
  try {
    size = (await fetchRange(url, 0, 1)).size;
  } catch (err) {
    console.warn('[music-loop] the size of the sound is not known, it is opened whole', err);
    return null;
  }
  if (size < PROBE_FROM_BYTES) return null;
  try {
    return await probeSeconds(url);
  } catch (err) {
    console.warn('[music-loop] the length of the sound is not known, it is opened whole', err);
    return null;
  }
}

type Source =
  | { status: 'none' }
  | { status: 'loading'; name: string; live?: { done: number; of: number } }
  | { status: 'long'; name: string; path: string; url: string; seconds: number; captured: boolean }
  | { status: 'error'; code: string; retry: (() => void) | null }
  | ({ status: 'ready'; name: string; path: string | null; captured: boolean; cache: PeakCache; passage: Passage | null; url: string | null } & DecodedSource);

type ExportLength = 15 | 30 | 60 | 'lap' | 'custom';

type ExportState =
  | { status: 'idle' }
  | { status: 'rendering' }
  | { status: 'saved'; name: string; path: string | null; seconds: number; bytes: number }
  | { status: 'error'; code: string };

/** A file that is not written after this long is reported: an offline render cannot be told to stop. */
const RENDER_TIMEOUT_MS = 120_000;
/**
 * From this confidence up, a tempo found in the sound is trusted enough to
 * snap the handles to it. Under it the tempo is shown as one to check, and
 * the magnet starts off: the detector answers for a steady pulse, and four
 * real tracks measured between 0.10 and 0.33 (doc 249 §12.6).
 */
const TEMPO_SURE = 0.2;
/** The loop is rebuilt this long after the last move of a handle. */
const PREPARE_DELAY_MS = 150;
const BEAT_CHOICES = [1, 2, 4, 8, 16] as const;

const baseName = (path: string): string => path.split(/[\\/]/).pop() || path;
const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

/** MusicLoop's one screen. */
export default function App({ deps = {}, onOpenPad }: { deps?: AppDeps; onOpenPad?: () => void | Promise<void> }) {
  const { t, lang } = useI18n();
  const engineRef = useRef<Studio | null>(null);
  if (!engineRef.current) engineRef.current = deps.engine ?? new LoopEngine(DEFAULT_SETTINGS);
  const engine = engineRef.current;
  const transform = deps.transform ?? browserTransform;
  const render = deps.render ?? renderExport;
  const probe = deps.probe ?? lengthIfLarge;
  const lengthOf = deps.lengthOf ?? knownLength;
  const readPassage = useMemo<NonNullable<AppDeps['passage']>>(
    () => deps.passage ?? ((url, path, passage, onProgress, signal) => loadPassage(url, path, passage, { decode: (bytes) => engine.decode(bytes), onProgress, signal })),
    [deps.passage, engine],
  );

  const [source, setSource] = useState<Source>({ status: 'none' });
  const [loop, setLoop] = useState<Span>({ from: 0, to: 1 });
  const [view, setView] = useState<Span>({ from: 0, to: 1 });
  const [settings, setSettings] = useState<LoopSettings>(DEFAULT_SETTINGS);
  const [tempo, setTempo] = useState<{ bpm: number; firstBeat: number } | null>(null);
  const [snap, setSnap] = useState(true);
  const [tempoSure, setTempoSure] = useState(true);
  const [prepared, setPrepared] = useState<PreparedLoop | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [loopError, setLoopError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [exportLength, setExportLength] = useState<ExportLength>(30);
  const [customSeconds, setCustomSeconds] = useState(45);
  const [exported, setExported] = useState<ExportState>({ status: 'idle' });
  const [kept, setKept] = useState<KeptLoop[]>([]);
  const [keptRead, setKeptRead] = useState(false);
  /** The stored list is known: only then may it be written over. */
  const [keptKnown, setKeptKnown] = useState(false);
  const [keptTry, setKeptTry] = useState(0);
  const [keptError, setKeptError] = useState<Key | null>(null);
  const [keepName, setKeepName] = useState('');
  /** The name of the last loop sent to the pad, said by the button that sent it. */
  const [sent, setSent] = useState<string | null>(null);
  const [credits, setCredits] = useState(false);
  const [takes, setTakes] = useState<MusicTake[]>([]);
  const [takesError, setTakesError] = useState<'failed' | 'denied' | null>(null);
  /** The person said no to the permission: asking again on every return to the window would be nagging. */
  const takesDenied = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const opening = useRef(0);
  /** Stops the reading of the sound being opened when another one is opened. */
  const reading = useRef<AbortController | null>(null);
  const [passageSeconds, setPassageSeconds] = useState<number>(DEFAULT_PASSAGE_SECONDS);
  const longPlayer = useRef<HTMLAudioElement | null>(null);

  const keptPorts = useMemo<KeptPorts>(() => (inHost()
    ? { hostGet: hostStateGet, hostSet: hostStateSet }
    : { storage: (() => { try { return window.localStorage; } catch (err) { console.warn('[music-loop] no localStorage in this frame', err); return null; } })() }), []);

  // The kept loops, read at opening and again on « Try again ». 🚨 A read that
  // failed leaves the stored list UNKNOWN, not empty: nothing is written until
  // one succeeds, or keeping one loop would replace every loop kept before
  // (cold verification of 2026-11-19).
  useEffect(() => {
    let alive = true;
    setKeptRead(false);
    loadKept(keptPorts).then(
      (list) => { if (alive) { setKept(list); setKeptKnown(true); setKeptError(null); setKeptRead(true); } },
      (err) => { console.error('[music-loop] kept loops not read', err); if (alive) { setKeptKnown(false); setKeptError('kept.loadError'); setKeptRead(true); } },
    );
    return () => { alive = false; };
  }, [keptPorts, keptTry]);

  // The sounds the Recorder captured (doc 249 §6), read at opening and again
  // each time the window comes back to the front: the person has just been
  // recording in another window.
  useEffect(() => {
    if (!inHost()) return;
    let alive = true;
    let lastRead = -Infinity;
    const read = () => {
      const now = Date.now();
      if (takesDenied.current || now - lastRead < TAKES_REFRESH_MS) return;
      lastRead = now;
      musicTakes().then(
        (list) => { if (alive) { setTakes(list ?? []); setTakesError(null); } },
        (err) => {
          console.error('[music-loop] captured sounds not read', err);
          const denied = isPermissionRefusal(err instanceof Error ? err.message : String(err));
          if (denied) takesDenied.current = true;
          if (alive) setTakesError(denied ? 'denied' : 'failed');
        },
      );
    };
    read();
    window.addEventListener('focus', read);
    return () => { alive = false; window.removeEventListener('focus', read); };
  }, []);

  // The sound card is released when the window closes.
  useEffect(() => () => { void engine.dispose(); }, [engine]);

  /** A decoded sound becomes what the screen shows; a kept loop brings its region and settings back. */
  const show = useCallback((decoded: DecodedSource, name: string, path: string | null, captured: boolean, restore: KeptLoop | null, passage: Passage | null = null, url: string | null = null) => {
    engine.stop();
    setPlaying(false);
    const found = detectTempo(decoded.channels, decoded.sampleRate);
    const beat = restore?.bpm ? { bpm: restore.bpm, firstBeat: found?.firstBeat ?? 0 } : found ? { bpm: found.bpm, firstBeat: found.firstBeat } : null;
    const first: Span = restore
      ? { from: restore.start, to: restore.end }
      : beat
        ? { from: beat.firstBeat, to: beat.firstBeat + 4 * beatSeconds(beat.bpm) }
        : { from: 0, to: Math.min(4, decoded.seconds) };
    const region = clampSpan(first, decoded.seconds);
    // A tempo the person kept with a loop is theirs; one just found is trusted by its confidence.
    const sure = restore?.bpm ? true : (found?.confidence ?? 0) >= TEMPO_SURE;
    setTempoSure(sure);
    setSnap(sure);
    setTempo(beat);
    setLoop(region);
    setView(viewOfLoop(region, decoded.seconds));
    setSettings(restore ? restore.settings : DEFAULT_SETTINGS);
    setPrepared(null);
    setLoopError(null);
    setExported({ status: 'idle' });
    setKeepName(restore?.name ?? safeName(name));
    setSource({ status: 'ready', name, path, captured, cache: buildPeakCache(decoded.channels), passage, url, ...decoded });
  }, [engine]);

  const openWith = useCallback((name: string, read: (signal: AbortSignal) => Promise<DecodedSource>, path: string | null, captured: boolean, restore: KeptLoop | null, retry: (() => void) | null, passage: Passage | null = null, url: string | null = null) => {
    const turn = ++opening.current;
    reading.current?.abort();
    const control = new AbortController();
    reading.current = control;
    // The sound being replaced stops now: if the new one is refused, no loop
    // must keep playing behind a screen that has no stop button any more.
    engine.stop();
    setPlaying(false);
    setSource({ status: 'loading', name });
    read(control.signal).then(
      (decoded) => { if (turn === opening.current) show(decoded, name, path, captured, restore, passage, url); },
      (err) => {
        if (turn !== opening.current) return;
        // Too long to be read whole: not a refusal, the screen offers a passage of it.
        if (err instanceof LongSound && path) {
          setSource({ status: 'long', name, path, url: err.url, seconds: err.seconds, captured });
          return;
        }
        console.error('[music-loop] the sound was not opened', err);
        const code = err instanceof Error ? err.message : String(err);
        // « Try again » only where trying again can end differently: a file
        // that is too long or is not a sound will be refused the same way.
        setSource({ status: 'error', code, retry: isWorthRetrying(code) ? retry : null });
      },
    );
  }, [engine, show]);

  /** Loads one passage of a long sound; a file read as it plays says how far it is. */
  const openPassage = useCallback((path: string, url: string, passage: Passage, captured: boolean, name: string, restore: KeptLoop | null = null) => {
    const turn = opening.current + 1;
    const live = passageWay(path) === 'live';
    openWith(name, (signal) => readPassage(url, path, passage, (done) => {
      if (live && turn === opening.current) setSource({ status: 'loading', name, live: { done, of: passage.seconds } });
    }, signal), path, captured, restore, () => openPassage(path, url, passage, captured, name, restore), passage, url);
  }, [openWith, readPassage]);

  /**
   * Opens the sound at `path`. `name` is what it is called on screen when its
   * file name does not say it: every capture is a `mix.wav`, and the bar, the
   * exported file and a kept loop must carry what the list called it.
   * A sound longer than a source may be is not read whole: the screen offers
   * a passage of it, and a kept loop cut from a passage loads that passage.
   */
  const openPath = useCallback((path: string, captured = false, restore: KeptLoop | null = null, name?: string) => {
    const shown = name?.trim() || baseName(path);
    const kept = restore?.passage ?? null;
    if (kept) {
      const turn = ++opening.current;
      engine.stop();
      setPlaying(false);
      setSource({ status: 'loading', name: shown });
      soundUrl(path).then(
        (url) => { if (turn === opening.current) openPassage(path, url, kept, captured, shown, restore); },
        (err) => {
          console.error('[music-loop] the sound was not opened', err);
          if (turn !== opening.current) return;
          const code = err instanceof Error ? err.message : String(err);
          setSource({ status: 'error', code, retry: isWorthRetrying(code) ? () => openPath(path, captured, restore, name) : null });
        },
      );
      return;
    }
    openWith(shown, async () => {
      const url = await soundUrl(path);
      const seconds = await probe(url);
      if (seconds !== null && seconds > MAX_SOURCE_SECONDS) throw new LongSound(url, seconds);
      try {
        return await engine.decode(await fetchBytes(url));
      } catch (err) {
        // A small file can still be a long sound (a low bitrate): its length is then asked for.
        if (err instanceof Error && err.message === 'TOO_LONG') {
          const length = await lengthOf(url);
          if (length !== null) throw new LongSound(url, length);
        }
        throw err;
      }
    }, path, captured, restore, () => openPath(path, captured, restore, name));
  }, [openWith, openPassage, engine, probe, lengthOf]);

  /** A capture, opened under the name the list shows. One longer than a source may be is never fetched. */
  const openTake = useCallback((take: MusicTake) => {
    if (take.seconds > MAX_SOURCE_SECONDS) return;
    openPath(take.path, true, null, takeLabel(take, lang));
  }, [openPath, lang]);

  const openFile = useCallback((file: File) => {
    openWith(file.name, async () => engine.decode(await file.arrayBuffer()), null, false, null, null);
  }, [openWith, engine]);

  const onOpenClick = () => {
    if (!inHost()) {
      fileInput.current?.click();
      return;
    }
    pickSound(t('open.filter')).then(
      (path) => { if (path) openPath(path); },
      (err) => {
        console.error('[music-loop] no file picked', err);
        setSource({ status: 'error', code: err instanceof Error ? err.message : String(err), retry: null });
      },
    );
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) openFile(file);
  };

  const ready = source.status === 'ready' ? source : null;
  const bake = bakeKey(settings);

  // The loop is rebuilt when its region or a setting that rewrites the buffer changes.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    setPreparing(true);
    const timer = setTimeout(() => {
      prepareLoop(ready.channels, ready.sampleRate, { start: Math.round(loop.from * ready.sampleRate), end: Math.round(loop.to * ready.sampleRate) }, settings, transform).then(
        (next) => {
          if (!alive) return;
          engine.setLoop(next);
          setPrepared(next);
          setLoopError(null);
          setPreparing(false);
        },
        (err) => {
          console.error('[music-loop] the loop was not prepared', err);
          if (!alive) return;
          setLoopError(err instanceof Error ? err.message : String(err));
          setPreparing(false);
        },
      );
    }, PREPARE_DELAY_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [ready, loop.from, loop.to, bake, engine, transform]); // eslint-disable-line react-hooks/exhaustive-deps

  // The knobs follow at once.
  useEffect(() => { engine.setSettings(settings); }, [engine, settings]);

  const set = <K extends keyof LoopSettings>(key: K, value: LoopSettings[K]) => setSettings((s) => ({ ...s, [key]: value }));
  const setNumber = (key: keyof typeof BOUNDS) => (value: number) => set(key, clampSetting(key, value));

  const togglePlay = () => {
    if (engine.playing) {
      engine.stop();
      setPlaying(false);
      return;
    }
    engine.play().then(
      () => setPlaying(engine.playing),
      (err) => { console.error('[music-loop] the loop did not play', err); setLoopError(err instanceof Error ? err.message : String(err)); },
    );
  };

  const ratio = durationRatio(settings);
  const playheadAt = useCallback((): number | null => {
    if (!engine.playing) return null;
    const pos = engine.position() * ratio;
    return settings.reverse ? loop.to - pos : loop.from + pos;
  }, [engine, ratio, settings.reverse, loop.from, loop.to]);

  const total = ready?.seconds ?? 1;
  const lapSeconds = (loop.to - loop.from) / ratio;
  const heardBpm = tempo ? tempo.bpm * ratio : null;
  const loopBeats = tempo ? (loop.to - loop.from) / beatSeconds(tempo.bpm) : null;
  const chosenBeats = loopBeats !== null ? BEAT_CHOICES.find((n) => Math.abs(loopBeats - n) < 0.02) ?? null : null;

  const exportSeconds = exportLength === 'lap' ? lapSeconds : exportLength === 'custom' ? customSeconds : exportLength;

  const onExport = async () => {
    if (!ready || !prepared) return;
    setExported({ status: 'rendering' });
    try {
      const seconds = Math.min(maxExportSeconds(prepared.sampleRate), Math.max(0.1, exportSeconds));
      const channels = await withDeadline(render(prepared, settings, seconds, exportLength === 'lap'), RENDER_TIMEOUT_MS, 'RENDER_TIMEOUT');
      const bytes = encodeWav16(channels, prepared.sampleRate);
      const stem = `${safeName(ready.name)}${heardBpm ? `_${Math.round(heardBpm)}bpm` : ''}_${exportLength === 'lap' ? 'loop' : `${Number(seconds.toFixed(2))}s`}`;
      const nameFor = (copy: number) => `${stem}${copy > 1 ? `-${copy}` : ''}.wav`;
      const written = (channels[0]?.length ?? 0) / prepared.sampleRate;
      if (!inHost()) {
        downloadBytes(bytes, nameFor(1));
        setExported({ status: 'saved', name: nameFor(1), path: null, seconds: written, bytes: bytes.length });
        return;
      }
      const outcome = await saveInAppFolder(bytesToBase64(bytes), nameFor);
      if (outcome.kind === 'saved') setExported({ status: 'saved', name: baseName(outcome.path), path: outcome.path, seconds: written, bytes: outcome.bytes });
      else setExported({ status: 'error', code: outcome.code });
    } catch (err) {
      console.error('[music-loop] the file was not written', err);
      setExported({ status: 'error', code: err instanceof Error ? err.message : String(err) });
    }
  };

  const writeKept = (next: KeptLoop[]) => {
    // The stored list was never read: writing would replace loops this window has not seen.
    if (!keptKnown) return;
    setKept(next);
    saveKept(keptPorts, next).then(
      () => { setKeptError(null); announceKept(); },
      (err) => { console.error('[music-loop] kept loops not saved', err); setKeptError('kept.error'); },
    );
  };

  const keepLoop = (name: string) => {
    if (!ready?.path) return;
    writeKept(withKept(kept, {
      id: freshId(kept),
      name,
      path: ready.path,
      ...(ready.name !== baseName(ready.path) ? { source: ready.name } : {}),
      ...(ready.passage ? { passage: ready.passage } : {}),
      start: loop.from,
      end: loop.to,
      bpm: tempo?.bpm ?? null,
      captured: ready.captured,
      settings,
      savedAt: new Date().toISOString(),
    }));
  };

  const onKeep = () => {
    if (!ready) return;
    keepLoop(keepName.trim() || safeName(ready.name));
  };

  // One click by the loop: it is kept under where it starts and its name, and
  // the pad, when its window is open, shows it at once.
  const onSendToPad = () => {
    if (!ready?.path || !keptKnown) return;
    // Where it starts comes first: two loops of one sound differ at the start of their names, where a small tile shows them.
    const name = `${formatTime(loop.from)} ${keepName.trim() || safeName(ready.name)}`.slice(0, 80);
    keepLoop(name);
    setSent(name);
  };

  const filter = filterFor(settings.filter);
  const resetTitle = (text: string) => t('set.reset', { value: text });
  const db = (n: number) => t('unit.db', { n: signed(n) });
  const percent = (n: number) => (n > 0 ? t('unit.percent', { n: Math.round(n * 100) }) : t('unit.off'));

  return (
    <div className="ml-root" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="ml-bar">
        <h1>{t('app.title')}</h1>
        <button type="button" className="primary" onClick={onOpenClick}><FolderOpen />{t('open.button')}</button>
        <input ref={fileInput} type="file" accept="audio/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }} />
        {ready && <span className="ml-file" title={ready.path ?? ready.name}>{ready.name} · {formatTime(ready.seconds)}</span>}
        {ready?.captured && <span className="ml-badge">{t('open.captured')}</span>}
        {ready?.passage && <span className="ml-badge">{t('long.badge', { from: formatClock(ready.passage.from), total: formatClock(ready.passage.total) })}</span>}
        {ready?.passage && ready.path && ready.url && (
          <button type="button" onClick={() => { engine.stop(); setPlaying(false); setSource({ status: 'long', name: ready.name, path: ready.path!, url: ready.url!, seconds: ready.passage!.total, captured: ready.captured }); }}>{t('long.other')}</button>
        )}
        <span className="ml-grow" />
        {onOpenPad && <IconButton label={t('pad.open')} onClick={() => { Promise.resolve(onOpenPad()).catch((err) => console.error('[music-loop] the pad was not opened', err)); }}><Grid /></IconButton>}
        <IconButton label={t('credits.open')} onClick={() => setCredits(true)}><Info /></IconButton>
      </header>

      {source.status === 'none' && (
        <button type="button" className="ml-empty" onClick={onOpenClick}><FolderOpen />{t('open.drop')}</button>
      )}
      {source.status === 'loading' && (
        <p className="ml-notice busy" role="status">
          {source.live ? t('long.live', { done: formatClock(source.live.done), of: formatClock(source.live.of) }) : t('open.loading', { name: source.name })}
        </p>
      )}
      {source.status === 'error' && (
        <p className="ml-notice warn" role="alert">
          {errorText(t, source.code)}
          {source.retry && <button type="button" onClick={source.retry}>{t('error.retry')}</button>}
        </p>
      )}

      {source.status === 'long' && (
        <section className="ml-card ml-long" aria-label={t('long.title', { time: formatClock(source.seconds) })}>
          <h2>{source.name} · {t('long.title', { time: formatClock(source.seconds) })}</h2>
          <p className="lab">{t('long.hint')}</p>
          {/* The host serves the file by byte ranges: the player moves anywhere in it without loading it. */}
          <audio ref={longPlayer} className="ml-long-player" controls preload="metadata" src={source.url} />
          <span className="lab">{t('long.length')}</span>
          <Tiles
            label={t('long.length')}
            value={passageSeconds}
            options={PASSAGE_LENGTHS.map((n) => ({ value: n as number, text: t('long.minutes', { n: n / 60 }) }))}
            onChange={setPassageSeconds}
          />
          {passageWay(source.path) === 'live' && <p className="lab">{t('long.liveHint')}</p>}
          <div className="ml-row">
            <button
              type="button"
              className="primary"
              onClick={() => {
                const at = longPlayer.current?.currentTime ?? 0;
                longPlayer.current?.pause();
                openPassage(source.path, source.url, passageAt(at, passageSeconds, source.seconds), source.captured, source.name);
              }}
            >
              {t('long.take')}
            </button>
          </div>
        </section>
      )}

      {ready && (
        <>
          <section className="ml-wave">
            <div className="ml-transport">
              <IconButton label={playing ? t('play.stop') : t('play.play')} onClick={togglePlay} disabled={!prepared || (preparing && !playing)} primary>
                {playing ? <Stop /> : <Play />}
              </IconButton>
              <span className="ml-times">
                <span title={t('wave.start')}>{formatTime(loop.from)}</span>
                <span aria-hidden="true">→</span>
                <span title={t('wave.end')}>{formatTime(loop.to)}</span>
                <span className="len" title={t('wave.length')}>{formatTime(lapSeconds)}</span>
              </span>
              {preparing && <span className="ml-busy" role="status">{t('play.preparing')}</span>}
              <button type="button" onClick={onSendToPad} disabled={!ready.path || !keptKnown} title={ready.path ? t('pad.send') : t('kept.session')}><Grid />{t('pad.send')}</button>
              {sent && <span className="lab" role="status">{t('pad.sent', { name: sent })}</span>}
              <span className="ml-grow" />
              <div className="ml-tempo" role="group" aria-label={t('tempo.label')}>
                {tempo ? (
                  <>
                    <label>
                      <NumberField label={t('tempo.bpm')} value={tempo.bpm} min={40} max={300} step={0.1} digits={1} onCommit={(bpm) => { setTempo({ ...tempo, bpm }); setTempoSure(true); }} />
                      <span className="lab">{t('tempo.bpm')}</span>
                    </label>
                    <button type="button" title={t('tempo.half')} aria-label={t('tempo.half')} disabled={tempo.bpm / 2 < 40} onClick={() => setTempo({ ...tempo, bpm: tempo.bpm / 2 })}>÷2</button>
                    <button type="button" title={t('tempo.double')} aria-label={t('tempo.double')} disabled={tempo.bpm * 2 > 300} onClick={() => setTempo({ ...tempo, bpm: tempo.bpm * 2 })}>×2</button>
                    <IconToggle label={t('tempo.snap')} on={snap} onChange={setSnap}><Magnet /></IconToggle>
                    {!tempoSure && <span className="ml-badge">{t('tempo.unsure')}</span>}
                  </>
                ) : <span className="lab">{t('tempo.none')}</span>}
              </div>
              <div className="segmented" role="group">
                <IconButton label={t('wave.zoomOut')} onClick={() => setView((v) => zoomSpan(v, 1.6, (v.from + v.to) / 2, total))}><ZoomOut /></IconButton>
                <IconButton label={t('wave.zoomIn')} onClick={() => setView((v) => zoomSpan(v, 0.625, (loop.from + loop.to) / 2, total))}><ZoomIn /></IconButton>
                <IconButton label={t('wave.zoomLoop')} onClick={() => setView(viewOfLoop(loop, total))}><FitLoop /></IconButton>
                <IconButton label={t('wave.zoomAll')} onClick={() => setView({ from: 0, to: total })}><FitAll /></IconButton>
              </div>
            </div>
            <Waveform
              channels={ready.channels} cache={ready.cache} sampleRate={ready.sampleRate} total={total}
              view={view} loop={loop} tempo={tempo} snap={snap}
              playheadAt={playheadAt} playing={playing}
              onLoop={setLoop} onView={setView}
              label={t('wave.label', { name: ready.name })} t={t}
            />
            <Waveform
              overview
              channels={ready.channels} cache={ready.cache} sampleRate={ready.sampleRate} total={total}
              view={view} loop={loop} tempo={null} snap={false}
              playheadAt={playheadAt} playing={playing}
              onLoop={setLoop} onView={setView}
              label={t('wave.overview')} t={t}
            />
            {tempo && (
              <div className="ml-beats">
                <span className="lab">{t('tempo.beats')}</span>
                <Tiles
                  label={t('tempo.beats')}
                  options={BEAT_CHOICES.map((n) => ({ value: n, text: String(n), title: t('tempo.beatsOf', { n }) }))}
                  value={chosenBeats}
                  onChange={(n) => setLoop(clampSpan({ from: loop.from, to: loop.from + n * beatSeconds(tempo.bpm) }, total))}
                />
              </div>
            )}
            {loopError && <p className="ml-notice warn" role="alert">{errorText(t, loopError)}</p>}
          </section>

          <div className="g-grid">
            <section className="ml-card">
              <h2>{t('card.eq')}</h2>
              {(['low', 'mid', 'high', 'gainDb'] as const).map((key) => (
                <Slider key={key} label={t(`set.${key}`)} value={settings[key]} bound={BOUNDS[key]} text={db(settings[key])} onChange={setNumber(key)} reset={DEFAULT_SETTINGS[key]} resetTitle={resetTitle(db(DEFAULT_SETTINGS[key]))} />
              ))}
            </section>

            <section className="ml-card">
              <h2>{t('card.fx')}</h2>
              <Slider
                label={t('set.filter')} value={settings.filter} bound={BOUNDS.filter}
                text={filter.type === 'allpass' ? t('unit.off') : t(filter.type === 'lowpass' ? 'unit.lowpass' : 'unit.highpass', { n: Math.round(filter.frequency) })}
                onChange={setNumber('filter')} reset={0} resetTitle={resetTitle(t('unit.off'))}
              />
              <Slider label={t('set.drive')} value={settings.drive} bound={BOUNDS.drive} text={percent(settings.drive)} onChange={setNumber('drive')} reset={0} resetTitle={resetTitle(t('unit.off'))} />
              <Slider label={t('set.echoMix')} value={settings.echoMix} bound={BOUNDS.echoMix} text={percent(settings.echoMix)} onChange={setNumber('echoMix')} reset={0} resetTitle={resetTitle(t('unit.off'))} />
              {settings.echoMix > 0 && (
                <>
                  <Slider label={t('set.echoMs')} value={settings.echoMs} bound={BOUNDS.echoMs} text={t('unit.ms', { n: Math.round(settings.echoMs) })} onChange={setNumber('echoMs')} reset={DEFAULT_SETTINGS.echoMs} resetTitle={resetTitle(t('unit.ms', { n: DEFAULT_SETTINGS.echoMs }))} />
                  {heardBpm && (
                    <Tiles
                      label={t('set.echoMs')}
                      options={[0.25, 0.5, 0.75, 1].map((f) => ({ value: f, text: f === 1 ? '1' : f === 0.5 ? '½' : f === 0.25 ? '¼' : '¾', title: t('unit.ms', { n: Math.round((60000 / heardBpm) * f) }) }))}
                      value={[0.25, 0.5, 0.75, 1].find((f) => Math.abs((60000 / heardBpm) * f - settings.echoMs) < 1.5) ?? null}
                      onChange={(f) => setNumber('echoMs')((60000 / heardBpm) * f)}
                    />
                  )}
                  <Slider label={t('set.echoFeedback')} value={settings.echoFeedback} bound={BOUNDS.echoFeedback} text={t('unit.percent', { n: Math.round(settings.echoFeedback * 100) })} onChange={setNumber('echoFeedback')} reset={DEFAULT_SETTINGS.echoFeedback} resetTitle={resetTitle(t('unit.percent', { n: Math.round(DEFAULT_SETTINGS.echoFeedback * 100) }))} />
                </>
              )}
              <Slider label={t('set.reverbMix')} value={settings.reverbMix} bound={BOUNDS.reverbMix} text={percent(settings.reverbMix)} onChange={setNumber('reverbMix')} reset={0} resetTitle={resetTitle(t('unit.off'))} />
              {settings.reverbMix > 0 && (
                <Slider label={t('set.reverbSeconds')} value={settings.reverbSeconds} bound={BOUNDS.reverbSeconds} text={t('unit.s', { n: settings.reverbSeconds.toFixed(1) })} onChange={setNumber('reverbSeconds')} reset={DEFAULT_SETTINGS.reverbSeconds} resetTitle={resetTitle(t('unit.s', { n: DEFAULT_SETTINGS.reverbSeconds.toFixed(1) }))} />
              )}
            </section>

            <section className="ml-card">
              <h2>{t('card.time')}</h2>
              <Slider label={t('set.speed')} value={settings.speed} bound={BOUNDS.speed} text={t('unit.times', { n: settings.speed.toFixed(2) })} onChange={setNumber('speed')} reset={1} resetTitle={resetTitle(t('unit.times', { n: '1.00' }))} />
              {tempo && (
                <label className="ml-field">
                  <span className="name">{t('set.targetBpm')}</span>
                  <NumberField
                    label={t('set.targetBpm')} value={tempo.bpm * settings.speed} step={1}
                    min={Math.ceil(tempo.bpm * BOUNDS.speed.min)} max={Math.floor(tempo.bpm * BOUNDS.speed.max)}
                    onCommit={(bpm) => setNumber('speed')(bpm / tempo.bpm)}
                  />
                  <span className="lab">{t('tempo.bpm')}</span>
                </label>
              )}
              <Slider label={t('set.semitones')} value={settings.semitones} bound={BOUNDS.semitones} text={t('unit.semitones', { n: signed(settings.semitones) })} onChange={setNumber('semitones')} reset={0} resetTitle={resetTitle(t('unit.semitones', { n: '0' }))} />
              <label className="ml-check">
                <input type="checkbox" checked={settings.keepPitch} onChange={(e) => set('keepPitch', e.target.checked)} />
                <span>{t('set.keepPitch')}</span>
              </label>
            </section>

            <section className="ml-card">
              <h2>{t('card.shape')}</h2>
              <Slider label={t('set.fadeMs')} value={settings.fadeMs} bound={BOUNDS.fadeMs} text={t('unit.ms', { n: Math.round(settings.fadeMs) })} onChange={setNumber('fadeMs')} reset={DEFAULT_SETTINGS.fadeMs} resetTitle={resetTitle(t('unit.ms', { n: DEFAULT_SETTINGS.fadeMs }))} />
              <div className="ml-row">
                <IconToggle label={t('set.reverse')} on={settings.reverse} onChange={(on) => set('reverse', on)}><Backwards /></IconToggle>
                <IconButton label={t('set.resetAll')} onClick={() => setSettings(DEFAULT_SETTINGS)} disabled={!changesTime(settings) && JSON.stringify(settings) === JSON.stringify(DEFAULT_SETTINGS)}><Reset /></IconButton>
              </div>
            </section>

            <section className="ml-card">
              <h2>{t('card.export')}</h2>
              <Tiles<ExportLength>
                label={t('export.length')}
                options={[
                  { value: 15, text: t('export.seconds', { n: 15 }) },
                  { value: 30, text: t('export.seconds', { n: 30 }) },
                  { value: 60, text: t('export.seconds', { n: 60 }) },
                  { value: 'lap', text: t('export.lap'), title: formatTime(lapSeconds) },
                  { value: 'custom', text: t('export.seconds', { n: customSeconds }) },
                ]}
                value={exportLength}
                onChange={setExportLength}
              />
              {exportLength === 'custom' && (
                <label className="ml-field">
                  <span className="name">{t('export.custom')}</span>
                  <NumberField label={t('export.custom')} value={customSeconds} min={0.1} max={maxExportSeconds(ready.sampleRate)} step={1} digits={2} onCommit={setCustomSeconds} />
                </label>
              )}
              <button type="button" className="primary" disabled={!prepared || preparing || exported.status === 'rendering'} onClick={() => { void onExport(); }}>
                <Save />{exported.status === 'rendering' ? t('export.rendering') : t('export.save')}
              </button>
              {ready.captured && <p className="ml-rights">{t('export.rights')}</p>}
              {exported.status === 'saved' && (
                <p className="ml-notice ok" role="status">
                  {exported.path
                    ? t('export.saved', { name: exported.name, seconds: exported.seconds.toFixed(2), size: t('unit.mb', { n: megabytes(exported.bytes) }) })
                    : t('export.downloaded', { name: exported.name })}
                  {exported.path && (
                    <IconButton label={t('export.show')} onClick={() => { showInFolder(exported.path!).catch((err) => console.error('[music-loop] folder not shown', err)); }}><Reveal /></IconButton>
                  )}
                </p>
              )}
              {exported.status === 'error' && <p className="ml-notice warn" role="alert">{exportRefusal(t, exported.code)}</p>}
            </section>

            {(takes.length > 0 || takesError) && (
              <section className="ml-card">
                <h2>{t('card.captures')}</h2>
                {takesError && <p className="ml-notice warn" role="alert">{t(takesError === 'denied' ? 'error.permission' : 'captures.error')}</p>}
                <TakeList takes={takes} onOpen={openTake} t={t} lang={lang} />
              </section>
            )}

            <section className="ml-card">
              <h2>{t('card.kept')}</h2>
              {ready.path ? (
                <div className="ml-row">
                  <input type="text" className="ml-name" value={keepName} maxLength={80} aria-label={t('kept.name')} onChange={(e) => setKeepName(e.target.value)} />
                  <IconButton label={t('kept.keep')} onClick={onKeep} disabled={!keptKnown}><Bookmark /></IconButton>
                </div>
              ) : <p className="lab">{t('kept.session')}</p>}
              {keptError && (
                <p className="ml-notice warn" role="alert">
                  {t(keptError)}
                  {keptError === 'kept.loadError' && <button type="button" onClick={() => setKeptTry((n) => n + 1)}>{t('error.retry')}</button>}
                </p>
              )}
              {!keptRead && <span className="ml-busy" role="status">{t('kept.loading')}</span>}
              <KeptList kept={kept} quiet={!keptRead || !keptKnown} onOpen={(k) => openPath(k.path, k.captured, k, k.source)} onRemove={(k) => writeKept(withoutKept(kept, k.id))} t={t} />
            </section>
          </div>
        </>
      )}

      {!ready && takesError && <p className="ml-notice warn" role="alert">{t(takesError === 'denied' ? 'error.permission' : 'captures.error')}</p>}
      {!ready && takes.length > 0 && (
        <section className="ml-card ml-below">
          <h2>{t('card.captures')}</h2>
          <TakeList takes={takes} onOpen={openTake} t={t} lang={lang} />
        </section>
      )}
      {!ready && keptError && (
        <p className="ml-notice warn" role="alert">
          {t(keptError)}
          {keptError === 'kept.loadError' && <button type="button" onClick={() => setKeptTry((n) => n + 1)}>{t('error.retry')}</button>}
        </p>
      )}
      {!ready && kept.length > 0 && (
        <section className="ml-card ml-below">
          <h2>{t('card.kept')}</h2>
          <KeptList kept={kept} onOpen={(k) => openPath(k.path, k.captured, k, k.source)} onRemove={(k) => writeKept(withoutKept(kept, k.id))} t={t} />
        </section>
      )}

      {credits && <Credits t={t} onClose={() => setCredits(false)} onLink={(url) => { openLink(url).catch((err) => console.error('[music-loop] link not opened', err)); }} />}
    </div>
  );
}

function TakeList({ takes, onOpen, t, lang }: {
  takes: readonly MusicTake[];
  onOpen: (take: MusicTake) => void;
  t: ReturnType<typeof useI18n>['t'];
  lang: string;
}) {
  return (
    <ul className="ml-kept">
      {takes.map((take) => {
        const label = takeLabel(take, lang);
        // A capture longer than a source may be is shown, and says why it does not open.
        const tooLong = take.seconds > MAX_SOURCE_SECONDS;
        const say = tooLong ? t('captures.tooLong', { name: label }) : t('captures.open', { name: label });
        return (
        <li key={take.path}>
          <button type="button" className="open" title={tooLong ? say : take.path} aria-label={say} disabled={tooLong} onClick={() => onOpen(take)}>
            <span className="n">{label}</span>
            <span className="lab">{formatTime(take.seconds)}{take.sampleRate ? ` · ${t('captures.khz', { n: Number((take.sampleRate / 1000).toFixed(1)) })}` : ''}</span>
          </button>
        </li>
        );
      })}
    </ul>
  );
}

function KeptList({ kept, onOpen, onRemove, t, quiet = false }: {
  kept: readonly KeptLoop[];
  /** The list is still being read: an empty one says nothing yet. */
  quiet?: boolean;
  onOpen: (loop: KeptLoop) => void;
  onRemove: (loop: KeptLoop) => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  if (kept.length === 0) return quiet ? null : <p className="lab">{t('kept.none')}</p>;
  return (
    <ul className="ml-kept">
      {kept.map((k) => (
        <li key={k.id}>
          <button type="button" className="open" title={k.path} aria-label={t('kept.open', { name: k.name })} onClick={() => onOpen(k)}>
            <span className="n">{k.name}</span>
            <span className="lab">{formatTime(k.end - k.start)}{k.bpm ? ` · ${Math.round(k.bpm)} ${t('tempo.bpm')}` : ''}</span>
          </button>
          <IconButton label={t('kept.remove', { name: k.name })} onClick={() => onRemove(k)}><Close /></IconButton>
        </li>
      ))}
    </ul>
  );
}
