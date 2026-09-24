import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { createApiClient, mk } from '../src/index.ts';
import {
  BRIEFING_AUDIO_STALE_MS,
  FIRST_ANALYSIS_POLL_MS,
  briefingAudioQueryOptions,
  briefingRetryMutationOptions,
  dataSourcesMutationOptions,
  eveningReadyMutationOptions,
  firstAnalysisQueryOptions,
  firstAnalysisStartMutationOptions,
  integrationDisconnectMutationOptions,
  integrationStartMutationOptions,
  integrationSyncMutationOptions,
  oauthCompleteMutationOptions,
  shareCardQueryOptions,
} from '../src/hooks/index.ts';
import { json, mockFetch, ok, uuid } from './fixtures.ts';

function api(fetchFn: (url: string, init: RequestInit) => Promise<Response>) {
  return createApiClient({
    baseUrl: 'https://api.example.com/functions/v1/api',
    getAccessToken: () => 'token',
    fetch: fetchFn,
  });
}

function bodyOf(init: RequestInit): unknown {
  return typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
}

const HASH = 'a'.repeat(64);
const NONCE = 'A'.repeat(43);

describe('integration mutations', () => {
  it('starts a connection with the nonce hash and the given idempotency key', async () => {
    const mock = mockFetch(() =>
      json(
        200,
        ok({
          state_id: uuid(5),
          auth_url: 'https://accounts.example.com/o/oauth2/auth?x=1',
          state_expires_at: '2026-09-24T08:10:00Z',
          callback_url: 'dijitalasistan://integrations/callback',
          requested_scopes: ['gmail.readonly'],
        }),
      ),
    );
    const observer = new MutationObserver(
      new QueryClient(),
      integrationStartMutationOptions(api(mock.fn)),
    );
    const data = await observer.mutate({
      input: {
        params: { provider: 'google' },
        body: { capabilities: ['mail_read'], device_nonce_hash: HASH },
      },
      idempotencyKey: uuid(9),
    });
    expect(data.state_id).toBe(uuid(5));
    const call = mock.calls[0];
    expect(call?.url).toBe('https://api.example.com/functions/v1/api/integrations/google/start');
    expect(call?.headers['idempotency-key']).toBe(uuid(9));
    expect(bodyOf(call?.init ?? {})).toEqual({
      capabilities: ['mail_read'],
      device_nonce_hash: HASH,
    });
  });

  it('completes the OAuth flow once and never retries a single-use code', async () => {
    let calls = 0;
    const mock = mockFetch(() => {
      calls += 1;
      return json(503, {
        error: { code: 'SERVICE_UNAVAILABLE', message: 'x', retryable: true },
      });
    });
    const options = oauthCompleteMutationOptions(api(mock.fn));
    expect(options.retry).toBe(false);
    expect(options.mutationKey).toEqual(mk.integrations.complete);
    const observer = new MutationObserver(new QueryClient(), options);
    await expect(
      observer.mutate({ input: { body: { completion_code: NONCE, device_nonce: NONCE } } }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(calls).toBe(1);
  });

  it('sends disconnect, sync and data-source calls to their account routes', async () => {
    const account = uuid(3);
    const seen: string[] = [];
    const mock = mockFetch((call) => {
      seen.push(`${call.init.method ?? 'GET'} ${new URL(call.url).pathname}`);
      if (call.url.endsWith('/sync')) {
        return json(202, ok({ jobs: [], next_allowed_at: '2026-09-24T08:01:00Z' }));
      }
      return json(500, { error: { code: 'INTERNAL', message: 'x' } });
    });
    const client = api(mock.fn);
    const queryClient = new QueryClient();
    await new MutationObserver(queryClient, integrationSyncMutationOptions(client)).mutate({
      params: { accountId: account },
      body: {},
    });
    await new MutationObserver(queryClient, integrationDisconnectMutationOptions(client))
      .mutate({
        input: { params: { accountId: account }, body: { confirm: true, purge_content: true } },
      })
      .catch(() => undefined);
    await new MutationObserver(queryClient, dataSourcesMutationOptions(client))
      .mutate({
        input: {
          params: { accountId: account },
          body: {
            data_sources: { draft_replies: false },
            expected_updated_at: '2026-09-24T08:00:00Z',
          },
        },
      })
      .catch(() => undefined);
    expect(seen).toEqual([
      `POST /functions/v1/api/integrations/${account}/sync`,
      `POST /functions/v1/api/integrations/${account}/disconnect`,
      `PATCH /functions/v1/api/integrations/${account}/data-sources`,
    ]);
  });
});

describe('first analysis', () => {
  it('starts the job and polls every 1.5 s until a terminal status', async () => {
    const job = uuid(7);
    const mock = mockFetch(
      () =>
        json(
          202,
          ok({
            job: { job_id: job, status: 'queued', poll_after_ms: 1500 },
            already_running: false,
          }),
        ),
      () =>
        json(
          200,
          ok({
            status: 'running',
            partial: false,
            steps: [{ key: 'scan_mail', status: 'running', count: 12 }],
            counts: {
              mails_found: 12,
              potential_important: 0,
              upcoming_events: 0,
              possible_followups: 0,
            },
            top_items: [],
            total_items: 0,
            briefing_id: null,
          }),
        ),
    );
    const client = api(mock.fn);
    const queryClient = new QueryClient();
    const started = await new MutationObserver(
      queryClient,
      firstAnalysisStartMutationOptions(client),
    ).mutate({ input: { body: { window_hours: 72 } }, idempotencyKey: 'first_analysis:u:1' });
    expect(started.job.job_id).toBe(job);
    expect(mock.calls[0]?.headers['idempotency-key']).toBe('first_analysis:u:1');

    const options = firstAnalysisQueryOptions(client, job);
    expect(options.queryKey).toEqual(['onboarding', 'first-analysis', job]);
    const progress = await queryClient.query(options);
    expect(progress.counts.mails_found).toBe(12);
    const interval = options.refetchInterval as (query: {
      state: { data?: { status: string } };
    }) => number | false;
    expect(interval({ state: { data: { status: 'running' } } })).toBe(FIRST_ANALYSIS_POLL_MS);
    expect(interval({ state: { data: { status: 'completed' } } })).toBe(false);
    expect(interval({ state: { data: { status: 'failed' } } })).toBe(false);
  });
});

describe('briefings and weekly', () => {
  it('requests audio as a 240 s query keyed by briefing and preference', async () => {
    const id = uuid(11);
    const mock = mockFetch(() =>
      json(
        200,
        ok({
          mode: 'native',
          language: 'tr-TR',
          chapters: [{ index: 0, title: 'Genel bakış', text: 'Merhaba.', est_duration_s: 3 }],
          notice_key: null,
          premium_status: 'unavailable',
        }),
      ),
    );
    const options = briefingAudioQueryOptions(api(mock.fn), id, 'native');
    expect(options.queryKey).toEqual(['briefings', id, 'audio', 'native']);
    expect(options.staleTime).toBe(BRIEFING_AUDIO_STALE_MS);
    const data = await new QueryClient().query(options);
    expect(data.mode).toBe('native');
    expect(bodyOf(mock.calls[0]?.init ?? {})).toEqual({ prefer: 'native' });
  });

  it('confirms the evening close with its idempotency key and retries a failed briefing', async () => {
    const id = uuid(12);
    const mock = mockFetch(
      () =>
        json(
          200,
          ok({ carried: 2, next_morning_at: '2026-09-25T05:00:00Z', closed_at: TS_CLOSED }),
        ),
      () =>
        json(
          202,
          ok({
            briefing_id: id,
            status: 'generating',
            job: { job_id: uuid(13), status: 'queued', poll_after_ms: 5000 },
          }),
        ),
    );
    const client = api(mock.fn);
    const queryClient = new QueryClient();
    const ready = await new MutationObserver(
      queryClient,
      eveningReadyMutationOptions(client),
    ).mutate({
      input: { params: { id }, body: { confirm: true, carry_over_item_ids: [uuid(20)] } },
      idempotencyKey: `evening_ready:${id}`,
    });
    expect(ready.carried).toBe(2);
    expect(mock.calls[0]?.headers['idempotency-key']).toBe(`evening_ready:${id}`);
    const retried = await new MutationObserver(
      queryClient,
      briefingRetryMutationOptions(client),
    ).mutate({ input: { params: { id }, body: {} } });
    expect(retried.status).toBe('generating');
  });

  it('loads the privacy-safe share card as a persisted query', async () => {
    const id = uuid(14);
    const mock = mockFetch(() =>
      json(
        200,
        ok({
          week_label: '21–27 Eylül',
          metrics: {
            analyzed_emails: 684,
            important_subjects: 32,
            meetings: 21,
            followups_closed: 6,
            deadlines: 4,
            estimated_time_saved_minutes: 168,
          },
          formula_version: 'v1',
          labels: { time_saved_prefix: 'Tahmini kazandırılan zaman' },
          share_text: 'Dijital Haftam',
        }),
      ),
    );
    const options = shareCardQueryOptions(api(mock.fn), id);
    expect(options.meta).toEqual({ persist: true });
    const card = await new QueryClient().query(options);
    expect(card.metrics.analyzed_emails).toBe(684);
  });
});

const TS_CLOSED = '2026-09-24T19:14:00Z';
