/**
 * WH-05 `POST /webhooks-revenuecat` (TEST_PLAN EF-WH-03 = TST-EF-07, IT-RC-01/02/04/06, CT-08).
 */
import { assert, assertEquals, assertFalse } from '@std/assert';
import { createLogger, memorySink } from '../_shared/logging/logger.ts';
import { memoryBillingLedger } from '../_shared/testing/business.ts';
import { createRevenueCatWebhookApp } from './app.ts';

const SECRET = 'rc-webhook-secret-0123456789';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function setup(secret: string | undefined = SECRET) {
  const ledger = memoryBillingLedger();
  const pokes: number[] = [];
  const sink = memorySink();
  const app = createRevenueCatWebhookApp({
    authSecret: secret,
    ledger,
    poke: () => Promise.resolve(void pokes.push(1)),
    log: createLogger({ fn: 'webhooks-revenuecat', sink: sink.sink }),
  });
  return { app, ledger, pokes, sink };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    api_version: '1.0',
    event: {
      id: 'evt-1',
      type: 'INITIAL_PURCHASE',
      app_user_id: USER,
      environment: 'PRODUCTION',
      event_timestamp_ms: Date.parse('2026-09-24T08:00:00Z'),
      product_id: 'da_pro_monthly',
      period_type: 'TRIAL',
      store: 'APP_STORE',
      price: 0,
      expiration_at_ms: Date.parse('2026-10-01T08:00:00Z'),
      subscriber_attributes: { $email: { value: 'deniz@example.com' } },
      ...overrides,
    },
  };
}

function post(
  app: ReturnType<typeof setup>['app'],
  body: unknown,
  authorization: string | null = `Bearer ${SECRET}`,
) {
  return app.request('/webhooks-revenuecat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authorization === null ? {} : { Authorization: authorization }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

Deno.test(
  'WH-05 rejects a missing or wrong Authorization with 401 and stores nothing',
  async () => {
    const { app, ledger } = setup();
    for (const authorization of [null, 'Bearer wrong', SECRET, `Bearer ${SECRET}x`]) {
      const res = await post(app, event(), authorization);
      assertEquals(res.status, 401);
      assertEquals((await res.json()).error.code, 'WEBHOOK_SIGNATURE_INVALID');
    }
    assertEquals(ledger.rows.length, 0);
  },
);

Deno.test(
  'WH-05 without REVENUECAT_WEBHOOK_AUTH answers EXTERNAL_CREDENTIAL_REQUIRED',
  async () => {
    const { app, ledger } = setup('');
    const res = await post(app, event());
    assertEquals(res.status, 503);
    assertEquals((await res.json()).error.code, 'EXTERNAL_CREDENTIAL_REQUIRED');
    assertEquals(ledger.rows.length, 0);
  },
);

Deno.test(
  'WH-05 stores the event once, enqueues one billing_sync and answers before any REST call',
  async () => {
    const { app, ledger, pokes, sink } = setup();
    for (let i = 0; i < 3; i++) {
      const res = await post(app, event());
      assertEquals(res.status, 200);
      assertEquals(await res.json(), { ok: true });
    }
    assertEquals(ledger.rows.length, 1, 'duplicate event id → one row (IT-RC-02)');
    assertEquals(ledger.jobKeys, [`billing_sync:${USER}:evt-1`], 'and one job');
    assertEquals(pokes.length, 1, 'only the first delivery pokes the worker');
    const row = ledger.rows[0];
    assertEquals(row?.eventType, 'INITIAL_PURCHASE');
    assertEquals(row?.eventTimestamp, '2026-09-24T08:00:00.000Z');
    assertFalse(
      JSON.stringify(row?.payload).includes('subscriber_attributes'),
      'attributes are stripped',
    );
    assertFalse(
      JSON.stringify(sink.lines).includes('deniz@example.com'),
      'payloads are never logged',
    );
  },
);

Deno.test('WH-05 TRANSFER re-fetches both sides (IT-RC-04)', async () => {
  const { app, ledger } = setup();
  const res = await post(
    app,
    event({
      id: 'evt-t',
      type: 'TRANSFER',
      app_user_id: undefined,
      transferred_from: [USER],
      transferred_to: [OTHER],
    }),
  );
  assertEquals(res.status, 200);
  await res.body?.cancel();
  assertEquals(
    ledger.jobKeys.sort(),
    [`billing_sync:${OTHER}:evt-t`, `billing_sync:${USER}:evt-t`].sort(),
  );
});

Deno.test('WH-05 stores TEST and unknown event types without syncing (IT-RC-06)', async () => {
  const { app, ledger, pokes } = setup();
  for (const type of ['TEST', 'SOME_NEW_EVENT_TYPE']) {
    const res = await post(app, event({ id: `evt-${type}`, type }));
    assertEquals(res.status, 200);
    await res.body?.cancel();
  }
  assertEquals(
    ledger.rows.map((r) => r.eventType),
    ['TEST', 'SOME_NEW_EVENT_TYPE'],
  );
  assertEquals(ledger.jobKeys, []);
  assertEquals(pokes.length, 0);
});

Deno.test(
  'WH-05 validates the body: malformed JSON 400, schema 422, over 256 KiB 413',
  async () => {
    const { app, ledger } = setup();
    assertEquals((await post(app, '{')).status, 400);
    const invalid = await post(app, { api_version: '1.0', event: { id: 'x', type: 'RENEWAL' } });
    assertEquals(invalid.status, 422);
    await invalid.body?.cancel();
    const noUser = await post(app, event({ app_user_id: undefined }));
    assertEquals(noUser.status, 422, 'a known non-TEST event needs app_user_id');
    await noUser.body?.cancel();
    const big = await post(app, event({ padding: 'x'.repeat(300 * 1024) }));
    assertEquals(big.status, 413);
    await big.body?.cancel();
    assertEquals(ledger.rows.length, 0);
    assert(true);
  },
);
