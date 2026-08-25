"use client";

/** Inline SVG icons — no icon-font, no runtime dependency, no extra request. */

type Props = { className?: string };

const base = "h-4 w-4";

export const Play = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M8 5.14v13.72a.5.5 0 0 0 .76.43l11.14-6.86a.5.5 0 0 0 0-.86L8.76 4.71A.5.5 0 0 0 8 5.14Z" />
  </svg>
);

export const Pause = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" />
  </svg>
);

export const Next = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M6 5.14v13.72a.5.5 0 0 0 .76.43l9.24-5.7v5.14a.5.5 0 0 0 .5.5H18a.5.5 0 0 0 .5-.5V5.27a.5.5 0 0 0-.5-.5h-1.5a.5.5 0 0 0-.5.5v5.14l-9.24-5.7a.5.5 0 0 0-.76.43Z" />
  </svg>
);

export const Prev = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M18 5.14v13.72a.5.5 0 0 1-.76.43L8 13.59v5.14a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V5.27a.5.5 0 0 1 .5-.5h1.5a.5.5 0 0 1 .5.5v5.14l9.24-5.7a.5.5 0 0 1 .76.43Z" />
  </svg>
);

export const Shuffle = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </svg>
);

export const Repeat = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3" />
  </svg>
);

export const Plus = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Trash = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </svg>
);

export const Search = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const Volume = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 5 6 9H3v6h3l5 4V5ZM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12" />
  </svg>
);

export const Refresh = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
  </svg>
);

export const Disc = ({ className = base }: Props) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3.2" />
    <circle cx="12" cy="12" r="0.8" fill="currentColor" />
  </svg>
);
