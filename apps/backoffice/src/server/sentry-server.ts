import type * as SentryTypes from '@sentry/nextjs';

import { sentryInitOptions } from '@/lib/sentry-scrub';
import { serverSentryConfig } from '@/server/sentry-config';

/*
 * The server SDK behind `src/instrumentation.ts` (BACKOFFICE_PLAN §2.2, @sentry/nextjs 10.75). With
 * no `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` nothing is imported or started. Otherwise the SDK
 * starts once per server runtime with `sendDefaultPii:false`, no tracing and the shared scrubber
 * (`lib/sentry-scrub.ts`: no bodies, headers, cookies or e-mail addresses; masked ids).
 */

let started: Promise<boolean> | null = null;

/** Starts the server SDK once; false when no DSN is configured. */
export function startServerSentry(
  raw: Readonly<Record<string, string | undefined>> = process.env,
): Promise<boolean> {
  started ??= (async () => {
    const config = serverSentryConfig(raw);
    if (config === null) return false;
    const Sentry = await import('@sentry/nextjs');
    Sentry.init(sentryInitOptions(config));
    Sentry.setTag('runtime', raw.NEXT_RUNTIME ?? 'nodejs');
    return true;
  })();
  return started;
}

/** Reports a server request error (server components, route handlers, actions) when started. */
export async function reportRequestError(
  ...args: Parameters<typeof SentryTypes.captureRequestError>
): Promise<void> {
  if (!(await startServerSentry())) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
}

/** Test seam. */
export function resetServerSentryForTests(): void {
  started = null;
}
