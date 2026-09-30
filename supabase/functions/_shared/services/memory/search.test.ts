/**
 * Search (API_CONTRACTS API-SRC-01 over RPC-02; AI_PIPELINE_PLAN §10.2; TEST_PLAN IT-AI-09): Free
 * users get FTS only and `memory` is reported as locked when asked for; Pro adds the query
 * embedding when the semantic quota allows it, and a failed embedding degrades to FTS flagged
 * `degraded`; a foreign `contact_id` is `NOT_FOUND`; the extractive answer quotes retrieved rows
 * verbatim with emphasis spans and an honest confidence label.
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { AppError } from '../../errors.ts';
import { parseSearchQuery } from './query-parse.ts';
import {
  groundedAnswer,
  runSearch,
  type SearchPorts,
  type SearchRow,
  toResultView,
  vectorLiteral,
} from './search.ts';

const NOW = new Date('2026-09-24T06:30:00.000Z');
const CTX = { isPro: true, now: NOW, timeZone: 'Europe/Istanbul', locale: 'tr' as const };
const C1 = 'cccccccc-0000-4000-8000-000000000001';
const T1 = 'aaaaaaaa-0000-4000-8000-000000000001';

const row = (overrides: Partial<SearchRow>): SearchRow => ({
  result_type: 'email',
  entity_id: T1,
  title: 'Yılmaz Endüstri teklif',
  snippet: 'Revize teklif cuma gününe kadar bekleniyor.',
  source_type: 'email_thread',
  source_id: T1,
  source_provider: 'google',
  source_timestamp: '2026-09-23T09:00:00Z',
  score: 0.9,
  ...overrides,
});

function ports(overrides: Partial<SearchPorts> = {}) {
  const calls: unknown[] = [];
  const p: SearchPorts = {
    search: (args) => {
      calls.push(args);
      return Promise.resolve([row({})]);
    },
    contactsNamed: (names) =>
      Promise.resolve(names.includes('Mehmet') ? [{ id: C1, display_name: 'Mehmet Yılmaz' }] : []),
    ownsContact: (id) => Promise.resolve(id === C1),
    semanticQuota: () => Promise.resolve(true),
    embedQuery: () =>
      Promise.resolve({
        kind: 'ok',
        vectors: [[0.12345678901, Number.NaN, -1]],
        model: 'embed-model',
      }),
    ...overrides,
  };
  return { p, calls };
}

Deno.test('search: result views carry routes, vetted source ids and ISO timestamps', () => {
  const v = toResultView(row({ source_id: 'not-a-uuid', title: null, snippet: null }));
  assertEquals(
    [v.title, v.snippet, v.source.source_id, v.source.source_timestamp],
    ['', '', null, '2026-09-23T09:00:00.000Z'],
  );
  assert(v.route.includes(T1));
  for (const t of [
    'person',
    'event',
    'task',
    'commitment',
    'life_event',
    'capture',
    'memory',
  ] as const) {
    assert(toResultView(row({ result_type: t })).route.startsWith('/'), t);
  }
  assertEquals(vectorLiteral([0.12345678901, Number.POSITIVE_INFINITY, 2]), '[0.1234568,0,2]');
});

Deno.test(
  'search query: capitalised names become person hints (regression: normalisation lower-cased them)',
  () => {
    const at = new Date('2026-09-24T06:30:00Z');
    assertEquals(parseSearchQuery("Mehmet'in teklifi", at, 'Europe/Istanbul').personHints, [
      'Mehmet',
    ]);
    assertEquals(parseSearchQuery('teklif Ayşe ile', at, 'Europe/Istanbul').personHints, ['Ayşe']);
    assertEquals(
      parseSearchQuery('Teklif nerede', at, 'Europe/Istanbul').personHints,
      [],
      'sentence case is not a name',
    );
  },
);

Deno.test(
  'search (IT-AI-09): Pro hybrid search embeds the query; a failed embedding degrades to FTS',
  async () => {
    const { p, calls } = ports();
    const out = await runSearch(p, { q: "Mehmet'in teklifi", mode: 'results', limit: 20 }, CTX);
    assertEquals(
      [out.data.mode, out.semanticUsed, out.degraded, out.lockedTypes],
      ['hybrid', true, false, []],
    );
    const args = calls[0] as {
      p_query_embedding: string;
      p_contact_id: string | null;
      p_limit: number;
    };
    assertEquals(
      [args.p_query_embedding, args.p_contact_id, args.p_limit],
      ['[0.1234568,0,-1]', C1, 20],
    );

    const down = ports({
      embedQuery: () =>
        Promise.resolve({ kind: 'unavailable', reason: 'provider_503', retryable: true }),
    });
    const degraded = await runSearch(down.p, { q: 'teklif', mode: 'results', limit: 10 }, CTX);
    assertEquals(
      [degraded.data.mode, degraded.degraded, degraded.semanticUsed],
      ['fts_only', true, false],
    );
    const noQuota = ports({ semanticQuota: () => Promise.resolve(false) });
    assertEquals(
      (await runSearch(noQuota.p, { q: 'teklif', mode: 'results', limit: 10 }, CTX)).degraded,
      true,
    );
  },
);

Deno.test(
  'search: Free is FTS only and an explicit memory filter is reported as locked',
  async () => {
    const { p, calls } = ports();
    const free = { ...CTX, isPro: false };
    const out = await runSearch(
      p,
      { q: 'teklif', mode: 'results', types: ['memory', 'email'], limit: 10 },
      free,
    );
    assertEquals([out.data.mode, out.lockedTypes], ['fts_only', ['memory']]);
    assertEquals((calls[0] as { p_types: string[]; p_query_embedding: null }).p_types, ['email']);
    const onlyMemory = await runSearch(
      p,
      { q: 'teklif', mode: 'results', types: ['memory'], limit: 10 },
      free,
    );
    assertEquals(
      [onlyMemory.data.results, calls.length],
      [[], 1],
      'no search runs when nothing is left to search',
    );
    const implicit = await runSearch(p, { q: 'teklif', mode: 'results', limit: 10 }, free);
    assertEquals(implicit.lockedTypes, [], 'an implicit type list locks nothing');
  },
);

Deno.test(
  'search: a foreign contact filter is NOT_FOUND; an owned one is passed through',
  async () => {
    const { p, calls } = ports();
    const e = await assertRejects(
      () => runSearch(p, { q: 'x', mode: 'results', contact_id: T1, limit: 5 }, CTX),
      AppError,
    );
    assertEquals([e.code, e.details], ['NOT_FOUND', { resource: 'contact' }]);
    await runSearch(
      p,
      {
        q: 'x',
        mode: 'results',
        contact_id: C1,
        from: '2026-09-01T00:00:00Z',
        to: '2026-09-30T00:00:00Z',
        cursor: 'cur',
        limit: 5,
      },
      CTX,
    );
    const args = calls[0] as Record<string, unknown>;
    assertEquals(
      [args.p_contact_id, args.p_from, args.p_to, args.p_cursor],
      [C1, '2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z', 'cur'],
    );
  },
);

Deno.test(
  'search: the extractive answer quotes rows verbatim with emphasis spans and a confidence label',
  async () => {
    const results = [
      toResultView(row({})),
      toResultView(
        row({
          entity_id: 'aaaaaaaa-0000-4000-8000-000000000002',
          title: 'Kargo',
          snippet: 'Paket yolda',
        }),
      ),
    ];
    const { answer, sources } = groundedAnswer('Yılmaz teklif ne zaman', results, 'tr');
    assertEquals(sources.length, 1);
    assert(answer.text.startsWith('Yılmaz Endüstri teklif — Revize teklif cuma'));
    assertEquals(answer.emphasis_spans, [{ start: 0, end: 'Yılmaz Endüstri teklif'.length }]);
    assertEquals([answer.confidence_label, answer.source_count], ['partial', 1]);
    const high = groundedAnswer('teklif cuma', results, 'tr');
    assertEquals(high.answer.confidence_label, 'high');
    const none = groundedAnswer('uçak bileti', results, 'tr');
    assertEquals(
      [none.answer.confidence_label, none.answer.source_count, none.sources],
      ['unsure', 0, []],
    );
    assert(none.answer.text.length > 0);

    const { p } = ports();
    const out = await runSearch(p, { q: 'teklif cuma', mode: 'answer', limit: 5 }, CTX);
    assertEquals([out.data.answer?.confidence_label, out.data.sources?.length], ['high', 1]);
  },
);
