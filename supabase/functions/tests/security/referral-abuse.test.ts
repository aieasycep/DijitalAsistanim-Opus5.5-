/**
 * THR-15 Referral abuse (SECURITY_AND_PRIVACY_PLAN §2 THR-15; M§45, P-06; API_CONTRACTS API-BIZ-01,
 * JOB-25; TEST_PLAN UT-REF-*, TST-EF-18). Attacker scenarios through `POST /referrals/apply` on the
 * real `api` app and the JOB-25 evaluator (the SQL decisions and the capped reward are proven in
 * `221_referrals` and `300_threats_writes.test.sql`):
 * - self-referral by the own code or a shared installation is refused at apply time;
 * - guessing codes is rate-limited per user;
 * - a farm of fresh accounts applying one code within the hour is flagged — nobody is rewarded;
 * - A→B→A loops are rejected; a recycled (tombstoned) identity is rejected;
 * - the yearly cap withholds the referrer's reward.
 */
import { assert, assertEquals } from '@std/assert';
import { referralSignalMaterial } from '@da/domain';
import { hashIdHex } from '../../_shared/crypto/hash.ts';
import { createLogger, memorySink } from '../../_shared/logging/logger.ts';
import { evaluateReferralJob } from '../../_shared/services/referrals/evaluate.ts';
import { call, createHarness, NOW } from '../../api/testing.ts';

const HOUR = 3_600_000;
const REFERRER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CODE = '2222222';
const log = createLogger({ fn: 'worker', sink: memorySink().sink });

function uuid(n: number): string {
  return `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;
}

async function world() {
  const h = await createHarness({ env: { PUBLIC_WEB_URL: 'https://dijitalasistan.example' } });
  const repo = h.business.referrals;
  repo.addUser(REFERRER, {
    email: 'referrer@example.com',
    display_name: 'Ayşe',
    created_at: '2026-01-01T00:00:00Z',
  });
  repo.codes.set(REFERRER, { code: CODE, disabled: false });
  const fresh = (id: string, email: string) =>
    repo.addUser(id, {
      email,
      display_name: email.split('@')[0] ?? null,
      created_at: new Date(NOW.getTime() - HOUR).toISOString(),
      installation_ids: [crypto.randomUUID()],
    });
  const apply = async (userId: string, code: string, ip = '203.0.113.9') => {
    const user = repo.users.get(userId);
    return await call(h, 'POST', '/referrals/apply', {
      jwt: await h.token(userId),
      key: crypto.randomUUID(),
      headers: { 'X-Forwarded-For': ip },
      body: {
        code,
        installation_id: user?.installation_ids[0] ?? crypto.randomUUID(),
        source: 'deep_link',
      },
    });
  };
  /** Makes a referee fully qualified (onboarding, a connected account, a first briefing). */
  const qualify = (userId: string) => {
    const user = repo.users.get(userId);
    assert(user !== undefined);
    user.onboarding_completed_at = new Date(NOW.getTime()).toISOString();
    user.account_connected_at = new Date(NOW.getTime() + HOUR).toISOString();
    user.first_briefing_at = new Date(NOW.getTime() + 20 * HOUR).toISOString();
  };
  const evaluate = (referralId: string, at = new Date(NOW.getTime() + 49 * HOUR)) =>
    evaluateReferralJob({ repo, pepper: h.deps.env, now: () => at, log }, referralId, null);
  return { h, repo, fresh, apply, qualify, evaluate };
}

Deno.test('THR-15: self-referral by code or shared installation is refused at apply', async () => {
  const w = await world();
  const own = await w.apply(REFERRER, CODE);
  assertEquals([own.status, (await own.json()).error.code], [422, 'REFERRAL_SELF']);
  // A second account on the referrer's own phone.
  const sock = w.fresh(uuid(1), 'sock@example.com');
  const referrer = w.repo.users.get(REFERRER);
  assert(referrer !== undefined);
  referrer.device_hashes = [
    await hashIdHex(w.h.deps.env, `installation:${sock.installation_ids[0]}`),
  ];
  const shared = await w.apply(uuid(1), CODE);
  assertEquals([shared.status, (await shared.json()).error.code], [422, 'REFERRAL_SELF']);
  assertEquals(w.repo.referrals.length, 0);
});

Deno.test(
  'THR-15: guessing codes is rate-limited before the code space can be walked',
  async () => {
    const w = await world();
    w.fresh(uuid(2), 'guesser@example.com');
    const statuses: number[] = [];
    for (const code of [
      '3222223',
      '4222224',
      '5222225',
      '6222226',
      '7222227',
      '8222228',
      '9222229',
    ]) {
      const res = await w.apply(uuid(2), code);
      statuses.push(res.status);
      await res.body?.cancel();
    }
    assert(statuses.includes(429), `no rate limit in ${statuses.join(',')}`);
    assertEquals(statuses.indexOf(429) <= 5, true, 'at most five attempts per hour');
  },
);

Deno.test(
  'THR-15: a farm of fresh accounts on one code within the hour is flagged and rewarded nowhere',
  async () => {
    const w = await world();
    const farm = [3, 4, 5, 6].map((n) => uuid(n));
    for (const [i, id] of farm.entries()) {
      w.fresh(id, `farm${i}@example.com`);
      const res = await w.apply(id, CODE, `198.51.100.${i + 10}`);
      assertEquals(res.status, 201);
      await res.body?.cancel();
      w.qualify(id);
    }
    for (const referral of [...w.repo.referrals]) {
      const out = await w.evaluate(referral.id);
      assertEquals(out.action, 'flag', JSON.stringify(out));
      assert((out.flag_reasons as string[]).includes('velocity'));
    }
    assertEquals(w.repo.grants, [], 'no Pro days for the farm or the referrer');
    assertEquals(w.repo.credits, []);
  },
);

Deno.test('THR-15: an A→B→A loop and a recycled identity are rejected', async () => {
  const w = await world();
  const a = uuid(7);
  const b = uuid(8);
  w.fresh(a, 'loop-a@example.com');
  w.fresh(b, 'loop-b@example.com');
  w.repo.codes.set(a, { code: '3222223', disabled: false });
  w.repo.codes.set(b, { code: '4222224', disabled: false });
  assertEquals((await w.apply(b, '3222223')).status, 201, 'B applies A');
  assertEquals((await w.apply(a, '4222224')).status, 201, 'A applies B');
  w.qualify(a);
  w.qualify(b);
  // Both legs are rejected, in either evaluation order (the first rejection must not hide the loop
  // from the mirror leg).
  for (const referral of [...w.repo.referrals]) {
    const out = await w.evaluate(referral.id);
    assertEquals([out.action, out.reason], ['reject', 'loop']);
  }
  assertEquals(
    w.repo.referrals.map((r) => r.status),
    ['rejected', 'rejected'],
  );
  assertEquals(w.repo.grants, []);

  // A deleted account comes back with the same address: its tombstone rejects the new referral.
  const w2 = await world();
  const again = uuid(9);
  w2.fresh(again, 'deleted.before@example.com');
  w2.repo.tombstones.add(
    `email:${await hashIdHex(w2.h.deps.env, referralSignalMaterial('email', 'deleted.before@example.com') ?? '')}`,
  );
  assertEquals((await w2.apply(again, CODE)).status, 201);
  w2.qualify(again);
  const out = await w2.evaluate(w2.repo.referrals[0]?.id ?? '');
  assertEquals([out.action, out.reason], ['reject', 'tombstoned']);
  assertEquals(w2.repo.grants, []);
});

Deno.test('THR-15 / P-06: at the yearly cap the referrer reward is withheld', async () => {
  const w = await world();
  for (let i = 0; i < 6; i++) {
    w.repo.credits.push({
      referral_id: crypto.randomUUID(),
      user_id: REFERRER,
      side: 'referrer',
      days: 14,
      created_at: new Date(NOW.getTime() - (i + 1) * 20 * 24 * HOUR).toISOString(),
    });
  }
  const friend = uuid(10);
  w.fresh(friend, 'real.friend@example.com');
  assertEquals((await w.apply(friend, CODE)).status, 201);
  w.qualify(friend);
  const out = await w.evaluate(w.repo.referrals[0]?.id ?? '');
  assertEquals([out.action, out.referrer_withheld], ['reward', 'cap_reached']);
  assertEquals(
    w.repo.grants.map((g) => g.user_id),
    [friend],
  );
});
