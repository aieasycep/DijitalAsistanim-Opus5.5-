import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { ApiError, createApiClient, qk } from '../src/index.ts';
import {
  ACTION_MUTATION_ROUTES,
  MAIL_ORIGINAL_GC_TIME_MS,
  apiMutationOptions,
  conflictOptionsQueryOptions,
  discardReplyDraftMutationOptions,
  forceAnalysisMutationOptions,
  freeSlotsQueryOptions,
  mailOriginalQueryOptions,
  meetingPrepAudioQueryOptions,
  meetingPrepQueryOptions,
  retryTransient,
  threadSummaryQueryOptions,
} from '../src/hooks/index.ts';
import { TS, json, mockFetch, ok, uuid } from './fixtures.ts';

function api(fetchFn: (url: string, init: RequestInit) => Promise<Response>) {
  return createApiClient({
    baseUrl: 'https://api.example.com/functions/v1/api',
    getAccessToken: () => 'token',
    fetch: fetchFn,
  });
}

const draft = {
  id: uuid(20),
  kind: 'reply',
  email_message_id: uuid(21),
  email_thread_id: uuid(22),
  connected_account_id: uuid(23),
  tone: 'short',
  subject: 'Re: Teklif',
  to: [{ email: 'ahmet@example.com', name: 'Ahmet' }],
  cc: [],
  body_text: 'Merhaba Ahmet,',
  language: 'tr',
  version: 1,
  status: 'draft',
  attachments: [],
  grounding: { facts_used: [] },
  warnings: [],
  approval_id: null,
  web_link: null,
  created_at: TS,
  updated_at: TS,
};

describe('query keys of the T-8.10…T-8.14 areas', () => {
  it('nest under their roots', () => {
    expect(qk.flow.feed('all')).toEqual(['flow', 'all']);
    expect(qk.mail.intel('2026-09-24', 'all')).toEqual(['mail', 'intel', '2026-09-24', 'all']);
    expect(qk.mail.original('m')).toEqual(['mail', 'original', 'm']);
    expect(qk.plan.freeSlots('a', 'b', 30)).toEqual(['plan', 'free-slots', 'a', 'b', 30]);
    expect(qk.meetings.prep('e')).toEqual(['meeting', 'prep', 'e']);
    expect(qk.approvals.status('x')).toEqual(['approvals', 'x', 'status']);
  });
});

describe('route mutations', () => {
  it('sends the input and reuses the caller idempotency key', async () => {
    const mock = mockFetch(() => json(201, ok(draft)));
    const client = api(mock.fn);
    const observer = new MutationObserver(
      new QueryClient(),
      apiMutationOptions(client, 'POST /mail/:messageId/reply-drafts'),
    );
    const data = await observer.mutate({
      input: { params: { messageId: uuid(21) }, body: { tone: 'short' } },
      idempotencyKey: 'intent-1',
    });
    expect(data.id).toBe(uuid(20));
    expect(mock.calls[0]?.url).toBe(
      `https://api.example.com/functions/v1/api/mail/${uuid(21)}/reply-drafts`,
    );
    expect(mock.calls[0]?.headers['idempotency-key']).toBe('intent-1');
    const body = mock.calls[0]?.init.body;
    expect(JSON.parse(typeof body === 'string' ? body : '{}')).toEqual({ tone: 'short' });
  });

  it('names every mutation after its route', () => {
    const client = api(mockFetch(() => json(200, ok({}))).fn);
    for (const key of ACTION_MUTATION_ROUTES) {
      expect(apiMutationOptions(client, key).mutationKey).toEqual(['api', key]);
    }
  });

  it('"Analiz et" posts message_ids with force_analysis to the account sync route', async () => {
    const mock = mockFetch(() =>
      json(
        202,
        ok({
          jobs: [{ job_id: uuid(30), status: 'queued', poll_after_ms: 2000 }],
          next_allowed_at: TS,
        }),
      ),
    );
    const options = forceAnalysisMutationOptions(api(mock.fn));
    expect(options.mutationKey).toEqual([
      'api',
      'POST /integrations/:accountId/sync',
      'force_analysis',
    ]);
    const data = await new MutationObserver(new QueryClient(), options).mutate({
      accountId: uuid(23),
      messageIds: [uuid(21)],
    });
    expect(data.jobs).toHaveLength(1);
    expect(mock.calls[0]?.url).toBe(
      `https://api.example.com/functions/v1/api/integrations/${uuid(23)}/sync`,
    );
    const body = mock.calls[0]?.init.body;
    expect(JSON.parse(typeof body === 'string' ? body : '{}')).toEqual({
      message_ids: [uuid(21)],
      force_analysis: true,
    });
  });

  it('meeting summary audio posts the prep version hash and keys the cache by it', async () => {
    const audio = {
      mode: 'premium',
      signed_url: 'https://files.example.com/prep/abc.mp3?token=t',
      expires_at: TS,
      duration_s: 118,
      chapters: [{ index: 0, title: 'Giriş', start_s: 0 }],
    };
    const mock = mockFetch(() => json(200, ok(audio)));
    const options = meetingPrepAudioQueryOptions(api(mock.fn), uuid(40), 'hash-1');
    expect(options.queryKey).toEqual(['meeting', 'prep', uuid(40), 'audio', 'hash-1']);
    const data = await new QueryClient().query(options);
    expect(data.mode).toBe('premium');
    expect(mock.calls[0]?.url).toBe(
      `https://api.example.com/functions/v1/api/meetings/${uuid(40)}/prep/audio`,
    );
    const body = mock.calls[0]?.init.body;
    expect(JSON.parse(typeof body === 'string' ? body : '{}')).toEqual({
      prep_version_hash: 'hash-1',
    });
  });

  it('"Taslağı sil" patches status discarded with the expected version and key', async () => {
    const mock = mockFetch(() => json(200, ok({ ...draft, status: 'discarded', version: 2 })));
    const data = await new MutationObserver(
      new QueryClient(),
      discardReplyDraftMutationOptions(api(mock.fn)),
    ).mutate({ draftId: uuid(20), expectedVersion: 1, idempotencyKey: 'discard-1' });
    expect(data.status).toBe('discarded');
    expect(mock.calls[0]?.init.method).toBe('PATCH');
    expect(mock.calls[0]?.headers['idempotency-key']).toBe('discard-1');
    const body = mock.calls[0]?.init.body;
    expect(JSON.parse(typeof body === 'string' ? body : '{}')).toEqual({
      status: 'discarded',
      expected_version: 1,
    });
  });

  it('surfaces server errors as typed ApiErrors', async () => {
    const mock = mockFetch(() =>
      json(402, {
        error: {
          code: 'ENTITLEMENT_REQUIRED',
          message: 'pro',
          message_key: 'errors.entitlement_required',
          retryable: false,
          correlation_id: 'corr-1',
          details: { feature: 'advanced_planning' },
        },
      }),
    );
    const observer = new MutationObserver(
      new QueryClient(),
      apiMutationOptions(api(mock.fn), 'POST /plan/proposals'),
    );
    await expect(
      observer.mutate({
        input: {
          body: {
            title: 'Odak',
            duration_minutes: 60,
            window: { from: '2026-09-24T09:00:00Z', to: '2026-09-24T18:00:00Z' },
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'ENTITLEMENT_REQUIRED',
      details: { feature: 'advanced_planning' },
    });
  });
});

describe('query factories', () => {
  it('keeps the original mail in memory only', async () => {
    const original = {
      message_id: uuid(21),
      subject: 'Teklif',
      from: { email: 'ahmet@example.com' },
      to: [],
      cc: [],
      date: TS,
      body: { format: 'text', content: 'Merhaba', truncated: false, remote_images_blocked: true },
      attachments: [],
      web_link: null,
      fetched_at: TS,
    };
    const mock = mockFetch(() => json(200, ok(original)));
    const options = mailOriginalQueryOptions(api(mock.fn), uuid(21));
    expect(options.meta).toBeUndefined();
    expect(options.gcTime).toBe(MAIL_ORIGINAL_GC_TIME_MS);
    const data = await new QueryClient().query(options);
    expect(data.body.content).toBe('Merhaba');
    expect(mock.calls[0]?.url).toContain(`/mail/${uuid(21)}/original?remote_images=blocked`);
  });

  it('builds the free-slot, conflict, prep and thread-summary requests', async () => {
    const mock = mockFetch(
      () => json(200, ok({ slots: [], sources_considered: [] })),
      () => json(200, ok({ conflict: { insight_id: uuid(1), events: [] }, options: [] })),
    );
    const client = api(mock.fn);
    const slots = freeSlotsQueryOptions(client, {
      from: '2026-09-24T00:00:00Z',
      to: '2026-09-25T00:00:00Z',
      minMinutes: 60,
    });
    expect(slots.queryKey).toEqual([
      'plan',
      'free-slots',
      '2026-09-24T00:00:00Z',
      '2026-09-25T00:00:00Z',
      60,
    ]);
    await new QueryClient().query(slots);
    expect(mock.calls[0]?.url).toContain('min_minutes=60');
    expect(conflictOptionsQueryOptions(client, uuid(1)).queryKey).toEqual([
      'plan',
      'conflict',
      uuid(1),
    ]);
    expect(meetingPrepQueryOptions(client, uuid(3)).meta).toEqual({ persist: true });
    expect(threadSummaryQueryOptions(client, uuid(4)).queryKey).toEqual([
      'mail',
      'thread-summary',
      uuid(4),
    ]);
  });

  it('retries only transient failures', () => {
    const retry = retryTransient(2);
    const network = new ApiError({ code: 'SERVICE_UNAVAILABLE', kind: 'network', status: null });
    const denied = new ApiError({ code: 'FORBIDDEN', kind: 'server', status: 403 });
    expect(retry(0, network)).toBe(true);
    expect(retry(2, network)).toBe(false);
    expect(retry(0, denied)).toBe(false);
    expect(retry(0, new Error('x'))).toBe(false);
  });
});
