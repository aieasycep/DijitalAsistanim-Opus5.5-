import 'server-only';

import { AppEnv } from '@da/validation/env';

import { SentryDsn } from '@/env';
import type { SentryRuntimeConfig } from '@/lib/sentry-scrub';

/*
 * Backoffice Sentry configuration (BACKOFFICE_PLAN §2.2, §2.7; INTEGRATION_PLAN §15 names). The
 * SDK starts only when a DSN exists: the server (instrumentation.ts) uses `SENTRY_DSN`, falling
 * back to `NEXT_PUBLIC_SENTRY_DSN`; the browser gets `NEXT_PUBLIC_SENTRY_DSN` from the root layout
 * at request time, so no value is inlined into a bundle. Keys are read through variables (Next
 * inlines only literal `process.env.NEXT_PUBLIC_*` reads). A malformed DSN reads as unset here
 * (monitoring never breaks boot); `parseBackofficeEnv` reports it on the first request.
 */

type Raw = Readonly<Record<string, string | undefined>>;

const SERVER_DSN_KEYS = ['SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN'] as const;
const BROWSER_DSN_KEY = 'NEXT_PUBLIC_SENTRY_DSN';

function dsnOf(raw: Raw, key: string): string | null {
  const value = raw[key]?.trim() ?? '';
  return value !== '' && SentryDsn.safeParse(value).success ? value : null;
}

function base(raw: Raw, dsn: string | null): SentryRuntimeConfig | null {
  if (dsn === null) return null;
  const appEnv = AppEnv.safeParse(raw.APP_ENV?.trim());
  const sha = raw.VERCEL_GIT_COMMIT_SHA?.trim() ?? '';
  return {
    dsn,
    environment: appEnv.success ? appEnv.data : 'development',
    ...(/^[0-9a-f]{7,40}$/.test(sha) ? { release: `da-backoffice@${sha.slice(0, 12)}` } : {}),
  };
}

/** The server-side SDK configuration, or null (no SDK) without a valid DSN. */
export function serverSentryConfig(raw: Raw = process.env): SentryRuntimeConfig | null {
  const dsn = SERVER_DSN_KEYS.map((key) => dsnOf(raw, key)).find((value) => value !== null);
  return base(raw, dsn ?? null);
}

/** The browser SDK configuration, or null (the browser loads no Sentry code at all). */
export function browserSentryConfig(raw: Raw = process.env): SentryRuntimeConfig | null {
  return base(raw, dsnOf(raw, BROWSER_DSN_KEY));
}

/** The DSN's ingest origin for CSP `connect-src` (BACKOFFICE_PLAN §3.8), or null. */
export function sentryIngestOrigin(config: SentryRuntimeConfig | null): string | null {
  return config === null ? null : new URL(config.dsn).origin;
}
