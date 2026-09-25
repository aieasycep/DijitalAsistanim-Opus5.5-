/**
 * IT-RC-* (TEST_PLAN §6.6; API_CONTRACTS WH-05, JOB-24 `billing_sync`, API-BIZ-03; ADR-11): the
 * webhook stores and enqueues, the worker rebuilds the `subscriptions` mirror from the RevenueCat
 * REST v2 customer (the mock), never from the event body.
 */
import { assert, assertEquals, assertNotEquals } from '@std/assert';
import {
  call,
  count,
  createUser,
  drain,
  env,
  it,
  json,
  mock,
  one,
  q,
  releaseJobs,
} from './_harness/mod.ts';
import { createWorkerApp } from '../../functions/worker/app.ts';
import { billingSyncJob } from '../../functions/worker/handlers/billing_sync.ts';
import { createRegistry } from '../../functions/_shared/jobs/registry.ts';
import { supabaseJobsRepo } from '../../functions/_shared/jobs/client.ts';
import { supabaseBillingRepo } from '../../functions/_shared/services/billing/repo.ts';
import {
  createRevenueCatClient,
  revenueCatConfig,
} from '../../functions/_shared/services/billing/revenuecat.ts';
import { clientConfigFromEnv, serviceClient } from '../../functions/_shared/db/clients.ts';
import { loadEnv, processEnv } from '../../functions/_shared/env.ts';
import { createLogger } from '../../functions/_shared/logging/logger.ts';

const DAY = 86_400_000;

function event(name: string, fields: Record<string, unknown>): Record<string, unknown> {
  const body = JSON.parse(
    Deno.readTextFileSync(
      new URL(`../../functions/_shared/testing/fixtures/revenuecat/${name}.json`, import.meta.url),
    ),
  ) as { event: Record<string, unknown> };
  for (const [k, v] of Object.entries(body.event))
    if (v === '__app_user_id__' || v === '__event_id__') delete body.event[k];
  body.event = { ...body.event, id: crypto.randomUUID().toUpperCase(), ...fields };
  for (const key of ['aliases'])
    if (Array.isArray(body.event[key])) body.event[key] = [body.event.app_user_id];
  return body;
}

async function deliver(
  body: Record<string, unknown>,
  auth: string | null = `Bearer ${env('REVENUECAT_WEBHOOK_AUTH')}`,
): Promise<Response> {
  return await call('webhooks-revenuecat', 'POST', '', {
    headers: {
      'Content-Type': 'application/json',
      ...(auth === null ? {} : { Authorization: auth }),
    },
    rawBody: JSON.stringify(body),
  });
}

async function mirror(userId: string): Promise<Record<string, unknown> | null> {
  return (await q(`select * from public.subscriptions where user_id = $1`, [userId]))[0] ?? null;
}

async function entitlement(userId: string): Promise<{ entitlement: string; is_active: boolean }> {
  return await one(`select * from private.effective_entitlement_at($1, now())`, [userId]);
}

it('IT-RC-01', 'missing or wrong Authorization → 401 and nothing stored', async () => {
  const user = await createUser();
  const body = event('webhook_renewal', { app_user_id: user.id, original_app_user_id: user.id });
  for (const auth of [null, 'Bearer not-the-secret', `Basic ${env('REVENUECAT_WEBHOOK_AUTH')}`]) {
    const res = await deliver(body, auth);
    const out = await json<{ error: { code: string } }>(res);
    assertEquals(res.status, 401);
    assertEquals(out.error.code, 'WEBHOOK_SIGNATURE_INVALID');
  }
  assertEquals(
    await count(`select 1 from public.billing_events where rc_app_user_id = $1`, [user.id]),
    0,
  );
  assertEquals(await count(`select 1 from public.jobs where type = 'billing_sync'`), 0);
});

it(
  'IT-RC-02',
  'the same event id three times → one billing_events row and one billing_sync job',
  async () => {
    const user = await createUser();
    const body = event('webhook_renewal', { app_user_id: user.id, original_app_user_id: user.id });
    for (let i = 0; i < 3; i++) {
      const res = await deliver(body);
      assertEquals(res.status, 200, await res.text());
    }
    assertEquals(
      await count(`select 1 from public.billing_events where event_id = $1`, [
        (body.event as { id: string }).id,
      ]),
      1,
    );
    assertEquals(
      await count(`select 1 from public.jobs where type = 'billing_sync' and user_id = $1`, [
        user.id,
      ]),
      1,
    );
  },
);

it(
  'IT-RC-03',
  'out of order: EXPIRATION then an older RENEWAL → the mirror follows REST (active)',
  async () => {
    const user = await createUser();
    await mock.revenuecat({
      op: 'customer',
      id: user.id,
      fixture: 'revenuecat/customer_v2_active.json',
    });
    const now = Date.now();
    const expiration = event('webhook_expiration', {
      app_user_id: user.id,
      original_app_user_id: user.id,
      event_timestamp_ms: now,
    });
    const renewal = event('webhook_renewal', {
      app_user_id: user.id,
      original_app_user_id: user.id,
      event_timestamp_ms: now - DAY,
    });
    await deliver(expiration).then((r) => r.body?.cancel());
    await deliver(renewal).then((r) => r.body?.cancel());
    await releaseJobs();
    await drain({ types: ['billing_sync'] });
    const row = await mirror(user.id);
    assert(row !== null);
    assertEquals(row.status, 'active');
    assertEquals(row.is_active, true);
    assert(
      [(expiration.event as { id: string }).id, (renewal.event as { id: string }).id].includes(
        String(row.last_event_id),
      ),
    );
    assert(
      (await mock.requests(`/revenuecat/v2/projects/projintegration/customers/${user.id}`))
        .length >= 1,
      'REST re-fetch',
    );
    assertEquals((await entitlement(user.id)).is_active, true);
  },
);

it('IT-RC-04', 'TRANSFER recomputes every id in transferred_from and transferred_to', async () => {
  const from = await createUser();
  const to = await createUser();
  await mock.revenuecat({
    op: 'customer',
    id: to.id,
    fixture: 'revenuecat/customer_v2_active.json',
  });
  await mock.revenuecat({
    op: 'customer',
    id: from.id,
    fixture: 'revenuecat/customer_v2_expired.json',
  });
  const body = event('webhook_transfer', { transferred_from: [from.id], transferred_to: [to.id] });
  const res = await deliver(body);
  assertEquals(res.status, 200, await res.text());
  const jobs = await q<{ user_id: string }>(
    `select user_id from public.jobs where type = 'billing_sync'`,
  );
  assertEquals(new Set(jobs.map((j) => j.user_id)), new Set([from.id, to.id]));
  await releaseJobs();
  await drain({ types: ['billing_sync'] });
  for (const id of [from.id, to.id])
    assert(
      (await mock.requests(`/revenuecat/v2/projects/projintegration/customers/${id}`)).length >= 1,
      id,
    );
  assertEquals((await mirror(to.id))?.is_active, true);
  assertNotEquals((await mirror(from.id))?.is_active, true);
});

it(
  'IT-RC-05',
  'a SANDBOX event in production for a non-allow-listed user is stored, not applied',
  async () => {
    const user = await createUser();
    await mock.revenuecat({
      op: 'customer',
      id: user.id,
      fixture: 'revenuecat/customer_v2_active.json',
      environment: 'sandbox',
    });
    const body = event('webhook_renewal', {
      app_user_id: user.id,
      original_app_user_id: user.id,
      environment: 'SANDBOX',
    });
    const res = await deliver(body);
    assertEquals(res.status, 200, await res.text());
    // The real billing_sync handler with the production flag (the production entrypoint refuses the
    // test-only base URLs, so this worker is assembled from the same factories).
    const raw = processEnv();
    const system = serviceClient(clientConfigFromEnv(raw));
    const config = revenueCatConfig(loadEnv(raw));
    const worker = createWorkerApp({
      secret: env('CRON_SECRET'),
      repo: supabaseJobsRepo(system),
      registry: createRegistry([
        billingSyncJob({
          repo: supabaseBillingRepo(system),
          revenueCat: config === null ? null : createRevenueCatClient({ config }),
          production: true,
        }) as never,
      ]),
      log: createLogger({ fn: 'worker', sink: () => {} }),
    });
    await releaseJobs();
    const run = await worker.request('/worker/run', {
      method: 'POST',
      headers: {
        apikey: env('CRON_SECRET'),
        'content-type': 'application/json',
        'X-DA-Client': 'ios/1.4.0 (812)',
      },
      body: JSON.stringify({ types: ['billing_sync'] }),
    });
    assertEquals(run.status, 200, await run.text());
    const stored = await one<{ process_status: string }>(
      `select process_status from public.billing_events where event_id = $1`,
      [(body.event as { id: string }).id],
    );
    assertEquals(stored.process_status, 'ignored_sandbox');
    assertNotEquals((await mirror(user.id))?.is_active, true);
    assertEquals((await entitlement(user.id)).is_active, false);
  },
);

it('IT-RC-06', 'a TEST event → 200 with no state change', async () => {
  const user = await createUser();
  const body = event('webhook_test', { app_user_id: user.id, original_app_user_id: user.id });
  const res = await deliver(body);
  assertEquals(res.status, 200, await res.text());
  await releaseJobs();
  await drain({ types: ['billing_sync'] });
  assertEquals(await mirror(user.id), null);
  assertEquals((await entitlement(user.id)).is_active, false);
});

it(
  'IT-RC-07',
  'INITIAL_PURCHASE with trial schedules the trial_ending notification 24 h before expiry',
  async () => {
    const user = await createUser();
    const expiresIn = 40 * 3_600_000;
    await mock.revenuecat({
      op: 'customer',
      id: user.id,
      fixture: 'revenuecat/customer_v2_trial.json',
      expires_in_ms: expiresIn,
    });
    const expiresAt = Date.now() + expiresIn;
    const body = event('webhook_initial_purchase_trial', {
      app_user_id: user.id,
      original_app_user_id: user.id,
      expiration_at_ms: expiresAt,
      event_timestamp_ms: Date.now(),
    });
    await deliver(body).then((r) => r.body?.cancel());
    await releaseJobs();
    await drain({ types: ['billing_sync'] });
    const row = await mirror(user.id);
    assertEquals(row?.period_type, 'trial');
    const reminder = await one<{ run_after: Date; idempotency_key: string }>(
      `select run_after, idempotency_key from public.jobs where type = 'notification' and user_id = $1 and idempotency_key like '%trial_ending%'`,
      [user.id],
    );
    const lead = Date.parse(String(row?.expires_at)) - new Date(reminder.run_after).getTime();
    assert(Math.abs(lead - 24 * 3_600_000) < 60_000, `lead ${lead} ms`);
  },
);

it('IT-RC-08', 'POST /purchases/sync re-fetches REST and makes the entitlement pro', async () => {
  const user = await createUser();
  assertEquals((await entitlement(user.id)).is_active, false);
  await mock.revenuecat({
    op: 'customer',
    id: user.id,
    fixture: 'revenuecat/customer_v2_active.json',
  });
  const res = await call('api', 'POST', '/purchases/sync', {
    jwt: user.jwt,
    key: crypto.randomUUID(),
    body: { reason: 'purchase', rc_app_user_id: user.id },
  });
  const out = await json<Record<string, unknown>>(res);
  assertEquals(res.status, 200, JSON.stringify(out));
  await releaseJobs();
  await drain({ types: ['billing_sync'] });
  assertEquals((await mirror(user.id))?.status, 'active');
  const e = await entitlement(user.id);
  assertEquals(e.entitlement, 'pro');
  assertEquals(e.is_active, true);
  // Another user's app user id is refused.
  const other = await call('api', 'POST', '/purchases/sync', {
    jwt: user.jwt,
    key: crypto.randomUUID(),
    body: { reason: 'restore', rc_app_user_id: crypto.randomUUID() },
  });
  await other.body?.cancel();
  assertEquals(other.status, 422);
});

it(
  'IT-RC-08',
  'E2E paywall: the mock store activation (/revenuecat/__activate) then POST /purchases/sync → pro',
  async () => {
    const user = await createUser();
    // The Maestro harness' `POST /revenuecat/activate` forwards here (scripts/e2e/harness-server.ts).
    const activated = await fetch(`${env('DA_IT_MOCK_URL')}/revenuecat/__activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_user_id: user.id, product: 'da_pro_monthly' }),
    });
    assertEquals(activated.status, 200, await activated.text());
    const res = await call('api', 'POST', '/purchases/sync', {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: { reason: 'purchase', rc_app_user_id: user.id },
    });
    assertEquals(res.status, 200, JSON.stringify(await json(res)));
    await releaseJobs();
    await drain({ types: ['billing_sync'] });
    const row = await mirror(user.id);
    assertEquals(row?.status, 'active');
    assertEquals(row?.product_id, 'da_pro_monthly:monthly');
    const e = await entitlement(user.id);
    assertEquals([e.entitlement, e.is_active], ['pro', true]);
  },
);

it('IT-RC-09', 'REST 429 → backoff honouring the rate-limit headers', async () => {
  const user = await createUser();
  await mock.revenuecat({
    op: 'customer',
    id: user.id,
    fixture: 'revenuecat/customer_v2_active.json',
  });
  await mock.script(`GET /revenuecat/v2/projects/projintegration/customers/${user.id}`, [
    {
      status: 429,
      headers: { 'Retry-After': '7', 'RateLimit-Reset': '7' },
      body: {
        object: 'error',
        type: 'rate_limit_error',
        message: 'Too many requests',
        backoff_ms: 7000,
      },
    },
  ]);
  await deliver(
    event('webhook_renewal', { app_user_id: user.id, original_app_user_id: user.id }),
  ).then((r) => r.body?.cancel());
  await releaseJobs();
  const started = Date.now();
  await drain({ types: ['billing_sync'], rounds: 1 });
  const job = await one<{ status: string; run_after: Date }>(
    `select status, run_after from public.jobs where type = 'billing_sync' and user_id = $1`,
    [user.id],
  );
  assertEquals(job.status, 'retrying');
  const delay = new Date(job.run_after).getTime() - started;
  assert(delay >= 6000 && delay < 30_000, `retry after ${delay} ms`);
  await releaseJobs();
  await drain({ types: ['billing_sync'] });
  assertEquals((await mirror(user.id))?.is_active, true);
});
