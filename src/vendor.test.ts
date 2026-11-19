// @vitest-environment node
/**
 * The one vendored file is the file its record names: same bytes, the MIT
 * notice beside it. A file edited in place, or replaced without updating
 * VENDOR.md, fails here before it ships.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const at = (name: string) => fileURLToPath(new URL(`./vendor/signalsmith-stretch/${name}`, import.meta.url));

describe('the vendored Signalsmith Stretch', () => {
  it('is the file of signalsmith-stretch 1.3.2, unchanged', () => {
    const sha = createHash('sha256').update(readFileSync(at('SignalsmithStretch.mjs'))).digest('hex');
    expect(sha).toBe('97530b11d5bc01015af4cde40d6aa55ff10c40aa1294ca4c8c5762027d517a46');
    expect(readFileSync(at('VENDOR.md'), 'utf8')).toContain(sha);
  });

  it('keeps its MIT notice and its author beside it', () => {
    const licence = readFileSync(at('LICENSE.txt'), 'utf8');
    expect(licence).toMatch(/^MIT License/);
    expect(licence).toContain('Geraint Luff / Signalsmith Audio Ltd.');
    expect(licence).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  });

  it('is named in the notices at the root of the cartridge', () => {
    const notices = readFileSync(fileURLToPath(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url)), 'utf8');
    expect(notices).toContain('signalsmith-stretch');
    expect(notices).toContain('1.3.2');
  });
});
