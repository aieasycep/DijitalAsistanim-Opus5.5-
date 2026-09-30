/**
 * Entitlement gates and plan limits (IMPLEMENTATION_PLAN T-7.02; TEST_PLAN UT-ENT-09/10/11;
 * API_CONTRACTS §4.1/§4.2, §2.6 `ENTITLEMENT_REQUIRED` / `QUOTA_EXCEEDED`).
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { ENTITLEMENT_FEATURE_GATES, PRO_FEATURES } from '@da/domain';
import { routes } from '@da/validation';
import { AppError } from '../../errors.ts';
import { memoryEntitlementGate } from '../../testing/business.ts';
import { testDb } from '../../testing/db.ts';
import { jsonResponse, stubFetch } from '../../testing/fetch.ts';
import { checkPlanLimit, requireEntitlement, supabaseEntitlementGate, usageDelta } from './gate.ts';
import { PRO_ROUTE_FEATURES, proFeatureForRoute } from './middleware.ts';

const USER = '11111111-1111-4111-8111-111111111111';

Deno.test(
  'requireEntitlement: included features pass, Pro switches need Pro (402 {feature})',
  async () => {
    const gate = memoryEntitlementGate();
    await requireEntitlement(gate, USER, 'morning_briefing');
    assertEquals(gate.checks.length, 0, 'included features never query the database');
    for (const feature of PRO_FEATURES) {
      const error = await assertRejects(() => requireEntitlement(gate, USER, feature), AppError);
      assertEquals(
        [error.code, error.status, error.details],
        ['ENTITLEMENT_REQUIRED', 402, { feature }],
      );
    }
    gate.plans.set(USER, 'pro');
    for (const feature of PRO_FEATURES) await requireEntitlement(gate, USER, feature);
  },
);

Deno.test(
  'requireEntitlement: a second mail account on Free is ENTITLEMENT_REQUIRED with the limit (UT-ENT-10)',
  async () => {
    const gate = memoryEntitlementGate();
    await requireEntitlement(gate, USER, 'mail_accounts');
    gate.used.set(`${USER}:max_mail_accounts`, 1);
    const error = await assertRejects(
      () => requireEntitlement(gate, USER, 'mail_accounts'),
      AppError,
    );
    assertEquals(error.details, {
      feature: 'mail_accounts',
      limit_key: 'max_mail_accounts',
      limit: 1,
      current: 1,
    });
    gate.plans.set(USER, 'pro');
    await requireEntitlement(gate, USER, 'mail_accounts');
  },
);

Deno.test(
  'checkPlanLimit: daily quotas are QUOTA_EXCEEDED with Retry-After; counts are ENTITLEMENT_REQUIRED',
  async () => {
    const gate = memoryEntitlementGate('2026-09-24T21:00:00.000Z');
    const now = new Date('2026-09-24T20:00:00.000Z');
    const free = await assertRejects(
      () => checkPlanLimit(gate, USER, 'captures_daily', { now }),
      AppError,
    );
    assertEquals(free.code, 'QUOTA_EXCEEDED');
    assertEquals(free.details?.upgrade_available, true);
    assertEquals(free.headers['Retry-After'], '3600');
    gate.plans.set(USER, 'pro');
    const allowed = await checkPlanLimit(gate, USER, 'captures_daily', { now });
    assertEquals(usageDelta(allowed), {
      limit_key: 'captures_daily',
      limit: 50,
      used: 1,
      remaining: 49,
      resets_at: '2026-09-24T21:00:00.000Z',
    });
    gate.used.set(`${USER}:captures_daily`, 50);
    const pro = await assertRejects(
      () => checkPlanLimit(gate, USER, 'captures_daily', { now }),
      AppError,
    );
    assertEquals(pro.details, {
      limit_key: 'captures_daily',
      limit: 50,
      used: 50,
      resets_at: '2026-09-24T21:00:00.000Z',
      upgrade_available: false,
    });
    gate.plans.set(USER, 'free');
    gate.used.set(`${USER}:vip_max`, 5);
    const vip = await assertRejects(() => checkPlanLimit(gate, USER, 'vip_max'), AppError);
    assertEquals(vip.details, { feature: 'vip', limit_key: 'vip_max', limit: 5, current: 5 });
  },
);

Deno.test('the supabase gate calls public.check_plan_limit with the verified user id', async () => {
  const stub = stubFetch(() => jsonResponse({ key: 'capture', allowed: false, plan: 'free' }));
  const gate = supabaseEntitlementGate(testDb(stub.fetch));
  const state = await gate.check(USER, 'capture');
  assertEquals(state, {
    key: 'capture',
    allowed: false,
    plan: 'free',
    limit: null,
    used: null,
    resets_at: null,
  });
  assert(stub.calls[0]?.url.endsWith('/rest/v1/rpc/check_plan_limit'));
  assertEquals(JSON.parse(stub.calls[0]?.body ?? '{}'), {
    p_key: 'capture',
    p_increment: 1,
    p_user_id: USER,
  });
});

Deno.test('PRO_ROUTE_FEATURES only lists registry routes with Pro-only features', () => {
  for (const [key, feature] of Object.entries(PRO_ROUTE_FEATURES)) {
    assert(key in routes, `${key} is an api route`);
    assertEquals(ENTITLEMENT_FEATURE_GATES[feature].kind, 'plan_feature', key);
  }
  assertEquals(
    proFeatureForRoute('POST /captures/:id/discard'),
    null,
    'discard stays open after a downgrade',
  );
  assertEquals(proFeatureForRoute('GET /me/entitlements'), null);
  assertEquals(proFeatureForRoute(undefined), null);
});
