'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import en from '../../messages/en/webPages.json';
import tr from '../../messages/tr/webPages.json';
import './globals.css';

/**
 * W-ERR-02 · the root layout itself failed, so no locale or provider is available: the message is
 * shown in Turkish and English from the site's own catalogs.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactNode {
  return (
    <html lang="tr">
      <body className="bg-bg font-sans text-ink">
        <main className="site-container py-20">
          <div className="mx-auto max-w-[560px] text-center">
            <h1 className="text-web-h2">{tr.errors.error.title}</h1>
            <p className="mt-3 text-body text-ink-2">{tr.errors.error.body}</p>
            <p lang="en" className="mt-6 text-body text-ink-2">
              {en.errors.error.title} {en.errors.error.body}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={reset}
                className="inline-flex min-h-12 items-center rounded-button bg-primary px-6 text-label-lg text-text-on-primary"
              >
                {tr.errors.error.retry} / <span lang="en">{en.errors.error.retry}</span>
              </button>
              <Link
                href="/"
                className="inline-flex min-h-12 items-center rounded-button border border-border-strong px-6 text-label-lg"
              >
                {tr.errors.error.home} / <span lang="en">{en.errors.error.home}</span>
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
