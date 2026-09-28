/**
 * Backend analytics events of API_CONTRACTS §17.1 at their API and JOB-24 emission points:
 * API-DEV-01 `device_registered` / `push_permission_changed`, API-REM-02 `reminder_created` and the
 * `subscription_*` events of the billing sync, all through the shared server emitter (no replay
 * duplicates, the analytics opt-out honoured, no content).
 */
import { assertEquals } from '@std/assert';
import { supabaseBillingRepo } from '../_shared/services/billing/repo.ts';
import { memoryServerAnalytics } from '../_shared/testing/analytics.ts';
import { USER_A } from '../_shared/testing/jwt.ts';
import { postgrest } from '../_shared/testing/postgrest.ts';
import { call, createHarness } from './testing.ts';

const INSTALLATION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOKEN = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

function registerBody(push: { permission: string; expo_push_token: string | null }) {
  return {
    installation_id: INSTALLATION,
    platform: 'android',
    os_version: '15',
    app_version: '1.4.0',
    build_number: '812',
    locale: 'tr-TR',
    timezone: 'Europe/Istanbul',
    push,
    device_fingerprint_hash: null,
  };
}

Deno.test(
  'API-DEV-01 (§17.1): device_registered for a new installation, push_permission_changed on a flip',
  async () => {
    const h = await createHarness();
    const jwt = await h.token(USER_A);
    const register = async (
      push: { permission: string; expo_push_token: string | null },
      key: string = crypto.randomUUID(),
    ) => {
      const res = await call(h, 'POST', '/devices/register', {
        jwt,
        key,
        body: registerBody(push),
      });
      assertEquals(res.status, 200);
      await res.body?.cancel();
    };
    const granted = { permission: 'granted', expo_push_token: TOKEN };
    const key = crypto.randomUUID();
    await register(granted, key);
    await register(granted, key); // an idempotent replay emits nothing
    await register(granted); // a routine re-registration emits nothing
    await register({ permission: 'denied', expo_push_token: null });
    const unregister = await call(h, 'POST', '/devices/unregister', {
      jwt,
      key: crypto.randomUUID(),
      body: { installation_id: INSTALLATION, reason: 'logout' },
    });
    assertEquals(unregister.status, 200);
    await unregister.body?.cancel();
    await register(granted); // signing in again on the device is a new registration
    assertEquals(
      h.serverEvents.rows.map((r) => [r.event_name, r.props]),
      [
        ['device_registered', { platform: 'android', push_permission: 'granted' }],
        ['push_permission_changed', { permission: 'denied' }],
        ['device_registered', { platform: 'android', push_permission: 'granted' }],
      ],
    );
    const first = h.serverEvents.rows[0]!;
    assertEquals(
      [first.user_id, first.session_id, first.platform, first.app_version],
      [USER_A, null, 'ios', '1.4.0'],
    );
  },
);

Deno.test(
  'API-REM-02 (§17.1): reminder_created once per reminder; opt-out stores nothing',
  async () => {
    const h = await createHarness();
    const jwt = await h.token(USER_A);
    const body = {
      client_reminder_id: crypto.randomUUID(),
      title: 'Teklife dön',
      preset: 'before_1h',
      fire_at: '2026-09-23T13:00:00Z',
      anchor_at: '2026-09-23T14:00:00.000Z',
      origin: 'email_detail',
    };
    assertEquals((await call(h, 'POST', '/reminders', { jwt, body })).status, 201);
    assertEquals((await call(h, 'POST', '/reminders', { jwt, body })).status, 200);
    assertEquals(
      h.serverEvents.rows.map((r) => [r.event_name, r.props]),
      [['reminder_created', { preset: 'before_1h' }]],
    );

    h.serverEvents.optOut.add(USER_A);
    const other = { ...body, client_reminder_id: crypto.randomUUID() };
    assertEquals((await call(h, 'POST', '/reminders', { jwt, body: other })).status, 201);
    assertEquals(h.serverEvents.rows.length, 1);
  },
);

Deno.test('JOB-24 (§17.1): subscription events go through the server emitter', async () => {
  const mem = memoryServerAnalytics();
  const repo = supabaseBillingRepo(postgrest({}).db, mem.analytics);
  const row = {
    user_id: USER_A,
    event_name: 'subscription_started',
    props: { product: 'da_pro_monthly', store: 'app_store', period_type: 'trial' },
    occurred_at: '2026-09-28T09:00:00Z',
  } as const;
  await repo.analytics(row);
  mem.optOut.add(USER_A);
  await repo.analytics({ ...row, event_name: 'subscription_renewed' });
  assertEquals(
    mem.rows.map((r) => [r.event_name, r.props, r.session_id]),
    [['subscription_started', row.props, null]],
  );
});
