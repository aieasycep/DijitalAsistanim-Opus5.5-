/**
 * THR-01 Token theft (SECURITY_AND_PRIVACY_PLAN §2 THR-01, CTL-3.3, CTL-3.14; TEST_PLAN TST-EF-04,
 * TST-EF-14). Through the merged connect flow (`api` start → `oauth` authorize/callback → `api`
 * completion) provider tokens exist only as AES-256-GCM ciphertext bound by the AAD
 * `v1|{account}|{provider}|{kind}`; a row moved to another account, provider or kind never
 * decrypts, and no token, OAuth code, PKCE verifier, state or completion code reaches a response,
 * a redirect, an audit row, a job payload or a log line.
 */
import { assert, assertEquals, assertFalse, assertRejects } from '@std/assert';
import { toBase64Url } from '../../_shared/crypto/encoding.ts';
import { sha256Hex } from '../../_shared/crypto/hmac.ts';
import { decryptToken, encryptToken, TokenCipherError } from '../../_shared/crypto/token-cipher.ts';
import { createLogger, memorySink } from '../../_shared/logging/logger.ts';
import { createTokenSource } from '../../_shared/providers/token-source.ts';
import { demoConsent, integrationHarness } from '../../_shared/testing/integrations.ts';
import { USER_A, USER_B } from '../../_shared/testing/jwt.ts';
import { createApiApp } from '../../api/app.ts';
import { call, createHarness } from '../../api/testing.ts';
import { createOAuthApp } from '../../oauth/app.ts';

function nonce(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Runs the full demo connect for `userId` and returns every artefact an attacker could observe. */
async function connectThroughApi(userId = USER_A) {
  const ih = await integrationHarness();
  const base = await createHarness({ integrations: ih.runtime });
  const apiSink = memorySink();
  const app = createApiApp({
    ...base.deps,
    log: createLogger({ fn: 'api', sink: apiSink.sink }),
  });
  const h = { ...base, app };
  const jwt = await h.token(userId);
  const observed: string[] = [];
  const deviceNonce = nonce();

  const start = await call(h, 'POST', '/integrations/demo/start', {
    jwt,
    key: crypto.randomUUID(),
    body: {
      capabilities: ['mail_read', 'calendar_read'],
      device_nonce_hash: await sha256Hex(deviceNonce),
    },
  });
  assertEquals(start.status, 200);
  // The start response carries the auth URL (with the state) to the app; it is not "observed".
  const startText = await start.text();
  const authUrl = new URL(JSON.parse(startText).data.auth_url);

  const oauth = createOAuthApp({ runtime: ih.runtime, demoEnabled: true, log: ih.runtime.log });
  const authorize = await demoConsent(oauth, authUrl);
  assertEquals(authorize.status, 302);
  const callbackUrl = new URL(authorize.headers.get('Location') ?? '');
  const callback = await oauth.request(`/oauth/demo/callback${callbackUrl.search}`);
  assertEquals(callback.status, 302);
  const deepLink = new URL(callback.headers.get('Location') ?? '');
  observed.push(deepLink.href, await callback.text());
  const completionCode = deepLink.searchParams.get('completion_code') ?? '';

  const complete = await call(h, 'POST', '/integrations/oauth/complete', {
    jwt,
    key: crypto.randomUUID(),
    body: { completion_code: completionCode, device_nonce: deviceNonce },
  });
  assertEquals(complete.status, 200);
  const completeText = await complete.text();
  observed.push(completeText);
  const accountId = JSON.parse(completeText).data.account.id as string;

  return {
    ih,
    h,
    jwt,
    accountId,
    observed,
    apiLines: apiSink.lines,
    secrets: {
      state: authUrl.searchParams.get('state') ?? '',
      code: callbackUrl.searchParams.get('code') ?? '',
      completionCode,
      deviceNonce,
    },
  };
}

Deno.test(
  'THR-01: after a full connect the tokens are account-bound ciphertext and appear in no response, redirect, audit row, job or log',
  async () => {
    const s = await connectThroughApi();
    const account = s.ih.store.accounts.get(s.accountId);
    assert(account !== undefined);
    const plaintexts: string[] = [];
    for (const kind of ['refresh', 'access'] as const) {
      const row = s.ih.store.credentials.get(`${s.accountId}:${kind}`);
      assert(row !== undefined, `${kind} credential stored`);
      const binding = { account: s.accountId, provider: account.provider, kind };
      const plain = await decryptToken(s.ih.keyring, row, binding);
      assert(plain.length > 8);
      plaintexts.push(plain);
      assertFalse(new TextDecoder().decode(row.ciphertext).includes(plain), 'ciphertext only');
      // Bound to this account, provider and kind: any other binding is refused.
      for (const other of [
        { ...binding, account: crypto.randomUUID() },
        { ...binding, provider: 'google' },
        { ...binding, kind: kind === 'refresh' ? ('access' as const) : ('refresh' as const) },
      ]) {
        const error = await assertRejects(
          () => decryptToken(s.ih.keyring, row, other),
          TokenCipherError,
        );
        assertEquals(error.reason, 'aad_mismatch');
      }
    }

    const surfaces = [
      ...s.observed,
      ...s.ih.logLines,
      ...s.apiLines,
      JSON.stringify(s.ih.audit),
      JSON.stringify([...s.ih.jobs.jobs.values()].map((j) => j.payload)),
      JSON.stringify([...s.ih.store.accounts.values()]),
    ].join('\n');
    for (const secret of [...plaintexts, s.secrets.code, s.secrets.deviceNonce]) {
      assert(secret.length > 0);
      assertFalse(surfaces.includes(secret), 'a token or flow secret leaked');
    }
    // The state (in the auth URL) and the completion code (in the app deep link) travel once to
    // the app; neither is ever logged, audited or queued.
    const logsAndAudit = [
      ...s.ih.logLines,
      ...s.apiLines,
      JSON.stringify(s.ih.audit),
      JSON.stringify([...s.ih.jobs.jobs.values()].map((j) => j.payload)),
    ].join('\n');
    assertFalse(logsAndAudit.includes(s.secrets.completionCode));
    assertFalse(logsAndAudit.includes(s.secrets.state));
    assertFalse(/ciphertext|refresh_token|access_token/.test(s.observed.join('\n')));
  },
);

Deno.test(
  'THR-01: a credential row transplanted onto another account never yields a token (the token source fails closed)',
  async () => {
    const h = await integrationHarness();
    const victim = h.store.addAccount({ user_id: USER_A, provider: 'demo' });
    const attacker = h.store.addAccount({ user_id: USER_B, provider: 'demo' });
    const stolen = await encryptToken(h.keyring, 'victim-access-token-value', {
      account: victim.id,
      provider: 'demo',
      kind: 'access',
    });
    await h.store.saveCredential(victim, {
      kind: 'access',
      token: stolen,
      accessExpiresAt: new Date(h.runtime.now().getTime() + 3_600_000).toISOString(),
      scopeSnapshot: null,
    });
    const row = h.store.credentials.get(`${victim.id}:access`);
    assert(row !== undefined);
    // An attacker with write access to the table copies the victim's row onto their own account.
    h.store.credentials.set(`${attacker.id}:access`, { ...row, connected_account_id: attacker.id });
    const refreshCalls: string[] = [];
    const source = createTokenSource({
      store: h.store,
      keyring: h.keyring,
      oauth: {
        provider: 'demo',
        refresh: () => {
          refreshCalls.push('refresh');
          return Promise.reject(new Error('no refresh token for the attacker'));
        },
      } as never,
      account: attacker,
      owner: 'security-test',
      now: h.runtime.now,
      sleep: () => Promise.resolve(),
    });
    const error = await assertRejects(() => source.get(), TokenCipherError);
    assertEquals(error.reason, 'aad_mismatch');
    assertEquals(refreshCalls, []);
    // The victim's own source still works with the untouched row.
    const own = createTokenSource({
      store: h.store,
      keyring: h.keyring,
      oauth: {} as never,
      account: victim,
      owner: 'security-test',
      now: h.runtime.now,
    });
    assertEquals(await own.get(), 'victim-access-token-value');
  },
);

Deno.test(
  'THR-01 / CTL-3.14: credential fields logged by name are redacted, including the PKCE verifier, state, code and completion code',
  () => {
    const sink = memorySink();
    const log = createLogger({ fn: 'oauth', sink: sink.sink });
    // 43-character base64url values: shorter than the generic long-run scrubber (48).
    const verifier = nonce();
    const state = nonce();
    const completion = nonce();
    const code = '4/0AVG7fiQshortcode';
    const secret = 'GOCSPX-client-secret-value';
    const jwt = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl';
    log.warn('oauth_debug_attempt', {
      code,
      code_verifier: verifier,
      state,
      client_secret: secret,
      completion_code: completion,
      device_nonce: verifier,
      signature: 'sig-value-123',
      'set-cookie': 'sb-access-token=abc',
      nested: { refresh_token: '1//refresh', access_token: 'ya29.access', id_token: jwt },
      note: `Bearer ya29.access-token-in-free-text ${jwt}`,
    });
    const line = sink.lines.join('\n');
    for (const value of [
      verifier,
      state,
      completion,
      code,
      secret,
      'sig-value-123',
      'sb-access-token=abc',
      '1//refresh',
      'ya29.access',
      jwt,
    ]) {
      assertFalse(line.includes(value), `logged: ${value.slice(0, 12)}`);
    }
  },
);
