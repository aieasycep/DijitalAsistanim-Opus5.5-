import { assert, assertEquals, assertFalse } from '@std/assert';
import { exportPKCS8, generateKeyPair, SignJWT } from 'jose';
import { decryptToken, encryptToken } from '../_shared/crypto/token-cipher.ts';
import { jsonResponse } from '../_shared/testing/fetch.ts';
import { USER_A } from '../_shared/testing/jwt.ts';
import { APPLE_TOKEN_ENDPOINT } from '../_shared/services/apple.ts';
import { call, createHarness } from './testing.ts';

const APPLE_SUB = '001234.abcdef0123456789abcdef0123456789.0712';
const REFRESH = 'r1a2b3c4d5e6f.0.abcd.refresh-token-from-apple';

async function appleEnv(): Promise<Record<string, string>> {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  return {
    APPLE_TEAM_ID: 'ABCDE12345',
    APPLE_SIWA_KEY_ID: 'KEY1234567',
    APPLE_SIWA_PRIVATE_KEY: (await exportPKCS8(privateKey)).replace(/\n/g, '\\n'),
    APPLE_SIWA_NATIVE_CLIENT_ID: 'com.dijitalasistan.app',
  };
}

async function idToken(sub: string): Promise<string> {
  const { privateKey } = await generateKeyPair('ES256');
  return await new SignJWT({ sub })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuer('https://appleid.apple.com')
    .sign(privateKey);
}

const body = { authorization_code: 'c1234567890abcdef.0.abcd', identity_token_sub: APPLE_SUB };

Deno.test(
  'apple exchange without SIWA credentials is 503 EXTERNAL_CREDENTIAL_REQUIRED and calls nobody',
  async () => {
    const h = await createHarness();
    const res = await call(h, 'POST', '/auth/apple/exchange', {
      jwt: await h.token(USER_A),
      key: crypto.randomUUID(),
      body,
    });
    assertEquals(res.status, 503);
    const error = (await res.json()).error;
    assertEquals(error.code, 'EXTERNAL_CREDENTIAL_REQUIRED');
    assertEquals(error.details.credential_keys, [
      'APPLE_TEAM_ID',
      'APPLE_SIWA_KEY_ID',
      'APPLE_SIWA_PRIVATE_KEY',
      'APPLE_SIWA_NATIVE_CLIENT_ID',
    ]);
    assertEquals(h.fetchCalls.length, 0);
  },
);

Deno.test(
  "a sub that is not the caller's Apple identity is 422 before Apple is called",
  async () => {
    const h = await createHarness({ env: await appleEnv() });
    h.appleSubs.set(USER_A, 'another-sub');
    const res = await call(h, 'POST', '/auth/apple/exchange', {
      jwt: await h.token(USER_A),
      key: crypto.randomUUID(),
      body,
    });
    assertEquals(res.status, 422);
    assertEquals((await res.json()).error.field_errors[0].path, 'identity_token_sub');
    assertEquals(h.fetchCalls.length, 0);
  },
);

Deno.test(
  'success: the refresh token is stored encrypted (AAD-bound), audited, and never echoed',
  async () => {
    const token = await idToken(APPLE_SUB);
    const h = await createHarness({
      env: await appleEnv(),
      fetch: () =>
        jsonResponse({
          access_token: 'a',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: REFRESH,
          id_token: token,
        }),
    });
    h.appleSubs.set(USER_A, APPLE_SUB);
    const res = await call(h, 'POST', '/auth/apple/exchange', {
      jwt: await h.token(USER_A),
      key: crypto.randomUUID(),
      body,
    });
    assertEquals(res.status, 200);
    const text = await res.text();
    assertEquals(JSON.parse(text).data, { stored: true });
    assertFalse(text.includes(REFRESH));

    const sent = h.fetchCalls[0];
    assertEquals(sent?.url, APPLE_TOKEN_ENDPOINT);
    const form = new URLSearchParams(sent?.body ?? '');
    assertEquals(form.get('grant_type'), 'authorization_code');
    assertEquals(form.get('client_id'), 'com.dijitalasistan.app');
    assert((form.get('client_secret') ?? '').split('.').length === 3);

    const record = h.credentials.rows[0];
    assert(record !== undefined);
    assertEquals(
      [record.provider, record.kind, record.connectedAccountId],
      ['apple_device', 'apple_siwa_refresh', null],
    );
    assertFalse(new TextDecoder().decode(record.ciphertext).includes('refresh-token'));
    const keyring = await h.deps.keyring();
    assertEquals(
      await decryptToken(keyring, record, {
        account: USER_A,
        provider: 'apple_device',
        kind: 'apple_siwa_refresh',
      }),
      REFRESH,
    );
    assertEquals(
      h.audit.map((a) => [a.action, a.targetType, a.result]),
      [['user.siwa_token.stored', 'oauth_credential', 'success']],
    );
  },
);

Deno.test(
  'invalid_grant with a stored credential answers stored:false; without one it is PROVIDER_REJECTED',
  async () => {
    const h = await createHarness({
      env: await appleEnv(),
      fetch: () => jsonResponse({ error: 'invalid_grant' }, 400),
    });
    h.appleSubs.set(USER_A, APPLE_SUB);
    const jwt = await h.token(USER_A);
    const rejected = await call(h, 'POST', '/auth/apple/exchange', {
      jwt,
      key: crypto.randomUUID(),
      body,
    });
    assertEquals(rejected.status, 422);
    const error = (await rejected.json()).error;
    assertEquals(
      [error.code, error.details.provider_reason],
      ['PROVIDER_REJECTED', 'invalid_grant'],
    );
    const keyring = await h.deps.keyring();
    const existing = await encryptToken(keyring, 'older-token', {
      account: USER_A,
      provider: 'apple_device',
      kind: 'apple_siwa_refresh',
    });
    await h.credentials.saveUserCredential(USER_A, 'apple_device', 'apple_siwa_refresh', existing);
    const reused = await call(h, 'POST', '/auth/apple/exchange', {
      jwt,
      key: crypto.randomUUID(),
      body,
    });
    assertEquals(reused.status, 200);
    assertEquals((await reused.json()).data, { stored: false });
  },
);

Deno.test(
  'an id_token for another subject is refused; Apple 5xx is PROVIDER_UNAVAILABLE',
  async () => {
    const wrong = await idToken('someone-else');
    const h = await createHarness({
      env: await appleEnv(),
      fetch: () => jsonResponse({ refresh_token: REFRESH, id_token: wrong }),
    });
    h.appleSubs.set(USER_A, APPLE_SUB);
    const res = await call(h, 'POST', '/auth/apple/exchange', {
      jwt: await h.token(USER_A),
      key: crypto.randomUUID(),
      body,
    });
    assertEquals(res.status, 422);
    await res.body?.cancel();
    assertEquals(h.credentials.rows.length, 0);
    const down = await createHarness({
      env: await appleEnv(),
      fetch: () => new Response('', { status: 503 }),
    });
    down.appleSubs.set(USER_A, APPLE_SUB);
    const unavailable = await call(down, 'POST', '/auth/apple/exchange', {
      jwt: await down.token(USER_A),
      key: crypto.randomUUID(),
      body,
    });
    assertEquals((await unavailable.json()).error.code, 'PROVIDER_UNAVAILABLE');
  },
);
