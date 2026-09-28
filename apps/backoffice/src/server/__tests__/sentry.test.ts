import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseBackofficeEnv } from '@/env';
import { buildCsp } from '@/server/security-headers';
import {
  browserSentryConfig,
  sentryIngestOrigin,
  serverSentryConfig,
} from '@/server/sentry-config';
import {
  reportRequestError,
  resetServerSentryForTests,
  startServerSentry,
} from '@/server/sentry-server';

/*
 * Backoffice Sentry on the server (BACKOFFICE_PLAN §2.2 `instrumentation.ts`, §2.7, §3.8): nothing
 * is imported or started without a DSN; with one, the SDK starts once with the scrubber and
 * `onRequestError` reports through it; the browser DSN extends CSP `connect-src` with its ingest
 * origin only; the env schema accepts only real DSNs.
 */

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  setTag: vi.fn(),
  captureRequestError: vi.fn(),
  imported: 0,
}));
vi.mock('@sentry/nextjs', () => {
  sentry.imported += 1;
  return {
    init: sentry.init,
    setTag: sentry.setTag,
    captureRequestError: sentry.captureRequestError,
  };
});

const DSN = 'https://publickey@o123.ingest.de.sentry.io/4507';
const BROWSER_DSN = 'https://browserkey@o123.ingest.de.sentry.io/4508';
const VALID_ENV = {
  APP_ENV: 'development',
  API_PUBLIC_BASE_URL: 'http://127.0.0.1:54321',
  ADMIN_BFF_SECRET: 'x'.repeat(40),
  ADMIN_ORIGIN: 'http://localhost:3100',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_key',
};

beforeEach(() => {
  resetServerSentryForTests();
  sentry.init.mockReset();
  sentry.setTag.mockReset();
  sentry.captureRequestError.mockReset();
});

describe('sentry-config', () => {
  it('reads nothing without a DSN or with a malformed one', () => {
    expect(serverSentryConfig({})).toBeNull();
    expect(browserSentryConfig({ SENTRY_DSN: DSN })).toBeNull();
    for (const bad of ['http://k@h/1', 'https://h/1', 'https://k@h/project', 'not a url', ' ']) {
      expect(serverSentryConfig({ SENTRY_DSN: bad })).toBeNull();
    }
    expect(sentryIngestOrigin(null)).toBeNull();
  });

  it('uses SENTRY_DSN on the server (falling back to the public DSN) and APP_ENV', () => {
    expect(serverSentryConfig({ SENTRY_DSN: DSN, APP_ENV: 'production' })).toEqual({
      dsn: DSN,
      environment: 'production',
    });
    expect(serverSentryConfig({ NEXT_PUBLIC_SENTRY_DSN: BROWSER_DSN, APP_ENV: 'bogus' })).toEqual({
      dsn: BROWSER_DSN,
      environment: 'development',
    });
    expect(
      browserSentryConfig({
        NEXT_PUBLIC_SENTRY_DSN: BROWSER_DSN,
        APP_ENV: 'preview',
        VERCEL_GIT_COMMIT_SHA: '0123456789abcdef0123',
      }),
    ).toEqual({ dsn: BROWSER_DSN, environment: 'preview', release: 'da-backoffice@0123456789ab' });
    expect(sentryIngestOrigin({ dsn: BROWSER_DSN, environment: 'test' })).toBe(
      'https://o123.ingest.de.sentry.io',
    );
  });

  it('the env schema accepts a DSN and rejects a malformed one by name only', () => {
    const env = parseBackofficeEnv({
      ...VALID_ENV,
      SENTRY_DSN: DSN,
      NEXT_PUBLIC_SENTRY_DSN: BROWSER_DSN,
    });
    expect([env.SENTRY_DSN, env.NEXT_PUBLIC_SENTRY_DSN]).toEqual([DSN, BROWSER_DSN]);
    expect(parseBackofficeEnv(VALID_ENV).SENTRY_DSN).toBeNull();
    let message = '';
    try {
      parseBackofficeEnv({ ...VALID_ENV, NEXT_PUBLIC_SENTRY_DSN: 'https://nokey.example/1' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('NEXT_PUBLIC_SENTRY_DSN');
    expect(message).not.toContain('nokey.example');
  });

  it('CSP connect-src names the ingest origin only when a browser DSN is set', () => {
    expect(buildCsp('n')).toContain("connect-src 'self';");
    expect(buildCsp('n', { connectSources: ['https://o123.ingest.de.sentry.io'] })).toContain(
      "connect-src 'self' https://o123.ingest.de.sentry.io;",
    );
  });
});

describe('sentry-server (instrumentation)', () => {
  it('without a DSN nothing starts and request errors are dropped', async () => {
    const before = sentry.imported;
    expect(await startServerSentry({})).toBe(false);
    await reportRequestError(
      new Error('x'),
      { path: '/users', method: 'GET', headers: {} },
      { routerKind: 'App Router', routePath: '/users', routeType: 'render' },
    );
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureRequestError).not.toHaveBeenCalled();
    expect(sentry.imported).toBe(before);
  });

  it('with a DSN the SDK starts once with the scrubber and reports request errors', async () => {
    const raw = { SENTRY_DSN: DSN, APP_ENV: 'production', NEXT_RUNTIME: 'nodejs' };
    expect(await startServerSentry(raw)).toBe(true);
    expect(await startServerSentry(raw)).toBe(true);
    expect(sentry.init).toHaveBeenCalledTimes(1);
    const options = sentry.init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).toMatchObject({ dsn: DSN, environment: 'production', sendDefaultPii: false });
    expect(typeof options.beforeSend).toBe('function');
    expect(sentry.setTag).toHaveBeenCalledWith('runtime', 'nodejs');
    const request = { path: '/users', method: 'GET', headers: { cookie: 'x' } };
    const context = {
      routerKind: 'App Router',
      routePath: '/users',
      routeType: 'render',
      renderSource: 'react-server-components',
      revalidateReason: undefined,
      renderType: 'dynamic',
    } as const;
    const error = new Error('boom');
    await reportRequestError(error, request, context);
    expect(sentry.captureRequestError).toHaveBeenCalledWith(error, request, context);
  });

  it('register() and onRequestError() delegate to the server SDK', async () => {
    const saved = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = DSN;
    try {
      const { register, onRequestError } = await import('@/instrumentation');
      await register();
      expect(sentry.init).toHaveBeenCalledTimes(1);
      await onRequestError(new Error('x'), { path: '/', method: 'GET', headers: {} }, {
        routerKind: 'App Router',
        routePath: '/',
        routeType: 'route',
        renderSource: undefined,
        revalidateReason: undefined,
        renderType: undefined,
      } as never);
      expect(sentry.captureRequestError).toHaveBeenCalledTimes(1);
    } finally {
      if (saved === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = saved;
    }
  });
});
