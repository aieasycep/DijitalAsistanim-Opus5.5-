/**
 * THR-04 OAuth misconfiguration (SECURITY_AND_PRIVACY_PLAN §2 THR-04, CTL-3.2; R-01, R-07;
 * TEST_PLAN TST-EF-01/02/03). Through the merged `startConnect` → `oauth` callback →
 * `completeOAuth` path:
 * - PKCE S256 on every Google flow: the verifier sent to the token endpoint hashes to the challenge
 *   of the authorization URL, is fresh per flow and never appears in the URL, a redirect or a log;
 * - state is single-use, expires after 10 minutes and is bound to its provider;
 * - the callback redirect target is fixed (no attacker-chosen return URL);
 * - the completion (R-07) is bound to the initiating user and device nonce, is single-use, and an
 *   identity already linked by another user is never attached.
 * The SQL side (hashed single-use state, the 10-minute binding window) is covered by
 * `supabase/tests/database/20260924002000_integrations_runtime.test.sql`.
 */
import { assert, assertEquals, assertFalse, assertMatch, assertRejects } from '@std/assert';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { sha256, sha256Hex } from '../../_shared/crypto/hmac.ts';
import { toBase64Url } from '../../_shared/crypto/encoding.ts';
import { AppError } from '../../_shared/errors.ts';
import { jsonResponse, type RecordedCall } from '../../_shared/testing/fetch.ts';
import { integrationHarness, type IntegrationHarness } from '../../_shared/testing/integrations.ts';
import { USER_A, USER_B } from '../../_shared/testing/jwt.ts';
import { completeOAuth, startConnect } from '../../_shared/services/integrations/connect.ts';
import { DemoOAuth } from '../../_shared/providers/demo/auth.ts';
import { createOAuthApp } from '../../oauth/app.ts';
import oauthFixture from '../../_shared/providers/google/__fixtures__/oauth.json' with { type: 'json' };

const GOOGLE_ENV = {
  GOOGLE_OAUTH_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://api.example.test/functions/v1/oauth/google/callback',
};
const APP_CALLBACK = 'dijitalasistan://integrations/callback';

function nonce(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** A Google harness whose token endpoint answers with an id_token for the flow's OIDC nonce. */
async function googleHarness() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(publicKey)), kid: 'g1', alg: 'RS256', use: 'sig' }],
  });
  const flow = { oidcNonce: '' };
  const tokenCalls: RecordedCall[] = [];
  const h = await integrationHarness({
    env: { ...GOOGLE_ENV, DEMO_MODE: 'false' },
    googleJwks: jwks,
    fetch: async (call) => {
      const url = new URL(call.url);
      if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/token') {
        tokenCalls.push(call);
        const now = Math.floor(Date.parse('2026-09-24T07:30:00.000Z') / 1000);
        const idToken = await new SignJWT({
          sub: '1098765432109876543',
          email: 'yunus@gmail.com',
          email_verified: true,
          nonce: flow.oidcNonce,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'g1' })
          .setIssuer('https://accounts.google.com')
          .setAudience(GOOGLE_ENV.GOOGLE_OAUTH_CLIENT_ID)
          .setIssuedAt(now)
          .setExpirationTime(now + 3600)
          .sign(privateKey);
        return jsonResponse({ ...oauthFixture.token_response, id_token: idToken });
      }
      return new Response('unexpected', { status: 599 });
    },
  });
  return { h, flow, tokenCalls };
}

async function startGoogle(h: IntegrationHarness, userId = USER_A) {
  const deviceNonce = nonce();
  const start = await startConnect(h.runtime, {
    userId,
    provider: 'google',
    capabilities: ['mail_read', 'calendar_read'],
    deviceNonceHash: await sha256Hex(deviceNonce),
    locale: 'tr-TR',
  });
  return { authUrl: new URL(start.data.auth_url), deviceNonce, stateId: start.data.state_id };
}

async function demoFlow(h: IntegrationHarness, userId = USER_A) {
  const deviceNonce = nonce();
  const start = await startConnect(h.runtime, {
    userId,
    provider: 'demo',
    capabilities: ['mail_read'],
    deviceNonceHash: await sha256Hex(deviceNonce),
    locale: 'tr-TR',
  });
  const app = createOAuthApp({ runtime: h.runtime, demoEnabled: true, log: h.runtime.log });
  const authUrl = new URL(start.data.auth_url);
  const authorize = await app.request(`/oauth/demo/authorize${authUrl.search}`);
  const callbackUrl = new URL(authorize.headers.get('Location') ?? '');
  return { app, deviceNonce, callbackUrl, authUrl };
}

Deno.test(
  'THR-04: Google PKCE S256 — the exchanged verifier matches the challenge, is fresh per flow and never leaves the server',
  async () => {
    const { h, flow, tokenCalls } = await googleHarness();
    const first = await startGoogle(h);
    const second = await startGoogle(h);
    assertEquals(first.authUrl.searchParams.get('code_challenge_method'), 'S256');
    const challenge = first.authUrl.searchParams.get('code_challenge') ?? '';
    assertMatch(challenge, /^[A-Za-z0-9_-]{43}$/);
    assert(challenge !== second.authUrl.searchParams.get('code_challenge'), 'fresh per flow');
    assertEquals(first.authUrl.searchParams.get('response_type'), 'code', 'no implicit flow');
    assertEquals(
      first.authUrl.searchParams.get('redirect_uri'),
      GOOGLE_ENV.GOOGLE_OAUTH_REDIRECT_URI,
      'the exact registered redirect',
    );

    flow.oidcNonce = first.authUrl.searchParams.get('nonce') ?? '';
    const app = createOAuthApp({ runtime: h.runtime, demoEnabled: false, log: h.runtime.log });
    const state = first.authUrl.searchParams.get('state') ?? '';
    const callback = await app.request(
      `/oauth/google/callback?state=${state}&code=4%2F0AVG7fiQ-test-code&scope=openid`,
    );
    assertEquals(callback.status, 302);
    const deepLink = new URL(callback.headers.get('Location') ?? '');
    assertEquals(deepLink.searchParams.get('result'), 'pending_confirmation');

    assertEquals(tokenCalls.length, 1);
    const form = new URLSearchParams(tokenCalls[0]?.body ?? '');
    assertEquals(form.get('grant_type'), 'authorization_code');
    const verifier = form.get('code_verifier') ?? '';
    assertMatch(verifier, /^[A-Za-z0-9._~-]{43,128}$/);
    assertEquals(toBase64Url(await sha256(verifier)), challenge, 'S256(verifier) = challenge');
    const everything = [
      first.authUrl.href,
      deepLink.href,
      ...h.logLines,
      JSON.stringify(h.audit),
      JSON.stringify([...h.store.states.values()].map((s) => ({ ...s, state_hash: null }))),
    ].join('\n');
    assertFalse(everything.includes(verifier), 'the verifier is never exposed or stored in clear');
    assertFalse(everything.includes('1//test-refresh-token'));

    // The completion of the Google flow is bound like any other (R-07).
    const done = await completeOAuth(h.runtime, {
      userId: USER_A,
      completionCode: deepLink.searchParams.get('completion_code') ?? '',
      deviceNonce: first.deviceNonce,
      correlationId: crypto.randomUUID(),
    });
    assertEquals(done.result, 'success');
    assertEquals(done.account?.provider, 'google');
  },
);

Deno.test(
  'THR-04: a replayed, expired or cross-provider state never reaches the token endpoint',
  async () => {
    // Replay: the state is consumed by the first callback.
    {
      const { h, flow, tokenCalls } = await googleHarness();
      const s = await startGoogle(h);
      flow.oidcNonce = s.authUrl.searchParams.get('nonce') ?? '';
      const app = createOAuthApp({ runtime: h.runtime, demoEnabled: false, log: h.runtime.log });
      const url = `/oauth/google/callback?state=${s.authUrl.searchParams.get('state')}&code=c1`;
      assertEquals((await app.request(url)).status, 302);
      const replay = await app.request(url);
      assertEquals(
        new URL(replay.headers.get('Location') ?? '').searchParams.get('result'),
        'expired_state',
      );
      assertEquals(tokenCalls.length, 1, 'the replay made no second exchange');
      assert(h.audit.some((a) => a.action === 'security.oauth_state_replay'));
    }
    // Expiry: 10 minutes after the start the state is dead.
    {
      const { h, tokenCalls } = await googleHarness();
      const s = await startGoogle(h);
      h.setNow(new Date(Date.parse('2026-09-24T07:30:00.000Z') + 10 * 60_000 + 1_000));
      const app = createOAuthApp({ runtime: h.runtime, demoEnabled: false, log: h.runtime.log });
      const res = await app.request(
        `/oauth/google/callback?state=${s.authUrl.searchParams.get('state')}&code=late`,
      );
      assertEquals(
        new URL(res.headers.get('Location') ?? '').searchParams.get('result'),
        'expired_state',
      );
      assertEquals(tokenCalls.length, 0);
      assertEquals([...h.store.accounts.values()].length, 0);
    }
    // Cross-provider: a Google state presented on the Microsoft callback is refused.
    {
      const { h, tokenCalls } = await googleHarness();
      const s = await startGoogle(h);
      const app = createOAuthApp({ runtime: h.runtime, demoEnabled: false, log: h.runtime.log });
      const res = await app.request(
        `/oauth/microsoft/callback?state=${s.authUrl.searchParams.get('state')}&code=mixed`,
      );
      const result = new URL(res.headers.get('Location') ?? '').searchParams.get('result');
      assertEquals(result, 'expired_state');
      assertEquals(tokenCalls.length, 0);
      const again = await app.request(
        `/oauth/google/callback?state=${s.authUrl.searchParams.get('state')}&code=after-mix`,
      );
      assertEquals(
        new URL(again.headers.get('Location') ?? '').searchParams.get('result'),
        'expired_state',
        'the mixed-up state is burnt',
      );
      assertEquals(tokenCalls.length, 0);
    }
  },
);

Deno.test(
  'THR-04: the callback redirect is always the app deep link — injected return URLs are ignored',
  async () => {
    const h = await integrationHarness();
    const { app, callbackUrl } = await demoFlow(h);
    const evil = new URL(callbackUrl.href);
    for (const key of ['redirect_uri', 'return_to', 'next', 'continue']) {
      evil.searchParams.set(key, 'https://evil.example/steal');
    }
    const res = await app.request(`/oauth/demo/callback${evil.search}`);
    assertEquals(res.status, 302);
    const location = res.headers.get('Location') ?? '';
    assert(location.startsWith(`${APP_CALLBACK}?`), location);
    assertFalse(location.includes('evil.example'));
    assertEquals(res.headers.get('Referrer-Policy'), 'no-referrer');
    assertEquals(res.headers.get('Cache-Control'), 'no-store');
  },
);

Deno.test(
  'THR-04 / R-07: completion with a wrong nonce, by another user or with a reused code is rejected and nothing is attached',
  async () => {
    for (const variant of ['wrong_nonce', 'other_user', 'reused'] as const) {
      const h = await integrationHarness();
      const { app, callbackUrl, deviceNonce } = await demoFlow(h);
      const cb = await app.request(`/oauth/demo/callback${callbackUrl.search}`);
      const code = new URL(cb.headers.get('Location') ?? '').searchParams.get('completion_code');
      assert(code !== null);
      if (variant === 'reused') {
        const ok = await completeOAuth(h.runtime, {
          userId: USER_A,
          completionCode: code,
          deviceNonce,
          correlationId: crypto.randomUUID(),
        });
        assertEquals(ok.result, 'success');
      }
      const before = h.store.accounts.size;
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
      assertFalse(
        [...h.store.accounts.values()].some((a) => a.user_id === USER_B),
        `${variant}: nothing attached to the attacker`,
      );
      if (variant !== 'reused') {
        assertEquals(h.store.accounts.size, 0, `${variant}: the pending account is purged`);
        assertEquals(h.store.credentials.size, 0, `${variant}: its tokens are purged`);
      } else {
        assertEquals(h.store.accounts.size, before);
      }
    }
  },
);

Deno.test(
  'THR-04 / R-01: an identity already linked by another user is never attached to the attacker (already_linked)',
  async () => {
    const h = await integrationHarness();
    const demo = h.runtime.providers.resolve('demo').oauth as DemoOAuth;
    // The victim (A) owns the mailbox the attacker (B) now authorizes with.
    h.store.addAccount({
      user_id: USER_A,
      provider: 'demo',
      provider_account_id: `demo-google-${await demo.subjectFor(USER_B)}`,
      capabilities_granted: ['mail_read'],
    });
    const { app, callbackUrl, deviceNonce } = await demoFlow(h, USER_B);
    const cb = await app.request(`/oauth/demo/callback${callbackUrl.search}`);
    const done = await completeOAuth(h.runtime, {
      userId: USER_B,
      completionCode:
        new URL(cb.headers.get('Location') ?? '').searchParams.get('completion_code') ?? '',
      deviceNonce,
      correlationId: crypto.randomUUID(),
    });
    assertEquals(done.result, 'already_linked');
    assertEquals(done.account, null);
    assertEquals([...h.store.accounts.values()].filter((a) => a.user_id === USER_B).length, 0);
    assertEquals([...h.jobs.jobs.values()].filter((j) => j.type === 'initial_sync').length, 0);
  },
);
