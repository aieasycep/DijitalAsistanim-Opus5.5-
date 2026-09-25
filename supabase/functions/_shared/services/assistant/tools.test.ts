/**
 * Read-only assistant tools (T-5.11; AI_PIPELINE_PLAN §11.3–§11.4; R-04): the T0 template answers of
 * the structured intents over the user's derived data, person resolution and retrieval documents.
 * Every card parses as `AssistantRichCardV1` (CT-06) and every item carries its source citation
 * (IT-AI-10: citations map to the user's own rows only).
 */
import { assert, assertEquals } from '@std/assert';
import { AssistantRichCardV1 } from '@da/validation';
import type { AssistStore, ContactMatch } from '../assist/store.ts';
import type { InsightSnapshot } from '../intel/store.ts';
import type { LifeEventRow } from '../intel/types.ts';
import { eventRow, insightRow, NOW } from '../../testing/intel.ts';
import type { DetectedIntent } from './intents.ts';
import {
  personChoiceCard,
  resolvePerson,
  retrievalDocs,
  splitSentences,
  templateAnswer,
  type ToolContext,
} from './tools.ts';

const CTX: ToolContext = {
  now: NOW, // Perşembe 09:30 Europe/Istanbul
  timeZone: 'Europe/Istanbul',
  locale: 'tr',
  workingHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
};

const intent = (
  name: DetectedIntent['intent'],
  extra: Partial<DetectedIntent> = {},
): DetectedIntent => ({
  intent: name,
  people: [],
  from: null,
  to: null,
  topic: null,
  tier: 't0',
  ...extra,
});

function life(overrides: Partial<LifeEventRow>): LifeEventRow {
  return {
    id: crypto.randomUUID(),
    type: 'payment',
    title: 'Enerjisa faturası',
    status: 'open',
    event_at: null,
    due_at: '2026-09-30T20:59:00.000Z',
    payload: {},
    amount: '1250.50',
    currency: 'TRY',
    tracking_url: null,
    suppressed: false,
    resolved_at: null,
    updated_at: NOW.toISOString(),
    source_type: 'email_message',
    source_id: crypto.randomUUID(),
    source_provider: 'google',
    source_timestamp: NOW.toISOString(),
    confidence: 0.9,
    evidence: [],
    ...overrides,
  };
}

function snapshot(overrides: Partial<InsightSnapshot> = {}): InsightSnapshot {
  return {
    threads: [],
    latestInbound: [],
    commitments: [],
    lifeEvents: [],
    events: [],
    tasks: [],
    approvals: [],
    insights: [],
    vip: { contactIds: [], emails: [], notifyOff: [] },
    ownAddresses: [],
    ownDomains: [],
    mutedContacts: [],
    ...overrides,
  };
}

function cardsParse(answer: ReturnType<typeof templateAnswer>) {
  for (const card of answer?.cards ?? []) AssistantRichCardV1.parse(card);
}

Deno.test(
  'assistant tools: "Bugün neye odaklanmalıyım?" lists the top 5 open insights by rank',
  () => {
    const insights = [
      insightRow({ title: 'Mehmet Bey teklif bekliyor', rank_score: 900, urgency: 'urgent' }),
      insightRow({
        title: 'KDV beyannamesi',
        kind: 'deadline',
        rank_score: 700,
        due_at: '2026-09-26T09:00:00.000Z',
      }),
      insightRow({ title: 'Kapanmış', status: 'done', rank_score: 999 }),
      ...Array.from({ length: 5 }, (_, i) =>
        insightRow({ title: `Diğer ${String(i)}`, rank_score: 100 + i }),
      ),
    ];
    const a = templateAnswer(intent('focus_today'), snapshot({ insights }), CTX);
    cardsParse(a);
    const items = a?.cards[0]?.type === 'list' ? a.cards[0].data.items : [];
    assertEquals(
      items.map((i) => i.title),
      ['Mehmet Bey teklif bekliyor', 'KDV beyannamesi', 'Diğer 4', 'Diğer 3', 'Diğer 2'],
    );
    assertEquals([items[0]?.badge, items[1]?.badge], ['ACİL', 'SON TARİH']);
    assert(items[1]?.meta?.includes('12:00'), 'due times render in the user zone');
    assertEquals(a?.citations.length, 5);
    assert(a?.text.includes('Mehmet Bey teklif bekliyor'));
    const none = templateAnswer(intent('focus_today'), snapshot(), CTX);
    assertEquals([none?.cards, none?.citations], [[], []]);
    assert((none?.text ?? '').length > 0);
  },
);

Deno.test('assistant tools: who needs a reply — reply_needed only, earliest due first', () => {
  const insights = [
    insightRow({ title: 'Selin', kind: 'reply_needed', due_at: '2026-09-25T09:00:00.000Z' }),
    insightRow({ title: 'Mehmet', kind: 'reply_needed', due_at: '2026-09-24T12:00:00.000Z' }),
    insightRow({ title: 'Tarihsiz', kind: 'reply_needed', due_at: null }),
    insightRow({ title: 'Toplantı', kind: 'meeting' }),
  ];
  const a = templateAnswer(intent('who_needs_reply'), snapshot({ insights }), CTX);
  cardsParse(a);
  const items = a?.cards[0]?.type === 'list' ? a.cards[0].data.items : [];
  assertEquals(
    items.map((i) => i.title),
    ['Mehmet', 'Selin', 'Tarihsiz'],
  );
  assertEquals(templateAnswer(intent('who_needs_reply'), snapshot(), CTX)?.cards, []);
});

Deno.test(
  'assistant tools: "Yarın yoğun muyum?" counts real meetings and names the longest gap',
  () => {
    const events = [
      eventRow({
        title: 'Satış toplantısı',
        start_at: '2026-09-25T06:00:00.000Z',
        end_at: '2026-09-25T07:00:00.000Z',
      }),
      eventRow({
        title: 'Yılmaz Endüstri',
        start_at: '2026-09-25T11:00:00.000Z',
        end_at: '2026-09-25T12:00:00.000Z',
      }),
      eventRow({
        title: 'İptal',
        status: 'cancelled',
        start_at: '2026-09-25T08:00:00.000Z',
        end_at: '2026-09-25T09:00:00.000Z',
      }),
      eventRow({
        title: 'Tatil',
        all_day: true,
        start_at: '2026-09-25T00:00:00.000Z',
        end_at: '2026-09-26T00:00:00.000Z',
      }),
      eventRow({
        title: 'Bugün',
        start_at: '2026-09-24T10:00:00.000Z',
        end_at: '2026-09-24T11:00:00.000Z',
      }),
    ];
    const a = templateAnswer(intent('am_i_busy'), snapshot({ events }), CTX);
    cardsParse(a);
    const card = a?.cards[0];
    assert(card?.type === 'list');
    assertEquals(
      card.data.items.map((i) => [i.title, i.meta]),
      [
        ['Satış toplantısı', '09:00–10:00'],
        ['Yılmaz Endüstri', '14:00–15:00'],
      ],
    );
    assert(card.data.title.includes('YARIN'));
    assert(card.route.includes('2026-09-25'));
    assert(
      a?.text.includes('10:00') && a.text.includes('14:00'),
      `the longest free gap is 10:00–14:00: ${a?.text ?? ''}`,
    );
    assertEquals(
      a?.citations.map((c) => c.source.source_type),
      ['calendar_event', 'calendar_event'],
    );

    const free = templateAnswer(
      intent('am_i_busy', {
        from: new Date('2026-09-27T21:00:00Z'),
        to: new Date('2026-09-28T21:00:00Z'),
      }),
      snapshot({ events }),
      CTX,
    );
    assertEquals(free?.cards, []);
    const today = templateAnswer(
      intent('am_i_busy', {
        from: new Date('2026-09-23T21:00:00Z'),
        to: new Date('2026-09-24T21:00:00Z'),
      }),
      snapshot({ events }),
      CTX,
    );
    assert(today?.cards[0]?.type === 'list' && today.cards[0].data.title.includes('BUGÜN'));
    const en = templateAnswer(intent('am_i_busy'), snapshot({ events }), { ...CTX, locale: 'en' });
    assert(
      en?.cards[0]?.type === 'list' && en.cards[0].data.title.toUpperCase().includes('TOMORROW'),
    );
  },
);

Deno.test(
  'assistant tools: deadlines in the named period (default 7 days), sorted by due time',
  () => {
    const insights = [
      insightRow({ title: 'SGK prim', kind: 'deadline', due_at: '2026-09-29T09:00:00.000Z' }),
      insightRow({ title: 'KDV', kind: 'deadline', due_at: '2026-09-26T09:00:00.000Z' }),
      insightRow({ title: 'Çok ileri', kind: 'deadline', due_at: '2026-11-01T09:00:00.000Z' }),
      insightRow({ title: 'Tarihsiz', kind: 'deadline', due_at: null }),
    ];
    const a = templateAnswer(intent('deadlines_period'), snapshot({ insights }), CTX);
    cardsParse(a);
    assert(a?.cards[0]?.type === 'list');
    assertEquals(
      a.cards[0].data.items.map((i) => i.title),
      ['KDV', 'SGK prim'],
    );
    const month = templateAnswer(
      intent('deadlines_period', { from: NOW, to: new Date('2026-11-30T00:00:00Z') }),
      snapshot({ insights }),
      CTX,
    );
    assert(month?.cards[0]?.type === 'list' && month.cards[0].data.items.length === 3);
    assertEquals(templateAnswer(intent('deadlines_period'), snapshot(), CTX)?.cards, []);
  },
);

Deno.test(
  'assistant tools: payments and travel read life events; undated open payments are included',
  () => {
    const lifeEvents = [
      life({ title: 'Enerjisa faturası' }),
      life({ title: 'Netflix yenileme', type: 'subscription', due_at: null, amount: null }),
      life({ title: 'Susturulmuş', suppressed: true }),
      life({
        title: 'TK2124 İstanbul–Ankara',
        type: 'flight',
        due_at: null,
        event_at: '2026-09-28T04:15:00.000Z',
        amount: null,
        currency: null,
      }),
      life({
        title: 'Kaya Otel',
        type: 'reservation',
        due_at: null,
        event_at: '2026-12-20T11:00:00.000Z',
        amount: null,
      }),
    ];
    const pay = templateAnswer(intent('payments_period'), snapshot({ lifeEvents }), CTX);
    cardsParse(pay);
    assert(pay?.cards[0]?.type === 'list');
    assertEquals(pay.cards[0].data.kind, 'payments');
    assertEquals(
      pay.cards[0].data.items.map((i) => [i.title, i.meta]),
      [
        [
          'Enerjisa faturası',
          `${pay.cards[0].data.items[0]?.meta?.split(' · ')[0] ?? ''} · 1250.50 TRY`,
        ],
        ['Netflix yenileme', null],
      ],
    );
    assertEquals(pay.citations.length, 2);

    const travel = templateAnswer(intent('travel_lookup'), snapshot({ lifeEvents }), CTX);
    cardsParse(travel);
    assert(travel?.cards[0]?.type === 'list');
    assertEquals(
      travel.cards[0].data.items.map((i) => i.title),
      ['TK2124 İstanbul–Ankara'],
    );
    assert(travel.text.length > pay.text.length - 100);
    const ranged = templateAnswer(
      intent('travel_lookup', {
        from: new Date('2026-12-01T00:00:00Z'),
        to: new Date('2026-12-31T00:00:00Z'),
      }),
      snapshot({ lifeEvents }),
      CTX,
    );
    assert(
      ranged?.cards[0]?.type === 'list' && ranged.cards[0].data.items[0]?.title === 'Kaya Otel',
    );
    assertEquals(templateAnswer(intent('payments_period'), snapshot(), CTX)?.cards, []);
    assertEquals(templateAnswer(intent('travel_lookup'), snapshot(), CTX)?.cards, []);
  },
);

Deno.test(
  'assistant tools: canned intents, snooze candidates, and intents that need retrieval',
  () => {
    for (const name of ['play_briefing', 'smalltalk', 'unsupported'] as const) {
      const a = templateAnswer(intent(name), snapshot(), CTX);
      assertEquals([a?.cards, a?.citations], [[], []]);
      assert((a?.text ?? '').length > 0);
    }
    const insights = [
      insightRow({ title: 'Mehmet Bey teklif bekliyor' }),
      insightRow({ title: 'Selin ajans' }),
    ];
    const snooze = templateAnswer(
      intent('snooze_item', { people: ['MEHMET'] }),
      snapshot({ insights }),
      CTX,
    );
    cardsParse(snooze);
    assert(snooze?.cards[0]?.type === 'list');
    assertEquals(
      snooze.cards[0].data.items.map((i) => i.title),
      ['Mehmet Bey teklif bekliyor'],
    );
    const all = templateAnswer(intent('snooze_item'), snapshot({ insights }), CTX);
    assert(all?.cards[0]?.type === 'list' && all.cards[0].data.items.length === 2);
    assertEquals(
      templateAnswer(intent('snooze_item', { people: ['Zeynep'] }), snapshot({ insights }), CTX)
        ?.cards,
      [],
    );
    assertEquals(templateAnswer(intent('last_contact' as never), snapshot(), CTX), null);
  },
);

Deno.test(
  'assistant tools: person resolution — scoped contact, one match, a choice card, none',
  async () => {
    const C1 = 'cccccccc-0000-4000-8000-000000000001';
    const C2 = 'cccccccc-0000-4000-8000-000000000002';
    const mehmet: ContactMatch = {
      id: C1,
      display_name: 'Mehmet Yılmaz',
      primary_email: 'mehmet@yilmazendustri.example',
      organization: 'Yılmaz Endüstri',
    };
    const other: ContactMatch = {
      id: C2,
      display_name: 'Mehmet Demir',
      primary_email: null,
      organization: null,
    };
    const calls: string[] = [];
    const store = {
      contact: (_u: string, id: string) => {
        calls.push(`contact:${id}`);
        return Promise.resolve(id === C1 ? mehmet : null);
      },
      contactsNamed: (_u: string, names: readonly string[]) => {
        calls.push(`named:${names.join(',')}`);
        return Promise.resolve(
          names[0] === 'Mehmet' ? [mehmet, other] : names[0] === 'Yılmaz' ? [mehmet] : [],
        );
      },
    } as unknown as AssistStore;
    assertEquals(await resolvePerson(store, 'u', [], C1), { kind: 'one', contact: mehmet });
    assertEquals(await resolvePerson(store, 'u', [], 'gone'), { kind: 'none' });
    assertEquals(await resolvePerson(store, 'u', [], null), { kind: 'none' });
    assertEquals(await resolvePerson(store, 'u', ['Yılmaz'], null), {
      kind: 'one',
      contact: mehmet,
    });
    assertEquals(await resolvePerson(store, 'u', ['Mehmet'], C1), {
      kind: 'many',
      contacts: [mehmet, other],
    });
    assertEquals(await resolvePerson(store, 'u', ['Zeynep'], null), { kind: 'none' });
    const card = personChoiceCard([mehmet, other], 'tr');
    AssistantRichCardV1.parse(card);
    assert(card.type === 'list');
    assertEquals(
      card.data.items.map((i) => [i.entity_id, i.meta]),
      [
        [C1, 'Yılmaz Endüstri'],
        [C2, null],
      ],
    );
  },
);

Deno.test(
  'assistant tools: retrieval rows become r1..r6 documents with sentence splits and citations',
  () => {
    const view = (
      i: number,
      title = `Başlık ${String(i)}`,
      snippet = 'İlk cümle. İkinci cümle!',
    ) => ({
      chunk_id: `k${String(i)}`,
      title,
      snippet,
      score: 1 - i / 10,
      source: {
        source_type: 'email_thread',
        source_id: `t${String(i)}`,
        source_provider: 'google',
        source_timestamp: NOW.toISOString(),
        ...(i === 1 ? { open_route: '/mail/t1' } : {}),
      },
    });
    const rows = [view(1), view(2, '', ''), ...Array.from({ length: 7 }, (_, i) => view(i + 3))];
    const { docs, citations } = retrievalDocs(rows as never);
    assertEquals(
      docs.map((d) => d.source),
      ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'],
    );
    assertEquals(docs[0]?.sentences, ['Başlık 1.', 'İlk cümle.', 'İkinci cümle!']);
    assertEquals(citations[0]?.source.source_id, 't1');
    assertEquals((citations[0]?.source as { open_route?: string }).open_route, '/mail/t1');
    assertEquals(citations[1]?.source.source_id, 't3', 'an empty row is skipped');
    assertEquals(retrievalDocs(rows as never, 2).docs.length, 2);
    assertEquals(splitSentences('a. Tamam? Evet\nHayır x'), ['a.', 'Tamam?', 'Evet', 'Hayır x']);
    assertEquals(
      splitSentences('! . Tamam'),
      ['Tamam'],
      'fragments under two characters are dropped',
    );
    assertEquals(splitSentences(''), []);
  },
);
