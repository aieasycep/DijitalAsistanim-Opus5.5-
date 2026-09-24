import { assert, assertEquals, assertFalse } from '@std/assert';
import type { AdminGate } from '../_shared/auth/admin.ts';
import { API_CONTRACT_VERSION } from '../_shared/config.ts';
import { createLogger, memorySink } from '../_shared/logging/logger.ts';
import { testEnv } from '../_shared/testing/env.ts';
import { stubFetch } from '../_shared/testing/fetch.ts';
import { ADMIN_ID, createTestIssuer, userClaims } from '../_shared/testing/jwt.ts';
import { createHealthApp } from './app.ts';
import type { HealthRow } from './data.ts';
import type { HealthData } from './probes/types.ts';

const NOW = new Date('2026-09-23T07:00:00Z');
const BFF = crypto.randomUUID();

const PROVIDER_COMPONENTS = [
  'google_oauth',
  'microsoft_oauth',
  'gmail',
  'microsoft_graph',
  'push',
  'ai_anthropic',
  'ai_openai',
  'ai_voyage',
  'revenuecat',
  'webhooks',
];

function healthyData(): HealthData {
  return {
    pingDatabase: () => Promise.resolve(),
    listStorage: () => Promise.resolve(),
    cronStats: () =>
      Promise.resolve({
        lastAttemptFinishedAt: new Date(NOW.getTime() - 20_000).toISOString(),
        oldestReadyJobAt: null,
        lastCronEnqueueAt: new Date(NOW.getTime() - 60_000).toISOString(),
      }),
    webhookStats: () =>
      Promise.resolve({ lastReceivedAt: null, total: 0, rejected: 0, backlog: 0 }),
    aiErrorRate: () => Promise.resolve({ total: 0, errors: 0 }),
    accountHealth: () => Promise.resolve({ total: 0, failing: 0 }),
    embeddingQueryModel: () => Promise.resolve(null),
    auditChain: () => Promise.resolve({ ok: true, checked: 10, firstBadSeq: null }),
  };
}

async function setup(
  env: Record<string, string | undefined> = {},
  gate: AdminGate = { authorize: () => Promise.resolve() },
) {
  const raw = testEnv(env);
  const rows: HealthRow[] = [];
  const sink = memorySink();
  const issuer = await createTestIssuer();
  const stub = stubFetch((call) => {
    if (call.url.endsWith('/functions/v1/health/live') || call.url.endsWith('/auth/v1/health'))
      return new Response('{}', { status: 200 });
    return new Response('unexpected', { status: 599 });
  });
  const app = createHealthApp({
    raw,
    data: healthyData(),
    writer: { insert: (r) => Promise.resolve(void rows.push(...r)) },
    admin: { verifier: issuer.verifier, gate, bffSecret: BFF },
    log: createLogger({ fn: 'health', sink: sink.sink }),
    fetch: stub.fetch,
    now: () => NOW,
  });
  return { app, raw, rows, sink, issuer, stub };
}

Deno.test(
  'GET /health/live requires the automations secret or an admin and never touches the database',
  async () => {
    const { app, raw, issuer } = await setup({ SB_REGION: 'eu-central-1' });
    const anonymous = await app.request('/health/live');
    assertEquals(anonymous.status, 401);
    await anonymous.body?.cancel();
    const cron = await app.request('/health/live', { headers: { apikey: raw.CRON_SECRET ?? '' } });
    assertEquals(cron.status, 200);
    assertEquals((await cron.json()).data, {
      status: 'ok',
      version: API_CONTRACT_VERSION,
      region: 'eu-central-1',
    });
    const adminJwt = await issuer.sign(
      userClaims(ADMIN_ID, { aal: 'aal2', app_metadata: { da_kind: 'admin' } }),
    );
    const admin = await app.request('/health/live', {
      headers: { Authorization: `Bearer ${adminJwt}`, 'x-da-bff': BFF },
    });
    assertEquals(admin.status, 200);
    await admin.body?.cancel();
    const userJwt = await issuer.sign(userClaims());
    const user = await app.request('/health/live', {
      headers: { Authorization: `Bearer ${userJwt}`, 'x-da-bff': BFF },
    });
    assertEquals(user.status, 403);
    await user.body?.cancel();
  },
);

Deno.test(
  'with no credentials, provider probes return external_credential_required and never healthy',
  async () => {
    const { app, raw, rows, stub } = await setup();
    const res = await app.request('/health/run', {
      method: 'POST',
      headers: { apikey: raw.CRON_SECRET ?? '' },
    });
    assertEquals(res.status, 200);
    const results = (await res.json()).data.results as {
      probe: string;
      status: string;
      detail_code: string | null;
    }[];
    for (const component of PROVIDER_COMPONENTS) {
      const result = results.find((r) => r.probe === component);
      assertEquals(result?.status, 'external_credential_required', component);
      assertEquals(result?.detail_code, 'credential_missing');
    }
    const byProbe = Object.fromEntries(results.map((r) => [r.probe, r.status]));
    assertEquals(byProbe.api, 'healthy');
    assertEquals(byProbe.database, 'healthy');
    assertEquals(byProbe.supabase_auth, 'healthy');
    assertEquals(byProbe.storage, 'healthy');
    assertEquals(byProbe.cron, 'healthy');
    // Only our own endpoints were called: no provider was contacted without credentials.
    assert(stub.calls.every((c) => c.url.startsWith('https://project-ref.supabase.co/')));
    const credentialRow = rows.find((r) => r.component === 'ai_anthropic');
    assertEquals((credentialRow?.detail as { credential_keys?: string[] }).credential_keys, [
      'ANTHROPIC_API_KEY',
    ]);
  },
);

Deno.test(
  'rows are persisted with checked_by and the correlation id; pending components are logged, not persisted',
  async () => {
    const { app, raw, rows, sink } = await setup();
    const res = await app.request('/health/run', {
      method: 'POST',
      headers: {
        apikey: raw.CRON_SECRET ?? '',
        'X-Correlation-Id': '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      },
    });
    const results = (await res.json()).data.results as { probe: string }[];
    assertEquals(rows.length, 15);
    assert(rows.every((r) => r.checked_by === 'cron' && r.checked_at === NOW.toISOString()));
    assert(rows.every((r) => r.detail.correlation_id === '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'));
    assertFalse(
      rows.some((r) => r.component === 'email_delivery' || r.component === 'audit_chain'),
    );
    assertFalse(results.some((r) => r.probe === 'email_delivery' || r.probe === 'audit_chain'));
    const unpersisted = sink
      .records()
      .filter((r) => r.msg === 'health_probe_unpersisted')
      .map((r) => r.component);
    assertEquals(unpersisted.sort(), ['audit_chain', 'email_delivery']);
  },
);

Deno.test('an admin run is recorded as checked_by admin and can select probes', async () => {
  const seen: string[] = [];
  const { app, issuer, rows } = await setup(
    {},
    { authorize: (_jwt, permission) => Promise.resolve(void seen.push(permission)) },
  );
  const jwt = await issuer.sign(
    userClaims(ADMIN_ID, { aal: 'aal2', app_metadata: { da_kind: 'admin' } }),
  );
  const res = await app.request('/health/run', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'x-da-bff': BFF,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ probes: ['database', 'ai_openai'] }),
  });
  assertEquals(res.status, 200);
  const results = (await res.json()).data.results as { probe: string }[];
  assertEquals(results.map((r) => r.probe).sort(), ['ai_openai', 'database']);
  assertEquals(rows.map((r) => r.component).sort(), ['ai_openai', 'database']);
  assert(rows.every((r) => r.checked_by === 'admin'));
  assertEquals(seen, ['health.run']);
});

Deno.test(
  'demo mode in production reports api down with demo_mode_forbidden instead of starting',
  async () => {
    const { app, raw } = await setup({ APP_ENV: 'production', DEMO_MODE: 'true' });
    const res = await app.request('/health/run', {
      method: 'POST',
      headers: { apikey: raw.CRON_SECRET ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ probes: ['api'] }),
    });
    const results = (await res.json()).data.results as unknown[];
    assertEquals(results, [
      {
        probe: 'api',
        status: 'down',
        latency_ms: null,
        detail_code: 'demo_mode_forbidden',
        checked_at: NOW.toISOString(),
      },
    ]);
  },
);

Deno.test('a failing dependency is down, never green; a throwing probe is unknown', async () => {
  const raw = testEnv();
  const rows: HealthRow[] = [];
  const data: HealthData = {
    ...healthyData(),
    pingDatabase: () => Promise.reject(new Error('connection refused')),
    cronStats: () => Promise.reject(new Error('x')),
  };
  const app = createHealthApp({
    raw,
    data,
    writer: { insert: (r) => Promise.resolve(void rows.push(...r)) },
    admin: null,
    log: createLogger({ fn: 'health', sink: memorySink().sink }),
    fetch: stubFetch(() => Promise.reject(new TypeError('network down'))).fetch,
    now: () => NOW,
  });
  const res = await app.request('/health/run', {
    method: 'POST',
    headers: { apikey: raw.CRON_SECRET ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ probes: ['database', 'supabase_auth', 'cron', 'api'] }),
  });
  const byProbe = Object.fromEntries(
    ((await res.json()).data.results as { probe: string; status: string }[]).map((r) => [
      r.probe,
      r.status,
    ]),
  );
  assertEquals(byProbe, { database: 'down', supabase_auth: 'down', cron: 'unknown', api: 'down' });
});

Deno.test('health rejects invalid run bodies and browser origins', async () => {
  const { app, raw } = await setup();
  const bad = await app.request('/health/run', {
    method: 'POST',
    headers: { apikey: raw.CRON_SECRET ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ probes: ['email_delivery'] }),
  });
  assertEquals(bad.status, 422);
  await bad.body?.cancel();
  const browser = await app.request('/health/live', {
    headers: { apikey: raw.CRON_SECRET ?? '', Origin: 'https://evil.example' },
  });
  assertEquals(browser.status, 403);
  await browser.body?.cancel();
});
