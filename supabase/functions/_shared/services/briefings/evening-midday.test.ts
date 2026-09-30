/**
 * Midday pulse and evening close (T-5.08; R-05; AI_PIPELINE_PLAN §4.3.7–§4.3.9): deterministic T0
 * compositions validated as `MiddayPulseV1` / `EveningCloseV1`; midday without a delta is
 * `skipped` with `no_meaningful_delta` and no push; both make zero model calls unless
 * `ai.feature.briefing_polish` is on, then at most one T1 call (TEST_PLAN IT-AI-08).
 */
import { assert, assertEquals } from '@std/assert';
import type { PipelineContext } from '../ai/pipeline.ts';
import type { BriefingItemRow, CommitmentRow, TaskRow } from '../intel/types.ts';
import {
  aiUser,
  briefingRow,
  eventRow,
  fixtureServices,
  insightRow,
  NOW,
  pipelineFlags,
} from '../../testing/intel.ts';
import { composeEvening, eveningLists, type EveningInput } from './evening.ts';
import { composeMidday, middayDeltas, middaySince, type MiddayInput } from './midday.ts';

const TZ = 'Europe/Istanbul';
const EVENING_NOW = new Date('2026-09-24T16:00:00.000Z'); // 19:00 local

function pipeline(polish = false) {
  const flags = pipelineFlags({ 'ai.feature.briefing_polish': polish });
  const ai = fixtureServices({ user: { flags } });
  const ctx: PipelineContext = {
    runtime: ai.services.runtime,
    user: aiUser({ flags }),
    correlationId: 'corr-b',
  };
  return { ctx, ai };
}

function task(overrides: Partial<TaskRow>): TaskRow {
  return {
    id: crypto.randomUUID(),
    title: 'KDV beyannamesi',
    due_date: null,
    due_at: null,
    status: 'open',
    completed_at: null,
    connected_account_id: null,
    provider: 'google',
    source_type: 'task',
    source_id: null,
    created_at: '2026-09-20T08:00:00.000Z',
    ...overrides,
  };
}

function commitment(overrides: Partial<CommitmentRow>): CommitmentRow {
  return {
    id: crypto.randomUUID(),
    contact_id: null,
    counterparty_name: 'Mehmet Yılmaz',
    direction: 'user_owes',
    text: 'Revize teklifi göndereceğim',
    due_at: null,
    due_is_date_only: false,
    status: 'open',
    completed_at: null,
    source_type: 'email_message',
    source_id: crypto.randomUUID(),
    source_provider: 'google',
    source_timestamp: '2026-09-23T09:00:00.000Z',
    confidence: 0.8,
    evidence: [],
    ...overrides,
  };
}

// ── Evening ──────────────────────────────────────────────────────────────────

function eveningInput(overrides: Partial<EveningInput> = {}): EveningInput {
  const carried = insightRow({ title: 'Mehmet Bey teklif bekliyor', kind: 'reply_needed' });
  const dueToday = insightRow({
    title: 'SGK prim ödemesi',
    kind: 'deadline',
    due_at: '2026-09-24T20:00:00.000Z',
  });
  const follow = insightRow({
    title: 'Selin yanıt vermedi',
    kind: 'follow_up',
    entity_type: 'email_thread',
    source_timestamp: '2026-09-21T09:00:00.000Z',
  });
  const done = insightRow({
    title: 'Faturayı öde',
    status: 'done',
    done_at: '2026-09-24T10:00:00.000Z',
  });
  const doneYesterday = insightRow({
    title: 'Dün bitti',
    status: 'done',
    done_at: '2026-09-23T10:00:00.000Z',
  });
  return {
    briefing: briefingRow({ kind: 'evening' }),
    now: EVENING_NOW,
    insights: [carried, dueToday, follow, done, doneYesterday],
    morningItems: [
      { insight_id: carried.id } as BriefingItemRow,
      { insight_id: carried.id } as BriefingItemRow,
      { insight_id: null } as BriefingItemRow,
      { insight_id: done.id } as BriefingItemRow,
    ],
    tasks: [
      task({ status: 'done', completed_at: '2026-09-24T12:30:00.000Z' }),
      task({ title: 'Açık görev' }),
    ],
    commitments: [commitment({ status: 'done', completed_at: '2026-09-24T14:00:00.000Z' })],
    tomorrowEvents: [
      eventRow({
        title: 'Öğle yemeği',
        start_at: '2026-09-25T09:00:00.000Z',
        end_at: '2026-09-25T10:00:00.000Z',
      }),
      eventRow({
        title: 'Satış toplantısı',
        start_at: '2026-09-25T06:30:00.000Z',
        end_at: '2026-09-25T07:30:00.000Z',
      }),
      eventRow({
        title: 'İptal',
        status: 'cancelled',
        start_at: '2026-09-25T05:00:00.000Z',
        end_at: '2026-09-25T06:00:00.000Z',
      }),
      eventRow({
        title: 'Tatil',
        all_day: true,
        start_at: '2026-09-25T00:00:00.000Z',
        end_at: '2026-09-26T00:00:00.000Z',
      }),
    ],
    awaitingSince: { [follow.entity_id]: '2026-09-22T09:00:00.000Z' },
    ...overrides,
  };
}

Deno.test(
  'evening lists: done today, carry-over from the morning plus due today, follow-ups, first event',
  () => {
    const lists = eveningLists(eveningInput(), TZ, 'tr');
    assertEquals(
      lists.completed.map((d) => [d.entityType, d.title]),
      [
        ['email_thread', 'Faturayı öde'],
        ['task', 'KDV beyannamesi'],
        ['commitment', 'Revize teklifi göndereceğim'],
      ],
    );
    assertEquals(lists.completed[1]?.meta, '15:30', 'completion times are local');
    assertEquals(
      lists.carry.map((d) => d.title),
      ['Mehmet Bey teklif bekliyor', 'SGK prim ödemesi'],
    );
    assertEquals(
      lists.followUps.map((f) => [f.insight.title, f.days]),
      [['Selin yanıt vermedi', 2]],
    );
    assert(lists.followUps[0]?.draft.meta?.includes('2'));
    assertEquals(lists.first?.title, 'Satış toplantısı');
  },
);

Deno.test(
  'evening compose (IT-AI-08): a ready close with template copy, items per section and a push',
  async () => {
    const { ctx, ai } = pipeline();
    const out = await composeEvening(ctx, eveningInput());
    assertEquals(out.patch.status, 'ready');
    assertEquals(out.patch.sections, ['completed', 'carry_over', 'follow_up', 'tomorrow_first']);
    assertEquals(out.patch.counts, {
      completed: 3,
      carry_over: 2,
      follow_ups: 1,
      tomorrow_first_at: '2026-09-25T06:30:00.000Z',
    });
    assertEquals(out.narrativeMode, 'template');
    assertEquals(out.patch.provenance, { narrative_mode: 'template' });
    assert((out.patch.hero_line ?? '').includes('2'));
    assertEquals(out.notification?.template_key, 'evening.ready');
    assertEquals(out.notification?.params_public, { count: 2 });
    assertEquals(
      out.notification?.params_sensitive.highlights,
      'Mehmet Bey teklif bekliyor · SGK prim ödemesi',
    );
    assertEquals(
      out.items.map((i) => i.section),
      [
        'completed',
        'completed',
        'completed',
        'carry_over',
        'carry_over',
        'follow_up',
        'tomorrow_first',
      ],
    );
    assertEquals(ai.calls, [], 'no model call without briefing_polish');
  },
);

Deno.test(
  'evening compose: nothing left → the "all closed" hero and the clear notification',
  async () => {
    const { ctx } = pipeline();
    const out = await composeEvening(
      ctx,
      eveningInput({
        insights: [],
        morningItems: [],
        tasks: [],
        commitments: [],
        tomorrowEvents: [],
        awaitingSince: {},
      }),
    );
    assertEquals([out.patch.counts?.carry_over, out.patch.counts?.tomorrow_first_at], [0, null]);
    assertEquals(out.notification?.template_key, 'evening.clear');
    assertEquals([out.notification?.params_public, out.notification?.params_sensitive], [{}, {}]);
    assertEquals(out.items, []);
  },
);

Deno.test('evening compose (R-05): with briefing_polish on, at most one T1 call', async () => {
  const { ctx, ai } = pipeline(true);
  const out = await composeEvening(ctx, eveningInput());
  assert(ai.calls.length <= 1);
  assertEquals(
    ai.calls.every((c) => c === 'BriefingPolishV1'),
    true,
  );
  assert(['ai', 'template'].includes(out.narrativeMode));
});

// ── Midday ───────────────────────────────────────────────────────────────────

const MIDDAY_NOW = new Date('2026-09-24T09:30:00.000Z'); // 12:30 local

function middayInput(overrides: Partial<MiddayInput> = {}): MiddayInput {
  const morning = briefingRow({ kind: 'morning', generated_at: '2026-09-24T04:30:00.000Z' });
  return {
    briefing: briefingRow({ kind: 'midday' }),
    morning,
    now: MIDDAY_NOW,
    insights: [
      insightRow({
        title: 'Mehmet Bey acil dönüş istiyor',
        kind: 'reply_needed',
        urgency: 'urgent',
        created_at: '2026-09-24T08:00:00.000Z',
      }),
      insightRow({
        title: 'Sabah öncesi',
        kind: 'reply_needed',
        urgency: 'urgent',
        created_at: '2026-09-24T03:00:00.000Z',
      }),
      insightRow({
        title: 'Toplantı çakışması',
        kind: 'conflict',
        event_at: '2026-09-24T12:00:00.000Z',
        created_at: '2026-09-24T07:00:00.000Z',
      }),
      insightRow({
        title: 'Bugün son gün: SGK',
        kind: 'deadline',
        due_at: '2026-09-24T20:00:00.000Z',
        created_at: '2026-09-24T06:00:00.000Z',
      }),
      insightRow({
        title: 'Yarınki son gün',
        kind: 'deadline',
        due_at: '2026-09-25T20:00:00.000Z',
        created_at: '2026-09-24T06:00:00.000Z',
      }),
      insightRow({
        title: 'Düşük öncelik',
        kind: 'reply_needed',
        urgency: 'low',
        created_at: '2026-09-24T08:00:00.000Z',
      }),
    ],
    events: [
      eventRow({
        title: 'Satış sunumu',
        start_at: '2026-09-24T13:00:00.000Z',
        end_at: '2026-09-24T14:00:00.000Z',
        updated_at: '2026-09-24T08:30:00.000Z',
      }),
      eventRow({
        title: 'İptal edilen görüşme',
        status: 'cancelled',
        start_at: '2026-09-24T11:00:00.000Z',
        end_at: '2026-09-24T12:00:00.000Z',
        updated_at: '2026-09-24T09:00:00.000Z',
      }),
      eventRow({
        title: 'Değişmemiş',
        start_at: '2026-09-24T15:00:00.000Z',
        end_at: '2026-09-24T16:00:00.000Z',
        updated_at: '2026-09-23T08:00:00.000Z',
      }),
      eventRow({
        title: 'Bitmiş',
        start_at: '2026-09-24T05:00:00.000Z',
        end_at: '2026-09-24T06:00:00.000Z',
        updated_at: '2026-09-24T08:00:00.000Z',
      }),
    ],
    ...overrides,
  };
}

Deno.test(
  'midday deltas: new urgent replies, today conflicts/deadlines, changed events since the morning',
  () => {
    const input = middayInput();
    assertEquals(middaySince(input, TZ).toISOString(), '2026-09-24T04:30:00.000Z');
    assertEquals(
      middaySince({ ...input, morning: null }, TZ).toISOString(),
      '2026-09-24T04:00:00.000Z',
      'local 07:00 without a morning briefing',
    );
    const deltas = middayDeltas(input, TZ, 'tr');
    assertEquals(
      deltas.map((d) => [d.type, d.badge, d.draft.title]),
      [
        ['deadline_today', 'SON TARİH', 'Bugün son gün: SGK'],
        ['new_conflict', 'TAKVİM', 'Toplantı çakışması'],
        ['new_urgent_reply', 'ACİL', 'Mehmet Bey acil dönüş istiyor'],
        ['event_changed', 'TAKVİM', 'Satış sunumu'],
        ['event_cancelled', 'TAKVİM', 'İptal edilen görüşme'],
      ],
    );
  },
);

Deno.test(
  'midday compose (IT-AI-08): ready with counts, remaining schedule and one push, zero model calls',
  async () => {
    const { ctx, ai } = pipeline();
    const out = await composeMidday(ctx, middayInput());
    assertEquals(out.patch.status, 'ready');
    assertEquals(out.patch.counts, { delta_count: 5, calendar: 3, mail: 2, remaining: 2 });
    assertEquals(out.patch.sections, ['midday_delta', 'schedule']);
    assertEquals((out.patch.provenance as { since?: string }).since, '2026-09-24T04:30:00.000Z');
    assertEquals(out.notification?.template_key, 'midday.ready');
    assertEquals(out.notification?.params_public, { count: 5 });
    assertEquals(out.items.filter((i) => i.section === 'schedule').length, 2);
    assertEquals(ai.calls, []);
  },
);

Deno.test(
  'midday compose (IT-AI-08): no meaningful delta → skipped, no notification, no items',
  async () => {
    const { ctx, ai } = pipeline(true);
    const out = await composeMidday(ctx, middayInput({ insights: [], events: [] }));
    assertEquals(
      [out.patch.status, out.patch.skipped_reason, out.notification, out.items, out.narrativeMode],
      ['skipped', 'no_meaningful_delta', null, [], 'none'],
    );
    assertEquals(out.patch.counts, { delta_count: 0 });
    assertEquals(ai.calls, [], 'a skipped pulse never calls a model');
  },
);

Deno.test('midday compose (R-05): polish on makes at most one T1 call', async () => {
  const { ctx, ai } = pipeline(true);
  const out = await composeMidday(ctx, middayInput());
  assert(ai.calls.length <= 1);
  assert(out.notification !== null);
});

Deno.test('briefing compose: the template path does not depend on the process clock', async () => {
  const { ctx } = pipeline();
  const a = await composeMidday(ctx, middayInput());
  const b = await composeMidday(ctx, middayInput());
  assertEquals(a.patch.hero_line, b.patch.hero_line);
  assertEquals(a.patch.generated_at, MIDDAY_NOW.toISOString());
  assert(NOW.getTime() < MIDDAY_NOW.getTime());
});
