/**
 * The RevenueCat emulator's harness endpoint (`POST /revenuecat/__activate`, E2E-M-06/M-16): the
 * activated customer is what the billing client and the mirror mapping read as Pro. In-process
 * (`app.request`), so no port is opened.
 */
import { assert, assertEquals } from '@std/assert';
import {
  createRevenueCatClient,
  revenueCatConfig,
  toMirrorSnapshot,
} from '../../services/billing/revenuecat.ts';
import { createMockProviders } from './server.ts';

const KEY = 'sk_mockproviderstest';
const USER = '11111111-1111-4111-8111-111111111111';
const BASE = '/revenuecat/v2/projects/proje2e';
const DAY = 86_400_000;

async function withKey(fn: () => Promise<void>): Promise<void> {
  const previous = Deno.env.get('REVENUECAT_API_V2_SECRET_KEY');
  Deno.env.set('REVENUECAT_API_V2_SECRET_KEY', KEY);
  try {
    await fn();
  } finally {
    if (previous === undefined) Deno.env.delete('REVENUECAT_API_V2_SECRET_KEY');
    else Deno.env.set('REVENUECAT_API_V2_SECRET_KEY', previous);
  }
}

function activate(
  app: Awaited<ReturnType<typeof createMockProviders>>['app'],
  body: unknown,
): Promise<Response> {
  return Promise.resolve(
    app.request('/revenuecat/__activate', { method: 'POST', body: JSON.stringify(body) }),
  );
}

Deno.test('__activate: the REST v2 customer is active for a year with the product', async () => {
  await withKey(async () => {
    const { app } = await createMockProviders();
    const res = await activate(app, { app_user_id: USER, product: 'da_pro_annual' });
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true, app_user_id: USER, product: 'da_pro_annual' });

    const auth = { headers: { authorization: `Bearer ${KEY}` } };
    const customer = (await (await app.request(`${BASE}/customers/${USER}`, auth)).json()) as {
      id: string;
      active_entitlements: { items: { expires_at: number }[] };
    };
    assertEquals(customer.id, USER);
    const expiresAt = customer.active_entitlements.items[0]?.expires_at ?? 0;
    assert(expiresAt > Date.now() + 364 * DAY, `expires_at ${String(expiresAt)}`);
    const subs = (await (
      await app.request(`${BASE}/customers/${USER}/subscriptions`, auth)
    ).json()) as { items: { customer_id: string; product_id: string; status: string }[] };
    assertEquals(subs.items.length, 1);
    const [sub] = subs.items;
    assertEquals([sub?.customer_id, sub?.status], [USER, 'active']);
    const product = (await (
      await app.request(`${BASE}/products/${sub?.product_id ?? ''}`, auth)
    ).json()) as { store_identifier: string };
    assertEquals(product.store_identifier, 'da_pro_annual');
    // Products the harness never activated keep the default store identifier.
    const other = (await (await app.request(`${BASE}/products/prod1a2b3c4d5e`, auth)).json()) as {
      store_identifier: string;
    };
    assertEquals(other.store_identifier, 'da_pro_annual:annual');
  });
});

Deno.test(
  '__activate: the billing client and mirror mapping read the customer as Pro',
  async () => {
    await withKey(async () => {
      const { app } = await createMockProviders();
      assertEquals(
        (await activate(app, { app_user_id: USER, product: 'da_pro_monthly' })).status,
        200,
      );
      const config = revenueCatConfig({
        APP_ENV: 'e2e',
        REVENUECAT_PROJECT_ID: 'proje2e',
        REVENUECAT_API_V2_SECRET_KEY: KEY,
        REVENUECAT_API_BASE_URL: 'http://host.docker.internal:8788/revenuecat/v2',
      });
      assert(config !== null);
      const client = createRevenueCatClient({
        config,
        fetch: async (input, init) => await app.request(input, init),
      });
      const data = await client.fetchCustomer(USER);
      assertEquals(data.found, true);
      const snapshot = toMirrorSnapshot(data, { fetchedAt: new Date(), allowSandbox: false });
      assertEquals(
        [snapshot.is_active, snapshot.status, snapshot.product_id],
        [true, 'active', 'da_pro_monthly'],
      );
    });
  },
);

Deno.test(
  '__activate: 400 without app_user_id or product; reset forgets; REST needs the bearer',
  async () => {
    await withKey(async () => {
      const { app } = await createMockProviders();
      for (const body of [
        { product: 'da_pro_annual' },
        { app_user_id: USER },
        { app_user_id: ' ', product: 'da_pro_annual' },
        { app_user_id: USER, product: 42 },
      ]) {
        const res = await activate(app, body);
        await res.body?.cancel();
        assertEquals(res.status, 400, JSON.stringify(body));
      }
      const auth = { headers: { authorization: `Bearer ${KEY}` } };
      assertEquals((await activate(app, { app_user_id: USER, product: 'p' })).status, 200);
      const anonymous = await app.request(`${BASE}/customers/${USER}`);
      await anonymous.body?.cancel();
      assertEquals(anonymous.status, 401);
      assertEquals((await app.request(`${BASE}/customers/${USER}`, auth)).status, 200);
      assertEquals((await app.request('/__reset', { method: 'POST' })).status, 200);
      const gone = await app.request(`${BASE}/customers/${USER}`, auth);
      await gone.body?.cancel();
      assertEquals(gone.status, 404);
    });
  },
);
