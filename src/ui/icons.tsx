/**
 * icons.tsx — inline SVG icons drawn in `currentColor` (style-cartouche §3:
 * icons, not words, for the transport and the display settings; never emoji).
 * The word each one stands for goes in the button's title and aria-label.
 */
import type { ReactNode } from 'react';

const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const Play = () => <Svg><path d="M4.5 2.8v10.4L13 8z" fill="currentColor" /></Svg>;
export const Stop = () => <Svg><rect x="3.5" y="3.5" width="9" height="9" rx="1.2" fill="currentColor" /></Svg>;
export const FolderOpen = () => <Svg><path d="M1.8 12.5V3.6h4l1.4 1.6h6.9v2" /><path d="M1.8 12.5l1.9-5.3h11l-1.9 5.3z" /></Svg>;
export const Save = () => <Svg><path d="M8 2v8M4.8 7.2L8 10.4l3.2-3.2" /><path d="M2.5 11.5v2h11v-2" /></Svg>;
export const ZoomIn = () => <Svg><circle cx="7" cy="7" r="4.3" /><path d="M10.2 10.2l3.6 3.6M5 7h4M7 5v4" /></Svg>;
export const ZoomOut = () => <Svg><circle cx="7" cy="7" r="4.3" /><path d="M10.2 10.2l3.6 3.6M5 7h4" /></Svg>;
/** Two brackets closing on a wave: the view fitted to the loop. */
export const FitLoop = () => <Svg><path d="M4.5 3H2.5v10h2M11.5 3h2v10h-2" /><path d="M5.5 8h1l1-2.5 1 5 1-2.5h1" /></Svg>;
/** Arrows to both ends: the whole sound. */
export const FitAll = () => <Svg><path d="M2 8h12M4.5 5.5L2 8l2.5 2.5M11.5 5.5L14 8l-2.5 2.5" /></Svg>;
/** A magnet: the handles snap to the beats. */
export const Magnet = () => <Svg><path d="M3.5 2.5v5.5a4.5 4.5 0 0 0 9 0V2.5h-3v5.5a1.5 1.5 0 0 1-3 0V2.5z" /><path d="M3.5 5h3M9.5 5h3" /></Svg>;
/** An arrow pointing back: the loop played backwards. */
export const Backwards = () => <Svg><path d="M13 8H3.5M7 4.5L3.5 8 7 11.5" /><path d="M13 4v8" /></Svg>;
export const Bookmark = () => <Svg><path d="M4 2.5h8v11L8 10.5 4 13.5z" /></Svg>;
export const Close = () => <Svg><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></Svg>;
export const Info = () => <Svg><circle cx="8" cy="8" r="6" /><path d="M8 7.2v4M8 4.8v.2" /></Svg>;
export const Reset = () => <Svg><path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.8" /><path d="M2.5 1.8v3h3" /></Svg>;
export const Reveal = () => <Svg><path d="M1.8 12.5V3.6h4l1.4 1.6h7v7.3z" /><path d="M6 9h4M8.5 7.2L10.3 9l-1.8 1.8" /></Svg>;
export const Grid = () => <Svg><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></Svg>;
export const Record = () => <Svg><circle cx="8" cy="8" r="4.5" fill="currentColor" /></Svg>;
export const Back = () => <Svg><path d="M13 8H3.5M7 4.5L3.5 8 7 11.5" /></Svg>;
export const Pencil = () => <Svg><path d="M3 13l.6-2.8 7.3-7.3 2.2 2.2-7.3 7.3z" /><path d="M9.6 4.2l2.2 2.2" /></Svg>;
