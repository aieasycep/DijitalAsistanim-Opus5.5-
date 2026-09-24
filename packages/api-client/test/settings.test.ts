import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { createApiClient, mk, qk } from '../src/index.ts';
import {
  deleteAccountMutationOptions,
  deleteHistoryMutationOptions,
  exportDownloadMutationOptions,
  feedbackMutationOptions,
  notificationTestMutationOptions,
  privacyExportMutationOptions,
  purchasesSyncMutationOptions,
  referralApplyMutationOptions,
  referralMeQueryOptions,
  supportTicketMutationOptions,
} from '../src/hooks/index.ts';
import { TS, errorBody, json, mockFetch, ok, uuid } from './fixtures.ts';

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

const PATH = 'https://api.example.com/functions/v1/api';

describe('settings query keys', () => {
  it('nests every settings area under its root key', () => {
    expect(qk.privacy.exportLatest()).toEqual(['privacy', 'export', 'latest']);
    expect(qk.privacy.historyLatest()).toEqual(['privacy', 'history', 'latest']);
    expect(qk.support.tickets()).toEqual(['support', 'tickets']);
    expect(qk.rules.preview('abc').slice(0, 1)).toEqual(qk.rules.all);
    expect(qk.learned.list().slice(0, 1)).toEqual(qk.learned.all);
    expect(qk.purchases.offerings()).toEqual(['rc', 'offerings']);
  });
});

describe('referral options', () => {
  it('reads GET /referrals/me into a persisted query', async () => {
    const data = {
      code: 'K7M2P9Q',
      share_url: 'https://dijitalasistan.app/r/K7M2P9Q',
      reward_days: 14,
      cap_per_year: 6,
      remaining_this_year: 6,
      earned_days_total: 0,
      referrals: [],
      referred_by: null,
    };
    const mock = mockFetch(() => json(200, ok(data)));
    const options = referralMeQueryOptions(api(mock.fn));
    expect(options.queryKey).toEqual(['referrals', 'me']);
    expect(options.meta).toEqual({ persist: true });
    const result = await new QueryClient().query(options);
    expect(result.code).toBe('K7M2P9Q');
    expect(mock.calls[0]?.url).toBe(`${PATH}/referrals/me`);
  });

  it('applies a code once with its idempotency key and never retries a business error', async () => {
    const mock = mockFetch(() => json(404, errorBody('REFERRAL_CODE_INVALID')));
    const observer = new MutationObserver(
      new QueryClient(),
      referralApplyMutationOptions(api(mock.fn)),
    );
    await expect(
      observer.mutate({
        body: { code: 'K7M2P9Q', installation_id: uuid(1), source: 'manual' },
        idempotencyKey: uuid(9),
      }),
    ).rejects.toMatchObject({ code: 'REFERRAL_CODE_INVALID' });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.headers['idempotency-key']).toBe(uuid(9));
    expect(bodyOf(mock.calls[0]?.init ?? {})).toEqual({
      code: 'K7M2P9Q',
      installation_id: uuid(1),
      source: 'manual',
    });
  });

  it('syncs purchases with the reason and the RevenueCat app user id', async () => {
    const entitlement = {
      is_active: true,
      source: 'store',
      active_until: TS,
      store: {
        active: true,
        product_id: 'da_pro_annual',
        store: 'test_store',
        period_type: 'normal',
        will_renew: true,
        expires_at: TS,
        billing_issue: false,
        management_url: null,
      },
      grants: [],
    };
    const mock = mockFetch(() => json(200, ok({ entitlement, stale: false })));
    const observer = new MutationObserver(
      new QueryClient(),
      purchasesSyncMutationOptions(api(mock.fn)),
    );
    const data = await observer.mutate({ body: { reason: 'purchase', rc_app_user_id: uuid(2) } });
    expect(data.entitlement.is_active).toBe(true);
    expect(mock.calls[0]?.url).toBe(`${PATH}/purchases/sync`);
    expect(purchasesSyncMutationOptions(api(mock.fn)).mutationKey).toEqual(
      mk.business.purchasesSync,
    );
  });
});

describe('privacy options', () => {
  it('requests an export and mints a download URL per tap', async () => {
    const mock = mockFetch(
      () => json(202, ok({ request_id: uuid(3), status: 'requested' })),
      () =>
        json(
          200,
          ok({
            signed_url: 'https://storage.example.com/exports/x.zip?token=1',
            expires_at: TS,
            file_size_bytes: 2048,
            sha256: 'a'.repeat(64),
          }),
        ),
    );
    const client = api(mock.fn);
    const requested = await new MutationObserver(
      new QueryClient(),
      privacyExportMutationOptions(client),
    ).mutate({ body: {}, idempotencyKey: uuid(4) });
    expect(requested.request_id).toBe(uuid(3));
    const link = await new MutationObserver(
      new QueryClient(),
      exportDownloadMutationOptions(client),
    ).mutate({ id: uuid(3) });
    expect(link.signed_url).toContain('exports');
    expect(mock.calls[1]?.url).toBe(`${PATH}/privacy/export/${uuid(3)}/download`);
  });

  it('sends the history and account deletion requests verbatim', async () => {
    const mock = mockFetch(
      () => json(401, errorBody('REAUTH_REQUIRED')),
      () =>
        json(
          202,
          ok({
            request_id: uuid(5),
            status: 'queued',
            status_token: 'A'.repeat(43),
            subscription_notice: { active: false, management_url: null },
          }),
        ),
    );
    const client = api(mock.fn);
    await expect(
      new MutationObserver(new QueryClient(), deleteHistoryMutationOptions(client)).mutate({
        body: { scope: { type: 'all_analysis' }, confirm: true },
        idempotencyKey: uuid(6),
      }),
    ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    expect(bodyOf(mock.calls[0]?.init ?? {})).toEqual({
      scope: { type: 'all_analysis' },
      confirm: true,
    });
    const queued = await new MutationObserver(
      new QueryClient(),
      deleteAccountMutationOptions(client),
    ).mutate({ body: { confirm_text: 'SİL', acknowledge_subscription: false } });
    expect(queued.status).toBe('queued');
  });
});

describe('support, feedback and test push options', () => {
  it('posts a ticket, a feedback and a test notification with their keys', async () => {
    const mock = mockFetch(
      () => json(201, ok({ id: uuid(7), reference: 'DA-7K3M9Q', status: 'open' })),
      () => json(201, ok({ id: uuid(8) })),
      () =>
        json(
          202,
          ok({
            notification_id: uuid(9),
            job: { job_id: uuid(10), status: 'queued', poll_after_ms: 1000 },
            deferred_until: null,
          }),
        ),
    );
    const client = api(mock.fn);
    const ticket = await new MutationObserver(
      new QueryClient(),
      supportTicketMutationOptions(client),
    ).mutate({
      body: {
        category: 'sync',
        subject: 'Eşitleme hakkında',
        message: 'Takvimim iki gündür güncellenmiyor.',
        include_diagnostics: true,
      },
      idempotencyKey: uuid(11),
    });
    expect(ticket.reference).toBe('DA-7K3M9Q');
    expect(mock.calls[0]?.headers['idempotency-key']).toBe(uuid(11));
    await new MutationObserver(new QueryClient(), feedbackMutationOptions(client)).mutate({
      body: { type: 'general', rating: 4, message: 'Güzel', include_diagnostics: false },
    });
    expect(mock.calls[1]?.url).toBe(`${PATH}/feedback`);
    const test = await new MutationObserver(
      new QueryClient(),
      notificationTestMutationOptions(client),
    ).mutate({ body: { installation_id: uuid(12), category: 'critical_email' } });
    expect(test.deferred_until).toBeNull();
  });
});
