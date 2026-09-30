/**
 * API-ANI-01 `POST /android-notifications/signals` (API_CONTRACTS §8.17 tests; INTEGRATION_PLAN
 * "Upload contract"; UT-ENT-09 `android_ni`): denylisted packages rejected and counted, iOS → 403,
 * duplicates counted, Free → 402, flag off → 503 FEATURE_DISABLED, the 7-day window, and no field
 * that can carry more than 60 characters of text.
 */
import { assert, assertEquals } from '@std/assert';
import { AniSignal } from '@da/validation';
import type { UserAuth } from '../_shared/http/context.ts';
import { MemoryAndroidNi } from '../_shared/testing/android-ni.ts';
import { USER_A, USER_B } from '../_shared/testing/jwt.ts';
import { createApiApp } from './app.ts';
import type { ApiDeps } from './deps.ts';
import { createHarness, NOW } from './testing.ts';

const INSTALLATION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ANDROID = 'android/1.4.0 (812)';
const hash = (n: number) => n.toString(16).padStart(64, '0');
const at = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();
const DAY = 86_400_000;

function signal(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    signal_hash: hash(n),
    package: 'com.trendyol.go',
    app_label: 'Trendyol',
    category: 'cargo',
    tracking_status: 'in_transit',
    posted_at: at(3_600_000),
    ...overrides,
  };
}

async function setup(options: { pro?: boolean; flag?: boolean } = {}) {
  const h = await createHarness();
  if (options.pro ?? true) h.business.gate.plans.set(USER_A, 'pro');
  const ani = new MemoryAndroidNi();
  const install = ani.addInstallation(INSTALLATION, { user_id: USER_A });
  const flagOn = options.flag ?? true;
  const deps: ApiDeps = {
    ...h.deps,
    androidSignals: ani.repo(),
    repos: (auth: UserAuth) => {
      const base = h.deps.repos(auth);
      return {
        ...base,
        bootstrap: {
          ...base.bootstrap,
          flags: () => Promise.resolve({ 'feature.android_ni': flagOn }),
        },
      };
    },
  };
  const app = createApiApp(deps);
  const jwt = await h.token(USER_A);
  const post = (
    body: unknown,
    opts: { client?: string; key?: string; jwt?: string } = {},
  ): Promise<Response> =>
    Promise.resolve(
      app.request('/api/android-notifications/signals', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.jwt ?? jwt}`,
          'X-DA-Client': opts.client ?? ANDROID,
          'X-DA-Installation-Id': INSTALLATION,
          'Content-Type': 'application/json',
          'Idempotency-Key': opts.key ?? crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      }),
    );
  return { h, ani, install, post };
}

Deno.test(
  'API-ANI-01: accepted signals stored structured-only, denylisted packages rejected and counted',
  async () => {
    const { h, ani, install, post } = await setup();
    ani.flagDenylist = new Set(['com.example.flagonly']);
    const res = await post({
      installation_id: INSTALLATION,
      signals: [
        signal(1),
        signal(2, {
          category: 'bank_payment',
          package: 'com.garanti.cepsubesi',
          app_label: 'Garanti BBVA',
          tracking_status: undefined,
          amount: { value: '1250.50', currency: 'TRY' },
          due_date: '2026-09-30',
        }),
        signal(3, { package: 'com.google.android.gms', app_label: 'Google Play services' }),
        signal(4, { package: 'com.google.android.apps.authenticator2' }),
        signal(5, { package: 'tr.gov.turkiye.edevlet.kapisi' }),
        signal(6, { package: 'com.x8bit.bitwarden' }),
        signal(7, { package: 'com.dijitalasistan.app.dev' }),
        signal(8, { package: 'com.example.totp' }),
        signal(9, { package: 'com.example.flagonly' }),
      ],
    });
    assertEquals(res.status, 202);
    assertEquals((await res.json()).data, { accepted: 2, duplicates: 0, rejected: 7 });
    assertEquals(ani.signals.length, 2);
    const payment = ani.signals.find((s) => s.category === 'bank_payment');
    assertEquals(payment?.amount, '1250.50');
    assertEquals(payment?.currency, 'TRY');
    assertEquals(payment?.signal_hash, `\\x${hash(2)}`);
    assertEquals(payment?.installation_id, install.id);
    // Only the structured columns exist on a stored row.
    assertEquals(Object.keys(payment ?? {}).sort(), [
      'amount',
      'app_label',
      'category',
      'currency',
      'due_date',
      'flight_no',
      'gate',
      'id',
      'installation_id',
      'life_event_id',
      'package_name',
      'posted_at',
      'signal_hash',
      'tracking_status',
      'user_id',
    ]);
    const job = h.workflow.queue.jobs.get(`insight_refresh:${USER_A}:pending`);
    assertEquals(job?.type, 'insight_refresh');
    assertEquals((job?.payload as { scope?: string }).scope, 'life');
    assertEquals(
      ani.touched.map((t) => t.id),
      [install.id],
    );
    assertEquals(h.analytics.rows.length, 0, 'analytics-free');
  },
);

Deno.test('API-ANI-01: duplicates are counted; the same key replays the result', async () => {
  const { h, ani, post } = await setup();
  const body = { installation_id: INSTALLATION, signals: [signal(1), signal(2)] };
  const key = crypto.randomUUID();
  const first = await post(body, { key });
  assertEquals((await first.json()).data, { accepted: 2, duplicates: 0, rejected: 0 });
  const replay = await post(body, { key });
  assertEquals(replay.status, 202);
  assertEquals(replay.headers.get('Idempotency-Replayed'), 'true');
  assertEquals((await replay.json()).data, { accepted: 2, duplicates: 0, rejected: 0 });
  h.workflow.queue.jobs.clear();
  const again = await post({ installation_id: INSTALLATION, signals: [signal(1), signal(3)] });
  assertEquals((await again.json()).data, { accepted: 1, duplicates: 1, rejected: 0 });
  assertEquals(ani.signals.length, 3);
  const dup = await post({ installation_id: INSTALLATION, signals: [signal(2)] });
  assertEquals((await dup.json()).data, { accepted: 0, duplicates: 1, rejected: 0 });
  assertEquals(h.workflow.queue.jobs.size, 1, 'a duplicate-only batch enqueues nothing new');
});

Deno.test('API-ANI-01: iOS or any non-Android client → 403 FORBIDDEN', async () => {
  const { ani, post } = await setup();
  for (const client of ['ios/1.4.0 (812)', 'web/1.0.0 (1)']) {
    const res = await post({ installation_id: INSTALLATION, signals: [signal(1)] }, { client });
    assertEquals(res.status, 403, client);
    assertEquals((await res.json()).error.code, 'FORBIDDEN');
  }
  assertEquals(ani.signals.length, 0);
});

Deno.test('API-ANI-01: Free → 402 ENTITLEMENT_REQUIRED {feature:android_ni}', async () => {
  const { ani, post } = await setup({ pro: false });
  const res = await post({ installation_id: INSTALLATION, signals: [signal(1)] });
  assertEquals(res.status, 402);
  const error = (await res.json()).error;
  assertEquals([error.code, error.details.feature], ['ENTITLEMENT_REQUIRED', 'android_ni']);
  assertEquals(ani.signals.length, 0);
});

Deno.test('API-ANI-01: flag feature.android_ni off → 503 FEATURE_DISABLED', async () => {
  const { ani, post } = await setup({ flag: false });
  const res = await post({ installation_id: INSTALLATION, signals: [signal(1)] });
  assertEquals(res.status, 503);
  assertEquals((await res.json()).error.code, 'FEATURE_DISABLED');
  assertEquals(ani.signals.length, 0);
});

Deno.test(
  'API-ANI-01: posted_at must be within 7 days (older or future signals rejected)',
  async () => {
    const { ani, post } = await setup();
    const res = await post({
      installation_id: INSTALLATION,
      signals: [
        signal(1, { posted_at: at(6 * DAY) }),
        signal(2, { posted_at: at(7 * DAY + 60_000) }),
        signal(3, { posted_at: new Date(NOW.getTime() + 3_600_000).toISOString() }),
        signal(4, { posted_at: at(0) }),
      ],
    });
    assertEquals((await res.json()).data, { accepted: 2, duplicates: 0, rejected: 2 });
    assertEquals(ani.signals.map((s) => s.signal_hash).sort(), [`\\x${hash(1)}`, `\\x${hash(4)}`]);
  },
);

Deno.test('API-ANI-01: no field can carry more than 60 characters of text', async () => {
  const { ani, post } = await setup();
  const text = 'Kargonuz yola çıktı, takip için bağlantıya tıklayın lütfen hemen';
  assert(text.length > 60);
  const base = signal(1, {
    category: 'flight',
    tracking_status: undefined,
    flight_no: 'TK2412',
    gate: 'B12',
    amount: { value: '10.00', currency: 'TRY' },
    due_date: '2026-09-30',
  });
  // Every string field of the schema, top-level and nested, refuses a free-text sentence.
  const strings = Object.keys(AniSignal.shape);
  const cases: [string, Record<string, unknown>][] = [
    ...strings.map((field): [string, Record<string, unknown>] => [
      field,
      { ...base, [field]: text },
    ]),
    ['amount.value', { ...base, amount: { value: text, currency: 'TRY' } }],
    ['amount.currency', { ...base, amount: { value: '10.00', currency: text } }],
    ['app_label 61', { ...base, app_label: 'x'.repeat(61) }],
    ['text', { ...base, text }],
    ['title', { ...base, title: text }],
    ['amount extra', { ...base, amount: { value: '10.00', currency: 'TRY', note: text } }],
  ];
  for (const [name, s] of cases) {
    const res = await post({ installation_id: INSTALLATION, signals: [s] });
    assertEquals(res.status, 422, name);
    assertEquals((await res.json()).error.code, 'VALIDATION_FAILED', name);
  }
  const ok = await post({
    installation_id: INSTALLATION,
    signals: [{ ...base, app_label: 'x'.repeat(60) }],
  });
  assertEquals(ok.status, 202);
  await ok.body?.cancel();
  assertEquals(ani.signals.length, 1);
});

Deno.test(
  'API-ANI-01: the installation must be the caller’s Android device with the grant',
  async () => {
    const { h, ani, post } = await setup();
    h.business.gate.plans.set(USER_B, 'pro');
    const other = await h.token(USER_B);
    const foreign = await post(
      { installation_id: INSTALLATION, signals: [signal(1)] },
      { jwt: other },
    );
    assertEquals(foreign.status, 403);
    assertEquals((await foreign.json()).error.details.reason, 'installation');
    const unknown = await post({
      installation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      signals: [signal(1)],
    });
    assertEquals(unknown.status, 403);
    await unknown.body?.cancel();
    ani.addInstallation(INSTALLATION, { user_id: USER_A, ni_listener_granted: false });
    const ungranted = await post({ installation_id: INSTALLATION, signals: [signal(1)] });
    assertEquals(ungranted.status, 403);
    assertEquals((await ungranted.json()).error.details.reason, 'ni_not_granted');
    assertEquals(ani.signals.length, 0);
  },
);
