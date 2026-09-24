/**
 * OAuth connect with the client-bound completion (R-07): TEST_PLAN EF-OAUTH-01/03, EF-DEMO-01,
 * IT-OAUTH-*; API_CONTRACTS API-INT-01/02/07, OAUTH-01/03/04.
 */
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert';
import { toBase64Url } from '../../crypto/encoding.ts';
import { sha256Hex } from '../../crypto/hmac.ts';
import { AppError } from '../../errors.ts';
import { integrationHarness, type IntegrationHarness } from '../../testing/integrations.ts';
import { USER_A, USER_B } from '../../testing/jwt.ts';
import { createOAuthApp } from '../../../oauth/app.ts';
import { DemoOAuth } from '../../providers/demo/auth.ts';
import { completeOAuth, startConnect, startUpgrade } from './connect.ts';

function nonce(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function demoConnect(
  h: IntegrationHarness,
  userId = USER_A,
  capabilities: ('mail_read' | 'calendar_read' | 'tasks_read')[] = [
    'mail_read',
    'calendar_read',
    'tasks_read',
  ],
) {
  const deviceNonce = nonce();
  const start = await startConnect(h.runtime, {
    userId,
    provider: 'demo',
    capabilities,
    deviceNonceHash: await sha256Hex(deviceNonce),
    locale: 'tr-TR',
  });
  const app = createOAuthApp({ runtime: h.runtime, demoEnabled: true, log: h.runtime.log });
  const authUrl = new URL(start.data.auth_url);
  const authorize = await app.request(`/oauth/demo/authorize${authUrl.search}`);
  assertEquals(authorize.status, 302);
  const callbackUrl = new URL(authorize.headers.get('Location') ?? '');
  const callback = await app.request(`/oauth/demo/callback${callbackUrl.search}`);
  assertEquals(callback.status, 302);
  assertEquals(callback.headers.get('Cache-Control'), 'no-store');
  assertEquals(callback.headers.get('Referrer-Policy'), 'no-referrer');
  const deepLink = new URL(callback.headers.get('Location') ?? '');
  return { start, deviceNonce, deepLink, app, callbackUrl, authUrl };
}

Deno.test(
  'demo connect: start → authorize → callback → complete (R-07), nothing syncs before completion',
  async () => {
    const h = await integrationHarness();
    const { start, deviceNonce, deepLink } = await demoConnect(h);
    assertEquals(start.data.callback_url, 'dijitalasistan://integrations/callback');
    assertEquals(
      `${deepLink.protocol}//${deepLink.host}${deepLink.pathname}`,
      'dijitalasistan://integrations/callback',
    );
    assertEquals(deepLink.searchParams.get('result'), 'pending_confirmation');
    assertEquals(deepLink.searchParams.get('provider'), 'demo');
    assertEquals(deepLink.searchParams.get('state_id'), start.data.state_id);
    const code = deepLink.searchParams.get('completion_code') ?? '';
    assertMatch(code, /^[A-Za-z0-9_-]{43}$/);
    // The redirect carries no token, e-mail or scope.
    assert(
      !deepLink.search.includes('demo-at') &&
        !deepLink.search.includes('@') &&
        !deepLink.search.includes('scope'),
    );

    const pending = [...h.store.accounts.values()][0];
    assertEquals(pending?.status, 'connecting');
    assert(pending?.pending_binding_until !== null);
    assertEquals([...h.jobs.jobs.values()].filter((j) => j.type === 'initial_sync').length, 0);
    // Credentials are ciphertext only.
    const refresh = h.store.credentials.get(`${pending?.id}:refresh`);
    assert(
      refresh !== undefined && !new TextDecoder().decode(refresh.ciphertext).includes('demo-rt'),
    );

    const done = await completeOAuth(h.runtime, {
      userId: USER_A,
      completionCode: code,
      deviceNonce,
      correlationId: crypto.randomUUID(),
    });
    assertEquals(done.result, 'success');
    assertEquals(done.account?.status, 'syncing');
    assertEquals(done.account?.provider, 'demo');
    assertEquals(new Set(done.granted), new Set(['mail_read', 'calendar_read', 'tasks_read']));
    assertEquals(done.missing, []);
    assertEquals(done.jobs.length, 3);
    const initial = [...h.jobs.jobs.values()].filter((j) => j.type === 'initial_sync');
    assertEquals(initial.map((j) => (j.payload as { resource: string }).resource).sort(), [
      'calendar',
      'mail',
      'tasks',
    ]);
    assertEquals(h.audit.filter((a) => a.action === 'user.integration.connected').length, 1);
    assertEquals(h.store.accounts.get(done.accountId ?? '')?.demo_flavor, 'google');

    // The completion code is single-use.
    await assertRejects(
      () =>
        completeOAuth(h.runtime, {
          userId: USER_A,
          completionCode: code,
          deviceNonce,
          correlationId: crypto.randomUUID(),
        }),
      AppError,
      'OAUTH_COMPLETION_INVALID',
    );
    assertEquals(h.store.accounts.get(done.accountId ?? '')?.status, 'syncing');
  },
);

Deno.test(
  'completion by another user, a wrong nonce or after 10 minutes → 403 and the pending account is purged',
  async () => {
    for (const variant of ['other_user', 'wrong_nonce', 'late'] as const) {
      const h = await integrationHarness();
      const { deviceNonce, deepLink } = await demoConnect(h);
      const code = deepLink.searchParams.get('completion_code') ?? '';
      if (variant === 'late')
        h.setNow(new Date(Date.parse('2026-09-24T07:30:00.000Z') + 10 * 60_000 + 1000));
      await assertRejects(
        () =>
          completeOAuth(h.runtime, {
            userId: variant === 'other_user' ? USER_B : USER_A,
            completionCode: code,
            deviceNonce: variant === 'wrong_nonce' ? nonce() : deviceNonce,
            correlationId: crypto.randomUUID(),
          }),
        AppError,
        'OAUTH_COMPLETION_INVALID',
      );
      assertEquals(h.store.accounts.size, 0, variant);
      assertEquals(h.store.credentials.size, 0, variant);
      assertEquals(
        [...h.jobs.jobs.values()].filter((j) => j.type === 'initial_sync').length,
        0,
        variant,
      );
      assert(
        h.audit.some((a) => a.action === 'security.oauth_completion_rejected'),
        variant,
      );
    }
  },
);

Deno.test('a replayed callback state → expired_state and a replay audit entry', async () => {
  const h = await integrationHarness();
  const { app, callbackUrl } = await demoConnect(h);
  const again = await app.request(`/oauth/demo/callback${callbackUrl.search}`);
  assertEquals(again.status, 302);
  assertEquals(
    new URL(again.headers.get('Location') ?? '').searchParams.get('result'),
    'expired_state',
  );
  assert(h.audit.some((a) => a.action === 'security.oauth_state_replay'));
});

Deno.test('an unknown state renders the localized 400 page', async () => {
  const h = await integrationHarness();
  const app = createOAuthApp({ runtime: h.runtime, demoEnabled: true, log: h.runtime.log });
  const res = await app.request(`/oauth/google/callback?state=${'A'.repeat(43)}&code=x`, {
    headers: { 'Accept-Language': 'tr-TR' },
  });
  assertEquals(res.status, 400);
  assertEquals(res.headers.get('Cache-Control'), 'no-store');
  const html = await res.text();
  assertStringIncludes(html, 'Bağlantı tamamlanamadı.');
  assertStringIncludes(html, 'Uygulamayı Aç');
  const missing = await app.request('/oauth/google/callback');
  assertEquals(missing.status, 400);
});

Deno.test('demo routes answer 404 when demo mode is off', async () => {
  const h = await integrationHarness();
  const app = createOAuthApp({ runtime: h.runtime, demoEnabled: false, log: h.runtime.log });
  assertEquals(
    (
      await app.request(
        `/oauth/demo/authorize?state=${'A'.repeat(43)}&code_challenge=${'B'.repeat(43)}`,
      )
    ).status,
    404,
  );
  assertEquals(
    (await app.request(`/oauth/demo/callback?state=${'A'.repeat(43)}&code=demo_x`)).status,
    404,
  );
});

Deno.test(
  'start: demo rejected without DEMO_MODE; Google without credentials → EXTERNAL_CREDENTIAL_REQUIRED',
  async () => {
    const h = await integrationHarness({ env: { DEMO_MODE: 'false' } });
    await assertRejects(
      () =>
        startConnect(h.runtime, {
          userId: USER_A,
          provider: 'demo',
          capabilities: ['mail_read'],
          deviceNonceHash: 'a'.repeat(64),
          locale: 'tr-TR',
        }),
      AppError,
      'FEATURE_DISABLED',
    );
    const err = await assertRejects(
      () =>
        startConnect(h.runtime, {
          userId: USER_A,
          provider: 'google',
          capabilities: ['mail_read'],
          deviceNonceHash: 'a'.repeat(64),
          locale: 'tr-TR',
        }),
      AppError,
    );
    assertEquals(err.code, 'EXTERNAL_CREDENTIAL_REQUIRED');
    assertEquals(
      (err.details?.credential_keys as string[]).includes('GOOGLE_OAUTH_CLIENT_ID'),
      true,
    );
  },
);

Deno.test(
  'start: Google without credentials in demo mode falls back to the demo flavour',
  async () => {
    const h = await integrationHarness();
    const out = await startConnect(h.runtime, {
      userId: USER_A,
      provider: 'microsoft',
      capabilities: ['mail_read'],
      deviceNonceHash: 'a'.repeat(64),
      locale: 'tr-TR',
    });
    const url = new URL(out.data.auth_url);
    assertEquals(url.pathname, '/functions/v1/oauth/demo/authorize');
    assertEquals(url.searchParams.get('flavor'), 'microsoft');
  },
);

const GOOGLE_ENV = {
  GOOGLE_OAUTH_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://api.example.test/functions/v1/oauth/google/callback',
};

Deno.test(
  'start (Google): S256, offline access, include_granted_scopes, exact scopes, nonce; the verifier is stored encrypted',
  async () => {
    const h = await integrationHarness({ env: GOOGLE_ENV });
    const out = await startConnect(h.runtime, {
      userId: USER_A,
      provider: 'google',
      capabilities: ['mail_read', 'calendar_read'],
      deviceNonceHash: 'b'.repeat(64),
      locale: 'tr-TR',
    });
    const url = new URL(out.data.auth_url);
    assertEquals(url.origin, 'https://accounts.google.com');
    assertEquals(url.searchParams.get('code_challenge_method'), 'S256');
    assertEquals(url.searchParams.get('access_type'), 'offline');
    assertEquals(url.searchParams.get('include_granted_scopes'), 'true');
    assertEquals(url.searchParams.get('prompt'), 'consent');
    assertEquals(url.searchParams.get('redirect_uri'), GOOGLE_ENV.GOOGLE_OAUTH_REDIRECT_URI);
    assertMatch(url.searchParams.get('nonce') ?? '', /^[A-Za-z0-9_-]{43}$/);
    const scopes = (url.searchParams.get('scope') ?? '').split(' ');
    assertEquals(scopes.includes('https://www.googleapis.com/auth/gmail.readonly'), true);
    assertEquals(scopes.includes('https://www.googleapis.com/auth/calendar.events.readonly'), true);
    assertEquals(
      scopes.some((s) => s.includes('gmail.send') || s.includes('gmail.modify')),
      false,
    );
    const state = h.store.states.get(out.data.state_id);
    assert(state !== undefined);
    assertEquals(state.purpose, 'connect');
    const stateValue = url.searchParams.get('state') ?? '';
    assertEquals(
      await sha256Hex(stateValue),
      [...state.state_hash].map((b) => b.toString(16).padStart(2, '0')).join(''),
    );
    assertNotEquals(state.code_verifier_ciphertext.byteLength, 0);
    assertEquals(state.device_nonce_hash.byteLength, 32);
    assertEquals(out.data.requested_scopes, state.requested_scopes);
  },
);

Deno.test(
  'start: a Free user with one mail account → ENTITLEMENT_REQUIRED (mail_accounts)',
  async () => {
    const h = await integrationHarness();
    h.store.planLimits.set(`${USER_A}:max_mail_accounts`, 1);
    h.store.addAccount({ user_id: USER_A, provider: 'demo', capabilities_granted: ['mail_read'] });
    const err = await assertRejects(
      () =>
        startConnect(h.runtime, {
          userId: USER_A,
          provider: 'demo',
          capabilities: ['mail_read'],
          deviceNonceHash: 'c'.repeat(64),
          locale: 'tr-TR',
        }),
      AppError,
    );
    assertEquals(err.code, 'ENTITLEMENT_REQUIRED');
    assertEquals(err.details, { feature: 'mail_accounts', limit: 1, current: 1 });
  },
);

Deno.test(
  'upgrade: already granted short-circuits; Google requests only the missing scopes; resume is validated',
  async () => {
    const h = await integrationHarness({ env: GOOGLE_ENV });
    const account = h.store.addAccount({
      user_id: USER_A,
      provider: 'google',
      account_email: 'yunus@gmail.com',
      capabilities_granted: ['mail_read'],
    });
    const granted = await startUpgrade(h.runtime, {
      userId: USER_A,
      accountId: account.id,
      capability: 'mail_read',
      deviceNonceHash: 'd'.repeat(64),
      locale: 'tr',
    });
    assertEquals(granted.data, { already_granted: true });

    const approvalId = crypto.randomUUID();
    h.store.approvals.set(approvalId, {
      id: approvalId,
      user_id: USER_A,
      action_type: 'calendar_create',
      status: 'pending',
      destination_account_id: account.id,
      requires_scope: 'calendar_write',
    });
    await assertRejects(
      () =>
        startUpgrade(h.runtime, {
          userId: USER_A,
          accountId: account.id,
          capability: 'mail_send',
          resumeApprovalId: approvalId,
          deviceNonceHash: 'd'.repeat(64),
          locale: 'tr',
        }),
      AppError,
      'VALIDATION_FAILED',
    );
    const up = await startUpgrade(h.runtime, {
      userId: USER_A,
      accountId: account.id,
      capability: 'mail_send',
      deviceNonceHash: 'd'.repeat(64),
      locale: 'tr',
    });
    assert(up.data.already_granted === false);
    if (up.data.already_granted === false) {
      const url = new URL(up.data.auth_url);
      const scopes = (url.searchParams.get('scope') ?? '').split(' ');
      assertEquals(scopes.includes('https://www.googleapis.com/auth/gmail.send'), true);
      assertEquals(scopes.includes('https://www.googleapis.com/auth/gmail.readonly'), false);
      assertEquals(url.searchParams.get('login_hint'), 'yunus@gmail.com');
      assertEquals(up.data.missing_scopes, ['https://www.googleapis.com/auth/gmail.send']);
      assertEquals(h.store.states.get(up.data.state_id)?.purpose, 'upgrade');
    }
    const disconnected = h.store.addAccount({
      user_id: USER_A,
      provider: 'google',
      status: 'disconnected',
    });
    await assertRejects(
      () =>
        startUpgrade(h.runtime, {
          userId: USER_A,
          accountId: disconnected.id,
          capability: 'mail_send',
          deviceNonceHash: 'd'.repeat(64),
          locale: 'tr',
        }),
      AppError,
      'STATE_CONFLICT',
    );
  },
);

Deno.test(
  'demo upgrade: the held token set is swapped in only at completion and requires_scope is cleared',
  async () => {
    const h = await integrationHarness();
    const first = await demoConnect(h, USER_A, ['mail_read']);
    const done = await completeOAuth(h.runtime, {
      userId: USER_A,
      completionCode: first.deepLink.searchParams.get('completion_code') ?? '',
      deviceNonce: first.deviceNonce,
      correlationId: crypto.randomUUID(),
    });
    const accountId = done.accountId ?? '';
    const oldRefresh = h.store.credentials.get(`${accountId}:refresh`);
    const approvalId = crypto.randomUUID();
    h.store.approvals.set(approvalId, {
      id: approvalId,
      user_id: USER_A,
      action_type: 'email_send',
      status: 'pending',
      destination_account_id: accountId,
      requires_scope: 'mail_send',
    });

    const deviceNonce = nonce();
    const up = await startUpgrade(h.runtime, {
      userId: USER_A,
      accountId,
      capability: 'mail_send',
      resumeApprovalId: approvalId,
      deviceNonceHash: await sha256Hex(deviceNonce),
      locale: 'tr',
    });
    assert(up.data.already_granted === false);
    if (up.data.already_granted !== false) return;
    const authUrl = new URL(up.data.auth_url);
    const authorize = await first.app.request(`/oauth/demo/authorize${authUrl.search}`);
    const cb = await first.app.request(
      `/oauth/demo/callback${new URL(authorize.headers.get('Location') ?? '').search}`,
    );
    const link = new URL(cb.headers.get('Location') ?? '');
    assertEquals(link.searchParams.get('result'), 'pending_confirmation');
    // Until completion the working credentials are untouched.
    assertEquals(
      h.store.credentials.get(`${accountId}:refresh`)?.ciphertext,
      oldRefresh?.ciphertext,
    );
    const upgraded = await completeOAuth(h.runtime, {
      userId: USER_A,
      completionCode: link.searchParams.get('completion_code') ?? '',
      deviceNonce,
      correlationId: crypto.randomUUID(),
    });
    assertEquals(upgraded.result, 'success');
    assertEquals(upgraded.resume, { approval_id: approvalId });
    assert(upgraded.granted.includes('mail_send'));
    assertEquals(h.store.approvals.get(approvalId)?.requires_scope, null);
    assertNotEquals(
      h.store.credentials.get(`${accountId}:refresh`)?.ciphertext,
      oldRefresh?.ciphertext,
    );
    assert(h.audit.some((a) => a.action === 'user.integration.scope_upgraded'));
  },
);

Deno.test(
  'an identity linked by another user → already_linked, reported only through the completion',
  async () => {
    const h = await integrationHarness();
    const demo = h.runtime.providers.resolve('demo').oauth as DemoOAuth;
    const subject = await demo.subjectFor(USER_B);
    h.store.addAccount({
      user_id: USER_A,
      provider: 'demo',
      provider_account_id: `demo-google-${subject}`,
      capabilities_granted: ['mail_read'],
    });
    const b = await demoConnect(h, USER_B, ['mail_read']);
    assertEquals(b.deepLink.searchParams.get('result'), 'pending_confirmation');
    assertEquals([...h.store.accounts.values()].filter((x) => x.user_id === USER_B).length, 0);
    const done = await completeOAuth(h.runtime, {
      userId: USER_B,
      completionCode: b.deepLink.searchParams.get('completion_code') ?? '',
      deviceNonce: b.deviceNonce,
      correlationId: crypto.randomUUID(),
    });
    assertEquals(done.result, 'already_linked');
    assertEquals(done.account, null);
    assertEquals(done.jobs, []);
  },
);
