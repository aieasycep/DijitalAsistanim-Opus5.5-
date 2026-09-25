/**
 * AI budget (AI_PIPELINE_PLAN §8.10; TEST_PLAN IT-AI-05): reservations parse defensively, a refusal
 * maps to 429 `QUOTA_EXCEEDED` with the plan-limit key, settlement sends clamped integers and the
 * token breakdown, and the L3 organisation ceiling is evaluated at most once per interval after a
 * settle (single-flight), tripping the kill callback.
 */
import { assert, assertEquals } from '@std/assert';
import { pgError, postgrest } from '../testing/postgrest.ts';
import {
  budgetExceededError,
  type BudgetGate,
  parseOrgBudgetState,
  supabaseBudgetGate,
  supabaseOrgBudgetEvaluator,
  withOrgBudgetGuard,
} from './budget.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const USAGE = {
  inputTokens: 1200,
  outputTokens: 300,
  cacheReadTokens: 800,
  cacheWriteTokens: 100,
  cacheWrite1hTokens: 50,
  reasoningTokens: 0,
};

Deno.test('ai budget (IT-AI-05): refusals map to QUOTA_EXCEEDED with the plan limit key', () => {
  const e = budgetExceededError({
    allow: false,
    level: 'l2',
    reason: 'units_exhausted',
    reservationId: null,
  });
  assertEquals(
    [e.code, e.details],
    ['QUOTA_EXCEEDED', { limit_key: 'ai_daily_budget_units', upgrade_available: true }],
  );
  assertEquals(
    budgetExceededError({
      allow: false,
      level: 'l2',
      reason: 'hard_cap_month',
      reservationId: null,
    }).details?.limit_key,
    'ai_hard_cap_usd_month',
  );
  assertEquals(
    budgetExceededError({ allow: false, level: 'l2', reason: null, reservationId: null }).details
      ?.limit_key,
    'ai_hard_cap_usd_day',
  );
});

Deno.test(
  'ai budget: reserve/settle RPC arguments are clamped integers; odd replies parse safely',
  async () => {
    let reply: unknown = { allow: true, level: 'l1', reason: null, reservation_id: 'res-9' };
    const pg = postgrest((req) => (req.rpc === 'ai_budget_reserve' ? reply : null));
    const gate = supabaseBudgetGate(pg.db);
    assertEquals(
      await gate.reserve({ userId: USER, feature: 'email_triage', estCostMicros: 12.6, units: -2 }),
      { allow: true, level: 'l1', reason: null, reservationId: 'res-9' },
    );
    assertEquals(pg.to('rpc/ai_budget_reserve')[0]?.body, {
      p_user: USER,
      p_feature: 'email_triage',
      p_est_cost_micros: 13,
      p_units: 0,
    });
    reply = { allow: 'yes', level: 'l9', reason: 'odd', reservation_id: 7 };
    assertEquals(
      await gate.reserve({ userId: USER, feature: 'email_triage', estCostMicros: 1, units: 1 }),
      { allow: false, level: 'l0', reason: null, reservationId: null },
    );
    reply = { allow: false, level: 'l2', reason: 'hard_cap_day' };
    assertEquals(
      (await gate.reserve({ userId: USER, feature: 'email_triage', estCostMicros: 1, units: 1 }))
        .reason,
      'hard_cap_day',
    );
    reply = null;
    assertEquals(
      (await gate.reserve({ userId: USER, feature: 'email_triage', estCostMicros: 1, units: 1 }))
        .allow,
      false,
    );

    await gate.settle({
      reservationId: 'res-9',
      aiRequestId: 'req-1',
      actualCostMicros: -5,
      units: 1.4,
      usage: USAGE,
    });
    assertEquals(pg.to('rpc/ai_budget_settle')[0]?.body, {
      p_reservation_id: 'res-9',
      p_ai_request_id: 'req-1',
      p_actual_cost_micros: 0,
      p_units: 1,
      p_tokens: { input: 1200, output: 300, cache_read: 800, cache_write: 150 },
    });
  },
);

Deno.test('ai budget: org state parsing and the evaluator RPC', async () => {
  assertEquals(parseOrgBudgetState(null), {
    status: 'not_configured',
    spentMicros: 0,
    ceilingMicros: null,
    pct: 0,
    tripped: false,
    alerts: [],
  });
  assertEquals(
    parseOrgBudgetState({
      status: 'ok',
      spent_micros: '5000',
      ceiling_micros: 10000,
      pct: 50,
      tripped: false,
      alerts: ['50'],
    }),
    {
      status: 'ok',
      spentMicros: 5000,
      ceilingMicros: 10000,
      pct: 50,
      tripped: false,
      alerts: [50],
    },
  );
  const pg = postgrest({
    'POST rpc/ai_org_budget_evaluate': { status: 'disabled', tripped: true, pct: 101 },
  });
  const state = await supabaseOrgBudgetEvaluator(pg.db)();
  assertEquals([state.status, state.tripped], ['disabled', true]);
  assert(typeof (pg.calls[0]?.body as { p_now: string }).p_now === 'string');
});

Deno.test(
  'ai budget (L3): the org ceiling is checked after settles, at most once per interval',
  async () => {
    const settled: string[] = [];
    const inner: BudgetGate = {
      reserve: () =>
        Promise.resolve({ allow: true, level: 'l0', reason: null, reservationId: 'r' }),
      settle: (input) => {
        settled.push(input.reservationId);
        return Promise.resolve();
      },
    };
    let clock = 0;
    let evaluations = 0;
    let tripped = false;
    const trips: number[] = [];
    const guard = withOrgBudgetGuard(
      inner,
      () => {
        evaluations++;
        if (evaluations === 3) return Promise.reject(new Error('db down'));
        return Promise.resolve(
          parseOrgBudgetState({ status: 'ok', pct: tripped ? 100 : 40, tripped }),
        );
      },
      { intervalMs: 60_000, now: () => clock, onTrip: (s) => trips.push(s.pct) },
    );
    assertEquals(guard.lastState(), null);
    assertEquals(
      (await guard.reserve({ userId: USER, feature: 'email_triage', estCostMicros: 1, units: 1 }))
        .allow,
      true,
    );
    const settle = (id: string) =>
      guard.settle({
        reservationId: id,
        aiRequestId: null,
        actualCostMicros: 1,
        units: 1,
        usage: USAGE,
      });
    await Promise.all([settle('a'), settle('b')]);
    assertEquals(
      [evaluations, guard.lastState()?.pct],
      [1, 40],
      'concurrent settles share one evaluation',
    );
    clock = 30_000;
    await settle('c');
    assertEquals(evaluations, 1, 'within the interval no new evaluation');
    clock = 61_000;
    tripped = true;
    await settle('d');
    assertEquals([evaluations, trips], [2, [100]]);
    clock = 130_000;
    await settle('e');
    assertEquals(
      [evaluations, guard.lastState()?.tripped],
      [3, true],
      'a failed evaluation keeps the last state',
    );
    assertEquals(settled, ['a', 'b', 'c', 'd', 'e']);
  },
);

Deno.test('ai budget: a DB failure on reserve surfaces as the mapped error', async () => {
  const pg = postgrest(() => pgError('57014', 'canceling statement', 500));
  const e = await supabaseBudgetGate(pg.db)
    .reserve({ userId: USER, feature: 'email_triage', estCostMicros: 1, units: 1 })
    .catch((x) => x);
  assertEquals((e as { code?: string }).code, 'SERVICE_UNAVAILABLE');
});
