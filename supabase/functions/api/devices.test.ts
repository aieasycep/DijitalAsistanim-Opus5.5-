import { assert, assertEquals } from '@std/assert';
import { ADMIN_ID, USER_A, USER_B } from '../_shared/testing/jwt.ts';
import { call, createHarness } from './testing.ts';

const INSTALLATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';

function registerBody(overrides: Record<string, unknown> = {}) {
  return {
    installation_id: INSTALLATION,
    platform: 'ios',
    os_version: '18.1',
    app_version: '1.4.0',
    build_number: '812',
    locale: 'tr-TR',
    timezone: 'Europe/Istanbul',
    push: { permission: 'granted', expo_push_token: TOKEN_A },
    device_fingerprint_hash: null,
    ...overrides,
  };
}

const ROUTES: [string, string][] = [
  ['POST', '/devices/register'],
  ['POST', '/devices/unregister'],
  ['POST', '/auth/apple/exchange'],
  ['GET', '/me/bootstrap'],
  ['GET', '/me/entitlements'],
  ['POST', '/analytics/events'],
  ['POST', '/support/tickets'],
  ['POST', '/feedback'],
];

Deno.test(
  'every api route requires a user token (401 AUTH_REQUIRED) and refuses admin identities (403)',
  async () => {
    const h = await createHarness();
    const admin = await h.token(ADMIN_ID, { aal: 'aal2', app_metadata: { da_kind: 'admin' } });
    for (const [method, path] of ROUTES) {
      const anonymous = await call(h, method, path, {
        body: method === 'POST' ? {} : undefined,
        key: crypto.randomUUID(),
      });
      assertEquals(anonymous.status, 401, path);
      assertEquals((await anonymous.json()).error.code, 'AUTH_REQUIRED');
      const adminRes = await call(h, method, path, {
        jwt: admin,
        body: method === 'POST' ? {} : undefined,
        key: crypto.randomUUID(),
      });
      assertEquals(adminRes.status, 403, path);
      assertEquals((await adminRes.json()).error.details.reason, 'admin_identity');
    }
  },
);

Deno.test('unknown routes answer the NOT_FOUND envelope; browser origins are refused', async () => {
  const h = await createHarness();
  const jwt = await h.token(USER_A);
  const missing = await call(h, 'GET', '/briefings/today', { jwt });
  assertEquals(missing.status, 404);
  const body = await missing.json();
  assertEquals(body.error.code, 'NOT_FOUND');
  assert(typeof body.error.correlation_id === 'string');
  const browser = await call(h, 'GET', '/me/bootstrap', {
    jwt,
    headers: { Origin: 'https://evil.example' },
  });
  assertEquals(browser.status, 403);
  await browser.body?.cancel();
});

Deno.test(
  'POST /devices/register stores the installation and token; a replayed key writes nothing twice',
  async () => {
    const h = await createHarness();
    const jwt = await h.token(USER_A);
    const key = crypto.randomUUID();
    const res = await call(h, 'POST', '/devices/register', { jwt, key, body: registerBody() });
    assertEquals(res.status, 200);
    assertEquals((await res.json()).data, {
      installation_id: INSTALLATION,
      push_enabled: true,
      rebound_from_other_user: false,
      timezone_applied: false,
    });
    const stored = h.devices.installations.get(INSTALLATION);
    assertEquals(stored?.user_id, USER_A);
    assert(stored?.device_hash.startsWith('\\x'));
    assertEquals(
      h.devices.tokens.map((t) => [t.user_id, t.status]),
      [[USER_A, 'active']],
    );
    const replay = await call(h, 'POST', '/devices/register', { jwt, key, body: registerBody() });
    assertEquals(replay.status, 200);
    assertEquals(replay.headers.get('Idempotency-Replayed'), 'true');
    assertEquals((await replay.json()).data.push_enabled, true);
    assertEquals(h.devices.upserts(), 1);
  },
);

Deno.test(
  'register validates the body (422 with field errors) and requires an Idempotency-Key',
  async () => {
    const h = await createHarness();
    const jwt = await h.token(USER_A);
    const bad = await call(h, 'POST', '/devices/register', {
      jwt,
      key: crypto.randomUUID(),
      body: registerBody({ platform: 'windows', timezone: 'Mars/Base' }),
    });
    assertEquals(bad.status, 422);
    const body = await bad.json();
    assertEquals(body.error.code, 'VALIDATION_FAILED');
    const paths = (body.error.field_errors as { path: string }[]).map((f) => f.path);
    assert(paths.includes('platform'));
    assert(paths.includes('timezone'));
    const denied = await call(h, 'POST', '/devices/register', {
      jwt,
      key: crypto.randomUUID(),
      body: registerBody({ push: { permission: 'denied', expo_push_token: TOKEN_A } }),
    });
    assertEquals(denied.status, 422);
    await denied.body?.cancel();
    const noKey = await call(h, 'POST', '/devices/register', { jwt, body: registerBody() });
    assertEquals(noKey.status, 422);
    await noKey.body?.cancel();
  },
);

Deno.test(
  "a device rebound to another user disables the previous user's tokens and moves the push token",
  async () => {
    const h = await createHarness();
    await (
      await call(h, 'POST', '/devices/register', {
        jwt: await h.token(USER_A),
        key: crypto.randomUUID(),
        body: registerBody(),
      })
    ).body?.cancel();
    const res = await call(h, 'POST', '/devices/register', {
      jwt: await h.token(USER_B),
      key: crypto.randomUUID(),
      body: registerBody(),
    });
    assertEquals((await res.json()).data.rebound_from_other_user, true);
    assertEquals(h.devices.installations.get(INSTALLATION)?.user_id, USER_B);
    assertEquals(h.devices.tokens.length, 1);
    assertEquals(h.devices.tokens[0]?.user_id, USER_B);
    assertEquals(h.devices.tokens[0]?.status, 'active');
  },
);

Deno.test(
  'push permission off disables the installation tokens; auto timezone follows the device',
  async () => {
    const h = await createHarness();
    const jwt = await h.token(USER_A);
    h.devices.timezones.set(USER_A, { timezone: 'Europe/London', timezone_mode: 'auto' });
    await (
      await call(h, 'POST', '/devices/register', {
        jwt,
        key: crypto.randomUUID(),
        body: registerBody(),
      })
    ).body?.cancel();
    const off = await call(h, 'POST', '/devices/register', {
      jwt,
      key: crypto.randomUUID(),
      body: registerBody({ push: { permission: 'denied', expo_push_token: null } }),
    });
    const data = (await off.json()).data;
    assertEquals(data.push_enabled, false);
    assertEquals(h.devices.tokens[0]?.status, 'disabled');
    assertEquals(h.devices.tokens[0]?.disabled_reason, 'user_disabled');
    assertEquals(h.devices.timezones.get(USER_A)?.timezone, 'Europe/Istanbul');
  },
);

Deno.test(
  'POST /devices/unregister: a foreign installation is 404; the own one disables tokens even when disabled',
  async () => {
    const h = await createHarness();
    const jwtA = await h.token(USER_A);
    await (
      await call(h, 'POST', '/devices/register', {
        jwt: jwtA,
        key: crypto.randomUUID(),
        body: registerBody(),
      })
    ).body?.cancel();
    const foreign = await call(h, 'POST', '/devices/unregister', {
      jwt: await h.token(USER_B),
      key: crypto.randomUUID(),
      body: { installation_id: INSTALLATION, reason: 'logout' },
    });
    assertEquals(foreign.status, 404);
    assertEquals((await foreign.json()).error.code, 'NOT_FOUND');
    h.accounts.set(USER_A, { state: 'disabled', disabledAt: '2026-09-22T00:00:00Z' });
    const own = await call(h, 'POST', '/devices/unregister', {
      jwt: jwtA,
      key: crypto.randomUUID(),
      body: { installation_id: INSTALLATION, reason: 'account_switch' },
    });
    assertEquals(own.status, 200);
    assertEquals((await own.json()).data, { disabled_tokens: 1 });
    assertEquals(h.devices.tokens[0]?.disabled_reason, 'logout');
    assertEquals(h.devices.installations.get(INSTALLATION)?.signedOut, '2026-09-23T07:00:00.000Z');
  },
);

Deno.test(
  'account and version gates: disabled 403, deletion pending 403, old client 426',
  async () => {
    const h = await createHarness();
    const jwt = await h.token(USER_A);
    h.accounts.set(USER_A, { state: 'active', disabledAt: '2026-09-22T00:00:00Z' });
    const disabled = await call(h, 'POST', '/devices/register', {
      jwt,
      key: crypto.randomUUID(),
      body: registerBody(),
    });
    assertEquals([disabled.status, (await disabled.json()).error.code], [403, 'ACCOUNT_DISABLED']);
    h.accounts.set(USER_A, { state: 'deletion_pending', disabledAt: null });
    const pending = await call(h, 'GET', '/me/entitlements', { jwt });
    assertEquals(
      [pending.status, (await pending.json()).error.code],
      [403, 'ACCOUNT_DELETION_PENDING'],
    );
    h.accounts.delete(USER_A);
    const old = await call(h, 'GET', '/me/entitlements', {
      jwt,
      headers: { 'X-DA-Client': 'android/1.1.9' },
    });
    assertEquals([old.status, (await old.json()).error.code], [426, 'CLIENT_UPGRADE_REQUIRED']);
  },
);
