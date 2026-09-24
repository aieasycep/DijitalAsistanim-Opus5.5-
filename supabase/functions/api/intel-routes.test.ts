/**
 * API-MAIL-07, API-SRCH-01, API-BRF-02…04 on in-memory stores and the fixture provider.
 */
import { assert, assertEquals } from '@std/assert';
import { USER_A, USER_B } from '../_shared/testing/jwt.ts';
import {
  briefingRow,
  fixtureServices,
  MemoryIntel,
  messageRow,
  NOW,
  threadRow,
  uuid,
} from '../_shared/testing/intel.ts';
import type { SearchRpcArgs } from '../_shared/services/memory/search.ts';
import { weeklyStats } from '../_shared/services/briefings/weekly.ts';
import { createApiApp } from './app.ts';
import { createHarness } from './testing.ts';
import type { BriefingApiRepo, IntelApi, SearchRepo } from './routes/intel-api.ts';

interface Setup {
  readonly request: (
    method: string,
    path: string,
    body?: unknown,
    key?: string,
  ) => Promise<Response>;
  readonly mem: MemoryIntel;
  readonly ai: ReturnType<typeof fixtureServices>;
  readonly searches: SearchRpcArgs[];
  readonly repoCalls: string[];
}

async function setup(
  options: { pro?: boolean; briefingResult?: Record<string, unknown> } = {},
): Promise<Setup> {
  const h = await createHarness();
  const mem = new MemoryIntel();
  const pro = options.pro ?? true;
  if (pro) h.business.gate.plans.set(USER_A, 'pro');
  const ai = fixtureServices({ user: { isPro: pro, plan: pro ? 'pro' : 'free' } });
  const searches: SearchRpcArgs[] = [];
  const repoCalls: string[] = [];
  const search: SearchRepo = {
    search(args) {
      searches.push(args);
      return Promise.resolve(
        args.p_query.includes('teklif')
          ? [
              {
                result_type: 'email',
                entity_id: uuid(),
                title: 'Revize teklif',
                snippet: 'Mehmet Bey revize teklifi Cuma istiyor.',
                source_type: 'email_thread',
                source_id: uuid(),
                source_provider: 'google',
                source_timestamp: NOW.toISOString(),
                score: 0.9,
              },
            ]
          : [],
      );
    },
    contactsNamed: () => Promise.resolve([]),
    ownsContact: (id) => Promise.resolve(id !== USER_B),
    semanticQuota: () => Promise.resolve(true),
    retention: () => Promise.resolve({ policy: 'd365', oldest_available_at: null }),
  };
  const briefings: BriefingApiRepo = {
    byId: (id) => Promise.resolve(mem.briefings.find((b) => b.id === id) ?? null),
    eveningReady: (id) => {
      repoCalls.push(`evening:${id}`);
      return Promise.resolve(
        options.briefingResult ?? {
          ok: true,
          carried: 2,
          next_morning_at: NOW.toISOString(),
          closed_at: NOW.toISOString(),
        },
      );
    },
    retry: (id) => {
      repoCalls.push(`retry:${id}`);
      return Promise.resolve(
        options.briefingResult ?? { ok: false, reason: 'state_conflict', status: 'ready' },
      );
    },
  };
  const intel: IntelApi = {
    ai: ai.services,
    bodies: mem.bodySource(),
    mail: mem.mailStore(),
    memory: mem.memoryStore(),
    search: () => search,
    briefings: () => briefings,
  };
  const app = createApiApp({ ...h.deps, intel });
  const jwt = await h.token(USER_A);
  return {
    mem,
    ai,
    searches,
    repoCalls,
    request: (method, path, body, key) =>
      Promise.resolve(
        app.request(`/api${path}`, {
          method,
          headers: {
            'X-DA-Client': 'ios/1.4.0 (812)',
            Authorization: `Bearer ${jwt}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(key === undefined ? {} : { 'Idempotency-Key': key }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      ),
  };
}

Deno.test(
  'API-MAIL-07: opening a thread twice costs one model call; refresh regenerates',
  async () => {
    const s = await setup();
    const t = threadRow({
      participants: [{ email: 'mehmet@yilmazendustri.example', name: 'Mehmet Yılmaz' }],
    });
    s.mem.threads.push(t);
    for (const text of [
      "Revize teklifi Cuma'ya kadar iletebilir misiniz?",
      'Fiyatlarda iskonto konuşmuştuk.',
    ]) {
      const m = messageRow({ thread_id: t.id });
      s.mem.messages.push(m);
      s.mem.bodies.set(m.provider_message_id, { text, html: null });
    }
    const first = await s.request(
      'POST',
      `/mail/threads/${t.id}/summary`,
      { refresh: false },
      crypto.randomUUID(),
    );
    assertEquals(first.status, 200);
    const body = await first.json();
    assertEquals(body.data.cached, false);
    assert(body.data.summary.length > 0);
    const second = await s.request(
      'POST',
      `/mail/threads/${t.id}/summary`,
      { refresh: false },
      crypto.randomUUID(),
    );
    assertEquals((await second.json()).data.cached, true);
    assertEquals(s.ai.calls.filter((c) => c === 'ThreadSummaryV1').length, 1);
    await s.request(
      'POST',
      `/mail/threads/${t.id}/summary`,
      { refresh: true },
      crypto.randomUUID(),
    );
    assertEquals(s.ai.calls.filter((c) => c === 'ThreadSummaryV1').length, 2);
    const foreign = threadRow({ user_id: USER_B });
    s.mem.threads.push(foreign);
    const missing = await s.request(
      'POST',
      `/mail/threads/${foreign.id}/summary`,
      { refresh: false },
      crypto.randomUUID(),
    );
    assertEquals(missing.status, 404);
  },
);

Deno.test(
  'API-SRCH-01: Free is FTS-only without memory; Pro is hybrid; answer mode is grounded',
  async () => {
    const free = await setup({ pro: false });
    const r = await free.request('GET', '/search?q=teklif%20maili&types=memory,email');
    assertEquals(r.status, 200);
    const body = await r.json();
    assertEquals(body.data.mode, 'fts_only');
    assertEquals(body.meta.locked_types, ['memory']);
    assertEquals(free.searches[0]!.p_types, ['email']);
    assertEquals(free.searches[0]!.p_query_embedding, null);
    assertEquals((await free.request('GET', '/search?q=teklif&mode=answer')).status, 402);

    const pro = await setup();
    const hybrid = await (await pro.request('GET', '/search?q=Mehmet%20teklif')).json();
    assertEquals(hybrid.data.mode, 'hybrid');
    assert(String(pro.searches[0]!.p_query_embedding).startsWith('['));
    const answer = await (await pro.request('GET', '/search?q=teklif&mode=answer')).json();
    assertEquals(answer.data.answer.source_count, 1);
    assert(answer.data.answer.text.includes('Revize teklif'));
    const none = await (
      await pro.request('GET', '/search?q=u%C3%A7ak%20bileti&mode=answer')
    ).json();
    assertEquals(none.data.answer.text, 'Bunu kayıtlarında bulamadım.');
    assertEquals(none.data.answer.confidence_label, 'unsure');
  },
);

Deno.test(
  'API-BRF-02 / API-BRF-04: evening-ready is Pro and idempotent; retry of a ready briefing conflicts',
  async () => {
    const s = await setup();
    const id = uuid();
    const key = crypto.randomUUID();
    const r = await s.request('POST', `/briefings/${id}/evening-ready`, { confirm: true }, key);
    assertEquals(r.status, 200);
    assertEquals((await r.json()).data.carried, 2);
    const again = await s.request('POST', `/briefings/${id}/evening-ready`, { confirm: true }, key);
    assertEquals(again.headers.get('Idempotency-Replayed'), 'true');
    const free = await setup({ pro: false });
    assertEquals(
      (
        await free.request(
          'POST',
          `/briefings/${id}/evening-ready`,
          { confirm: true },
          crypto.randomUUID(),
        )
      ).status,
      402,
    );
    const b = briefingRow({ status: 'ready' });
    s.mem.briefings.push(b);
    const retry = await s.request('POST', `/briefings/${b.id}/retry`, {}, crypto.randomUUID());
    assertEquals(retry.status, 409);
    assertEquals((await retry.json()).error.code, 'STATE_CONFLICT');
  },
);

Deno.test('API-BRF-03: the share card holds integers and fixed labels only', async () => {
  const s = await setup();
  const b = briefingRow({
    kind: 'weekly',
    weekly_stats: weeklyStats(s.mem.counts, {
      start: '2026-09-21',
      end: '2026-09-27',
    }) as unknown as Record<string, unknown>,
  });
  s.mem.briefings.push(b);
  const r = await s.request('GET', `/weekly/${b.id}/share-card`);
  assertEquals(r.status, 200);
  const card = (await r.json()).data;
  assertEquals(card.week_label, '21–27 Eylül');
  assertEquals(Object.keys(card).sort(), [
    'formula_version',
    'labels',
    'metrics',
    'share_text',
    'week_label',
  ]);
  assert(Object.values(card.metrics).every((v) => Number.isInteger(v)));
  const morning = briefingRow();
  s.mem.briefings.push(morning);
  assertEquals((await s.request('GET', `/weekly/${morning.id}/share-card`)).status, 404);
});
