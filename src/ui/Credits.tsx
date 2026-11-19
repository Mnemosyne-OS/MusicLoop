/**
 * Credits.tsx — what MusicLoop is made with, and the licence of the one
 * library it carries, in full. A click anywhere closes it (style-cartouche
 * §5); only the link keeps its click.
 */
import { useEffect } from 'react';
import licence from '../vendor/signalsmith-stretch/LICENSE.txt?raw';
import { STRETCH_URL } from '../host';
import type { T } from '../i18n/strings';
import { Close } from './icons';

/** The credits, as a full view over the screen. */
export function Credits({ t, onClose, onLink }: { t: T; onClose: () => void; onLink: (url: string) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ml-credits" role="dialog" aria-modal="true" aria-label={t('credits.open')} onClick={onClose}>
      <button type="button" className="icon-btn close" aria-label={t('credits.close')} title={t('credits.close')}><Close /></button>
      <div className="ml-card">
        <h2>{t('credits.open')}</h2>
        <p>{t('credits.stretch')}</p>
        <p>
          <a href={STRETCH_URL} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onLink(STRETCH_URL); }}>{STRETCH_URL}</a>
        </p>
        <pre>{licence}</pre>
      </div>
    </div>
  );
}
