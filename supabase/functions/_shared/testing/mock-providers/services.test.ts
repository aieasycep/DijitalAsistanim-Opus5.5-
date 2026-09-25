/**
 * Mock provider server (TEST_PLAN §6.1), in process: the RevenueCat purchase activation the E2E
 * paywall flow uses (`POST /revenuecat/__activate`) and the Anthropic / OpenAI emulators whose
 * structured output is scripted through `POST /__script` (IT-AI-02 / IT-AI-03).
 */
import { assert, assertEquals } from '@std/assert';
import { createMockProviders } from './server.ts';

const USER = '5b0c9f36-8d2e-4a61-9a7b-1c2d3e4f5a6b';
const KEY = 'sk_mock_services_test';

async function setup() {
  Deno.env.set('REVENUECAT_API_V2_SECRET_KEY', KEY);
  const { app } = await createMockProviders();
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const rc = (path: string) =>
    app.request(`/revenuecat/v2/projects/projintegration${path}`, {
      headers: { authorization: `Bearer ${KEY}` },
    });
  return { app, post, rc };
}

Deno.test(
  'RevenueCat /__activate: the next REST v2 customer read is an active pro purchase',
  async () => {
    const { post, rc } = await setup();
    assertEquals((await rc(`/customers/${USER}`)).status, 404);
    const before = Date.now();
    const res = await post('/revenuecat/__activate', {
      app_user_id: USER,
      product: 'da_pro_monthly',
    });
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true, product_id: 'prod_da_pro_monthly' });

    const customer = (await (await rc(`/customers/${USER}`)).json()) as {
      id: string;
      active_entitlements: { items: { entitlement_id: string; expires_at: number }[] };
    };
    assertEquals(customer.id, USER);
    const [entitlement] = customer.active_entitlements.items;
    assertEquals(entitlement?.entitlement_id, 'entla1b2c3d4e5');
    const days = ((entitlement?.expires_at ?? 0) - before) / 86_400_000;
    assert(days > 29.9 && days < 30.1, String(days));

    const subs = (await (await rc(`/customers/${USER}/subscriptions`)).json()) as {
      items: { customer_id: string; product_id: string; status: string; gives_access: boolean }[];
    };
    assertEquals(subs.items.length, 1);
    assertEquals(subs.items[0]?.customer_id, USER);
    assertEquals(subs.items[0]?.status, 'active');
    assertEquals(subs.items[0]?.gives_access, true);
    const product = (await (await rc(`/products/${subs.items[0]?.product_id ?? ''}`)).json()) as {
      store_identifier: string;
    };
    assertEquals(product.store_identifier, 'da_pro_monthly:monthly');
    const entitlements = (await (await rc('/entitlements')).json()) as {
      items: { lookup_key: string }[];
    };
    assertEquals(entitlements.items[0]?.lookup_key, 'pro');

    // The control endpoint form, the annual default, and bad input.
    const annual = await post('/__revenuecat', {
      op: 'activate',
      app_user_id: USER,
      environment: 'sandbox',
    });
    assertEquals((await annual.json()) as unknown, { ok: true, product_id: 'prod_da_pro_annual' });
    const sandbox = (await (await rc(`/customers/${USER}/subscriptions`)).json()) as {
      items: { environment: string }[];
    };
    assertEquals(sandbox.items[0]?.environment, 'sandbox');
    assertEquals((await post('/revenuecat/__activate', { app_user_id: 'u_free' })).status, 400);
    assertEquals((await post('/__revenuecat', { op: 'activate', product: 'x' })).status, 400);
    assertEquals((await post('/__reset', {})).status, 200);
    assertEquals((await rc(`/customers/${USER}`)).status, 404);
  },
);

Deno.test(
  'LLM emulators: scripted structured output in provider envelopes; unscripted → 400',
  async () => {
    const { app, post } = await setup();
    const anthropic = (body: string, headers: Record<string, string> = {}) =>
      post('/anthropic/v1/messages', body, {
        'x-api-key': 'k',
        'anthropic-version': '2023-06-01',
        ...headers,
      });
    const request = JSON.stringify({
      model: 'mock-model',
      output_config: { format: { schema: { properties: { tasks_for_user: {} } } } },
    });

    assertEquals((await anthropic(request)).status, 400);
    assertEquals((await post('/anthropic/v1/messages', request)).status, 401);
    assertEquals((await post('/anthropic/v1/messages', request, { 'x-api-key': 'k' })).status, 400);

    await post('/__script', {
      route: 'POST /anthropic/v1/messages',
      responses: [
        { passthrough: true, body: '{"summary_tr": "kesik', match: 'tasks_for_user' },
        { passthrough: true, body: { summary_tr: 'Özet' }, times: 2 },
      ],
    });
    // The `match` entry waits for a request carrying that schema property.
    const other = await anthropic(JSON.stringify({ model: 'mock-model' }));
    assertEquals(other.status, 400);
    const malformed = await anthropic(request);
    assertEquals(malformed.status, 200);
    assertEquals(malformed.headers.get('request-id'), 'req_mock_1');
    const env = (await malformed.json()) as {
      model: string;
      stop_reason: string;
      content: { type: string; text: string }[];
      usage: { input_tokens: number; output_tokens: number };
    };
    assertEquals(env.model, 'mock-model');
    assertEquals(env.stop_reason, 'end_turn');
    assertEquals(env.content, [{ type: 'text', text: '{"summary_tr": "kesik' }]);
    assert(env.usage.input_tokens > 0 && env.usage.output_tokens > 0);
    const ok = (await (await anthropic(request)).json()) as { content: { text: string }[] };
    assertEquals(JSON.parse(ok.content[0]?.text ?? ''), { summary_tr: 'Özet' });

    const openai = (body: string, auth = 'Bearer k') =>
      post('/openai/v1/responses', body, { authorization: auth });
    assertEquals((await openai(request, '')).status, 401);
    assertEquals((await openai(request)).status, 400);
    await post('/__script', {
      route: 'POST /openai/v1/responses',
      responses: [{ passthrough: true, body: 'not json' }],
    });
    const res = await openai(request);
    assertEquals(res.status, 200);
    const out = (await res.json()) as {
      status: string;
      output: { content: { type: string; text: string }[] }[];
      usage: { total_tokens: number };
    };
    assertEquals(out.status, 'completed');
    assertEquals(out.output[0]?.content[0], {
      type: 'output_text',
      text: 'not json',
      annotations: [],
    } as never);
    assert(out.usage.total_tokens > 0);
    const recorded = (await (await app.request('/__requests?prefix=/openai')).json()) as {
      requests: { status: number }[];
    };
    assertEquals(
      recorded.requests.map((r) => r.status),
      [401, 400, 200],
    );
  },
);
