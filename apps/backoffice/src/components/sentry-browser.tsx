'use client';

import { useEffect } from 'react';

import { sentryInitOptions, type SentryRuntimeConfig } from '@/lib/sentry-scrub';

/*
 * Browser Sentry (BACKOFFICE_PLAN §2.2). The root layout passes the configuration read at request
 * time; without a DSN it passes null and no Sentry code is ever loaded (the SDK is a dynamic import,
 * its own chunk). The error boundaries report through `reportBoundaryError` with the correlation id
 * they show (`error.digest`), scrubbed like every other event.
 */

let started: Promise<boolean> | null = null;

/** Starts the browser SDK once; false without a configuration. */
export function startBrowserSentry(config: SentryRuntimeConfig | null): Promise<boolean> {
  if (config === null) return started ?? Promise.resolve(false);
  started ??= import('@sentry/nextjs').then((Sentry) => {
    Sentry.init(sentryInitOptions(config));
    Sentry.setTag('runtime', 'browser');
    return true;
  });
  return started;
}

export function SentryBrowser({ config }: { readonly config: SentryRuntimeConfig | null }) {
  useEffect(() => {
    void startBrowserSentry(config).catch(() => false);
  }, [config]);
  return null;
}

/** Reports an error-boundary error with its correlation id; false when Sentry is not running. */
export async function reportBoundaryError(
  error: Error & { digest?: string },
  boundary: 'root' | 'admin',
): Promise<boolean> {
  const running = started === null ? false : await started.catch(() => false);
  if (!running) return false;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureException(error, {
    tags: { boundary, correlation_id: error.digest ?? 'none' },
  });
  return true;
}

/** Test seam. */
export function resetBrowserSentryForTests(): void {
  started = null;
}
