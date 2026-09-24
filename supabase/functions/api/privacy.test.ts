/**
 * API-PRV-01…04 (IMPLEMENTATION_PLAN T-11.01…T-11.03; API_CONTRACTS §8.15 "Tests"; R-16).
 */
import { assert, assertEquals, assertMatch } from '@std/assert';
import { routes } from '@da/validation';
import { memoryObjectStore, memoryPrivacyRepo } from '../_shared/testing/privacy.ts';
import { USER_A, USER_B } from '../_shared/testing/jwt.ts';
import { createApiApp } from './app.ts';
import { call, createHarness, type Harness, NOW } from './testing.ts';

const key = () => crypto.randomUUID();
const RECENT = { amr: [{ method: 'otp', timestamp: Math.floor(NOW.getTime() / 1000) - 60 }] };
const STALE = { amr: [{ method: 'otp', timestamp: Math.floor(NOW.getTime() / 1000) - 3600 }] };

async function privacyHarness() {
  const base = await createHarness();
  const repo = memoryPrivacyRepo();
  const store = memoryObjectStore();
  const signedOut: string[] = [];
  const deps = {
    ...base.deps,
    privacy: {
      repo,
      store,
      authAdmin: { signOutOthers: (jwt: string) => Promise.resolve(!!signedOut.push(jwt)) },
    },
  };
  const h: Harness = { ...base, deps, app: createApiApp(deps) };
  return { h, repo, store, signedOut };
}

Deno.test(
  'POST /privacy/export: 202 with the request; a second one is 409 with the active id',
  async () => {
    const { h, repo } = await privacyHarness();
    const jwt = await h.token(USER_A);
    const res = await call(h, 'POST', '/privacy/export', { jwt, key: key(), body: {} });
    assertEquals(res.status, 202);
    const body = await res.json();
    assert(routes['POST /privacy/export'].response.safeParse(body).success);
    assertEquals(body.data.status, 'requested');
    assertEquals(repo.enqueued[0]?.type, 'export');
    const again = await call(h, 'POST', '/privacy/export', {
      jwt,
      key: key(),
      body: { include: ['insights'] },
    });
    assertEquals(again.status, 409);
    const error = (await again.json()).error;
    assertEquals(
      [error.code, error.details.active_request_id],
      ['STATE_CONFLICT', body.data.request_id],
    );
    const bad = await call(h, 'POST', '/privacy/export', {
      jwt,
      key: key(),
      body: { include: ['oauth_credentials'] },
    });
    assertEquals(bad.status, 422);
    await bad.body?.cancel();
  },
);

Deno.test(
  'POST /privacy/export/:id/download: owner only, ready only, a fresh 300 s URL each call',
  async () => {
    const { h, repo, store } = await privacyHarness();
    const created = await repo.createExportRequest(USER_A, null, null);
    const row = repo.exports.get(created.request_id);
    assert(row !== undefined);
    repo.exports.set(created.request_id, {
      ...row,
      status: 'ready',
      storage_path: `${USER_A}/${created.request_id}.zip`,
      file_size_bytes: 2048,
      sha256: 'cd'.repeat(32),
      ready_at: NOW.toISOString(),
      expires_at: new Date(NOW.getTime() + 3_600_000).toISOString(),
    });
    store.put('exports', `${USER_A}/${created.request_id}.zip`);
    const path = `/privacy/export/${created.request_id}/download`;
    const other = await call(h, 'POST', path, { jwt: await h.token(USER_B), key: key(), body: {} });
    assertEquals(other.status, 404, 'another user id is NOT_FOUND');
    await other.body?.cancel();
    const jwt = await h.token(USER_A);
    const idem = key();
    const res = await call(h, 'POST', path, { jwt, key: idem, body: {} });
    assertEquals(res.status, 200);
    const body = await res.json();
    assert(routes['POST /privacy/export/:id/download'].response.safeParse(body).success);
    assertMatch(body.data.signed_url, /ttl=300$/);
    assertEquals(Date.parse(body.data.expires_at) - NOW.getTime(), 300_000);
    assertEquals(body.data.sha256, 'cd'.repeat(32));
    assert(repo.exports.get(created.request_id)?.downloaded_at !== null);
    assert(h.audit.some((a) => a.action === 'user.privacy.export_downloaded'));
    const replay = await call(h, 'POST', path, { jwt, key: idem, body: {} });
    assertEquals(replay.headers.get('Idempotency-Replayed'), 'true');
    assertMatch((await replay.json()).data.signed_url, /ttl=300$/);

    const current = repo.exports.get(created.request_id);
    assert(current !== undefined);
    repo.exports.set(created.request_id, { ...current, status: 'expired' });
    const expired = await call(h, 'POST', path, { jwt, key: key(), body: {} });
    assertEquals(expired.status, 409);
    assertEquals((await expired.json()).error.details.status, 'expired');
  },
);

Deno.test(
  'POST /privacy/delete-history: re-auth within 10 min, counts before queueing, one active',
  async () => {
    const { h, repo } = await privacyHarness();
    repo.counts = {
      summaries: 12,
      priority_decisions: 40,
      memory_chunks: 150,
      assistant_threads: 3,
      learned_preferences: 5,
      insights: 40,
      briefings: 9,
    };
    const body = { scope: { type: 'all_analysis' }, confirm: true };
    const stale = await call(h, 'POST', '/privacy/delete-history', {
      jwt: await h.token(USER_A, STALE),
      key: key(),
      body,
    });
    assertEquals(stale.status, 401);
    const staleError = (await stale.json()).error;
    assertEquals([staleError.code, staleError.details.max_age_seconds], ['REAUTH_REQUIRED', 600]);
    const jwt = await h.token(USER_A, RECENT);
    const unconfirmed = await call(h, 'POST', '/privacy/delete-history', {
      jwt: await h.token(USER_B, RECENT),
      key: key(),
      body: { scope: { type: 'all_analysis' } },
    });
    assertEquals(unconfirmed.status, 422, 'explicit confirmation is required');
    await unconfirmed.body?.cancel();
    const res = await call(h, 'POST', '/privacy/delete-history', { jwt, key: key(), body });
    assertEquals(res.status, 202);
    const data = await res.json();
    assert(routes['POST /privacy/delete-history'].response.safeParse(data).success);
    assertEquals(data.data.will_delete.memory_chunks, 150);
    assert(data.data.preserved.includes('vip'));
    assertEquals(repo.calls.slice(0, 2), ['historyCounts', 'createDeletionRequest:history']);
    assertEquals(repo.enqueued.at(-1)?.type, 'history_deletion');
    const again = await call(h, 'POST', '/privacy/delete-history', { jwt, key: key(), body });
    assertEquals(again.status, 409);
    await again.body?.cancel();
  },
);

Deno.test(
  'POST /privacy/delete-account: re-auth, subscription acknowledgement, one-time status token',
  async () => {
    const { h, repo, signedOut } = await privacyHarness();
    h.business.billing.mirrors.set(USER_A, {
      is_active: true,
      store: 'app_store',
      product_id: 'da_pro_monthly',
      period_type: 'normal',
      will_renew: true,
      expires_at: new Date(NOW.getTime() + 86_400_000).toISOString(),
      synced_at: NOW.toISOString(),
      environment: 'production',
    } as never);
    const stale = await call(h, 'POST', '/privacy/delete-account', {
      jwt: await h.token(USER_B, STALE),
      key: key(),
      body: { confirm_text: 'SİL', acknowledge_subscription: true },
    });
    assertEquals(stale.status, 401);
    await stale.body?.cancel();
    const jwt = await h.token(USER_A, RECENT);
    const wrongWord = await call(h, 'POST', '/privacy/delete-account', {
      jwt: await h.token(USER_B, RECENT),
      key: key(),
      body: { confirm_text: 'sil', acknowledge_subscription: true },
    });
    assertEquals(wrongWord.status, 422);
    await wrongWord.body?.cancel();
    const noAck = await call(h, 'POST', '/privacy/delete-account', {
      jwt,
      key: key(),
      body: { confirm_text: 'SİL', acknowledge_subscription: false },
    });
    assertEquals(noAck.status, 422, 'an active store subscription needs the acknowledgement');
    await noAck.body?.cancel();
    assertEquals(repo.deletions.size, 0);

    const res = await call(h, 'POST', '/privacy/delete-account', {
      jwt,
      key: key(),
      body: { confirm_text: 'DELETE', acknowledge_subscription: true, reason: 'privacy' },
    });
    assertEquals(res.status, 202);
    const data = await res.json();
    assert(routes['POST /privacy/delete-account'].response.safeParse(data).success);
    assertEquals(data.data.subscription_notice, {
      active: true,
      management_url: 'https://apps.apple.com/account/subscriptions',
    });
    const stored = repo.deletions.get(data.data.request_id);
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data.data.status_token)),
    );
    assertEquals(stored?.status_token_hash, digest, 'only the token hash is stored');
    assertEquals(signedOut, [jwt], 'the other sessions are signed out');
    assertEquals(repo.enqueued.at(-1)?.type, 'account_deletion');

    // A repeat returns the same request with a fresh token.
    const repeat = await call(h, 'POST', '/privacy/delete-account', {
      jwt,
      key: key(),
      body: { confirm_text: 'SİL', acknowledge_subscription: true },
    });
    const again = await repeat.json();
    assertEquals(again.data.request_id, data.data.request_id);
    assert(again.data.status_token !== data.data.status_token);

    const limited = await call(h, 'POST', '/privacy/delete-account', {
      jwt,
      key: key(),
      body: { confirm_text: 'SİL', acknowledge_subscription: true },
    });
    assertEquals(limited.status, 429, 'three deletion requests per 24 h');
    await limited.body?.cancel();

    // After the request the account gate blocks every other api route.
    h.accounts.set(USER_A, { state: 'deletion_pending', disabledAt: null });
    const blocked = await call(h, 'POST', '/privacy/export', { jwt, key: key(), body: {} });
    assertEquals(blocked.status, 403);
    assertEquals((await blocked.json()).error.code, 'ACCOUNT_DELETION_PENDING');
  },
);
