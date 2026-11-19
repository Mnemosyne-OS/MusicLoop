import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPermissionRefusal, isWorthRetrying, NAME_TRIES, safeName, saveInAppFolder, sdk, SOUND_EXTENSIONS } from './host';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saveInAppFolder', () => {
  const nameFor = (copy: number) => `loop${copy > 1 ? `-${copy}` : ''}.wav`;

  it('asks for the folder first, with no time limit, then writes', async () => {
    const calls: { action: string; timeout: unknown }[] = [];
    vi.spyOn(sdk, 'invoke').mockImplementation(async (action: string, _payload?: unknown, timeout?: number) => {
      calls.push({ action, timeout });
      return action === 'dialog.appFolder' ? { folder: 'C:/Apps/MusicLoop' } : { path: 'C:/Apps/MusicLoop/loop.wav', bytes: 3 };
    });
    expect(await saveInAppFolder('AAAA', nameFor)).toEqual({ kind: 'saved', path: 'C:/Apps/MusicLoop/loop.wav', bytes: 3 });
    expect(calls[0]).toEqual({ action: 'dialog.appFolder', timeout: 0 });
    expect(calls[1]!.action).toBe('dialog.writeAppBytes');
    expect(calls[1]!.timeout).toBeGreaterThan(0);
  });

  it('takes the next name when the file is already there, and never writes over it', async () => {
    const tried: string[] = [];
    vi.spyOn(sdk, 'invoke').mockImplementation(async (action: string, payload?: unknown) => {
      if (action === 'dialog.appFolder') return { folder: 'C:/Apps/MusicLoop' };
      const rel = (payload as { rel: string }).rel;
      tried.push(rel);
      if (tried.length < 3) throw new Error('EXISTS');
      return { path: `C:/Apps/MusicLoop/${rel}`, bytes: 3 };
    });
    const outcome = await saveInAppFolder('AAAA', nameFor);
    expect(tried).toEqual(['loop.wav', 'loop-2.wav', 'loop-3.wav']);
    expect(outcome).toMatchObject({ kind: 'saved', path: 'C:/Apps/MusicLoop/loop-3.wav' });
  });

  it('gives up after twenty names, and says EXISTS', async () => {
    let writes = 0;
    vi.spyOn(sdk, 'invoke').mockImplementation(async (action: string) => {
      if (action === 'dialog.appFolder') return { folder: 'C:/Apps/MusicLoop' };
      writes++;
      throw new Error('EXISTS');
    });
    expect(await saveInAppFolder('AAAA', nameFor)).toEqual({ kind: 'refused', code: 'EXISTS' });
    expect(writes).toBe(NAME_TRIES);
  });

  it('stops at the first refusal that is not a name already taken', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let writes = 0;
    vi.spyOn(sdk, 'invoke').mockImplementation(async (action: string) => {
      if (action === 'dialog.appFolder') return { folder: 'C:/Apps/MusicLoop' };
      writes++;
      throw new Error('EXTENSION_NOT_ALLOWED');
    });
    expect(await saveInAppFolder('AAAA', nameFor)).toEqual({ kind: 'refused', code: 'EXTENSION_NOT_ALLOWED' });
    expect(writes).toBe(1);
  });

  it('writes nothing when the folder was refused', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const invoke = vi.spyOn(sdk, 'invoke').mockRejectedValue(new Error('NO_VAULT_ROOT'));
    expect(await saveInAppFolder('AAAA', nameFor)).toEqual({ kind: 'refused', code: 'NO_VAULT_ROOT' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe('what the picker offers', () => {
  it('offers no extension the host door refuses', () => {
    // `.weba` was offered and refused by dialog.mediaUrl (NOT_A_FILM_OR_SOUND).
    expect(SOUND_EXTENSIONS).not.toContain('weba');
    expect(SOUND_EXTENSIONS).toEqual(expect.arrayContaining(['wav', 'mp3', 'flac', 'mp4']));
  });
});

describe('reading a refusal', () => {
  it('tells a permission the person refused from a failure', () => {
    expect(isPermissionRefusal('Unauthorized: This cartridge does not have the "dialog:open" permission.')).toBe(true);
    expect(isPermissionRefusal('Host did not reply to "recorder.musicTakes" within 15s')).toBe(false);
    expect(isPermissionRefusal('LIST_FAILED')).toBe(false);
  });

  it('offers to try again only where trying again can end differently', () => {
    for (const code of ['FETCH_FAILED', 'DECODE_TIMEOUT', 'Host did not reply to "dialog.mediaUrl" within 15s']) expect(isWorthRetrying(code), code).toBe(true);
    for (const code of ['TOO_LONG', 'NOT_DECODED', 'EMPTY_SOUND', 'NOT_A_FILM_OR_SOUND', 'PATH_OUTSIDE_HOME']) expect(isWorthRetrying(code), code).toBe(false);
  });
});

describe('safeName', () => {
  it('makes a file name every file system takes, from a title or from a date', () => {
    expect(safeName('My Song (final).mp3')).toBe('My-Song-final');
    expect(safeName('Nov 19, 2026, 2:30 AM')).toBe('Nov-19-2026-230-AM');
    expect(safeName('19 nov. 2026, 02:30')).toBe('19-nov-2026-0230');
    expect(safeName('???')).toBe('loop');
  });
});
