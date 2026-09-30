/**
 * IT-E2E-SEED (TEST_PLAN §12.2–§12.3; `supabase/seed/e2e/functions.sql`, loaded by the Maestro
 * harness): the seed refuses without `app.env`; every scenario the flows ask for seeds, seeds again to
 * the same rows and ids, and `e2e.reset_user` clears it; the demo canon user gets idempotent layers.
 */
import { assert, assertEquals, assertMatch, assertRejects } from '@std/assert';
import { createUser, db, it, one, q } from './_harness/mod.ts';

const FUNCTIONS = Deno.readTextFileSync(new URL('../../seed/e2e/functions.sql', import.meta.url));
const DEMO = Deno.readTextFileSync(new URL('../../seed/demo/10_demo_dataset.sql', import.meta.url));
const ANCHOR = '2026-09-22T05:45:00Z';

/** The part of a postgres.js transaction the tests use. */
interface Tx {
  unsafe(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

/** One transaction with `app.env` set (as the harness session does), or none (`null`). */
async function asStack<T>(env: string | null, body: (tx: Tx) => Promise<T>): Promise<T> {
  return (await db().begin(async (sql) => {
    const tx = sql as unknown as Tx;
    if (env !== null) await tx.unsafe(`select set_config('app.env', $1, true)`, [env]);
    return await body(tx);
  })) as T;
}

async function load(): Promise<void> {
  await asStack('ci', (tx) => tx.unsafe(FUNCTIONS));
}

interface Seeded {
  scenario: string;
  ids: Record<string, string>;
}

async function seed(userId: string, scenario: string): Promise<Seeded> {
  return await asStack('ci', async (tx) => {
    const rows = await tx.unsafe(`select e2e.seed_user($1::uuid, $2, $3::timestamptz) as out`, [
      userId,
      scenario,
      ANCHOR,
    ]);
    return (rows[0] as { out: Seeded }).out;
  });
}

let tables: string[] | null = null;

/** Row counts of every user-owned public table (plus referrals) for one user. */
async function snapshot(userId: string): Promise<Record<string, number>> {
  tables ??= (
    await q<{ table_name: string }>(
      `select c.table_name from information_schema.columns c
         join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public' and c.column_name = 'user_id' and t.table_type = 'BASE TABLE'
        order by 1`,
    )
  ).map((r) => r.table_name);
  const parts = tables.map(
    (t) => `select '${t}' as t, count(*)::int as n from public."${t}" where user_id = $1`,
  );
  parts.push(
    `select 'referrals', count(*)::int from public.referrals where referrer_id = $1 or referee_id = $1`,
  );
  const rows = await q<{ t: string; n: number }>(parts.join(' union all '), [userId]);
  return Object.fromEntries(rows.filter((r) => r.n > 0).map((r) => [r.t, r.n]));
}

const KEPT = new Set([
  'profiles',
  'user_preferences',
  'notification_preferences',
  'referral_codes',
]);

function content(snap: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(snap).filter(([t]) => !KEPT.has(t)));
}

it(
  'IT-E2E-SEED-01',
  'the E2E seed refuses to load or run outside a local / CI session',
  async () => {
    await assertRejects(
      () => asStack(null, (tx) => tx.unsafe(FUNCTIONS)),
      Error,
      'E2E_ENV_REQUIRED',
    );
    await assertRejects(
      () => asStack('production', (tx) => tx.unsafe(FUNCTIONS)),
      Error,
      'E2E_ENV_REQUIRED',
    );
    await load();
    const user = await createUser();
    await assertRejects(
      () => asStack(null, (tx) => tx.unsafe(`select e2e.seed_user($1::uuid, 'errors')`, [user.id])),
      Error,
      'E2E_ENV_REQUIRED',
    );
    await assertRejects(
      () => asStack(null, (tx) => tx.unsafe(`select e2e.reset_user($1::uuid)`, [user.id])),
      Error,
      'E2E_ENV_REQUIRED',
    );
    await assertRejects(
      () => seed(user.id, 'no_such_scenario'),
      Error,
      'VALIDATION_FAILED:scenario',
    );
    await assertRejects(() => seed(crypto.randomUUID(), 'errors'), Error, 'NOT_FOUND');
    // The API roles cannot reach the schema.
    const grants = await one<{ n: number }>(
      `select count(*)::int as n from information_schema.routine_privileges
      where routine_schema = 'e2e' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')`,
    );
    assertEquals(grants.n, 0);
  },
);

const SCENARIOS = [
  'empty_accounts',
  'mail_only',
  'errors',
  'android_ni',
  'dst_berlin',
  'referral_pending',
  'deletion',
  'approvals_mixed',
  'canon_plan',
  'announcement_active',
] as const;

it(
  'IT-E2E-SEED-02',
  'every scenario seeds, re-seeds to the same rows and ids, and resets (non-canon users)',
  async () => {
    await load();
    for (const scenario of SCENARIOS) {
      const user = await createUser();
      const first = await seed(user.id, scenario);
      assertEquals(first.scenario, scenario);
      const once = await snapshot(user.id);
      const second = await seed(user.id, scenario);
      assertEquals(second.ids, first.ids, scenario);
      assertEquals(await snapshot(user.id), once, scenario);
      if (scenario !== 'empty_accounts')
        assert((once.connected_accounts ?? 0) >= 1, `${scenario}: ${JSON.stringify(once)}`);
      const profile = await one<{ done: boolean }>(
        `select onboarding_completed_at is not null as done from public.profiles where user_id = $1`,
        [user.id],
      );
      assert(profile.done, scenario);
      await asStack('ci', (tx) => tx.unsafe(`select e2e.reset_user($1::uuid)`, [user.id]));
      assertEquals(content(await snapshot(user.id)), {}, scenario);
      // `none` keeps a fresh account as it is (u_new: onboarding untouched).
      const none = await seed(user.id, 'none');
      assertEquals(none.ids, {});
      assertEquals(content(await snapshot(user.id)), {}, scenario);
    }
  },
);

it('IT-E2E-SEED-03', 'scenario contents match what the Maestro flows assert', async () => {
  await load();
  const accounts = async (id: string) =>
    await q<{ status: string; demo_flavor: string; capabilities_granted: string[] }>(
      `select status, demo_flavor, capabilities_granted from public.connected_accounts where user_id = $1 order by demo_flavor, status`,
      [id],
    );
  const errors = await createUser();
  await seed(errors.id, 'errors');
  assertEquals(
    (await accounts(errors.id)).map((a) => `${a.demo_flavor}:${a.status}`),
    ['google:needs_reauth', 'microsoft:syncing'],
  );
  const override = await one<{ value: boolean }>(
    `select value from public.feature_flag_overrides where user_id = $1 and flag_key = 'ai.global.enabled'`,
    [errors.id],
  );
  assertEquals(override.value, false);
  const lag = await one<{ lag: number }>(
    `select extract(epoch from ($2::timestamptz - last_success_at))::int as lag from public.sync_states where user_id = $1`,
    [errors.id, ANCHOR],
  );
  assertEquals(lag.lag, 40 * 60);
  const pro = await one<{ entitlement: string; is_active: boolean }>(
    `select * from private.effective_entitlement_at($1, now())`,
    [errors.id],
  );
  assertEquals([pro.entitlement, pro.is_active], ['pro', true]);

  const mailOnly = await createUser();
  await seed(mailOnly.id, 'mail_only');
  assertEquals(
    (await accounts(mailOnly.id)).map((a) => a.capabilities_granted),
    [['mail_read']],
  );
  const free = await one<{ is_active: boolean }>(
    `select * from private.effective_entitlement_at($1, now())`,
    [mailOnly.id],
  );
  assertEquals(free.is_active, false);

  const ni = await createUser();
  await seed(ni.id, 'android_ni');
  const signals = await q<{ category: string }>(
    `select category from public.android_notification_signals where user_id = $1 order by category`,
    [ni.id],
  );
  assertEquals(
    signals.map((s) => s.category),
    ['bank_payment', 'cargo', 'flight'],
  );

  const en = await createUser();
  const berlin = await seed(en.id, 'dst_berlin');
  const thread = await one<{ deadline_at: Date; tz: string; locale: string }>(
    `select t.deadline_at, p.timezone as tz, pr.locale from public.email_threads t
       join public.user_preferences p on p.user_id = t.user_id join public.profiles pr on pr.user_id = t.user_id
      where t.user_id = $1 and t.deadline_at is not null`,
    [en.id],
  );
  assertEquals([thread.tz, thread.locale], ['Europe/Berlin', 'en-US']);
  assertEquals(thread.deadline_at.toISOString(), '2026-10-24T15:00:00.000Z');
  const ahmet = await one<{ user_id: string }>(
    `select user_id from public.email_messages where id = $1`,
    [berlin.ids.messageAhmet],
  );
  assertEquals(ahmet.user_id, en.id);

  const referrer = await createUser();
  const referral = await seed(referrer.id, 'referral_pending');
  assertMatch(referral.ids.referralCode ?? '', /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$/);
  const state = await one<{ status: string; code: string }>(
    `select status, code from public.referrals where referrer_id = $1`,
    [referrer.id],
  );
  assertEquals([state.status, state.code], ['pending', referral.ids.referralCode]);
});

it(
  'IT-E2E-SEED-04',
  'demo canon user: approvals_mixed, canon_plan and announcement_active layer idempotently',
  async () => {
    await load();
    const reseedDemo = () =>
      db().begin(async (tx) => {
        await tx.unsafe(`select set_config('da.demo_mode', 'true', true)`);
        await tx.unsafe(DEMO);
      });
    await reseedDemo();
    const demo = await one<{ id: string }>(
      `select id from auth.users where email = 'demo@dijitalasistan.app'`,
    );
    const statuses = async () =>
      Object.fromEntries(
        (
          await q<{ status: string; n: number }>(
            `select status, count(*)::int as n from public.approval_actions where user_id = $1 group by status`,
            [demo.id],
          )
        ).map((r) => [r.status, r.n]),
      );
    for (let round = 0; round < 2; round++) {
      await reseedDemo();
      const mixed = await seed(demo.id, 'approvals_mixed');
      assertEquals(await statuses(), { pending: 3, failed: 1, expired: 1 });
      const commitment = await one<{ status: string; action_type: string }>(
        `select status, action_type from public.approval_actions where id = $1`,
        [mixed.ids.approvalCommitment],
      );
      assertEquals([commitment.status, commitment.action_type], ['pending', 'commitment_create']);

      await reseedDemo();
      const plan = await seed(demo.id, 'canon_plan');
      const conflict = await q<{ title: string }>(
        `select title from public.calendar_events where id in ($1, $2) order by start_at`,
        [plan.ids.eventConflictA, plan.ids.eventConflictB],
      );
      assertEquals(
        conflict.map((c) => c.title),
        ['Müşteri toplantısı', 'Doktor randevusu'],
      );

      const banner = await seed(demo.id, 'announcement_active');
      const live = await q<{ id: string }>(
        `select id from public.announcements where published_at is not null and cancelled_at is null
           and starts_at <= $1::timestamptz and ends_at > $1::timestamptz and id::text like $2`,
        [ANCHOR, `${banner.ids.announcementActive ?? ''}%`],
      );
      assertEquals(live.length, 1);
      assertEquals(
        (
          await one<{ n: number }>(
            `select count(*)::int as n from public.announcement_dismissals where user_id = $1`,
            [demo.id],
          )
        ).n,
        0,
      );
    }
  },
);
