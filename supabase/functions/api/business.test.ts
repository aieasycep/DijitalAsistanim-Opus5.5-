/**
 * API-BIZ-01/02/03 and the Pro gate matrix (IMPLEMENTATION_PLAN T-7.01…T-7.03; TEST_PLAN IT-RC-08,
 * IT-RC-09, UT-ENT-09; API_CONTRACTS §4.1 "Server enforcement points").
 */
import { assert, assertEquals, assertNotEquals } from '@std/assert';
import { routes } from '@da/validation';
import { AppError } from '../_shared/errors.ts';
import { mountRoute } from '../_shared/http/validate.ts';
import { PRO_ROUTE_FEATURES } from '../_shared/services/entitlements/middleware.ts';
import { rcCustomer, stubRevenueCat } from '../_shared/testing/business.ts';
import { USER_A, USER_B } from '../_shared/testing/jwt.ts';
import { createApiApp } from './app.ts';
import type { RouteRegistrar } from './deps.ts';
import { call, createHarness, NOW } from './testing.ts';

const WEB = 'https://dijitalasistan.example';
const INSTALLATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const key = () => crypto.randomUUID();

Deno.test(
  'Pro gate matrix: every Pro route answers 402 ENTITLEMENT_REQUIRED {feature} to a Free user',
  async () => {
    const h = await createHarness();
    const stubs: RouteRegistrar = (app, kit) => {
      for (const routeKey of Object.keys(PRO_ROUTE_FEATURES)) {
        const contract = routes[routeKey as keyof typeof routes];
        mountRoute(app, contract, ...kit.chain({ gate: true, rateLimit: 'api_default' }), (c) =>
          Promise.resolve(c.json({ data: { reached: true } })),
        );
      }
    };
    const app = createApiApp(h.deps, [stubs]);
    const free = await h.token(USER_A);
    const pro = await h.token(USER_B);
    h.business.gate.plans.set(USER_B, 'pro');
    for (const [routeKey, feature] of Object.entries(PRO_ROUTE_FEATURES)) {
      const [method, template] = routeKey.split(' ') as [string, string];
      const path = template.replace(/:[A-Za-z]+/g, '11111111-1111-4111-8111-111111111111');
      const request = (jwt: string) =>
        app.request(`/api${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${jwt}`,
            'X-DA-Client': 'android/1.4.0 (812)',
            'Content-Type': 'application/json',
            'Idempotency-Key': key(),
          },
          body: '{}',
        });
      const denied = await request(free);
      assertEquals(denied.status, 402, routeKey);
      const error = (await denied.json()).error;
      assertEquals(
        [error.code, error.details.feature],
        ['ENTITLEMENT_REQUIRED', feature],
        routeKey,
      );
      const allowed = await request(pro);
      assertNotEquals(allowed.status, 402, routeKey);
      await allowed.body?.cancel();
    }
    const unaffected = await call(h, 'GET', '/me/entitlements', { jwt: free });
    assertEquals(unaffected.status, 200, 'routes outside the matrix are not gated');
    await unaffected.body?.cancel();
  },
);

Deno.test(
  'POST /purchases/sync refreshes the mirror from RevenueCat and returns the entitlement (IT-RC-08)',
  async () => {
    const customers = new Map([
      [
        USER_A,
        rcCustomer(USER_A, {
          active: true,
          expiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
          product: 'da_pro_annual:annual',
        }),
      ],
    ]);
    const h = await createHarness({ revenueCat: stubRevenueCat(customers) });
    h.business.billing.users.add(USER_A);
    const jwt = await h.token(USER_A);
    const idempotencyKey = key();
    const body = { reason: 'purchase', rc_app_user_id: USER_A };
    const res = await call(h, 'POST', '/purchases/sync', { jwt, key: idempotencyKey, body });
    assertEquals(res.status, 200);
    const payload = await res.json();
    assert(routes['POST /purchases/sync'].response.safeParse(payload).success);
    assertEquals(payload.data.stale, false);
    assertEquals(payload.data.entitlement.is_active, true);
    assertEquals(payload.data.entitlement.store.product_id, 'da_pro_annual:annual');
    assertEquals(h.business.billing.audits[0]?.action, 'system.subscription.synced');
    const replay = await call(h, 'POST', '/purchases/sync', { jwt, key: idempotencyKey, body });
    assertEquals(replay.headers.get('Idempotency-Replayed'), 'true');
    assertEquals((await replay.json()).data.entitlement.is_active, true);
    const entitlements = await call(h, 'GET', '/me/entitlements', { jwt });
    assertEquals(
      (await entitlements.json()).data.entitlement.source,
      'store',
      'GET /me/entitlements stays consistent',
    );
  },
);

Deno.test(
  'POST /purchases/sync: another app user id is 422; RevenueCat 429 answers stale and enqueues billing_sync',
  async () => {
    const failure = {
      error: new AppError('PROVIDER_RATE_LIMITED', {
        headers: { 'Retry-After': '30' },
      }) as AppError | null,
    };
    const h = await createHarness({ revenueCat: stubRevenueCat(new Map(), failure) });
    h.business.billing.users.add(USER_A);
    const jwt = await h.token(USER_A);
    const mismatch = await call(h, 'POST', '/purchases/sync', {
      jwt,
      key: key(),
      body: { reason: 'restore', rc_app_user_id: USER_B },
    });
    assertEquals(mismatch.status, 422);
    assertEquals((await mismatch.json()).error.field_errors[0].path, 'rc_app_user_id');
    const stale = await call(h, 'POST', '/purchases/sync', {
      jwt,
      key: key(),
      body: { reason: 'app_open', rc_app_user_id: USER_A },
    });
    assertEquals(stale.status, 200);
    assertEquals((await stale.json()).data.stale, true);
    const job = h.business.billing.jobs.find((j) => j.type === 'billing_sync');
    assertEquals(job?.payload, { app_user_id: USER_A, event_id: null, reason: 'purchase_sync' });
    assert(
      h.fetchCalls.some((c) => c.url.endsWith('/functions/v1/worker/run')),
      'the worker is poked',
    );
  },
);

Deno.test(
  'POST /purchases/sync without the RevenueCat key: stale mirror when one exists, else 503',
  async () => {
    const h = await createHarness();
    h.business.billing.users.add(USER_A);
    const jwt = await h.token(USER_A);
    const none = await call(h, 'POST', '/purchases/sync', {
      jwt,
      key: key(),
      body: { reason: 'purchase', rc_app_user_id: USER_A },
    });
    assertEquals(none.status, 503);
    assertEquals((await none.json()).error.code, 'EXTERNAL_CREDENTIAL_REQUIRED');
    h.business.billing.mirrors.set(USER_A, {
      is_active: true,
      status: 'active',
      will_renew: true,
      period_type: 'normal',
      expires_at: new Date(NOW.getTime() + 86_400_000).toISOString(),
      product_id: 'da_pro_monthly',
      store: 'app_store',
      synced_at: NOW.toISOString(),
      environment: 'production',
    });
    const stale = await call(h, 'POST', '/purchases/sync', {
      jwt,
      key: key(),
      body: { reason: 'purchase', rc_app_user_id: USER_A },
    });
    assertEquals(stale.status, 200);
    const data = (await stale.json()).data;
    assertEquals([data.stale, data.entitlement.is_active], [true, true]);
  },
);

async function referralHarness() {
  const h = await createHarness({ env: { PUBLIC_WEB_URL: WEB } });
  const repo = h.business.referrals;
  repo.addUser(USER_A, {
    email: 'ayse@example.com',
    display_name: 'Ayşe',
    created_at: '2026-01-01T00:00:00Z',
  });
  repo.addUser(USER_B, {
    email: 'burak@example.com',
    display_name: 'Burak',
    created_at: NOW.toISOString(),
  });
  return h;
}

Deno.test(
  'GET /referrals/me creates the code lazily and returns the share link and cap',
  async () => {
    const h = await referralHarness();
    const res = await call(h, 'GET', '/referrals/me', { jwt: await h.token(USER_A) });
    assertEquals(res.status, 200);
    const body = await res.json();
    assert(routes['GET /referrals/me'].response.safeParse(body).success);
    assertEquals(body.data.share_url, `${WEB}/r/${body.data.code}`);
    assertEquals(h.business.referrals.codes.get(USER_A)?.code, body.data.code);
    assertEquals(
      [body.data.cap_per_year, body.data.remaining_this_year, body.data.referred_by],
      [6, 6, null],
    );
    const again = await call(h, 'GET', '/referrals/me', { jwt: await h.token(USER_A) });
    assertEquals((await again.json()).data.code, body.data.code);
    const noWeb = await createHarness();
    noWeb.business.referrals.addUser(USER_A);
    const missing = await call(noWeb, 'GET', '/referrals/me', { jwt: await noWeb.token(USER_A) });
    assertEquals(missing.status, 503);
    await missing.body?.cancel();
  },
);

Deno.test(
  'POST /referrals/apply records a pending referral, replays by key and rejects a second one',
  async () => {
    const h = await referralHarness();
    h.business.referrals.codes.set(USER_A, { code: '2222222', disabled: false });
    const jwt = await h.token(USER_B);
    const idempotencyKey = key();
    const body = { code: ' 2222222 ', installation_id: INSTALLATION, source: 'deep_link' };
    const res = await call(h, 'POST', '/referrals/apply', { jwt, key: idempotencyKey, body });
    assertEquals(res.status, 201);
    const payload = await res.json();
    assert(routes['POST /referrals/apply'].response.safeParse(payload).success);
    assertEquals(payload.data.status, 'pending');
    const replay = await call(h, 'POST', '/referrals/apply', { jwt, key: idempotencyKey, body });
    assertEquals(replay.status, 201);
    assertEquals((await replay.json()).data.referral_id, payload.data.referral_id);
    const second = await call(h, 'POST', '/referrals/apply', { jwt, key: key(), body });
    assertEquals(second.status, 409);
    assertEquals((await second.json()).error.code, 'REFERRAL_ALREADY_APPLIED');
    assertEquals(h.business.referrals.referrals.length, 1);
  },
);

Deno.test(
  'POST /referrals/apply: self 422, unknown 404, ambiguous alphabet 422, 5 per hour',
  async () => {
    const h = await referralHarness();
    h.business.referrals.codes.set(USER_A, { code: '2222222', disabled: false });
    const jwt = await h.token(USER_A);
    const self = await call(h, 'POST', '/referrals/apply', {
      jwt,
      key: key(),
      body: { code: '2222222', installation_id: INSTALLATION, source: 'manual' },
    });
    assertEquals(self.status, 422);
    assertEquals((await self.json()).error.code, 'REFERRAL_SELF');
    const unknown = await call(h, 'POST', '/referrals/apply', {
      jwt,
      key: key(),
      body: { code: '3222223', installation_id: INSTALLATION, source: 'manual' },
    });
    assertEquals(unknown.status, 404);
    assertEquals((await unknown.json()).error.code, 'REFERRAL_CODE_INVALID');
    const ambiguous = await call(h, 'POST', '/referrals/apply', {
      jwt,
      key: key(),
      body: { code: 'O0I1L22', installation_id: INSTALLATION, source: 'manual' },
    });
    assertEquals(ambiguous.status, 422);
    assertEquals((await ambiguous.json()).error.code, 'VALIDATION_FAILED');
    for (let i = 0; i < 2; i++) {
      const res = await call(h, 'POST', '/referrals/apply', {
        jwt,
        key: key(),
        body: { code: '3222223', installation_id: INSTALLATION, source: 'manual' },
      });
      await res.body?.cancel();
    }
    const limited = await call(h, 'POST', '/referrals/apply', {
      jwt,
      key: key(),
      body: { code: '3222223', installation_id: INSTALLATION, source: 'manual' },
    });
    assertEquals(limited.status, 429);
    assertEquals((await limited.json()).error.code, 'RATE_LIMITED');
  },
);
