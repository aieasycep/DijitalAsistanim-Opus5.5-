/**
 * Referral apply, overview and JOB-25 evaluation over the in-memory repository (TEST_PLAN
 * UT-REF-01…10 through the Edge flow; API_CONTRACTS API-BIZ-01/02, JOB-25 tests).
 */
import { assert, assertEquals, assertMatch, assertRejects } from '@std/assert';
import { isValidReferralCode, referralSignalMaterial } from '@da/domain';
import { hashIdHex } from '../../crypto/hash.ts';
import { AppError } from '../../errors.ts';
import { createLogger, memorySink } from '../../logging/logger.ts';
import { memoryReferralRepo } from '../../testing/business.ts';
import { randomBase64 } from '../../testing/env.ts';
import { evaluateReferralJob } from './evaluate.ts';
import { applyReferralCode, ensureReferralCode, maskedLabel, referralOverview } from './service.ts';

const REFERRER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REFEREE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INSTALL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const T0 = new Date('2026-09-20T09:00:00.000Z');
const HOUR = 3600 * 1000;
const pepper = { HASH_PEPPER: randomBase64(32) };
const log = createLogger({ fn: 'worker', sink: memorySink().sink });

function world(now = T0) {
  const clock = { now };
  const repo = memoryReferralRepo(() => clock.now);
  repo.addUser(REFERRER, {
    email: 'referrer@example.com',
    display_name: 'Ayşe',
    created_at: '2026-01-01T00:00:00Z',
  });
  repo.addUser(REFEREE, {
    email: 'zeynep@example.com',
    display_name: 'zeynep',
    created_at: T0.toISOString(),
    installation_ids: [INSTALL],
  });
  repo.codes.set(REFERRER, { code: '2222222', disabled: false });
  return { repo, clock };
}

const apply = (
  repo: ReturnType<typeof world>['repo'],
  now: Date,
  overrides: Partial<Parameters<typeof applyReferralCode>[1]> = {},
) =>
  applyReferralCode(
    { repo, pepper, now },
    {
      userId: REFEREE,
      code: '2222222',
      installationId: INSTALL,
      source: 'deep_link',
      ip: '203.0.113.9',
      correlationId: null,
      ...overrides,
    },
  );

Deno.test(
  'GET /referrals/me data: lazy 7-character code with check character, masked labels, cap',
  async () => {
    const { repo } = world();
    const bytes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    let i = 0;
    const code = await ensureReferralCode(repo, REFEREE, () => bytes[i++ % bytes.length] ?? 0);
    assert(isValidReferralCode(code));
    assertEquals(code.length, 7);
    assertEquals(await ensureReferralCode(repo, REFEREE), code, 'creation is idempotent per user');
    await apply(repo, new Date(T0.getTime() + HOUR));
    const me = await referralOverview(
      { repo, publicWebUrl: 'https://dijitalasistan.example/', now: T0 },
      REFERRER,
    );
    assertEquals(me.share_url, 'https://dijitalasistan.example/r/2222222');
    assertEquals(
      me.referrals.map((r) => r.label),
      ['Z***'],
    );
    assertEquals([me.cap_per_year, me.remaining_this_year, me.reward_days], [6, 6, 14]);
    assert(!JSON.stringify(me).includes('@'), 'labels never include e-mails');
    assertEquals(maskedLabel(null), 'X***');
    assertEquals(maskedLabel('i'), 'İ***');
    await assertRejects(
      () => referralOverview({ repo, publicWebUrl: undefined, now: T0 }, REFERRER),
      AppError,
      'EXTERNAL_CREDENTIAL_REQUIRED',
    );
  },
);

Deno.test(
  'POST /referrals/apply data: pending, hashed signals, evaluation at the 48 h age',
  async () => {
    const { repo } = world();
    const now = new Date(T0.getTime() + HOUR);
    const data = await apply(repo, now);
    assertEquals(data.status, 'pending');
    assertEquals(data.reward_days, 14);
    assertEquals(
      data.qualification.eligible_after,
      new Date(T0.getTime() + 48 * HOUR).toISOString(),
    );
    const row = repo.referrals[0];
    assertMatch(row?.email_hash ?? '', /^[0-9a-f]{64}$/);
    assertEquals(
      row?.email_hash,
      await hashIdHex(pepper, referralSignalMaterial('email', 'zeynep@example.com') ?? ''),
    );
    assert(!JSON.stringify(row).includes('zeynep@example.com'), 'no raw e-mail is stored');
    assert(!JSON.stringify(row).includes('203.0.113'), 'no raw IP is stored');
    assertEquals(
      repo.jobs[0]?.runAfter?.toISOString(),
      new Date(T0.getTime() + 48 * HOUR).toISOString(),
    );
    await assertRejects(() => apply(repo, now), AppError, 'REFERRAL_ALREADY_APPLIED');
  },
);

Deno.test(
  'POST /referrals/apply rejects invalid codes, self-referral and a closed window',
  async () => {
    const { repo } = world();
    await assertRejects(
      () => apply(repo, T0, { code: '2222223' }),
      AppError,
      'REFERRAL_CODE_INVALID',
    );
    await assertRejects(
      () => apply(repo, T0, { code: '3222223' }),
      AppError,
      'REFERRAL_CODE_INVALID',
    );
    repo.codes.set(REFEREE, { code: '3222223', disabled: false });
    await assertRejects(() => apply(repo, T0, { code: '3222223' }), AppError, 'REFERRAL_SELF');
    const owner = repo.users.get(REFERRER);
    if (owner !== undefined)
      owner.device_hashes = [await hashIdHex(pepper, `installation:${INSTALL}`)];
    await assertRejects(
      () => apply(repo, T0),
      AppError,
      'REFERRAL_SELF',
      'a shared installation is self-referral',
    );
    if (owner !== undefined) owner.device_hashes = [];
    await assertRejects(
      () => apply(repo, new Date(T0.getTime() + 8 * 24 * HOUR)),
      AppError,
      'REFERRAL_WINDOW_CLOSED',
    );
  },
);

async function qualifiedWorld() {
  const w = world();
  await apply(w.repo, new Date(T0.getTime() + HOUR));
  const referee = w.repo.users.get(REFEREE);
  if (referee !== undefined) {
    referee.onboarding_completed_at = new Date(T0.getTime() + 2 * HOUR).toISOString();
    referee.account_connected_at = new Date(T0.getTime() + 3 * HOUR).toISOString();
    referee.first_briefing_at = new Date(T0.getTime() + 24 * HOUR).toISOString();
  }
  w.clock.now = new Date(T0.getTime() + 49 * HOUR);
  const evaluate = () =>
    evaluateReferralJob(
      { repo: w.repo, pepper, now: () => w.clock.now, log },
      w.repo.referrals[0]?.id ?? '',
      null,
    );
  return { ...w, evaluate };
}

Deno.test(
  'JOB-25 rewards a clean qualified referral once, both sides, and notifies both',
  async () => {
    const { repo, evaluate } = await qualifiedWorld();
    const result = await evaluate();
    assertEquals(result.action, 'reward');
    assertEquals(repo.referrals[0]?.status, 'rewarded');
    const id = repo.referrals[0]?.id ?? '';
    assertEquals(repo.grants.map((g) => g.key).sort(), [
      `referral:${id}:referee`,
      `referral:${id}:referrer`,
    ]);
    const pushes = repo.jobs.filter((j) => j.type === 'notification');
    assertEquals(pushes.map((j) => j.idempotencyKey).sort(), [
      `notif:${REFERRER}:referral:${id}:referrer`,
      `notif:${REFEREE}:referral:${id}:referee`,
    ]);
    const build = (pushes[0]?.payload as { build: Record<string, unknown> }).build;
    assertEquals(build.template_key, 'account.referral_reward');
    assertEquals(build.deeplink, 'dijitalasistan://settings/referral');
    const again = await evaluate();
    assertEquals(again.replayed, true);
    assertEquals(repo.credits.length, 2, 'double evaluation → one credit per side');
    assertEquals(repo.jobs.filter((j) => j.type === 'notification').length, 2);
  },
);

Deno.test(
  'JOB-25 waits (re-enqueued) until qualified and rejects after the 30-day window',
  async () => {
    const w = world();
    await apply(w.repo, new Date(T0.getTime() + HOUR));
    w.clock.now = new Date(T0.getTime() + 49 * HOUR);
    const evaluate = () =>
      evaluateReferralJob(
        { repo: w.repo, pepper, now: () => w.clock.now, log },
        w.repo.referrals[0]?.id ?? '',
        null,
      );
    const wait = await evaluate();
    assertEquals(wait.action, 'wait');
    const recheck = w.repo.jobs.find((j) =>
      j.idempotencyKey.startsWith(`referral_evaluate:${w.repo.referrals[0]?.id}:2026`),
    );
    assertEquals(
      recheck?.runAfter?.toISOString(),
      new Date(w.clock.now.getTime() + 12 * HOUR).toISOString(),
    );
    w.clock.now = new Date(T0.getTime() + 31 * 24 * HOUR);
    const timeout = await evaluate();
    assertEquals([timeout.action, timeout.reason], ['reject', 'qualification_timeout']);
  },
);

Deno.test(
  'JOB-25 anti-abuse: shared device flags, velocity flags, loops and tombstones reject, the cap withholds',
  async () => {
    {
      const { repo, evaluate } = await qualifiedWorld();
      const owner = repo.users.get(REFERRER);
      if (owner !== undefined) owner.device_hashes = [repo.referrals[0]?.device_hash ?? ''];
      const flagged = await evaluate();
      assertEquals(flagged.action, 'flag');
      assertEquals(flagged.flag_reasons, ['shared_device']);
    }
    {
      const { repo, evaluate } = await qualifiedWorld();
      for (let i = 0; i < 3; i++) {
        repo.referrals.push({
          ...(repo.referrals[0] as NonNullable<(typeof repo.referrals)[0]>),
          id: crypto.randomUUID(),
          referee_id: crypto.randomUUID(),
          email_hash: null,
          device_hash: null,
          applied_at: new Date(
            Date.parse(repo.referrals[0]?.applied_at ?? '') - (i + 1) * 60_000,
          ).toISOString(),
        });
      }
      const velocity = await evaluate();
      assertEquals(velocity.action, 'flag');
      assert((velocity.flag_reasons as string[]).includes('velocity'));
    }
    {
      const { repo, evaluate } = await qualifiedWorld();
      repo.referrals.push({
        ...(repo.referrals[0] as NonNullable<(typeof repo.referrals)[0]>),
        id: crypto.randomUUID(),
        referrer_id: REFEREE,
        referee_id: REFERRER,
      });
      const loop = await evaluate();
      assertEquals([loop.action, loop.reason], ['reject', 'loop']);
    }
    {
      const { repo, evaluate } = await qualifiedWorld();
      repo.tombstones.add(
        `email:${await hashIdHex(pepper, referralSignalMaterial('email', 'zeynep@example.com') ?? '')}`,
      );
      const tombstoned = await evaluate();
      assertEquals([tombstoned.action, tombstoned.reason], ['reject', 'tombstoned']);
    }
    {
      const { repo, evaluate } = await qualifiedWorld();
      for (let i = 0; i < 6; i++) {
        repo.credits.push({
          referral_id: crypto.randomUUID(),
          user_id: REFERRER,
          side: 'referrer',
          days: 14,
          created_at: new Date(T0.getTime() - (i + 1) * 24 * HOUR).toISOString(),
        });
      }
      const capped = await evaluate();
      assertEquals([capped.action, capped.referrer_withheld], ['reward', 'cap_reached']);
      assertEquals(capped.sides, ['referee']);
      assertEquals(
        repo.jobs.filter((j) => j.type === 'notification').map((j) => j.userId),
        [REFEREE],
      );
    }
  },
);
