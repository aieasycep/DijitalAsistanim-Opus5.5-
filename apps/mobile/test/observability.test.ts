/**
 * T-8.28 analytics delivery and Sentry scrubbing (UT-ANL-01 on the client, SECURITY_AND_PRIVACY_PLAN
 * CTL-3.14): events are batched (≤50) to `POST /analytics/events`, persisted, dropped on opt-out,
 * and no delivered event carries free text; Sentry starts only with a DSN, never with screenshots,
 * view hierarchies or a user, and every event and breadcrumb is scrubbed.
 */
import { ApiError } from '@da/api-client';
import {
  ANALYTICS_EVENTS,
  isValidPropValue,
  type AnalyticsPropSpec,
} from '@da/domain/analytics/index';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Sentry from '@sentry/react-native';

import {
  ANALYTICS_BUFFER_MAX,
  ANALYTICS_FLUSH_AT,
  createAnalyticsBatcher,
  toBatchItem,
  type AnalyticsDeps,
  type BufferedItem,
} from '../src/lib/analytics';
import {
  resetAnalyticsForTests,
  setAnalyticsSink,
  track,
  type TrackedEvent,
} from '../src/lib/events';
import { markStartupComplete, resetPerfForTests, startupDurationMs } from '../src/lib/perf';
import {
  captureError,
  initSentry,
  resetSentryForTests,
  routeTemplate,
  scrubBreadcrumb,
  scrubEvent,
  scrubString,
  sentryRelease,
} from '../src/lib/sentry';
import { uuid } from './helpers/fixtures';

type Body = Parameters<AnalyticsDeps['send']>[0];

function batcher(overrides: Partial<AnalyticsDeps> = {}) {
  const sent: Body[] = [];
  let stored: string | undefined;
  let n = 0;
  const deps: AnalyticsDeps = {
    send: (body) => {
      sent.push(body);
      return Promise.resolve({ accepted: body.events.length, dropped: 0 });
    },
    storage: () => ({
      read: () => stored,
      write: (value) => {
        stored = value ?? undefined;
      },
    }),
    isOnline: () => true,
    optedOut: () => false,
    isPro: () => false,
    newId: () => {
      n += 1;
      return uuid(500 + n);
    },
    ...overrides,
  };
  return { b: createAnalyticsBatcher(deps), sent, stored: () => stored };
}

const event = (name: string, props: Record<string, unknown> = {}): TrackedEvent =>
  ({ event: name, props, occurredAt: '2026-09-24T08:00:00.000Z' }) as TrackedEvent;

describe('analytics batcher (API-ANL-01)', () => {
  it('sends batches of at most 50 with the session id, after 20 events', async () => {
    const { b, sent } = batcher();
    for (let i = 0; i < ANALYTICS_FLUSH_AT - 1; i += 1)
      b.sink(event('tab_selected', { tab: 'flow' }));
    expect(sent).toHaveLength(0);
    for (let i = 0; i < 60; i += 1) b.sink(event('tab_selected', { tab: 'plan' }));
    await b.flush();
    // The 20th event starts a flush; the rest follow in batches of at most 50.
    expect(sent.map((s) => s.events.length)).toEqual([20, 50, 9]);
    expect(sent[0]?.session_id).toBe(uuid(501));
    expect(sent[0]?.events[0]).toEqual({
      name: 'tab_selected',
      ts: '2026-09-24T08:00:00.000Z',
      props: { tab: 'flow', is_pro: false },
    });
    expect(b.pending()).toHaveLength(0);
  });

  it('lifts the screen id out of the props and keeps the buffer across restarts', () => {
    const first = batcher({ isOnline: () => false });
    first.b.sink(event('offline_banner_shown', { screen: 'M-TD-01' }));
    const item = first.b.pending()[0];
    expect(item).toMatchObject({ name: 'offline_banner_shown', screen: 'M-TD-01' });
    expect(item?.props).not.toHaveProperty('screen');
    const stored = first.stored();
    const restarted = batcher({
      isOnline: () => false,
      storage: () => ({ read: () => stored, write: () => undefined }),
    });
    expect(restarted.b.pending()).toEqual(first.b.pending());
  });

  it('respects the opt-out: nothing is buffered or sent, and the buffer is discarded', async () => {
    let optedOut = false;
    const { b, sent } = batcher({ optedOut: () => optedOut, isOnline: () => false });
    b.sink(event('tab_selected', { tab: 'flow' }));
    expect(b.pending()).toHaveLength(1);
    optedOut = true;
    b.sink(event('tab_selected', { tab: 'plan' }));
    expect(b.pending()).toHaveLength(0);
    await b.flush();
    expect(sent).toHaveLength(0);
  });

  it('keeps events while signed out or offline and on network failures; drops rejected batches', async () => {
    let signedIn = false;
    let fail: 'network' | 'reject' | null = 'network';
    const { b, sent } = batcher({
      optedOut: () => (signedIn ? false : null),
      send: (body) => {
        if (fail === 'network') {
          return Promise.reject(
            new ApiError({ code: 'SERVICE_UNAVAILABLE', kind: 'network', status: null }),
          );
        }
        if (fail === 'reject') {
          return Promise.reject(
            new ApiError({
              code: 'VALIDATION_FAILED',
              kind: 'server',
              status: 422,
              retryable: false,
            }),
          );
        }
        sent.push(body);
        return Promise.resolve({});
      },
    });
    b.sink(event('app_opened', { source: 'cold' }));
    await b.flush();
    expect(b.pending()).toHaveLength(1);
    signedIn = true;
    await b.flush();
    expect(b.pending()).toHaveLength(1);
    fail = 'reject';
    await b.flush();
    expect(b.pending()).toHaveLength(0);
    fail = null;
    b.sink(event('app_opened', { source: 'warm' }));
    await b.flush();
    expect(sent).toHaveLength(1);
  });

  it('bounds the buffer', () => {
    const { b } = batcher({ isOnline: () => false });
    for (let i = 0; i < ANALYTICS_BUFFER_MAX + 10; i += 1)
      b.sink(event('app_opened', { source: 'cold' }));
    expect(b.pending()).toHaveLength(ANALYTICS_BUFFER_MAX);
  });

  it('delivers no free text: unknown events and content-like props never leave the device', async () => {
    const { b, sent } = batcher();
    resetAnalyticsForTests();
    setAnalyticsSink(b.sink);
    try {
      expect(track('email_opened_with_subject' as never, { subject: 'Revize teklif' })).toBe(false);
      track('tab_selected', { tab: 'flow', subject: 'Revize teklif', note: 'serbest metin' });
      track('search_opened', { from: 'ahmet@example.com' });
      track('deep_link_opened', {
        route_pattern: 'https://evil.example/x',
        source: 'notification',
        guarded: false,
      });
      b.sink(event('tab_selected', { tab: 'Kuzey Lojistik teklifi' }));
      b.sink(event('not_a_catalogue_event', { x: 1 }));
      await b.flush();
    } finally {
      setAnalyticsSink(null);
    }
    const items: BufferedItem[] = sent.flatMap((s) => s.events as BufferedItem[]);
    // Invalid props are dropped (the event stays, content-free); unknown events never leave.
    expect(items.map((i) => i.name)).toEqual([
      'tab_selected',
      'search_opened',
      'deep_link_opened',
      'tab_selected',
    ]);
    const catalogue = ANALYTICS_EVENTS as unknown as Record<
      string,
      { props: Record<string, AnalyticsPropSpec> }
    >;
    for (const item of items) {
      const specs = catalogue[item.name]?.props ?? {};
      for (const [key, value] of Object.entries(item.props)) {
        if (key === 'is_pro') {
          expect(typeof value).toBe('boolean');
          continue;
        }
        expect(specs[key]).toBeDefined();
        const spec = specs[key];
        if (spec !== undefined) expect(isValidPropValue(spec, value)).toBe(true);
      }
    }
    const text = JSON.stringify(items);
    for (const banned of ['Revize', 'serbest', 'example.com', 'evil', 'Kuzey']) {
      expect(text).not.toContain(banned);
    }
  });

  it('adds is_pro only when the plan is known', () => {
    expect(toBatchItem(event('app_opened', { source: 'cold' }), null)?.props).toEqual({
      source: 'cold',
    });
    expect(toBatchItem(event('app_opened', { source: 'cold' }), true)?.props).toEqual({
      source: 'cold',
      is_pro: true,
    });
  });
});

describe('Sentry (CTL-3.14)', () => {
  beforeEach(() => {
    resetSentryForTests();
    jest.mocked(Sentry.init).mockClear();
  });

  it('does not start without a DSN', () => {
    expect(initSentry({ EXPO_PUBLIC_APP_ENV: 'development' } as never)).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(captureError(new Error('x'))).toBeNull();
  });

  it('starts with PII off, no screenshots or view hierarchy, and the scrubbers', () => {
    expect(
      initSentry({
        EXPO_PUBLIC_SENTRY_DSN: 'https://public@o0.ingest.sentry.io/1',
        EXPO_PUBLIC_APP_ENV: 'preview',
      } as never),
    ).toBe(true);
    const options = jest.mocked(Sentry.init).mock.calls[0]?.[0];
    expect(options).toMatchObject({
      environment: 'preview',
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableCaptureFailedRequests: false,
      release: sentryRelease(),
      dist: '42',
      tracesSampleRate: 1,
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    });
    expect(options).not.toHaveProperty('replaysSessionSampleRate');
    expect(sentryRelease()).toMatch(/^com\.dijitalasistan\.app\.dev@\d+\.\d+\.\d+\+42$/);
    expect(Sentry.setTags).toHaveBeenCalledWith({ platform: 'ios', app_version: '1.0.0' });
    expect(captureError(new Error('boom'), { routePattern: '/mail/:id' })).toBe('event-id');
  });

  it('redacts e-mails, tokens, keys and secret query parameters', () => {
    const scrubbed = scrubString(
      'ahmet.yilmaz@kuzey.com Bearer abc.def ExponentPushToken[xyz] sb_secret_123 ' +
        'eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl https://x.test/cb?code=123&state=abc&ok=1',
    );
    for (const secret of [
      'ahmet',
      'abc.def',
      'xyz',
      'sb_secret_123',
      'eyJhbGciOi',
      '=123',
      'abc&',
    ]) {
      expect(scrubbed).not.toContain(secret);
    }
    expect(scrubbed).toContain('ok=1');
  });

  it('strips the user, request bodies, headers and content fields from events', () => {
    const event = scrubEvent({
      type: undefined,
      message: 'Failed for ahmet@kuzey.com',
      user: { id: uuid(1), email: 'ahmet@kuzey.com' },
      request: {
        method: 'POST',
        url: `https://p.supabase.co/functions/v1/api/mail/${uuid(3)}?code=1`,
        data: { body: 'Sayın Ahmet Bey' },
        headers: { Authorization: 'Bearer secret' },
        cookies: { sb: 'x' },
      },
      exception: { values: [{ type: 'Error', value: 'token=abc for ahmet@kuzey.com' }] },
      extra: { subject: 'Revize teklif', count: 2, nested: { snippet: 'gizli', ok: 'kuzey@x.io' } },
      breadcrumbs: [
        {
          category: 'fetch',
          data: {
            method: 'GET',
            url: `https://h/api/mail/${uuid(3)}?q=a`,
            status_code: 200,
            request_body: 'x',
          },
        },
        { category: 'ui.click', message: 'Ahmet Yılmaz ile konuş' },
        { category: 'console', message: 'draft: Sayın Ahmet Bey' },
      ],
    });
    expect(event).not.toBeNull();
    const text = JSON.stringify(event);
    for (const leak of [
      'ahmet',
      'Sayın',
      'secret',
      'Revize',
      'gizli',
      'kuzey@',
      'Yılmaz',
      'code=1',
    ]) {
      expect(text).not.toContain(leak);
    }
    expect(event?.user).toBeUndefined();
    expect(event?.request).toEqual({ method: 'POST', url: '/functions/v1/api/mail/:id' });
    expect(event?.breadcrumbs?.[0]?.data).toEqual({
      method: 'GET',
      url: '/api/mail/:id',
      status_code: 200,
    });
    expect(event?.extra).toMatchObject({ count: 2 });
  });

  it('turns URLs into route templates', () => {
    expect(routeTemplate(`https://x.test/briefing/${uuid(7)}/listen?t=1`)).toBe(
      '/briefing/:id/listen',
    );
  });
});

describe('startup timing', () => {
  it('measures once', () => {
    resetPerfForTests();
    const first = markStartupComplete(Date.now() + 5);
    expect(first).not.toBeNull();
    expect(markStartupComplete()).toBeNull();
    expect(startupDurationMs()).toBe(first);
  });
});
