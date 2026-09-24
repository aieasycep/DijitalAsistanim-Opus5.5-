/**
 * RevenueCat v2 client, mirror mapping and the shared sync (TEST_PLAN IT-RC-03/05/07/09,
 * UT-ENT-05…08; API_CONTRACTS JOB-24 tests).
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { AppError } from '../../errors.ts';
import { createLogger, memorySink } from '../../logging/logger.ts';
import { memoryBillingRepo, rcCustomer, stubRevenueCat } from '../../testing/business.ts';
import { jsonResponse, stubFetch } from '../../testing/fetch.ts';
import { createRevenueCatClient, revenueCatConfig, toMirrorSnapshot } from './revenuecat.ts';
import { syncBillingCustomer } from './sync.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-24T08:00:00.000Z');
const HOUR = 3600 * 1000;
const log = createLogger({ fn: 'worker', sink: memorySink().sink });

Deno.test('mirror mapping: trial, billing retry, cancellation, expiry (UT-ENT-05/06/07)', () => {
  const trial = toMirrorSnapshot(
    rcCustomer(USER, {
      active: true,
      expiresAt: new Date(NOW.getTime() + 30 * HOUR),
      status: 'trialing',
    }),
    { fetchedAt: NOW, allowSandbox: false },
  );
  assertEquals(
    [trial.is_active, trial.status, trial.period_type, trial.will_renew],
    [true, 'trial', 'trial', true],
  );
  assertEquals(trial.product_id, 'da_pro_monthly');
  assertEquals(trial.store, 'app_store');
  const retry = toMirrorSnapshot(
    rcCustomer(USER, {
      active: true,
      expiresAt: new Date(NOW.getTime() + 3 * 24 * HOUR),
      status: 'in_billing_retry',
    }),
    { fetchedAt: NOW, allowSandbox: false },
  );
  assertEquals(
    [retry.is_active, retry.status],
    [true, 'billing_issue'],
    'the REST snapshot is the truth',
  );
  assert(retry.grace_expires_at !== null);
  const cancelled = toMirrorSnapshot(
    rcCustomer(USER, {
      active: true,
      expiresAt: new Date(NOW.getTime() + 10 * 24 * HOUR),
      autoRenewal: 'will_not_renew',
    }),
    { fetchedAt: NOW, allowSandbox: false },
  );
  assertEquals(
    [cancelled.is_active, cancelled.status, cancelled.will_renew],
    [true, 'cancelled', false],
  );
  const expired = toMirrorSnapshot(
    rcCustomer(USER, { active: false, expiresAt: new Date(NOW.getTime() - HOUR) }),
    {
      fetchedAt: NOW,
      allowSandbox: false,
    },
  );
  assertEquals([expired.is_active, expired.status], [false, 'expired']);
  const none = toMirrorSnapshot(
    {
      found: false,
      entitlementId: 'entl_pro',
      customer: null,
      subscriptions: [],
      productIdentifiers: {},
    },
    { fetchedAt: NOW, allowSandbox: false },
  );
  assertEquals([none.is_active, none.status, none.store], [false, 'none', null]);
});

Deno.test(
  'mirror mapping: a sandbox purchase counts in production only for allow-listed testers (UT-ENT-08)',
  () => {
    const sandbox = rcCustomer(USER, {
      active: true,
      expiresAt: new Date(NOW.getTime() + 24 * HOUR),
      environment: 'sandbox',
    });
    const ignored = toMirrorSnapshot(sandbox, { fetchedAt: NOW, allowSandbox: false });
    assertEquals([ignored.is_active, ignored.status], [false, 'none']);
    const tester = toMirrorSnapshot(sandbox, { fetchedAt: NOW, allowSandbox: true });
    assertEquals([tester.is_active, tester.environment], [true, 'sandbox']);
  },
);

Deno.test(
  'the v2 client resolves the Pro entitlement once and reads customer, subscriptions, product',
  async () => {
    const stub = stubFetch((call) => {
      if (call.url.endsWith('/entitlements?limit=100')) {
        return jsonResponse({
          items: [
            { id: 'entl_other', lookup_key: 'basic' },
            { id: 'entl_pro', lookup_key: 'pro' },
          ],
        });
      }
      if (call.url.includes('/subscriptions')) {
        return jsonResponse({
          items: rcCustomer(USER, { active: true, expiresAt: NOW }).subscriptions,
          next_page: null,
        });
      }
      if (call.url.includes('/products/'))
        return jsonResponse({ id: 'prod_rc_1', store_identifier: 'da_pro_annual:annual' });
      if (call.url.includes(`/customers/${USER}`)) {
        return jsonResponse({
          id: USER,
          active_entitlements: {
            items: [{ entitlement_id: 'entl_pro', expires_at: NOW.getTime() }],
          },
        });
      }
      if (call.url.includes('/customers/missing')) return new Response('{}', { status: 404 });
      return new Response('unexpected', { status: 599 });
    });
    const config = revenueCatConfig({
      REVENUECAT_PROJECT_ID: 'proj1',
      REVENUECAT_API_V2_SECRET_KEY: 'sk_test_key',
    });
    assert(config !== null);
    assertEquals(revenueCatConfig({}), null);
    const client = createRevenueCatClient({ config, fetch: stub.fetch });
    const data = await client.fetchCustomer(USER);
    assertEquals(data.entitlementId, 'entl_pro');
    assertEquals(data.productIdentifiers, { prod_rc_1: 'da_pro_annual:annual' });
    assertEquals(stub.calls[0]?.headers.get('Authorization'), 'Bearer sk_test_key');
    assert(
      stub.calls.every((c) => c.url.startsWith('https://api.revenuecat.com/v2/projects/proj1/')),
    );
    const missing = await client.fetchCustomer('missing');
    assertEquals(missing.found, false);
    assertEquals(
      stub.calls.filter((c) => c.url.includes('/entitlements')).length,
      1,
      'the entitlement id is cached',
    );
  },
);

Deno.test('the v2 client normalises 401, 429 (Retry-After) and 5xx (IT-RC-09)', async () => {
  const config = { projectId: 'p', secretKey: 'sk_x', entitlementLookupKey: 'pro' };
  const answer = (status: number, headers: Record<string, string> = {}) =>
    createRevenueCatClient({
      config,
      fetch: stubFetch(() => new Response('{}', { status, headers })).fetch,
    });
  const unauthorized = await assertRejects(() => answer(401).fetchCustomer(USER), AppError);
  assertEquals(unauthorized.code, 'EXTERNAL_CREDENTIAL_REQUIRED');
  const limited = await assertRejects(
    () => answer(429, { 'Retry-After': '17' }).fetchCustomer(USER),
    AppError,
  );
  assertEquals([limited.code, limited.headers['Retry-After']], ['PROVIDER_RATE_LIMITED', '17']);
  const down = await assertRejects(() => answer(503).fetchCustomer(USER), AppError);
  assertEquals([down.code, down.retryable], ['PROVIDER_UNAVAILABLE', true]);
});

function deps(
  repo = memoryBillingRepo(),
  revenueCat = stubRevenueCat(new Map()),
  production = true,
) {
  return { repo, revenueCat, deps: { repo, revenueCat, production, now: () => NOW, log } };
}

Deno.test(
  'sync: anonymous ids are skipped; sandbox events in production are ignored before any REST call (IT-RC-05)',
  async () => {
    const { repo, revenueCat, deps: d } = deps();
    repo.events.set('evt-anon', {
      event_type: 'INITIAL_PURCHASE',
      environment: 'PRODUCTION',
      status: 'received',
    });
    const anonymous = await syncBillingCustomer(d, {
      appUserId: '$RCAnonymousID:abc',
      eventId: 'evt-anon',
      reason: 'webhook',
      correlationId: null,
    });
    assertEquals(anonymous, { status: 'skipped', reason: 'anonymous', user_id: null });
    assertEquals(repo.events.get('evt-anon')?.status, 'processed');
    repo.users.add(USER);
    repo.events.set('evt-sb', {
      event_type: 'INITIAL_PURCHASE',
      environment: 'SANDBOX',
      status: 'received',
    });
    const sandbox = await syncBillingCustomer(d, {
      appUserId: USER,
      eventId: 'evt-sb',
      reason: 'webhook',
      correlationId: null,
    });
    assertEquals(sandbox.status, 'skipped');
    assertEquals(repo.events.get('evt-sb')?.status, 'ignored_sandbox');
    assertEquals(revenueCat.calls, []);
    assertEquals(repo.mirrors.size, 0, 'stored, not applied');
    repo.sandboxAllowed.add(USER);
    revenueCat.calls.length = 0;
    const allowed = await syncBillingCustomer(d, {
      appUserId: USER,
      eventId: 'evt-sb',
      reason: 'webhook',
      correlationId: null,
    });
    assertEquals(allowed.status, 'synced');
  },
);

Deno.test(
  'sync: a missing RevenueCat key is EXTERNAL_CREDENTIAL_REQUIRED, never a fake success',
  async () => {
    const repo = memoryBillingRepo();
    repo.users.add(USER);
    const error = await assertRejects(
      () =>
        syncBillingCustomer(
          { repo, revenueCat: null, production: false, now: () => NOW, log },
          { appUserId: USER, eventId: null, reason: 'purchase_sync', correlationId: null },
        ),
      AppError,
    );
    assertEquals(error.code, 'EXTERNAL_CREDENTIAL_REQUIRED');
    assertEquals(repo.mirrors.size, 0);
  },
);

Deno.test('sync: unordered events converge on the REST truth (IT-RC-03)', async () => {
  const customers = new Map([
    [USER, rcCustomer(USER, { active: true, expiresAt: new Date(NOW.getTime() + 20 * 24 * HOUR) })],
  ]);
  const { repo, deps: d } = deps(memoryBillingRepo(), stubRevenueCat(customers));
  repo.users.add(USER);
  repo.events.set('evt-exp', {
    event_type: 'EXPIRATION',
    environment: 'PRODUCTION',
    status: 'received',
  });
  repo.events.set('evt-renew-old', {
    event_type: 'RENEWAL',
    environment: 'PRODUCTION',
    status: 'received',
  });
  await syncBillingCustomer(d, {
    appUserId: USER,
    eventId: 'evt-exp',
    reason: 'webhook',
    correlationId: null,
  });
  await syncBillingCustomer(d, {
    appUserId: USER,
    eventId: 'evt-renew-old',
    reason: 'webhook',
    correlationId: null,
  });
  const mirror = repo.mirrors.get(USER);
  assertEquals([mirror?.is_active, mirror?.status], [true, 'active']);
  assertEquals(repo.events.get('evt-exp')?.status, 'processed');
  assertEquals(
    repo.audits.map((a) => a.action),
    ['system.subscription.synced', 'system.subscription.synced'],
  );
});

Deno.test(
  'sync: a trial ending within 48 h schedules the 24 h reminder; a later one a re-check (IT-RC-07)',
  async () => {
    const expires = new Date(NOW.getTime() + 30 * HOUR);
    const customers = new Map([
      [USER, rcCustomer(USER, { active: true, expiresAt: expires, status: 'trialing' })],
    ]);
    const { repo, deps: d } = deps(memoryBillingRepo(), stubRevenueCat(customers));
    repo.users.add(USER);
    repo.events.set('evt-trial', {
      event_type: 'INITIAL_PURCHASE',
      environment: 'PRODUCTION',
      status: 'received',
    });
    const outcome = await syncBillingCustomer(d, {
      appUserId: USER,
      eventId: 'evt-trial',
      reason: 'webhook',
      correlationId: null,
    });
    assert(outcome.status === 'synced' && outcome.follow_ups.includes('trial_reminder'));
    const reminder = repo.jobs.find((j) => j.type === 'notification');
    assertEquals(
      reminder?.runAfter?.toISOString(),
      new Date(expires.getTime() - 24 * HOUR).toISOString(),
    );
    const build = (reminder?.payload as { build: Record<string, unknown> }).build;
    assertEquals(build.template_key, 'account.trial_ending');
    assertEquals(build.category, 'account');
    assertEquals(build.params_public, { plan: 'Aylık' });
    assertEquals(
      repo.analyticsRows.map((r) => [r.event_name, r.props]),
      [
        [
          'subscription_started',
          { product: 'da_pro_monthly', store: 'app_store', period_type: 'trial' },
        ],
      ],
    );

    const later = new Date(NOW.getTime() + 7 * 24 * HOUR);
    const repo2 = memoryBillingRepo();
    repo2.users.add(USER);
    await syncBillingCustomer(
      {
        repo: repo2,
        revenueCat: stubRevenueCat(
          new Map([
            [USER, rcCustomer(USER, { active: true, expiresAt: later, status: 'trialing' })],
          ]),
        ),
        production: true,
        now: () => NOW,
        log,
      },
      { appUserId: USER, eventId: null, reason: 'purchase_sync', correlationId: null },
    );
    const check = repo2.jobs.find((j) => j.type === 'billing_sync');
    assertEquals(
      check?.runAfter?.toISOString(),
      new Date(later.getTime() - 36 * HOUR).toISOString(),
    );
    assertEquals(repo2.jobs.filter((j) => j.type === 'notification').length, 0);
    assertEquals(
      repo2.audits[0]?.actorType,
      'user',
      'a purchase sync is audited with the user as actor',
    );
  },
);

Deno.test('sync: billing issue and Pro-ended pushes use the documented dedupe keys', async () => {
  const customers = new Map([
    [
      USER,
      rcCustomer(USER, {
        active: true,
        expiresAt: new Date(NOW.getTime() + 3 * 24 * HOUR),
        status: 'in_billing_retry',
        store: 'play_store',
      }),
    ],
  ]);
  const failure = { error: null as AppError | null };
  const revenueCat = stubRevenueCat(customers, failure);
  const repo = memoryBillingRepo();
  repo.users.add(USER);
  repo.events.set('evt-bi', {
    event_type: 'BILLING_ISSUE',
    environment: 'PRODUCTION',
    status: 'received',
  });
  const d = { repo, revenueCat, production: true, now: () => NOW, log };
  await syncBillingCustomer(d, {
    appUserId: USER,
    eventId: 'evt-bi',
    reason: 'webhook',
    correlationId: null,
  });
  const issue = repo.jobs.find((j) => j.idempotencyKey === `notif:${USER}:billing_issue:evt-bi`);
  assertEquals((issue?.payload as { build: { params_public: unknown } }).build.params_public, {
    store: 'Google Play',
  });
  customers.set(
    USER,
    rcCustomer(USER, { active: false, expiresAt: new Date(NOW.getTime() - HOUR) }),
  );
  repo.events.set('evt-exp', {
    event_type: 'EXPIRATION',
    environment: 'PRODUCTION',
    status: 'received',
  });
  await syncBillingCustomer(
    { ...d, now: () => new Date(NOW.getTime() + 1000) },
    { appUserId: USER, eventId: 'evt-exp', reason: 'webhook', correlationId: null },
  );
  assert(repo.jobs.some((j) => j.idempotencyKey.startsWith(`notif:${USER}:pro_ended:`)));
});
