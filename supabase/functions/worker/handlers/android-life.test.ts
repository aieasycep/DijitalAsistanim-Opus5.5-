/**
 * API-ANI-01 pipeline (JOB-12 "life events from Android signals", AI_PIPELINE_PLAN §13.8): stored
 * signals → `life_events` with provenance `android_notification` / `android_device`, structured
 * evidence only, `lifeEventDedupeKey` identities, merge into e-mail events, shipment episodes, the
 * insight + `phone_digest` notification step, and idempotent re-runs.
 */
import { assert, assertEquals } from '@std/assert';
import { lifeEventDedupeKey } from '@da/domain';
import { MemoryAndroidNi, type StoredSignal } from '../../_shared/testing/android-ni.ts';
import {
  fixtureServices,
  jobContext,
  MemoryIntel,
  NOW,
  uuid,
} from '../../_shared/testing/intel.ts';
import { USER_A } from '../../_shared/testing/jwt.ts';
import { refreshAndroidLifeEvents } from '../../_shared/services/life/android.ts';
import { runInsightRefresh } from './insight_refresh.ts';
import type { IntelDeps } from './intel.ts';

const H = 3_600_000;
const at = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();
let n = 0;

function add(ani: MemoryAndroidNi, s: Partial<StoredSignal>): StoredSignal {
  n++;
  const row: StoredSignal = {
    id: uuid(),
    user_id: USER_A,
    installation_id: uuid(),
    package_name: 'com.trendyol.go',
    app_label: 'Trendyol',
    category: 'cargo',
    amount: null,
    currency: null,
    due_date: null,
    tracking_status: null,
    flight_no: null,
    gate: null,
    posted_at: at(H),
    signal_hash: `\\x${n.toString(16).padStart(64, '0')}`,
    life_event_id: null,
    ...s,
  };
  ani.signals.push(row);
  return row;
}

function deps(mem: MemoryIntel, ani: MemoryAndroidNi): IntelDeps {
  const ai = fixtureServices();
  return {
    ai: ai.services,
    mail: mem.mailStore(),
    insights: {
      snapshot: () => Promise.resolve(mem.snapshot()),
      upsertInsights: (rows) => mem.upsertInsights(rows),
      expireInsights: () => Promise.resolve(),
      updateThreads: () => Promise.resolve(),
    },
    briefings: mem.briefingStore(),
    stats: mem.statsStore(),
    memory: mem.memoryStore(),
    bodies: null,
    reconciliation: {
      env: {},
      fetch: () => Promise.reject(new Error('no network')),
      costByModel: () => Promise.resolve([]),
      recordHealth: () => Promise.resolve(),
      audit: { append: () => Promise.resolve() },
    },
    android: ani.lifeStore(mem),
  };
}

const refresh = () => jobContext({ user_id: USER_A, scope: 'life' as const, reason: 'test' });
const STRUCTURED_QUOTE = /^[^\n]{1,60} · [a-z_]+: [A-Za-z0-9 .:TZ_-]{1,40}$/;

Deno.test(
  'API-ANI-01 pipeline: signals → life events with Android provenance, insights and phone_digest',
  async () => {
    const mem = new MemoryIntel();
    const ani = new MemoryAndroidNi();
    const transit = add(ani, { tracking_status: 'in_transit', posted_at: at(5 * H) });
    const delivered = add(ani, { tracking_status: 'delivered', posted_at: at(H) });
    const flight = add(ani, {
      package_name: 'com.turkishairlines.mobile',
      app_label: 'Turkish Airlines',
      category: 'flight',
      flight_no: 'TK2412',
      gate: 'B12',
      posted_at: at(2 * H),
    });
    const bill = add(ani, {
      package_name: 'com.garanti.cepsubesi',
      app_label: 'Garanti BBVA',
      category: 'bank_payment',
      amount: '1250.50',
      currency: 'TRY',
      due_date: '2026-09-25',
    });
    const renewal = add(ani, {
      package_name: 'com.netflix.mediaclient',
      app_label: 'Netflix',
      category: 'bank_payment',
      amount: '229.99',
      currency: 'TRY',
      due_date: '2026-09-26',
    });
    const booking = add(ani, {
      package_name: 'com.opentable',
      app_label: 'OpenTable',
      category: 'reservation',
      due_date: '2026-09-27',
    });
    const other = add(ani, { category: 'other', package_name: 'com.example.news' });

    const ctx = refresh();
    const result = await runInsightRefresh(deps(mem, ani), ctx);
    assertEquals(result.android_signals, 6, 'category other is never read back');
    assertEquals(result.android_linked, 6);

    const byType = new Map(mem.lifeEvents.map((l) => [l.type, l]));
    assertEquals([...byType.keys()].sort(), [
      'flight',
      'payment',
      'reservation',
      'shipment',
      'subscription',
    ]);
    for (const l of mem.lifeEvents) {
      assertEquals(l.source_type, 'android_notification');
      assertEquals(l.source_provider, 'android_device');
      assertEquals(l.payload.origin, 'android');
      assert(l.evidence.length >= 1 && l.evidence.length <= 5);
      for (const e of l.evidence) assert(STRUCTURED_QUOTE.test(e.quote), e.quote);
    }

    const shipment = byType.get('shipment')!;
    assertEquals(mem.lifeEvents.filter((l) => l.type === 'shipment').length, 1, 'one episode');
    assertEquals(shipment.payload.status, 'delivered');
    assertEquals(shipment.payload.tracking_status, 'delivered');
    assertEquals(shipment.source_id, delivered.id);
    assertEquals(shipment.source_timestamp, delivered.posted_at);
    assertEquals(shipment.event_at, delivered.posted_at);
    assertEquals(shipment.title, 'Trendyol · Teslim edildi');
    assertEquals(
      [transit, delivered].map((s) => s.life_event_id),
      [shipment.id, shipment.id],
    );

    const fl = byType.get('flight')!;
    assertEquals([fl.payload.flight_no, fl.payload.gate], ['TK2412', 'B12']);
    assertEquals(fl.dedupe_key, lifeEventDedupeKey('flight', ['TK2412', '2026-09-24']));
    assertEquals(fl.confidence, 0.85);
    assertEquals(flight.life_event_id, fl.id);

    const pay = byType.get('payment')!;
    assertEquals([pay.amount, pay.currency, pay.payload.status], ['1250.50', 'TRY', 'due']);
    assertEquals(pay.due_at, '2026-09-25T15:00:00.000Z', '18:00 Europe/Istanbul');
    assertEquals(pay.amount_evidence?.length, 1);
    assertEquals(
      pay.dedupe_key,
      lifeEventDedupeKey('payment', ['Garanti BBVA', '2026-09-25', 125050]),
    );
    assertEquals(pay.confidence, 0.85);
    assertEquals(bill.life_event_id, pay.id);

    const sub = byType.get('subscription')!;
    assertEquals([sub.payload.service, sub.payload.status], ['Netflix', 'renewal_upcoming']);
    assertEquals(sub.event_at, '2026-09-25T21:00:00.000Z');
    assertEquals(renewal.life_event_id, sub.id);

    const res = byType.get('reservation')!;
    assertEquals([res.payload.venue, res.event_at], ['OpenTable', '2026-09-26T21:00:00.000Z']);
    assertEquals(booking.life_event_id, res.id);
    assertEquals(other.life_event_id, null);

    // Insights carry the Android provenance; the undated flight stays visible while recent.
    const lifeInsights = mem.insights.filter((i) => i.kind === 'life_event');
    for (const type of ['shipment', 'flight', 'payment', 'subscription', 'reservation']) {
      const insight = lifeInsights.find((i) => i.entity_id === byType.get(type as 'flight')!.id);
      assert(insight !== undefined, type);
      assertEquals(insight.source_type, 'android_notification');
    }
    const pushes = ctx.enqueued.filter((j) => j.type === 'notification');
    assert(pushes.length >= 1);
    for (const job of pushes) {
      const build = (job.payload as { build: { category: string; from_android_signal?: boolean } })
        .build;
      assertEquals(build.category, 'life_intel');
      assertEquals(build.from_android_signal, true, 'phone_digest channel');
    }
  },
);

Deno.test('API-ANI-01 pipeline: re-runs are idempotent (linked and unlinked)', async () => {
  const mem = new MemoryIntel();
  const ani = new MemoryAndroidNi();
  add(ani, { tracking_status: 'out_for_delivery', posted_at: at(3 * H) });
  add(ani, {
    category: 'flight',
    package_name: 'com.pegasus.mobile',
    app_label: 'Pegasus',
    flight_no: 'PC2012',
  });
  const d = deps(mem, ani);
  await runInsightRefresh(d, refresh());
  const first = mem.lifeEvents.map((l) => `${l.id}|${l.dedupe_key}|${l.source_id}`).sort();
  const insights = mem.insights.map((i) => i.dedupe_key).sort();
  const again = await runInsightRefresh(d, refresh());
  assertEquals(again.android_signals, 0);
  // A lost link (e.g. a crash after the upsert) re-merges into the same rows.
  for (const s of ani.signals) s.life_event_id = null;
  const relinked = await runInsightRefresh(d, refresh());
  assertEquals(relinked.android_signals, 2);
  assertEquals(mem.lifeEvents.map((l) => `${l.id}|${l.dedupe_key}|${l.source_id}`).sort(), first);
  assertEquals(mem.insights.map((i) => i.dedupe_key).sort(), insights);
});

Deno.test(
  'API-ANI-01 pipeline: a signal enriches the e-mail event it matches and keeps its provenance',
  async () => {
    const mem = new MemoryIntel();
    const ani = new MemoryAndroidNi();
    const messageId = uuid();
    mem.lifeEvents.push({
      id: uuid(),
      user_id: USER_A,
      type: 'flight',
      title: 'TK2412 uçuşu · IST–ESB',
      event_at: '2026-09-24T12:00:00.000Z',
      due_at: null,
      payload: { flight_no: 'TK2412', from: 'IST', to: 'ESB', gate: 'A1', status: 'confirmed' },
      amount: null,
      currency: null,
      amount_evidence: null,
      tracking_url: null,
      dedupe_key: lifeEventDedupeKey('flight', ['TK2412', '2026-09-24']),
      source_type: 'email_message',
      source_id: messageId,
      source_provider: 'google',
      source_timestamp: at(20 * H),
      confidence: 0.85,
      evidence: [{ quote: 'TK2412 İstanbul – Ankara', field: 'flight_no', locator: 'm1:0-24' }],
    });
    const signal = add(ani, {
      category: 'flight',
      package_name: 'com.turkishairlines.mobile',
      app_label: 'Turkish Airlines',
      flight_no: 'TK2412',
      gate: 'B12',
    });
    const r = await refreshAndroidLifeEvents(ani.lifeStore(mem), {
      userId: USER_A,
      locale: 'tr',
      timeZone: 'Europe/Istanbul',
      now: NOW,
    });
    assertEquals([r.upserted, r.patched, r.linked], [0, 1, 1]);
    assertEquals(mem.lifeEvents.length, 1);
    const row = mem.lifeEvents[0]!;
    assertEquals(row.payload.gate, 'B12', 'the newer gate wins');
    assertEquals([row.payload.from, row.payload.to], ['IST', 'ESB']);
    assertEquals([row.source_type, row.source_id], ['email_message', messageId]);
    assertEquals(row.title, 'TK2412 uçuşu · IST–ESB');
    assertEquals(row.evidence[0]?.field, 'gate');
    assertEquals(signal.life_event_id, row.id);
  },
);

Deno.test('API-ANI-01 pipeline: shipment episodes per app', async () => {
  const mem = new MemoryIntel();
  const ani = new MemoryAndroidNi();
  add(ani, { tracking_status: 'delivered', posted_at: at(30 * H) });
  add(ani, { tracking_status: 'created', posted_at: at(4 * H) });
  add(ani, { tracking_status: 'exception', posted_at: at(2 * H) });
  add(ani, {
    package_name: 'com.hepsiburada.ecommerce',
    app_label: 'Hepsiburada',
    tracking_status: 'in_transit',
    posted_at: at(3 * H),
  });
  const run = () =>
    refreshAndroidLifeEvents(ani.lifeStore(mem), {
      userId: USER_A,
      locale: 'tr',
      timeZone: 'Europe/Istanbul',
      now: NOW,
    });
  await run();
  // A status uploaded late (posted before the delivery) joins that episode, not a new one.
  const late = add(ani, { tracking_status: 'in_transit', posted_at: at(40 * H) });
  await run();
  const shipments = mem.lifeEvents
    .filter((l) => l.type === 'shipment')
    .map((l) => `${l.payload.app_package}:${l.payload.status}`)
    .sort();
  assertEquals(shipments, [
    'com.hepsiburada.ecommerce:in_transit',
    'com.trendyol.go:delayed',
    'com.trendyol.go:delivered',
  ]);
  const delivered = mem.lifeEvents.find((l) => l.payload.status === 'delivered')!;
  assertEquals(late.life_event_id, delivered.id);
  const delayed = mem.lifeEvents.find((l) => l.payload.status === 'delayed')!;
  assertEquals(delayed.title, 'Trendyol · Kargo güncellemesi');
  assertEquals(delayed.event_at, null);
  assertEquals(ani.signals.filter((s) => s.life_event_id === null).length, 0);
});
