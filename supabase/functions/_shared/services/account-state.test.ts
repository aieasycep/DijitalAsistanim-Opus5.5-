/**
 * Account gate (API_CONTRACTS §2.3, §15; TEST_PLAN EF-AUTH-01): missing auth → `AUTH_REQUIRED`, a
 * missing profile → `FORBIDDEN`, disabled → `ACCOUNT_DISABLED`, deletion pending →
 * `ACCOUNT_DELETION_PENDING`, an app older than `app.min_supported_version` →
 * `CLIENT_UPGRADE_REQUIRED`; the `profiles` / `app_settings` readers and their TTL cache.
 */
import { assertEquals, assertRejects } from '@std/assert';
import { AppError } from '../errors.ts';
import { postgrest } from '../testing/postgrest.ts';
import {
  type AccountState,
  requireActiveAccount,
  supabaseAccountStateRepo,
  supabaseAppSettingsRepo,
} from './account-state.ts';

const USER = '11111111-1111-4111-8111-111111111111';

async function gate(
  state: AccountState | null,
  client: { platform: 'ios' | 'android' | null; version: string | null },
  authed = true,
) {
  let passed = false;
  const mw = requireActiveAccount({
    accounts: { get: () => Promise.resolve(state) },
    settings: {
      minSupportedVersion: () => Promise.resolve({ ios: '1.4.0', android: '1.3.0' }),
      referralRewardDays: () => Promise.resolve(14),
    },
  });
  const vars: Record<string, unknown> = { auth: authed ? { userId: USER } : undefined, client };
  await mw({ get: (k: string) => vars[k] } as never, () => {
    passed = true;
    return Promise.resolve();
  });
  return passed;
}

Deno.test('account gate (EF-AUTH-01): state and version checks in contract order', async () => {
  const active: AccountState = { state: 'active', disabledAt: null };
  assertEquals(await gate(active, { platform: 'ios', version: '1.4.0' }), true);
  assertEquals(await gate(active, { platform: null, version: null }), true);
  const cases: [
    AccountState | null,
    { platform: 'ios' | 'android' | null; version: string | null },
    boolean,
    string,
  ][] = [
    [active, { platform: 'ios', version: '1.4.0' }, false, 'AUTH_REQUIRED'],
    [null, { platform: 'ios', version: '1.4.0' }, true, 'FORBIDDEN'],
    [
      { state: 'active', disabledAt: '2026-09-01T00:00:00Z' },
      { platform: 'ios', version: '1.4.0' },
      true,
      'ACCOUNT_DISABLED',
    ],
    [
      { state: 'deletion_pending', disabledAt: null },
      { platform: 'ios', version: '1.4.0' },
      true,
      'ACCOUNT_DELETION_PENDING',
    ],
    [active, { platform: 'android', version: '1.2.9' }, true, 'CLIENT_UPGRADE_REQUIRED'],
  ];
  for (const [state, client, authed, code] of cases) {
    const e = await assertRejects(() => gate(state, client, authed), AppError);
    assertEquals(e.code, code);
  }
});

Deno.test('account state repo: profiles row → state; absent → null', async () => {
  const pg = postgrest({ 'GET profiles': [{ state: 'deletion_pending', disabled_at: null }] });
  assertEquals(await supabaseAccountStateRepo(pg.db).get(USER), {
    state: 'deletion_pending',
    disabledAt: null,
  });
  assertEquals(
    [pg.calls[0]?.select, pg.calls[0]?.params.user_id],
    ['state,disabled_at', `eq.${USER}`],
  );
  const none = postgrest({ 'GET profiles': [] });
  assertEquals(await supabaseAccountStateRepo(none.db).get(USER), null);
});

Deno.test(
  'app settings repo: min versions and reward days with defaults and a TTL cache',
  async () => {
    let rows: unknown[] = [
      { key: 'app.min_supported_version', value: { ios: '1.5.0', android: 'bad' } },
      { key: 'referral.reward_days', value: 30 },
    ];
    const pg = postgrest(() => rows);
    let clock = 0;
    const repo = supabaseAppSettingsRepo(pg.db, { ttlMs: 60_000, now: () => clock });
    assertEquals(await repo.minSupportedVersion(), { ios: '1.5.0', android: '1.0.0' });
    assertEquals(await repo.referralRewardDays(), 30);
    assertEquals(pg.calls.length, 1, 'cached within the TTL');
    assertEquals(pg.calls[0]?.params.key, 'in.(app.min_supported_version,referral.reward_days)');
    rows = [{ key: 'referral.reward_days', value: 7.5 }];
    clock = 61_000;
    assertEquals(
      await repo.referralRewardDays(),
      14,
      'a non-integer falls back to the documented default',
    );
    assertEquals(await repo.minSupportedVersion(), { ios: '1.0.0', android: '1.0.0' });
    assertEquals(pg.calls.length, 2);
  },
);
