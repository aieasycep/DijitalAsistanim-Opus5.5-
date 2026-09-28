import type { ErrorEvent } from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';

import {
  REDACTED,
  maskId,
  routeTemplate,
  scrubBreadcrumb,
  scrubEvent,
  scrubString,
  scrubValue,
  sentryInitOptions,
} from '@/lib/sentry-scrub';

/*
 * Backoffice Sentry scrubber (BACKOFFICE_PLAN §2.2; SECURITY_AND_PRIVACY_PLAN CTL-3.14): no bodies,
 * headers, cookies or admin e-mail addresses leave the app, ids are masked, breadcrumbs keep no
 * text, and every scan is linear on crafted input.
 */

const ADMIN_ID = '0190f5e0-0000-7000-8000-00000000f001';
const JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ4In0', 'c2lnbmF0dXJl'].join('.');

describe('scrubString', () => {
  it('redacts e-mail addresses, tokens, keys and secret query parameters; masks ids', () => {
    const text = [
      'admin ops@dijitalasistan.app failed',
      `Bearer ${JWT}`,
      `token ${JWT}`,
      'key sb_secret_abcdefghijk and sb_publishable_xyz',
      'GET /login?code=123456&state=abc&tab=audit',
      `user ${ADMIN_ID} missing`,
    ].join(' | ');
    const out = scrubString(text);
    expect(out).not.toContain('ops@dijitalasistan.app');
    expect(out).not.toContain('eyJ');
    expect(out).not.toContain('sb_secret_');
    expect(out).not.toContain('sb_publishable_');
    expect(out).toContain(`?code=${REDACTED}&state=${REDACTED}&tab=audit`);
    expect(out).toContain(`user ${maskId(ADMIN_ID)} missing`);
    expect(out).not.toContain(ADMIN_ID);
    expect(out).toContain(`Bearer ${REDACTED}`);
  });

  it('keeps ordinary text and route paths', () => {
    expect(scrubString('Kaydedilemedi · /jobs?status=dead')).toBe(
      'Kaydedilemedi · /jobs?status=dead',
    );
    expect(scrubString('user@localhost')).toBe('user@localhost');
  });

  it('is linear on crafted input (N / 4 vs N, best of three)', () => {
    const cases = [
      (n: number) => 'a'.repeat(n * 4),
      (n: number) => '@'.repeat(n),
      (n: number) => 'eyJ'.repeat(n),
      (n: number) => `?${'code=&'.repeat(n)}`,
      (n: number) => `a@${'.'.repeat(n)}`,
    ];
    for (const make of cases) {
      // Thread CPU time, sizes taken in turn: a busy runner preempts long runs more than short ones.
      const timed = (input: string) => {
        const start = process.threadCpuUsage();
        scrubString(input);
        const used = process.threadCpuUsage(start);
        return (used.user + used.system) / 1000;
      };
      const [smallInput, largeInput] = [make(12_500), make(50_000)];
      let small = Infinity;
      let large = Infinity;
      for (let i = 0; i < 3; i++) {
        small = Math.min(small, timed(smallInput));
        large = Math.min(large, timed(largeInput));
      }
      expect(large < 100 || large < 8 * Math.max(small, 1)).toBe(true);
    }
  });
});

describe('scrubValue and routeTemplate', () => {
  it('drops sensitive keys, scrubs strings and bounds depth', () => {
    expect(
      scrubValue({
        email: 'ops@dijitalasistan.app',
        headers: { cookie: 'sb=1' },
        reason: 'müşteri talebi',
        nested: { status: 'failed', note: 'x', id: ADMIN_ID },
        list: ['a@b.co', 1, null],
      }),
    ).toEqual({
      nested: { status: 'failed', id: maskId(ADMIN_ID) },
      list: [REDACTED, 1, null],
    });
    let deep: unknown = 'leaf';
    for (let i = 0; i < 10; i++) deep = { child: deep };
    expect(JSON.stringify(scrubValue(deep))).toContain(REDACTED);
  });

  it('turns URLs into route templates', () => {
    expect(routeTemplate(`https://admin.example/users/${ADMIN_ID}/audit?x=1#y`)).toBe(
      '/users/:id/audit',
    );
    expect(routeTemplate('/jobs/12345')).toBe('/jobs/:n');
  });
});

describe('scrubEvent', () => {
  it('removes user, request headers, cookies, body and query; scrubs messages and frames', () => {
    const event = {
      type: undefined,
      user: { id: ADMIN_ID, email: 'ops@dijitalasistan.app', ip_address: '10.0.0.1' },
      server_name: 'host-1',
      extra: { body: '{"reason":"x"}' },
      request: {
        method: 'POST',
        url: `https://admin.example/users/${ADMIN_ID}?tab=audit`,
        headers: { cookie: 'sb-auth=secret', authorization: 'Bearer x' },
        cookies: { session: 'x' },
        data: { email: 'ops@dijitalasistan.app' },
        query_string: 'tab=audit',
      },
      transaction: `/users/${ADMIN_ID}`,
      message: 'ops@dijitalasistan.app could not reveal',
      logentry: { message: 'for ops@dijitalasistan.app', params: ['ops@dijitalasistan.app'] },
      exception: {
        values: [
          {
            type: 'Error',
            value: `lookup ${ADMIN_ID} for ops@dijitalasistan.app`,
            stacktrace: { frames: [{ filename: 'a.js', vars: { email: 'x@y.co' } }] },
          },
          { type: 'TypeError' },
        ],
      },
      breadcrumbs: [
        { category: 'console', message: 'ops@dijitalasistan.app', data: { arguments: ['x'] } },
      ],
      contexts: {
        os: { name: 'Linux' },
        nextjs: { route_type: 'render', request_path: `/users/${ADMIN_ID}` },
        response: { headers: { 'set-cookie': 'x' } },
      },
      tags: { correlation_id: 'corr-1', boundary: 'admin', email: 'ops@dijitalasistan.app' },
    } as unknown as ErrorEvent;
    const out = scrubEvent(event);
    const text = JSON.stringify(out);
    expect(text).not.toContain('ops@dijitalasistan.app');
    expect(text).not.toContain('secret');
    expect(text).not.toContain(ADMIN_ID);
    expect(out?.user).toBeUndefined();
    expect(out?.server_name).toBeUndefined();
    expect(out?.extra).toBeUndefined();
    expect(out?.request).toEqual({ method: 'POST', url: '/users/:id' });
    expect(out?.transaction).toBe('/users/:id');
    expect(out?.logentry).toEqual({ message: `for ${REDACTED}` });
    expect(out?.exception?.values?.[0]?.stacktrace?.frames).toEqual([{ filename: 'a.js' }]);
    expect(out?.exception?.values?.[1]).toEqual({ type: 'TypeError' });
    expect(out?.breadcrumbs).toEqual([{ category: 'console' }]);
    expect(Object.keys(out?.contexts ?? {}).sort()).toEqual(['nextjs', 'os']);
    expect(out?.tags).toEqual({ correlation_id: 'corr-1', boundary: 'admin' });
  });

  it('passes an event without optional parts through', () => {
    expect(scrubEvent({ type: undefined })).toEqual({ type: undefined });
  });
});

describe('scrubBreadcrumb', () => {
  it('HTTP keeps method, route template and status; navigation keeps templates', () => {
    expect(
      scrubBreadcrumb({
        category: 'fetch',
        message: 'x',
        data: {
          method: 'GET',
          url: `/api/admin/users/${ADMIN_ID}?q=ops@x.co`,
          status_code: 200,
          body: 'b',
        },
      }),
    ).toEqual({
      category: 'fetch',
      data: { method: 'GET', url: '/api/admin/users/:id', status_code: 200 },
    });
    expect(scrubBreadcrumb({ type: 'http', category: 'xhr', data: { url: 42 } })).toEqual({
      type: 'http',
      category: 'xhr',
      data: {},
    });
    expect(
      scrubBreadcrumb({
        category: 'navigation',
        message: 'nav',
        data: { from: `/users/${ADMIN_ID}`, to: '/audit?actor=ops@x.co' },
      }),
    ).toEqual({ category: 'navigation', data: { from: '/users/:id', to: '/audit' } });
    expect(scrubBreadcrumb({ category: 'navigation' })).toEqual({
      category: 'navigation',
      data: {},
    });
  });

  it('UI and console breadcrumbs keep no text; others are scrubbed', () => {
    expect(scrubBreadcrumb({ category: 'ui.click', message: 'Yusuf Yılmaz', data: {} })).toEqual({
      category: 'ui.click',
    });
    expect(
      scrubBreadcrumb({ category: 'sentry.event', message: 'to ops@x.co', data: { email: 'x' } }),
    ).toEqual({ category: 'sentry.event', message: `to ${REDACTED}`, data: {} });
    expect(scrubBreadcrumb({ level: 'info' })).toEqual({ level: 'info' });
  });
});

describe('sentryInitOptions', () => {
  it('sends no default PII, traces nothing, records no replay and scrubs everything', () => {
    const options = sentryInitOptions({
      dsn: 'https://public@o1.ingest.sentry.io/42',
      environment: 'production',
      release: 'da-backoffice@abc',
    });
    expect(options).toMatchObject({
      dsn: 'https://public@o1.ingest.sentry.io/42',
      environment: 'production',
      release: 'da-backoffice@abc',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
    });
    expect(options.beforeSend({ type: undefined, user: { email: 'a@b.co' } })).toEqual({
      type: undefined,
    });
    expect(options.beforeBreadcrumb({ category: 'console', message: 'a@b.co' })).toEqual({
      category: 'console',
    });
    expect('release' in sentryInitOptions({ dsn: 'https://p@h/1', environment: 'test' })).toBe(
      false,
    );
  });
});
