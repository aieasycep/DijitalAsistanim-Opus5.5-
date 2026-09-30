/**
 * `billing_sync` (JOB-24) and `referral_evaluate` (JOB-25) through the job runner: payload shapes,
 * poison payloads, retry semantics (TEST_PLAN IT-RC-09) and the handler registry wiring.
 */
import { assertEquals } from '@std/assert';
import { AppError } from '../../_shared/errors.ts';
import { runWorker } from '../../_shared/jobs/runner.ts';
import { createLogger, memorySink } from '../../_shared/logging/logger.ts';
import {
  memoryBillingRepo,
  memoryReferralRepo,
  rcCustomer,
  stubRevenueCat,
} from '../../_shared/testing/business.ts';
import { randomBase64 } from '../../_shared/testing/env.ts';
import { memoryJobsRepo } from '../../_shared/testing/jobs.ts';
import { loadKeyring } from '../../_shared/crypto/token-cipher.ts';
import { memoryCredentials } from '../../_shared/testing/credentials.ts';
import { createHandlerRegistry } from './index.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-09-24T08:00:00Z');

function setup(options: { failure?: AppError | null; revenueCat?: boolean } = {}) {
  const jobs = memoryJobsRepo(() => NOW);
  const billing = memoryBillingRepo();
  billing.users.add(USER);
  const failure = { error: options.failure ?? null };
  const customers = new Map([
    [USER, rcCustomer(USER, { active: true, expiresAt: new Date(NOW + 20 * 86_400_000) })],
  ]);
  const referrals = memoryReferralRepo(() => new Date(NOW));
  const registry = createHandlerRegistry({
    credentials: memoryCredentials(),
    keyring: () =>
      loadKeyring({ token_encryption_keys: { 1: randomBase64(32) }, TOKEN_ENC_ACTIVE_VERSION: 1 }),
    business: {
      billing: {
        repo: billing,
        revenueCat: options.revenueCat === false ? null : stubRevenueCat(customers, failure),
        production: true,
        now: () => new Date(NOW),
      },
      referrals: {
        repo: referrals,
        pepper: { HASH_PEPPER: randomBase64(32) },
        now: () => new Date(NOW),
      },
    },
  });
  const run = () =>
    runWorker({
      repo: jobs,
      registry,
      log: createLogger({ fn: 'worker', sink: memorySink().sink }),
      now: () => NOW,
      random: () => 0.5,
    });
  return { jobs, billing, referrals, registry, run };
}

Deno.test('the worker registry serves billing_sync and referral_evaluate', () => {
  const { registry } = setup();
  assertEquals(
    ['billing_sync', 'referral_evaluate'].every((t) => registry.types.includes(t as never)),
    true,
  );
});

Deno.test('billing_sync accepts the webhook and the admin / reconcile payload shapes', async () => {
  const { jobs, billing, run } = setup();
  await jobs.enqueue({
    type: 'billing_sync',
    idempotencyKey: 'b:1',
    payload: { app_user_id: USER, event_id: null, reason: 'webhook' },
  });
  await jobs.enqueue({
    type: 'billing_sync',
    idempotencyKey: 'b:2',
    payload: { user_id: USER, reason: 'admin' },
  });
  await jobs.enqueue({ type: 'billing_sync', idempotencyKey: 'b:3', payload: { reason: 'admin' } });
  const summary = await run();
  assertEquals([summary.completed, summary.failed], [2, 1]);
  assertEquals(jobs.byKey('b:3')?.last_error_code, 'POISON_PAYLOAD');
  assertEquals(billing.mirrors.get(USER)?.is_active, true);
  assertEquals((jobs.byKey('b:1')?.result as { synced?: boolean } | null)?.synced, true);
});

Deno.test(
  'billing_sync: a missing key fails for good; a RevenueCat 429 retries after Retry-After (IT-RC-09)',
  async () => {
    const missing = setup({ revenueCat: false });
    await missing.jobs.enqueue({
      type: 'billing_sync',
      idempotencyKey: 'm',
      payload: { app_user_id: USER, reason: 'reconcile' },
    });
    await missing.run();
    assertEquals(missing.jobs.byKey('m')?.status, 'failed');
    assertEquals(missing.jobs.byKey('m')?.last_error_code, 'EXTERNAL_CREDENTIAL_REQUIRED');

    const limited = setup({
      failure: new AppError('PROVIDER_RATE_LIMITED', { headers: { 'Retry-After': '42' } }),
    });
    await limited.jobs.enqueue({
      type: 'billing_sync',
      idempotencyKey: 'r',
      payload: { app_user_id: USER, reason: 'webhook' },
    });
    await limited.run();
    assertEquals(limited.jobs.byKey('r')?.status, 'retrying');
    assertEquals(limited.jobs.failCalls[0]?.retryAfterSeconds, 42);
  },
);

Deno.test('referral_evaluate validates its payload and records the decision', async () => {
  const { jobs, referrals, run } = setup();
  referrals.addUser('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { email: 'a@example.com' });
  referrals.addUser('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
    email: 'b@example.com',
    created_at: new Date(NOW - 50 * 3_600_000).toISOString(),
    onboarding_completed_at: new Date(NOW - 49 * 3_600_000).toISOString(),
    account_connected_at: new Date(NOW - 48 * 3_600_000).toISOString(),
    first_briefing_at: new Date(NOW - 24 * 3_600_000).toISOString(),
  });
  referrals.codes.set('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { code: '2222222', disabled: false });
  const applied = await referrals.apply({
    refereeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    referrerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    code: '2222222',
    source: 'manual',
    deviceHash: null,
    emailHash: null,
    signals: {},
    runAfter: new Date(NOW),
    correlationId: null,
  });
  await jobs.enqueue({
    type: 'referral_evaluate',
    idempotencyKey: 'e:1',
    payload: { referral_id: applied.referral_id },
  });
  await jobs.enqueue({
    type: 'referral_evaluate',
    idempotencyKey: 'e:2',
    payload: { referral_id: 'not-a-uuid' },
  });
  await run();
  assertEquals(jobs.byKey('e:1')?.status, 'completed');
  assertEquals((jobs.byKey('e:1')?.result as { action?: string } | null)?.action, 'reward');
  assertEquals(referrals.referrals[0]?.status, 'rewarded');
  assertEquals(jobs.byKey('e:2')?.status, 'failed');
});
