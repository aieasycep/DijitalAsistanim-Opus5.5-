/**
 * Every query/mutation option factory maps to its API_CONTRACTS route, forwards the caller's
 * `Idempotency-Key` for `[IK]` routes (and sends none when the caller has none, so the client
 * generates one), and retries only transient failures up to its documented budget.
 * The client is a recording stand-in: request/response validation is covered by api.test.ts.
 */
import { QueryClient, type MutationFunctionContext } from '@tanstack/react-query';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { ApiError, codeForStatus, defaultGenerateId, parseRetryAfter } from '../src/index.ts';
import type { ApiClient } from '../src/api.ts';
import * as hooks from '../src/hooks/index.ts';
import { uuid } from './fixtures.ts';

interface Recorded {
  readonly key: string;
  readonly input: unknown;
  readonly options: unknown;
}

function recordingClient(): { client: ApiClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const client = {
    call: (key: string, input: unknown, options: unknown) => {
      calls.push({ key, input, options });
      return Promise.resolve({ data: { route: key }, meta: {} });
    },
    stream: () => Promise.reject(new Error('stream is not used by the factories')),
  } as unknown as ApiClient;
  return { client, calls };
}

const MUTATION_CONTEXT = {} as MutationFunctionContext;
const INPUT = { params: { id: uuid(1) }, body: { note: 'x' } };

type Factory = (client: ApiClient) => {
  mutationFn?: (variables: never, context: MutationFunctionContext) => Promise<unknown>;
  retry?: unknown;
};

/** `{ input, idempotencyKey }` mutations (T-8.15…T-8.18, onboarding journeys). */
const REQUEST_MUTATIONS: readonly [string, Factory, string][] = [
  ['API-APR-01', hooks.approvalProposeMutationOptions, 'POST /approvals'],
  ['API-APR-02', hooks.approvalEditMutationOptions, 'PATCH /approvals/:id'],
  ['API-APR-04', hooks.approvalRejectMutationOptions, 'POST /approvals/:id/reject'],
  ['API-APR-05', hooks.deviceExecutionMutationOptions, 'POST /approvals/:id/device-execution'],
  ['API-REM-03', hooks.reminderCancelMutationOptions, 'POST /reminders/:id/cancel'],
  ['API-CAP-03', hooks.captureAnalyzeMutationOptions, 'POST /captures/:id/analyze'],
  ['API-CAP-04', hooks.captureActionsMutationOptions, 'POST /captures/:id/actions'],
  ['API-CAP-05', hooks.captureDiscardMutationOptions, 'POST /captures/:id/discard'],
  ['API-INT-01', hooks.integrationStartMutationOptions, 'POST /integrations/:provider/start'],
  ['API-INT-02', hooks.integrationUpgradeMutationOptions, 'POST /integrations/:accountId/upgrade'],
  ['API-INT-07', hooks.oauthCompleteMutationOptions, 'POST /integrations/oauth/complete'],
  [
    'API-INT-03',
    hooks.integrationDisconnectMutationOptions,
    'POST /integrations/:accountId/disconnect',
  ],
  ['API-INT-05', hooks.dataSourcesMutationOptions, 'PATCH /integrations/:accountId/data-sources'],
  [
    'API-INT-06',
    hooks.deviceSnapshotMutationOptions,
    'POST /integrations/device-calendar/snapshot',
  ],
  ['API-ONB-01', hooks.firstAnalysisStartMutationOptions, 'POST /onboarding/first-analysis'],
  ['API-BRF-02', hooks.eveningReadyMutationOptions, 'POST /briefings/:id/evening-ready'],
  ['API-BRF-04', hooks.briefingRetryMutationOptions, 'POST /briefings/:id/retry'],
];

/** `{ body, idempotencyKey }` mutations (settings, business, privacy, Android NI). */
const BODY_MUTATIONS: readonly [string, Factory, string][] = [
  ['API-BIZ-01', hooks.referralApplyMutationOptions, 'POST /referrals/apply'],
  ['API-BIZ-03', hooks.purchasesSyncMutationOptions, 'POST /purchases/sync'],
  ['API-DEV-04', hooks.notificationTestMutationOptions, 'POST /notifications/test'],
  ['API-SUP-01', hooks.supportTicketMutationOptions, 'POST /support/tickets'],
  ['API-SUP-02', hooks.feedbackMutationOptions, 'POST /feedback'],
  ['API-PRV-01', hooks.privacyExportMutationOptions, 'POST /privacy/export'],
  ['API-PRV-02', hooks.deleteHistoryMutationOptions, 'POST /privacy/delete-history'],
  ['API-PRV-03', hooks.deleteAccountMutationOptions, 'POST /privacy/delete-account'],
  ['API-ANI-01', hooks.aniSignalsUploadMutationOptions, 'POST /android-notifications/signals'],
  ['API-DEV-01', hooks.registerDeviceMutationOptions, 'POST /devices/register'],
  ['API-DEV-02', hooks.unregisterDeviceMutationOptions, 'POST /devices/unregister'],
  ['API-DEV-03', hooks.appleExchangeMutationOptions, 'POST /auth/apple/exchange'],
];

function run(factory: Factory, client: ApiClient, variables: unknown): Promise<unknown> {
  const options = factory(client);
  if (options.mutationFn === undefined) throw new Error('factory without mutationFn');
  return options.mutationFn(variables as never, MUTATION_CONTEXT);
}

describe('[IK] request mutations forward the intent key', () => {
  it.each(REQUEST_MUTATIONS)('%s → %s', async (_id, factory, key) => {
    const { client, calls } = recordingClient();
    await expect(run(factory, client, { input: INPUT, idempotencyKey: 'ik-1' })).resolves.toEqual({
      route: key,
    });
    await run(factory, client, { input: INPUT });
    expect(calls).toEqual([
      { key, input: INPUT, options: { idempotencyKey: 'ik-1' } },
      { key, input: INPUT, options: {} },
    ]);
  });
});

describe('[IK] body mutations wrap the body and forward the intent key', () => {
  it.each(BODY_MUTATIONS)('%s → %s', async (_id, factory, key) => {
    const { client, calls } = recordingClient();
    const body = { value: 1 };
    await run(factory, client, { body, idempotencyKey: 'ik-2' });
    await run(factory, client, { body });
    expect(calls).toEqual([
      { key, input: { body }, options: { idempotencyKey: 'ik-2' } },
      { key, input: { body }, options: {} },
    ]);
  });
});

describe('single-argument mutations', () => {
  it('API-INT-04 sync, API-REM-02 reminders, API-CAP-01/02 captures pass the input through', async () => {
    const { client, calls } = recordingClient();
    await run(hooks.integrationSyncMutationOptions, client, INPUT);
    await run(hooks.reminderCreateMutationOptions, client, INPUT);
    await run(hooks.captureUploadUrlMutationOptions, client, INPUT);
    await run(hooks.captureCreateMutationOptions, client, INPUT);
    expect(calls.map((c) => [c.key, c.input])).toEqual([
      ['POST /integrations/:accountId/sync', INPUT],
      ['POST /reminders', INPUT],
      ['POST /captures/upload-url', INPUT],
      ['POST /captures', INPUT],
    ]);
  });

  it('API-PRV-04 export download sends the export id as a path parameter', async () => {
    const { client, calls } = recordingClient();
    await run(hooks.exportDownloadMutationOptions, client, { id: uuid(9) });
    expect(calls[0]?.key).toBe('POST /privacy/export/:id/download');
    expect(calls[0]?.input).toMatchObject({ params: { id: uuid(9) } });
  });

  it('API-MAIL-04 discarding a reply draft sends the expected version and the intent key', async () => {
    const { client, calls } = recordingClient();
    const vars = { draftId: uuid(4), expectedVersion: 3 };
    await run(hooks.discardReplyDraftMutationOptions, client, { ...vars, idempotencyKey: 'ik-3' });
    await run(hooks.discardReplyDraftMutationOptions, client, vars);
    const expectedInput = {
      params: { id: uuid(4) },
      body: { status: 'discarded', expected_version: 3 },
    };
    expect(calls[0]).toMatchObject({
      key: 'PATCH /reply-drafts/:id',
      input: expectedInput,
      options: { idempotencyKey: 'ik-3' },
    });
    expect(calls[1]?.options).toEqual({});
  });
});

describe('query factories call their route with the query signal', () => {
  const signal = new AbortController().signal;

  async function fetchWith(options: { queryFn?: unknown; queryKey: readonly unknown[] }) {
    const { queryFn } = options as { queryFn: (ctx: unknown) => Promise<unknown> };
    return queryFn({ signal, queryKey: options.queryKey, meta: undefined });
  }

  it('API-MAIL-07 / API-PLAN-03 / API-MEET-01 post their idempotent read bodies', async () => {
    const { client, calls } = recordingClient();
    await fetchWith(hooks.threadSummaryQueryOptions(client, 'thread-1'));
    await fetchWith(hooks.conflictOptionsQueryOptions(client, uuid(5)));
    await fetchWith(hooks.meetingPrepQueryOptions(client, 'event-1'));
    expect(calls.map((c) => [c.key, c.input])).toEqual([
      [
        'POST /mail/threads/:threadId/summary',
        { params: { threadId: 'thread-1' }, body: { refresh: false } },
      ],
      ['POST /plan/conflicts/:insightId/options', { params: { insightId: uuid(5) }, body: {} }],
      [
        'POST /meetings/:eventId/prep',
        { params: { eventId: 'event-1' }, body: { refresh: false } },
      ],
    ]);
  });

  it('API-BRF-01 audio defaults to premium and keys the cache by preference', async () => {
    const { client, calls } = recordingClient();
    const premium = hooks.briefingAudioQueryOptions(client, uuid(6));
    const native = hooks.briefingAudioQueryOptions(client, uuid(6), 'native');
    expect(premium.queryKey.at(-1)).toBe('premium');
    expect(native.queryKey.at(-1)).toBe('native');
    expect(premium.staleTime).toBe(hooks.BRIEFING_AUDIO_STALE_MS);
    await fetchWith(native);
    expect(calls[0]).toEqual({
      key: 'POST /briefings/:id/audio',
      input: { params: { id: uuid(6) }, body: { prefer: 'native' } },
      options: { signal },
    });
  });

  it('API-BRF-03 share card and API-BIZ-02 referral link are persisted reads', async () => {
    const { client, calls } = recordingClient();
    const share = hooks.shareCardQueryOptions(client, uuid(7));
    const referral = hooks.referralMeQueryOptions(client);
    expect(share.meta).toEqual({ persist: true });
    expect(referral.meta).toEqual({ persist: true });
    await fetchWith(share);
    await fetchWith(referral);
    expect(calls.map((c) => [c.key, c.input])).toEqual([
      ['GET /weekly/:id/share-card', { params: { id: uuid(7) } }],
      ['GET /referrals/me', {}],
    ]);
  });

  it('GET /me/entitlements are a persisted read of GET /me/entitlements', async () => {
    const { client, calls } = recordingClient();
    const options = hooks.entitlementsQueryOptions(client);
    expect(options.queryKey).toEqual(['me', 'entitlements']);
    expect(options.meta).toEqual({ persist: true });
    await new QueryClient().query(options);
    expect(calls[0]?.key).toBe('GET /me/entitlements');
  });

  it('API-ONB-02 first-analysis polling stops once the job is terminal', () => {
    const { client } = recordingClient();
    const options = hooks.firstAnalysisQueryOptions(client, 'job-1');
    const interval = options.refetchInterval as (query: unknown) => number | false;
    const at = (status: string | undefined) => interval({ state: { data: { status } } });
    expect(at('completed')).toBe(false);
    expect(at('failed')).toBe(false);
    expect(at('running')).toBeGreaterThan(0);
    expect(at(undefined)).toBeGreaterThan(0);
  });
});

describe('retry budgets retry transient failures only', () => {
  const network = new ApiError({ code: 'SERVICE_UNAVAILABLE', kind: 'network', status: null });
  const timeout = new ApiError({ code: 'UPSTREAM_TIMEOUT', kind: 'timeout', status: null });
  const retryable = new ApiError({ code: 'SERVICE_UNAVAILABLE', kind: 'server', status: 503 });
  const final = new ApiError({ code: 'VALIDATION_FAILED', kind: 'server', status: 422 });
  const { client } = recordingClient();

  const BUDGETS: readonly [string, unknown, number][] = [
    ['assistant thread', hooks.assistantThreadMutationOptions(client).retry, 2],
    ['device execution', hooks.deviceExecutionMutationOptions(client).retry, 2],
    ['reminder create', hooks.reminderCreateMutationOptions(client).retry, 3],
    ['reminder cancel', hooks.reminderCancelMutationOptions(client).retry, 3],
    ['capture discard', hooks.captureDiscardMutationOptions(client).retry, 2],
    ['search', hooks.searchQueryOptions(client, { q: 'fatura', mode: 'results' }).retry, 1],
    ['first analysis', hooks.firstAnalysisQueryOptions(client, 'job').retry, 3],
    ['briefing audio', hooks.briefingAudioQueryOptions(client, 'b').retry, 1],
    ['share card', hooks.shareCardQueryOptions(client, 'w').retry, 2],
    ['referral me', hooks.referralMeQueryOptions(client).retry, 2],
    ['purchases sync', hooks.purchasesSyncMutationOptions(client).retry, 2],
    ['feedback', hooks.feedbackMutationOptions(client).retry, 2],
    ['entitlements', hooks.entitlementsQueryOptions(client).retry, 3],
    ['apple exchange', hooks.appleExchangeMutationOptions(client).retry, 1],
  ];

  it.each(BUDGETS)('%s retries up to %#', (_name, retry, max) => {
    const fn = retry as (count: number, error: unknown) => boolean;
    expect(fn(0, network)).toBe(true);
    expect(fn(0, timeout)).toBe(true);
    expect(fn(0, retryable)).toBe(retryable.retryable);
    expect(fn(max - 1, network)).toBe(true);
    expect(fn(max, network)).toBe(false);
    expect(fn(0, final)).toBe(false);
    expect(fn(0, new Error('boom'))).toBe(false);
  });
});

describe('ApiClientProvider', () => {
  it('provides the client through React context', () => {
    const { client } = recordingClient();
    const element = hooks.ApiClientProvider({ client, children: createElement('span') });
    expect((element.props as { value: ApiClient }).value).toBe(client);
  });
});

describe('error helpers', () => {
  it('maps gateway statuses without an envelope to catalogue codes (API_CONTRACTS §2.4)', () => {
    const expected: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'AUTH_REQUIRED',
      402: 'ENTITLEMENT_REQUIRED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      405: 'METHOD_NOT_ALLOWED',
      409: 'STATE_CONFLICT',
      410: 'SOURCE_GONE',
      413: 'PAYLOAD_TOO_LARGE',
      415: 'UNSUPPORTED_MEDIA_TYPE',
      422: 'VALIDATION_FAILED',
      426: 'CLIENT_UPGRADE_REQUIRED',
      429: 'RATE_LIMITED',
      502: 'PROVIDER_UNAVAILABLE',
      503: 'SERVICE_UNAVAILABLE',
      504: 'UPSTREAM_TIMEOUT',
      500: 'INTERNAL_ERROR',
      418: 'BAD_REQUEST',
    };
    for (const [status, code] of Object.entries(expected)) {
      expect(codeForStatus(Number(status))).toBe(code);
    }
  });

  it('parses Retry-After as seconds or as an HTTP date', () => {
    const now = Date.parse('2026-09-24T08:00:00Z');
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('  ')).toBeNull();
    expect(parseRetryAfter('2.5', now)).toBe(2500);
    expect(parseRetryAfter('-4', now)).toBe(0);
    expect(parseRetryAfter('Thu, 24 Sep 2026 08:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('Thu, 24 Sep 2026 07:59:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon', now)).toBeNull();
  });
});

describe('defaultGenerateId()', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  function withCrypto<T>(value: unknown, fn: () => T): T {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value, configurable: true });
    try {
      return fn();
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  }

  it('builds a v4 UUID from getRandomValues when randomUUID is missing (Hermes)', () => {
    const id = withCrypto({ getRandomValues: (a: Uint8Array) => a.fill(0xff) }, () =>
      defaultGenerateId(),
    );
    expect(id).toMatch(UUID_V4);
    expect(id).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('fails loudly without any crypto source', () => {
    expect(() => withCrypto(undefined, () => defaultGenerateId())).toThrow(/No crypto source/);
  });
});
