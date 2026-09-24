'use client';

import { useEffect } from 'react';

/**
 * Opens and focuses the FAQ item a URL hash points at (`/support#faq-delete-account`, or the
 * `#kurum-yoneticileri` alias). The in-app Help screen links here (Part 5 W-SUP-01).
 */
export function FaqDeepLink(): null {
  useEffect(() => {
    const openFromHash = (): void => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id === '') return;
      const target = document.getElementById(id);
      const details = target?.closest('details') ?? null;
      if (details === null) return;
      details.open = true;
      const summary = details.querySelector('summary');
      summary?.focus();
      details.scrollIntoView({ block: 'start' });
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => {
      window.removeEventListener('hashchange', openFromHash);
    };
  }, []);
  return null;
}
