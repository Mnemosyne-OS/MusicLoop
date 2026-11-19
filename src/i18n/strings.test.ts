// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BOUNDS } from '../audio/settings';
import { errorText, exportRefusal, translate, WRITTEN, type Key } from './strings';

describe('strings', () => {
  const keys = Object.keys(WRITTEN.en) as Key[];

  it('writes every key in fr and es', () => {
    for (const lang of ['fr', 'es'] as const) {
      expect(keys.filter((k) => !(k in WRITTEN[lang])), lang).toEqual([]);
      expect(Object.keys(WRITTEN[lang]).filter((k) => !(k in WRITTEN.en)), lang).toEqual([]);
    }
  });

  it('keeps every placeholder in every written language', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const k of keys) {
      const en = vars(WRITTEN.en[k]);
      for (const lang of ['fr', 'es'] as const) expect(vars((WRITTEN[lang] as Record<string, string>)[k]!), `${lang} ${k}`).toBe(en);
    }
  });

  it('names every setting the person can move', () => {
    for (const key of [...Object.keys(BOUNDS), 'reverse', 'keepPitch']) expect(keys, key).toContain(`set.${key}`);
  });

  it('speaks to nobody in French: neither tu nor vous (settings tone)', () => {
    const second = /\b(tu|toi|ton|ta|tes|vous|votre|vos)\b/i;
    for (const k of keys) expect((WRITTEN.fr as Record<string, string>)[k], k).not.toMatch(second);
  });

  it('falls back to English and leaves an unknown placeholder visible', () => {
    expect(translate('de', 'play.stop')).toBe('Stop');
    expect(translate('fr', 'open.loading', {})).toContain('{name}');
    expect(translate('fr', 'open.loading', { name: 'a.wav' })).toBe('Lecture de a.wav');
  });

  it('turns the refusals of the host and of the engine into words, and keeps an unknown code visible', () => {
    const t = (key: Key, vars?: Record<string, string | number>) => translate('fr', key, vars);
    expect(errorText(t, 'TOO_LONG')).toMatch(/10 minutes/);
    expect(errorText(t, 'NOT_DECODED')).toMatch(/sait lire/);
    // Codes that carry the word TIMEOUT have their own sentence, not the host's.
    expect(errorText(t, 'RENDER_TIMEOUT')).toMatch(/2 minutes/);
    expect(errorText(t, 'STRETCH_TIMEOUT')).toMatch(/45 secondes/);
    expect(errorText(t, 'AUDIO_ASLEEP')).toMatch(/sortie son/);
    expect(errorText(t, 'Unauthorized: This cartridge does not have the "dialog:open" permission.')).toMatch(/autorisation/);
    expect(errorText(t, 'Host did not reply to "dialog.mediaUrl" within 15s')).toMatch(/Pas de réponse/);
    expect(errorText(t, 'CREDENTIAL_FILE')).toBe('Pas fait : CREDENTIAL_FILE');
    expect(exportRefusal(t, 'EXTENSION_NOT_ALLOWED')).toMatch(/WAV/);
    expect(exportRefusal(t, 'EXISTS')).toMatch(/20 fichiers/);
    expect(exportRefusal(t, 'TOO_LARGE')).toMatch(/50 Mo/);
    expect(exportRefusal(t, 'NOT_DECODED')).toMatch(/sait lire/);
    expect(exportRefusal(t, 'BAD_BASE64')).toBe('Pas fait : BAD_BASE64');
  });
});
