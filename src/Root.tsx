/**
 * Root.tsx — which of the two screens the window shows: the studio where one
 * loop is cut and shaped, or the pad where the kept loops play together.
 * The pad's own window (`?widget=music-loop-pad`) shows the pad alone.
 */
import { useState } from 'react';
import App from './App';
import { inHost, isPadWindow, openPadWindow } from './host';
import Pad from './pad/Pad';

export default function Root() {
  // The pad's own window never goes back to the studio: the studio is the window beside it.
  const detached = isPadWindow();
  const [view, setView] = useState<'studio' | 'pad'>(() => (detached ? 'pad' : 'studio'));
  // Inside the OS the pad opens as a window beside the studio; when the host
  // refuses, and outside the OS, it takes the place of the studio.
  const openPad = async () => {
    if (!inHost()) { setView('pad'); return; }
    try {
      await openPadWindow();
    } catch (err) {
      console.warn('[music-loop] the pad window was not opened, the pad is shown here', err);
      setView('pad');
    }
  };
  if (view === 'pad') return <Pad onBack={detached ? undefined : () => setView('studio')} />;
  return <App onOpenPad={openPad} />;
}
