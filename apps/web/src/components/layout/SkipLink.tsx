import type { ReactNode } from 'react';

/** First focusable element on every page (W-CMP-01); jumps to `<main id="main">`. */
export function SkipLink({ label }: { label: string }): ReactNode {
  return (
    <a
      href="#main"
      className="sr-only-focusable fixed top-2 left-2 z-(--da-z-toast) rounded-button bg-surface px-4 py-3 text-label-lg text-ink shadow-modal"
    >
      {label}
    </a>
  );
}
