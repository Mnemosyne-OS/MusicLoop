/**
 * themeColors.ts — the colours a canvas needs, read from the theme.
 *
 * A canvas cannot say `var(--accent)`. The stylesheet gives each colour to a
 * custom property of the waveform strip (ui/theme.css, `--ml-wave` and the
 * others, each one a variable of the app with its fallback), and this reads
 * the values the browser computed. The cartridge never names a theme.
 */

/** The five colours the waveform is drawn with. */
export interface ThemeColors {
  wave: string;
  waveLoop: string;
  loopFill: string;
  grid: string;
  viewBox: string;
}

/**
 * What is drawn when a property cannot be read (a test environment with no
 * stylesheet): the text colour of the strip itself. No colour is written in
 * this file; the fallbacks live in theme.css, inside each `var()`.
 */
export const FALLBACK_COLORS: ThemeColors = {
  wave: 'currentColor',
  waveLoop: 'currentColor',
  loopFill: 'transparent',
  grid: 'currentColor',
  viewBox: 'currentColor',
};

const PROPERTIES: Record<keyof ThemeColors, string> = {
  wave: '--ml-wave',
  waveLoop: '--ml-wave-loop',
  loopFill: '--ml-loop-fill',
  grid: '--ml-grid',
  viewBox: '--ml-view-box',
};

/** The colours the browser computed for `el`, each from a variable of the app. */
export function readThemeColors(el: Element): ThemeColors {
  const out: ThemeColors = { ...FALLBACK_COLORS };
  let style: CSSStyleDeclaration;
  try {
    style = getComputedStyle(el);
  } catch (err) {
    console.warn('[music-loop] theme colours not read, fallbacks drawn', err);
    return out;
  }
  for (const key of Object.keys(PROPERTIES) as (keyof ThemeColors)[]) {
    const value = style.getPropertyValue(PROPERTIES[key]).trim();
    if (value) out[key] = value;
  }
  return out;
}
