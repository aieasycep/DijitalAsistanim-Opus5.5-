/**
 * Privacy building blocks: SIWA revoke, RevenueCat customer delete, export sanitising, the sealed
 * confirmation address, batched Storage removal and the owner filter of every export read
 * (TEST_PLAN TST-EF-16, TST-EF-18, TST-EF-20).
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { decodeProtectedHeader } from 'jose';
import { toBase64 } from '../../crypto/encoding.ts';
import { loadKeyring } from '../../crypto/token-cipher.ts';
import { AppError } from '../../errors.ts';
import { testDb } from '../../testing/db.ts';
import { randomBase64 } from '../../testing/env.ts';
import { jsonResponse, stubFetch } from '../../testing/fetch.ts';
import { deleteRevenueCatCustomer } from '../billing/revenuecat.ts';
import { EXPORT_FILES, REDACTED, sanitizeValue } from './export.ts';
import { openNotifyEmail, sealNotifyEmail } from './notify-email.ts';
import { APPLE_REVOKE_ENDPOINT, appleRevokerFromEnv } from './providers.ts';
import { supabasePrivacyRepo } from './repo.ts';
import { type ObjectStore, removeInBatches } from './storage.ts';

const USER = '11111111-1111-4111-8111-111111111111';

async function applePem(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const body =
    toBase64(pkcs8)
      .match(/.{1,64}/g)
      ?.join('\n') ?? '';
  return (
    ['-----BEGIN', 'PRIVATE KEY-----'].join(' ') +
    `\n${body}\n` +
    ['-----END', 'PRIVATE KEY-----'].join(' ')
  );
}

Deno.test(
  'SIWA revoke posts the ES256 client secret and the refresh token; invalid_grant counts as revoked',
  async () => {
    assertEquals(appleRevokerFromEnv({}), null, 'no revoker without the Apple key');
    const stub = stubFetch((call) =>
      call.body?.includes('token=gone') === true
        ? jsonResponse({ error: 'invalid_grant' }, 400)
        : call.body?.includes('token=down') === true
          ? new Response('', { status: 503 })
          : new Response('', { status: 200 }),
    );
    const revoker = appleRevokerFromEnv(
      {
        APPLE_TEAM_ID: 'TEAM123456',
        APPLE_SIWA_KEY_ID: 'KEY1234567',
        APPLE_SIWA_PRIVATE_KEY: await applePem(),
        APPLE_SIWA_NATIVE_CLIENT_ID: 'com.dijitalasistan.app',
      },
      { fetch: stub.fetch },
    );
    assert(revoker !== null);
    assertEquals(await revoker.revoke('refresh-1'), 'revoked');
    const call = stub.calls[0];
    assertEquals(call?.url, APPLE_REVOKE_ENDPOINT);
    const form = new URLSearchParams(call?.body ?? '');
    assertEquals(form.get('client_id'), 'com.dijitalasistan.app');
    assertEquals(form.get('token'), 'refresh-1');
    assertEquals(form.get('token_type_hint'), 'refresh_token');
    assertEquals(decodeProtectedHeader(form.get('client_secret') ?? '').alg, 'ES256');
    assertEquals(await revoker.revoke('gone'), 'revoked');
    const error = await assertRejects(() => revoker.revoke('down'), AppError);
    assertEquals([error.code, error.retryable], ['PROVIDER_UNAVAILABLE', true]);
  },
);

Deno.test(
  'RevenueCat customer delete: DELETE v2 customer; 404 not_found; 429 honours Retry-After',
  async () => {
    const stub = stubFetch((call) =>
      call.url.endsWith('/missing')
        ? new Response('', { status: 404 })
        : call.url.endsWith('/busy')
          ? new Response('', { status: 429, headers: { 'Retry-After': '42' } })
          : new Response(null, { status: 204 }),
    );
    const options = {
      config: { projectId: 'proj1', secretKey: 'rc-key', entitlementLookupKey: 'pro' },
      fetch: stub.fetch,
    };
    assertEquals(await deleteRevenueCatCustomer(options, USER), 'deleted');
    assertEquals(stub.calls[0]?.method, 'DELETE');
    assertEquals(
      stub.calls[0]?.url,
      `https://api.revenuecat.com/v2/projects/proj1/customers/${USER}`,
    );
    assertEquals(await deleteRevenueCatCustomer(options, 'missing'), 'not_found');
    const limited = await assertRejects(() => deleteRevenueCatCustomer(options, 'busy'), AppError);
    assertEquals([limited.code, limited.headers['Retry-After']], ['PROVIDER_RATE_LIMITED', '42']);
  },
);

Deno.test(
  'export sanitising drops secret keys and redacts token-shaped values at any depth',
  () => {
    const refresh = ['1', '', 'Oa3F7yZr9Kq2Lm5Nx8Pw1Tv4Hb6Jc0Gd'].join('/');
    const clean = sanitizeValue({
      title: 'Teklif',
      access_token: 'x',
      nested: { note: refresh, content_hash: 'ab', list: [{ api_key: 'k', ok: 1 }] },
    });
    assertEquals(clean, { title: 'Teklif', nested: { note: REDACTED, list: [{ ok: 1 }] } });
    for (const file of EXPORT_FILES) {
      for (const column of file.source.columns.split(',')) {
        assert(!/token|secret|cipher|hash|embedding|cursor/.test(column), `${file.name}.${column}`);
      }
    }
  },
);

Deno.test('the confirmation address is sealed to its request and opens only for it', async () => {
  const keyring = await loadKeyring({
    token_encryption_keys: { 1: randomBase64(32) },
    TOKEN_ENC_ACTIVE_VERSION: 1,
  });
  const sealed = await sealNotifyEmail(keyring, 'req-1', 'yunus@example.com');
  assertEquals(sealed[0], 1);
  assert(!new TextDecoder().decode(sealed).includes('yunus'));
  assertEquals(await openNotifyEmail(keyring, 'req-1', sealed), 'yunus@example.com');
  await assertRejects(() => openNotifyEmail(keyring, 'req-2', sealed));
});

Deno.test('Storage objects are removed in batches of 100', async () => {
  const batches: number[] = [];
  const store: ObjectStore = {
    upload: () => Promise.resolve(),
    remove: (_bucket, paths) => Promise.resolve((batches.push(paths.length), paths.length)),
    list: () => Promise.resolve([]),
    signedUrl: () => Promise.resolve(''),
  };
  const paths = Array.from({ length: 250 }, (_, i) => `${USER}/c/${i}.jpg`);
  assertEquals(await removeInBatches(store, 'captures', [...paths, paths[0] as string]), 250);
  assertEquals(batches, [100, 100, 50]);
});

Deno.test('every export read is filtered by the verified owner (TST-EF-20)', async () => {
  const stub = stubFetch(() => jsonResponse([]));
  const repo = supabasePrivacyRepo(testDb(stub.fetch));
  const insights = EXPORT_FILES.find((f) => f.name === 'insights.json');
  const referrals = EXPORT_FILES.find((f) => f.name === 'referrals.json');
  const audit = EXPORT_FILES.find((f) => f.name === 'audit_events.json');
  assert(insights !== undefined && referrals !== undefined && audit !== undefined);
  await repo.readRows(insights.source, USER, 0, 1000);
  await repo.readRows(referrals.source, USER, 1000, 1000);
  await repo.readRows(audit.source, USER, 0, 1000);
  const [a, b, c] = stub.calls.map((call) => new URL(call.url));
  assertEquals(a?.searchParams.get('user_id'), `eq.${USER}`);
  assert(!(a?.searchParams.get('select') ?? '').includes('*'));
  assertEquals([a?.searchParams.get('offset'), a?.searchParams.get('limit')], ['0', '1000']);
  assertEquals(b?.searchParams.get('or'), `(referrer_id.eq.${USER},referee_id.eq.${USER})`);
  assertEquals(b?.searchParams.get('offset'), '1000');
  assertEquals(c?.searchParams.get('target_user_id'), `eq.${USER}`);
});
