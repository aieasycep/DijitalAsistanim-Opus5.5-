/**
 * Apple, RevenueCat, Expo and Voyage emulators (TEST_PLAN §6.1):
 * - `/apple/auth/token` (authorization_code → a refresh token; the ES256 client secret is decoded
 *   and recorded) and `/apple/auth/revoke`;
 * - `/revenuecat/v2/projects/{p}` (entitlements, customers, subscriptions, products, DELETE customer)
 *   answered from `POST /__revenuecat {op:'customer', id, fixture}` seeds (`customer_v2_*.json`);
 * - `POST /revenuecat/__activate {app_user_id, product}` (also `POST /__revenuecat {op:'activate'}`):
 *   a completed store purchase, as the E2E paywall flow simulates it through the harness — the next
 *   REST v2 customer read answers an active `pro` entitlement for that product, so the app's
 *   `POST /purchases/sync` mirrors it;
 * - `/expo/--/api/v2/push/send` (≤ 100 messages, bearer `EXPO_ACCESS_TOKEN`, gzip bodies) and
 *   `/expo/--/api/v2/push/getReceipts` (per-ticket outcomes seeded by `POST /__expo`);
 * - `/voyage/v1/embeddings` (deterministic unit vectors of `output_dimension`, from SHA-256 of the
 *   input text; the model name is echoed back, never chosen here).
 */
import type { Hono } from 'hono';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import {
  b64url,
  bearerOf,
  fixture,
  formOf,
  jsonOf,
  type MockEnv,
  type MockState,
  randomId,
} from './core.ts';

interface RcCustomer {
  customer: Record<string, unknown>;
  subscriptions: Record<string, unknown>[];
}

export function mountServices(app: Hono<MockEnv>, state: MockState): void {
  let apple = {
    refresh: new Map<string, boolean>(),
    secrets: [] as Record<string, unknown>[],
    sub: '001234.0a1b2c3d4e5f60718293a4b5c6d7e8f9.1200',
  };
  let rc = {
    customers: new Map<string, RcCustomer>(),
    deleted: [] as string[],
    products: new Map<string, string>(),
  };
  let expo = {
    tickets: new Map<string, { to: string; data: unknown }>(),
    receipts: new Map<string, Record<string, unknown>>(),
    byToken: new Map<string, Record<string, unknown>>(),
  };
  state.onReset(() => {
    apple = {
      refresh: new Map(),
      secrets: [],
      sub: '001234.0a1b2c3d4e5f60718293a4b5c6d7e8f9.1200',
    };
    rc = { customers: new Map(), deleted: [], products: new Map() };
    expo = { tickets: new Map(), receipts: new Map(), byToken: new Map() };
  });

  // ── Apple ─────────────────────────────────────────────────────────────────────────────────
  const recordSecret = (secret: string) => {
    try {
      apple.secrets.push({ header: decodeProtectedHeader(secret), claims: decodeJwt(secret) });
    } catch {
      apple.secrets.push({ invalid: true });
    }
  };
  app.post('/apple/auth/token', (c) => {
    const form = formOf(c);
    recordSecret(form.get('client_secret') ?? '');
    if (form.get('client_id') !== Deno.env.get('APPLE_SIWA_NATIVE_CLIENT_ID'))
      return c.json({ error: 'invalid_client' }, 400);
    if (form.get('grant_type') !== 'authorization_code' || (form.get('code') ?? '') === '')
      return c.json({ error: 'invalid_grant' }, 400);
    const refresh = `r${randomId()}${randomId()}.0.mock`;
    apple.refresh.set(refresh, true);
    return c.json({
      access_token: `a${randomId()}.0.mock`,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refresh,
      id_token: `${b64url(JSON.stringify({ alg: 'RS256', kid: 'mock-apple' }))}.${b64url(
        JSON.stringify({
          iss: 'https://appleid.apple.com',
          aud: form.get('client_id'),
          sub: apple.sub,
        }),
      )}.${b64url('sig')}`,
    });
  });
  app.post('/apple/auth/revoke', (c) => {
    const form = formOf(c);
    recordSecret(form.get('client_secret') ?? '');
    apple.refresh.set(form.get('token') ?? '', false);
    return c.body(null, 200);
  });
  app.post('/__apple', async (c) => {
    const body = (await c.req.json()) as { op?: string; sub?: string };
    if (body.op === 'identity' && typeof body.sub === 'string') apple.sub = body.sub;
    return c.json({ refresh: [...apple.refresh.entries()], secrets: apple.secrets });
  });

  // ── RevenueCat v2 ─────────────────────────────────────────────────────────────────────────
  const rcBase = '/revenuecat/v2/projects/:project';
  /** A completed purchase of `product` (`da_pro_annual` | `da_pro_monthly`) for `appUserId`. */
  const activate = (body: Record<string, unknown>): { ok: true; product_id: string } | null => {
    const appUserId = typeof body.app_user_id === 'string' ? body.app_user_id : '';
    const product = typeof body.product === 'string' ? body.product : 'da_pro_annual';
    if (!/^[0-9a-f-]{36}$/i.test(appUserId) || !/^da_pro_(annual|monthly)$/.test(product))
      return null;
    const monthly = product === 'da_pro_monthly';
    const seed = fixture<RcCustomer>('revenuecat/customer_v2_active.json');
    const now = Date.now();
    const ends = now + (monthly ? 30 : 365) * 86_400_000;
    const productId = `prod_${product}`;
    rc.products.set(productId, `${product}:${monthly ? 'monthly' : 'annual'}`);
    seed.customer.id = appUserId;
    seed.customer.first_seen_at = now;
    seed.customer.last_seen_at = now;
    const active = seed.customer.active_entitlements as { items?: { expires_at?: number }[] };
    for (const item of active.items ?? []) item.expires_at = ends;
    for (const sub of seed.subscriptions) {
      Object.assign(sub, {
        id: `sub_${randomId()}`,
        customer_id: appUserId,
        original_customer_id: appUserId,
        product_id: productId,
        starts_at: now,
        current_period_starts_at: now,
        current_period_ends_at: ends,
        store_subscription_identifier: String(now),
        ...(typeof body.environment === 'string' ? { environment: body.environment } : {}),
      });
    }
    rc.customers.set(appUserId, seed);
    return { ok: true, product_id: productId };
  };
  app.post('/revenuecat/__activate', (c) => {
    const out = activate(jsonOf(c));
    return out === null
      ? c.json({ error: 'app_user_id and product are required' }, 400)
      : c.json(out);
  });
  app.post('/__revenuecat', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    if (body.op === 'activate') {
      const out = activate(body);
      return out === null
        ? c.json({ error: 'app_user_id and product are required' }, 400)
        : c.json(out);
    }
    if (body.op === 'customer') {
      const seed = fixture<RcCustomer>(String(body.fixture));
      const id = String(body.id);
      seed.customer.id = id;
      // Relative expiry (the fixtures carry absolute epochs) and the store environment.
      if (typeof body.expires_in_ms === 'number') {
        const at = Date.now() + body.expires_in_ms;
        for (const sub of seed.subscriptions) sub.current_period_ends_at = at;
        const active = seed.customer.active_entitlements as
          { items?: { expires_at?: number }[] } | undefined;
        for (const item of active?.items ?? []) item.expires_at = at;
      }
      if (typeof body.environment === 'string')
        for (const sub of seed.subscriptions) sub.environment = body.environment;
      for (const sub of seed.subscriptions) {
        sub.customer_id = id;
        sub.original_customer_id = id;
      }
      rc.customers.set(id, seed);
      return c.json({ ok: true });
    }
    if (body.op === 'state')
      return c.json({ customers: [...rc.customers.keys()], deleted: rc.deleted });
    return c.json({ error: 'unknown op' }, 400);
  });
  app.use('/revenuecat/*', async (c, next) => {
    if (bearerOf(c) !== Deno.env.get('REVENUECAT_API_V2_SECRET_KEY'))
      return c.json(
        { object: 'error', type: 'authentication_error', message: 'Invalid API key' },
        401,
      );
    await next();
  });
  app.get(`${rcBase}/entitlements`, (c) =>
    c.json({
      object: 'list',
      items: [
        { object: 'entitlement', id: 'entla1b2c3d4e5', lookup_key: 'pro', display_name: 'Pro' },
      ],
      next_page: null,
    }),
  );
  app.get(`${rcBase}/customers/:id`, (c) => {
    const found = rc.customers.get(c.req.param('id'));
    if (found === undefined)
      return c.json(
        { object: 'error', type: 'resource_missing', message: 'Customer not found' },
        404,
      );
    return c.json(found.customer);
  });
  app.get(`${rcBase}/customers/:id/subscriptions`, (c) => {
    const found = rc.customers.get(c.req.param('id'));
    return c.json({ object: 'list', items: found?.subscriptions ?? [], next_page: null });
  });
  app.get(`${rcBase}/products/:id`, (c) =>
    c.json({
      object: 'product',
      id: c.req.param('id'),
      store_identifier: rc.products.get(c.req.param('id')) ?? 'da_pro_annual:annual',
      type: 'subscription',
    }),
  );
  app.delete(`${rcBase}/customers/:id`, (c) => {
    rc.deleted.push(c.req.param('id'));
    if (!rc.customers.delete(c.req.param('id')))
      return c.json(
        { object: 'error', type: 'resource_missing', message: 'Customer not found' },
        404,
      );
    return c.json({ object: 'customer', id: c.req.param('id'), deleted_at: Date.now() });
  });

  // ── Expo push ─────────────────────────────────────────────────────────────────────────────
  app.post('/__expo', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    if (body.op === 'receipt_for_token') {
      expo.byToken.set(String(body.token), body.receipt as Record<string, unknown>);
      return c.json({ ok: true });
    }
    if (body.op === 'state') return c.json({ tickets: [...expo.tickets.entries()] });
    return c.json({ error: 'unknown op' }, 400);
  });
  app.post('/expo/--/api/v2/push/send', (c) => {
    if (bearerOf(c) !== Deno.env.get('EXPO_ACCESS_TOKEN'))
      return c.json({ errors: [{ code: 'UNAUTHORIZED', message: 'Invalid access token' }] }, 401);
    const raw = jsonOf<unknown>(c);
    const messages = (Array.isArray(raw) ? raw : [raw]) as {
      to: string | string[];
      data?: unknown;
    }[];
    if (messages.length > 100)
      return c.json(
        { errors: [{ code: 'PUSH_TOO_MANY_NOTIFICATIONS', message: 'more than 100' }] },
        400,
      );
    const data = messages.map((m) => {
      const to = Array.isArray(m.to) ? (m.to[0] ?? '') : m.to;
      if (!/^Expo(nent)?PushToken\[.+\]$/.test(to)) {
        return {
          status: 'error',
          message: `"${to}" is not a registered push notification recipient`,
          details: { error: 'DeviceNotRegistered', expoPushToken: to },
        };
      }
      const id = crypto.randomUUID().toUpperCase();
      expo.tickets.set(id, { to, data: m.data ?? null });
      const receipt = expo.byToken.get(to);
      if (receipt !== undefined) expo.receipts.set(id, receipt);
      return { status: 'ok', id };
    });
    return c.json({ data });
  });
  app.post('/expo/--/api/v2/push/getReceipts', (c) => {
    const body = jsonOf<{ ids?: string[] }>(c);
    if ((body.ids ?? []).length > 1000)
      return c.json({ errors: [{ code: 'VALIDATION_ERROR', message: 'too many ids' }] }, 400);
    const data: Record<string, unknown> = {};
    for (const id of body.ids ?? []) {
      if (!expo.tickets.has(id)) continue;
      data[id] = expo.receipts.get(id) ?? { status: 'ok' };
    }
    return c.json({ data });
  });

  // ── Voyage embeddings ─────────────────────────────────────────────────────────────────────
  app.post('/voyage/v1/embeddings', async (c) => {
    if (bearerOf(c) !== Deno.env.get('VOYAGE_API_KEY'))
      return c.json({ detail: 'Provided API key is invalid.' }, 401);
    const body = jsonOf<{ model?: string; input?: string[]; output_dimension?: number }>(c);
    const dims = body.output_dimension ?? 1024;
    const data = [];
    let tokens = 0;
    for (const [index, text] of (body.input ?? []).entries()) {
      tokens += Math.ceil(text.length / 4);
      const seed = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
      );
      const vector = Array.from(
        { length: dims },
        (_, i) => ((seed[i % 32] ?? 0) - 127.5) / 127.5 + (i % 7) / 100,
      );
      const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
      data.push({ object: 'embedding', index, embedding: vector.map((v) => v / norm) });
    }
    return c.json({
      object: 'list',
      data,
      model: body.model ?? '',
      usage: { total_tokens: tokens },
    });
  });
}
