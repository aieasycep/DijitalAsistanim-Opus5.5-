/**
 * Usage summary and the entitlement reader (API_CONTRACTS RPC-11/RPC-12, API-ENT-01; TEST_PLAN
 * UT-ENT-04, UT-ENT-11, UT-ENT-12): the visible AI unit budget is capped on Free and has no visible cap on
 * Pro, money never appears, budget states map to L0–L3, and the reader tolerates both RPC shapes
 * and filters revoked grants.
 */
import { assert, assertEquals } from '@std/assert';
import { postgrest } from '../testing/postgrest.ts';
import { buildUsageSummary, supabaseEntitlementReader } from './entitlements.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-24T06:30:00.000Z');

Deno.test(
  'usage summary (UT-ENT-11): Free sees 50 units/day with the remaining count; limits keyed',
  () => {
    const summary = buildUsageSummary(
      [
        {
          key: 'ai_daily_budget_units',
          limit: 50,
          used: 12,
          resets_at: '2026-09-24T21:00:00.000Z',
        },
        { key: 'max_mail_accounts', limit: 1, used: 1 },
        { key: 'vip_max', limit: 5, used: 2, remaining: 3 },
        { key: 'unlimited_thing', limit: null, used: 4 },
        { limit: 3 },
      ],
      'free',
      'Europe/Istanbul',
      NOW,
    );
    assertEquals(summary, {
      plan: 'free',
      resets_at: '2026-09-24T21:00:00.000Z',
      limits: {
        max_mail_accounts: { limit: 1, used: 1, remaining: 0 },
        vip_max: { limit: 5, used: 2, remaining: 3 },
      },
      ai_budget: { state: 'ok', level: 'L0' },
      ai_units: { limit: 50, used: 12, remaining: 38 },
    });
    assert(!JSON.stringify(summary).includes('usd'), 'no money in the view');
  },
);

Deno.test(
  'usage summary: exhausted units → L2; object and {items} shapes; next local midnight default',
  () => {
    const exhausted = buildUsageSummary(
      { items: [{ key: 'ai_daily_budget_units', limit: 50, used: 55 }] },
      'free',
      'Europe/Istanbul',
      NOW,
    );
    assertEquals(
      [exhausted.ai_budget, exhausted.ai_units.remaining],
      [{ state: 'exhausted', level: 'L2' }, 0],
    );
    assertEquals(
      exhausted.resets_at,
      '2026-09-24T21:00:00.000Z',
      'Istanbul midnight when the RPC gives none',
    );
    const byKey = buildUsageSummary(
      { ai_daily_budget_units: { limit: 50, used: 50.9 }, max_calendars: { limit: 2, used: 1 } },
      'free',
      'Bad/Zone',
      NOW,
    );
    assertEquals([byKey.ai_units.used, byKey.limits.max_calendars?.remaining], [50, 1]);
    const soft = buildUsageSummary(
      { items: [], ai_budget: { state: 'soft_limited', level: 'L1' } },
      'pro',
      'Europe/Berlin',
      NOW,
    );
    assertEquals(
      [soft.ai_budget, soft.ai_units, soft.resets_at],
      [
        { state: 'soft_limited', level: 'L1' },
        { limit: null, used: 0, remaining: null },
        '2026-09-24T22:00:00.000Z',
      ],
    );
    assertEquals(buildUsageSummary(null, 'free', 'Europe/Istanbul', NOW).limits, {});
  },
);

Deno.test(
  'usage summary (UT-ENT-12): Pro units show no cap even when the row has a limit; L3 passes through',
  () => {
    const pro = buildUsageSummary(
      {
        items: [{ key: 'ai_daily_budget_units', limit: 500, used: 20 }],
        ai_budget: { state: 'exhausted', level: 'L3' },
      },
      'pro',
      'Europe/Istanbul',
      NOW,
    );
    assertEquals(
      [pro.ai_units.limit, pro.ai_units.remaining, pro.ai_budget],
      [null, null, { state: 'exhausted', level: 'L3' }],
    );
  },
);

Deno.test(
  'entitlement reader (UT-ENT-04): effective row (array or object), Pro subscription, live grants, usage RPC',
  async () => {
    let effective: unknown = [{ is_active: true, source: 'store' }];
    const pg = postgrest((req) => {
      if (req.rpc === 'effective_entitlement') return effective;
      if (req.rpc === 'get_usage_summary') return { items: [] };
      if (req.path === 'subscriptions')
        return [{ is_active: true, store: 'app_store', product_id: 'da_pro_annual' }];
      return [{ id: 'g1', source: 'referral_referee', revoked_at: null }];
    });
    const reader = supabaseEntitlementReader(pg.db);
    assertEquals((await reader.effective(USER)).source, 'store');
    effective = { is_active: false, source: 'grant' };
    assertEquals((await reader.effective(USER)).source, 'grant');
    effective = null;
    assertEquals((await reader.effective(USER)).source, 'none', 'no row reads as free');
    assertEquals((await reader.subscription(USER))?.product_id, 'da_pro_annual');
    const sub = pg.to('subscriptions')[0]!;
    assertEquals([sub.params.entitlement, sub.params.user_id], ['eq.pro', `eq.${USER}`]);
    assertEquals((await reader.grants(USER)).length, 1);
    const grants = pg.to('entitlement_grants')[0]!;
    assertEquals(
      [grants.params.revoked_at, grants.params.order, grants.params.limit],
      ['is.null', 'ends_at.desc', '50'],
    );
    assertEquals(await reader.usage(), { items: [] });
    assertEquals(pg.to('rpc/get_usage_summary')[0]?.body, {});
    const none = postgrest({ 'GET subscriptions': [] });
    assertEquals(await supabaseEntitlementReader(none.db).subscription(USER), null);
  },
);
