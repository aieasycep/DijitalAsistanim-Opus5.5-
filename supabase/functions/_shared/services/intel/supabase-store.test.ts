/**
 * The service-client pipeline stores (`supabase-store.ts`) against a PostgREST double: every read is
 * scoped by the verified `user_id` (IT-PRIV-05), writes carry the documented columns only, upserts
 * use the DATABASE_AND_RLS_PLAN unique keys, and database errors map to the API_CONTRACTS §15 codes.
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { AppError } from '../../errors.ts';
import { USER_A } from '../../testing/jwt.ts';
import { accountRow, messageRow, NOW, threadRow } from '../../testing/intel.ts';
import { pgCount, pgError, postgrest, type PgRequest } from '../../testing/postgrest.ts';
import {
  MESSAGE_COLUMNS,
  supabaseBriefingStore,
  supabaseInsightStore,
  supabaseMailStore,
  supabaseMemoryStore,
  supabaseStatsStore,
  THREAD_COLUMNS,
} from './supabase-store.ts';
import type { LifeEventInsert } from '../life/classify.ts';
import type {
  ApprovalInsert,
  BriefingItemInsert,
  CommitmentInsert,
  InsightUpsert,
  MemoryChunkInsert,
} from './types.ts';

const T1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const T2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const C1 = 'cccccccc-0000-4000-8000-000000000001';

async function appError(p: Promise<unknown>): Promise<AppError> {
  const e = await assertRejects(() => p);
  assert(e instanceof AppError);
  return e;
}

// ── Mail store ───────────────────────────────────────────────────────────────

Deno.test(
  'intel mail store: account/messages/threads read the documented columns by id',
  async () => {
    const pg = postgrest({
      'GET connected_accounts': [accountRow()],
      'GET email_messages': [
        { ...messageRow({ id: T1 }), classification_confidence: '0.850' },
        { ...messageRow({ id: T2 }), classification_confidence: null },
      ],
      'GET email_threads': [{ ...threadRow({ id: T1 }), category_confidence: '0.7' }],
    });
    const store = supabaseMailStore(pg.db);
    assertEquals((await store.account(accountRow().id))?.account_email, 'yunus@firma.example');
    const acct = pg.to('connected_accounts')[0]!;
    assertEquals(acct.select, 'id,user_id,provider,account_email,status,data_source_toggles');
    assertEquals(acct.params.id, `eq.${accountRow().id}`);

    const messages = await store.messages([T1, T2]);
    assertEquals(
      messages.map((m) => m.classification_confidence),
      [0.85, null],
    );
    assertEquals(pg.to('email_messages')[0]?.select, MESSAGE_COLUMNS);
    assertEquals(pg.to('email_messages')[0]?.params.id, `in.(${T1},${T2})`);
    assert(!MESSAGE_COLUMNS.includes('body'), 'no body column is ever selected');

    const threads = await store.threads([T1]);
    assertEquals(threads[0]?.category_confidence, 0.7);
    assertEquals(pg.to('email_threads')[0]?.select, THREAD_COLUMNS);

    // Empty id lists never reach PostgREST.
    const before = pg.calls.length;
    assertEquals(await store.messages([]), []);
    assertEquals(await store.threads([]), []);
    assertEquals(pg.calls.length, before);
  },
);

Deno.test(
  'intel mail store: an absent account is null; DB errors map to AppError codes',
  async () => {
    const empty = postgrest({ 'GET connected_accounts': [] });
    assertEquals(await supabaseMailStore(empty.db).account(T1), null);

    const cases: [Response, string, Record<string, unknown> | undefined][] = [
      [pgError('P0002', 'not found'), 'NOT_FOUND', undefined],
      [pgError('42501', 'permission denied'), 'FORBIDDEN', undefined],
      [pgError('22023', 'VALIDATION_FAILED:p_user'), 'VALIDATION_FAILED', undefined],
      [
        pgError('P0001', 'PLAN_LIMIT:vip_max'),
        'ENTITLEMENT_REQUIRED',
        { feature: 'vip', limit_key: 'vip_max' },
      ],
      [
        pgError('P0001', 'ENTITLEMENT_REQUIRED:ai_memory'),
        'ENTITLEMENT_REQUIRED',
        { feature: 'ai_memory' },
      ],
      [pgError('57014', 'canceling statement'), 'SERVICE_UNAVAILABLE', undefined],
    ];
    for (const [response, code, details] of cases) {
      const pg = postgrest(() => response.clone());
      const e = await appError(supabaseMailStore(pg.db).account(T1));
      assertEquals(e.code, code);
      if (details !== undefined) assertEquals(e.details, details);
    }
  },
);

Deno.test(
  'intel mail store: thread history is newest-first bounded, returned oldest-first',
  async () => {
    const older = messageRow({ id: T1, received_at: '2026-09-23T08:00:00.000Z' });
    const newer = messageRow({ id: T2, received_at: '2026-09-24T08:00:00.000Z' });
    const pg = postgrest({ 'GET email_messages': [newer, older] });
    const rows = await supabaseMailStore(pg.db).threadMessages(T1, 12);
    assertEquals(
      rows.map((r) => r.id),
      [T1, T2],
    );
    const q = pg.calls[0]!;
    assertEquals(q.params.thread_id, `eq.${T1}`);
    assertEquals(q.params.provider_deleted_at, 'is.null');
    assertEquals(q.params.order, 'received_at.desc');
    assertEquals(q.params.limit, '12');
  },
);

Deno.test(
  'intel mail store: own addresses, rules, learned preferences and VIPs per user',
  async () => {
    const pg = postgrest({
      'GET connected_accounts': [
        { account_email: 'Yunus@Firma.Example' },
        { account_email: null },
        { account_email: 'yunus.k@gmail.example' },
      ],
      'GET priority_rules': [{ id: 'r1', sort_order: 1 }],
      'GET learned_preferences': [{ id: 'l1' }],
      'GET vip_people': [
        {
          contact_id: C1,
          always_notify: true,
          contacts: {
            primary_email: 'Mehmet@YilmazEndustri.example',
            emails: ['mehmet@yilmazendustri.example'],
          },
        },
        { contact_id: T2, always_notify: false, contacts: null },
      ],
    });
    const store = supabaseMailStore(pg.db);
    assertEquals(await store.ownAddresses(USER_A), [
      'yunus@firma.example',
      'yunus.k@gmail.example',
    ]);
    const own = pg.to('connected_accounts')[0]!;
    assertEquals([own.params.user_id, own.params.disconnected_at], [`eq.${USER_A}`, 'is.null']);

    assertEquals((await store.rules(USER_A)).length, 1);
    const rules = pg.to('priority_rules')[0]!;
    assertEquals(rules.params, {
      user_id: `eq.${USER_A}`,
      enabled: 'eq.true',
      deleted_at: 'is.null',
      order: 'sort_order.asc',
    });
    assertEquals((await store.learned(USER_A)).length, 1);
    assertEquals(pg.to('learned_preferences')[0]?.params.user_id, `eq.${USER_A}`);

    const vip = await store.vip(USER_A);
    assertEquals(vip, {
      contactIds: [C1, T2],
      emails: ['mehmet@yilmazendustri.example'],
      notifyOff: [T2],
    });
    assertEquals(
      pg.to('vip_people')[0]?.select,
      'contact_id,always_notify,contacts(primary_email,emails)',
    );
  },
);

Deno.test(
  'intel mail store: sender history — replied before needs outbound, known also a recent inbound',
  async () => {
    const since = new Date('2026-06-01T00:00:00Z');
    const pg = postgrest({
      'GET contacts': [
        {
          primary_email: 'Mehmet@YilmazEndustri.example',
          emails: ['m.yilmaz@yilmazendustri.example'],
          last_inbound_at: '2026-09-20T08:00:00Z',
          last_outbound_at: '2026-09-21T08:00:00Z',
        },
        {
          primary_email: 'selin@ajans.example',
          emails: [],
          last_inbound_at: '2026-01-01T00:00:00Z',
          last_outbound_at: '2026-01-02T00:00:00Z',
        },
        {
          primary_email: 'bulten@haber.example',
          emails: null,
          last_inbound_at: '2026-09-22T00:00:00Z',
          last_outbound_at: null,
        },
      ],
    });
    const store = supabaseMailStore(pg.db);
    const h = await store.senderHistory(
      USER_A,
      ['mehmet@yilmazendustri.example', 'selin@ajans.example', 'bulten@haber.example'],
      since,
    );
    assertEquals([...h.known].sort(), [
      'm.yilmaz@yilmazendustri.example',
      'mehmet@yilmazendustri.example',
    ]);
    assertEquals([...h.repliedBefore].sort(), [
      'm.yilmaz@yilmazendustri.example',
      'mehmet@yilmazendustri.example',
      'selin@ajans.example',
    ]);
    const q = pg.calls[0]!;
    assertEquals(q.params.user_id, `eq.${USER_A}`);
    assert(q.params.emails?.startsWith('ov.{'));
    const empty = await store.senderHistory(USER_A, [], since);
    assertEquals([empty.known.size, empty.repliedBefore.size, pg.calls.length], [0, 0, 1]);
  },
);

Deno.test(
  'intel mail store: message/thread patches and contact RPCs send the exact bodies',
  async () => {
    const pg = postgrest({
      'PATCH email_messages': undefined,
      'PATCH email_threads': undefined,
      'POST rpc/upsert_contacts_from_people': { 'mehmet@yilmazendustri.example': C1 },
      'POST rpc/link_contact_refs': 3,
      'POST rpc/refresh_contact_stats': 1,
      'GET contacts': [
        { id: C1, display_name: 'Mehmet Yılmaz', emails: ['mehmet@yilmazendustri.example'] },
      ],
    });
    const store = supabaseMailStore(pg.db);
    await store.updateMessage(T1, { ai_status: 'classified', classification: 'important' });
    const patch = pg.to('email_messages', 'PATCH')[0]!;
    assertEquals(patch.params.id, `eq.${T1}`);
    assertEquals(patch.body, { ai_status: 'classified', classification: 'important' });
    await store.updateThread(T2, { reply_state: 'awaiting_my_reply' });
    assertEquals(pg.to('email_threads', 'PATCH')[0]?.body, { reply_state: 'awaiting_my_reply' });

    const people = [
      { email: 'mehmet@yilmazendustri.example', name: 'Mehmet Yılmaz', role: 'from' as const },
    ];
    assertEquals(await store.upsertContacts(USER_A, people), {
      'mehmet@yilmazendustri.example': C1,
    });
    assertEquals(pg.to('rpc/upsert_contacts_from_people')[0]?.body, {
      p_user: USER_A,
      p_people: people,
    });
    assertEquals(await store.upsertContacts(USER_A, []), {});
    assertEquals(pg.to('rpc/upsert_contacts_from_people').length, 1);

    await store.linkContacts(USER_A, [T1], []);
    assertEquals(pg.to('rpc/link_contact_refs')[0]?.body, {
      p_user: USER_A,
      p_thread_ids: [T1],
      p_event_ids: [],
    });
    await store.refreshContactStats(USER_A, null);
    await store.refreshContactStats(USER_A, [C1]);
    assertEquals(
      pg.to('rpc/refresh_contact_stats').map((c) => c.body),
      [
        { p_user: USER_A, p_contact_ids: null },
        { p_user: USER_A, p_contact_ids: [C1] },
      ],
    );

    const refs = await store.contactsByEmail(USER_A, ['Mehmet@YilmazEndustri.example']);
    assertEquals(refs[0]?.id, C1);
    const q = pg.to('contacts')[0]!;
    assertEquals(q.params.merged_into_id, 'is.null');
    assertEquals(q.params.emails, 'ov.{mehmet@yilmazendustri.example}');
    assertEquals(await store.contactsByEmail(USER_A, []), []);
  },
);

Deno.test(
  'intel mail store: derived rows upsert on (user_id, dedupe_key); commitments never overwrite',
  async () => {
    const pg = postgrest({
      'POST life_events': [{ id: T1, dedupe_key: 'shipment:yurtici:1234567890' }],
      'POST commitments': [{ id: T2, dedupe_key: 'commitment:x' }],
      'POST insights': [{ id: C1, dedupe_key: 'reply_needed:email_thread:t' }],
      'GET calendar_events': [{ id: T1, title: 'Haftalık satış' }],
    });
    const store = supabaseMailStore(pg.db);
    const life = [
      { user_id: USER_A, dedupe_key: 'shipment:yurtici:1234567890' },
    ] as unknown as LifeEventInsert[];
    assertEquals(await store.upsertLifeEvents(life), [
      { id: T1, dedupe_key: 'shipment:yurtici:1234567890' },
    ]);
    const lifeReq = pg.to('life_events')[0]!;
    assertEquals(lifeReq.params.on_conflict, 'user_id,dedupe_key');
    assertEquals(lifeReq.select, 'id,dedupe_key');
    assert(lifeReq.prefer.includes('resolution=merge-duplicates'));

    await store.upsertCommitments([
      { user_id: USER_A, dedupe_key: 'commitment:x' },
    ] as unknown as CommitmentInsert[]);
    assert(pg.to('commitments')[0]!.prefer.includes('resolution=ignore-duplicates'));

    await store.upsertInsights([
      { user_id: USER_A, dedupe_key: 'd' },
    ] as unknown as InsightUpsert[]);
    assertEquals(pg.to('insights')[0]?.params.on_conflict, 'user_id,dedupe_key');

    assertEquals(await store.upsertLifeEvents([]), []);
    assertEquals(await store.upsertCommitments([]), []);
    assertEquals(await store.upsertInsights([]), []);
    assertEquals(pg.calls.length, 3);

    const from = new Date('2026-09-24T00:00:00Z');
    const to = new Date('2026-09-25T00:00:00Z');
    await store.events(USER_A, from, to);
    const ev = pg.to('calendar_events')[0]!;
    assertEquals(ev.params.start_at, `lt.${to.toISOString()}`);
    assertEquals(ev.params.end_at, `gt.${from.toISOString()}`);
    assertEquals(ev.params.provider_deleted_at, 'is.null');
  },
);

Deno.test(
  'intel mail store: commitment approvals are skipped while one is already pending',
  async () => {
    const row = (ref: string): ApprovalInsert =>
      ({
        user_id: USER_A,
        action_type: 'commitment_create',
        origin: 'commitment_detection',
        origin_ref_id: ref,
        idempotency_key: `commitment_create:${ref}`,
      }) as unknown as ApprovalInsert;
    const pg = postgrest((req: PgRequest) => {
      if (req.method === 'GET')
        return req.params.origin_ref_id === `eq.${T1}` ? [{ id: 'existing' }] : [];
      return [{ id: 'new' }];
    });
    assertEquals(await supabaseMailStore(pg.db).insertApprovals([row(T1), row(T2)]), 1);
    const lookups = pg.calls.filter((c) => c.method === 'GET');
    assertEquals(lookups[0]?.params.status, 'eq.pending');
    assertEquals(lookups[0]?.params.action_type, 'eq.commitment_create');
    const upserts = pg.calls.filter((c) => c.method === 'POST');
    assertEquals(upserts.length, 1);
    assertEquals(upserts[0]?.params.on_conflict, 'idempotency_key');
    assert(upserts[0]!.prefer.includes('resolution=ignore-duplicates'));
  },
);

// ── Insight store ────────────────────────────────────────────────────────────

Deno.test(
  'intel insight store: the snapshot reads each source scoped to the user and resolves mutes',
  async () => {
    const awaiting = threadRow({ id: T1, reply_state: 'awaiting_my_reply' });
    const deadline = threadRow({
      id: T2,
      reply_state: 'none',
      deadline_at: '2026-09-26T09:00:00Z',
    });
    const pg = postgrest((req) => {
      switch (req.path) {
        case 'email_threads':
          return [{ ...awaiting, category_confidence: '0.9' }, deadline];
        case 'email_messages':
          return [
            messageRow({ id: 'm2', thread_id: T1, received_at: '2026-09-24T06:00:00Z' }),
            messageRow({ id: 'm1', thread_id: T1, received_at: '2026-09-23T06:00:00Z' }),
          ];
        case 'commitments':
          return [{ id: 'c1', confidence: '0.8', status: 'open' }];
        case 'life_events':
          return [{ id: 'l1', confidence: 0.9, status: 'open' }];
        case 'calendar_events':
          return [{ id: 'e1' }];
        case 'tasks':
          return [{ id: 'k1' }];
        case 'approval_actions':
          return [{ id: 'a1', status: 'pending' }];
        case 'insights':
          return [{ id: 'i1', confidence: '0.75', rank_score: '310' }];
        case 'connected_accounts':
          return [
            { account_email: 'yunus@firma.example' },
            { account_email: 'yunus@gmail.example' },
          ];
        case 'vip_people':
          return [];
        case 'learned_preferences':
          return [
            {
              target_type: 'sender',
              target_ref: 'Bulten@Haber.example',
              effect: { follow_up: 'mute' },
              enabled: true,
              deleted_at: null,
            },
            {
              target_type: 'contact',
              target_ref: C1,
              effect: { follow_up: 'mute' },
              enabled: true,
              deleted_at: null,
            },
            {
              target_type: 'sender',
              target_ref: 'off@x.example',
              effect: { follow_up: 'mute' },
              enabled: false,
              deleted_at: null,
            },
            {
              target_type: 'sender',
              target_ref: 'boost@x.example',
              effect: { priority: 'high' },
              enabled: true,
              deleted_at: null,
            },
          ];
        case 'contacts':
          return [{ emails: ['Selin@Ajans.example'] }];
        default:
          return pgError('UNMATCHED', req.path, 500);
      }
    });
    const snap = await supabaseInsightStore(pg.db).snapshot(USER_A, NOW);
    assertEquals(
      snap.threads.map((t) => [t.id, t.category_confidence]),
      [
        [T1, 0.9],
        [T2, null],
      ],
    );
    assertEquals(
      snap.latestInbound.map((m) => m.id),
      ['m2'],
      'one latest inbound message per awaiting thread',
    );
    assertEquals(snap.commitments[0]?.confidence, 0.8);
    assertEquals([snap.insights[0]?.confidence, snap.insights[0]?.rank_score], [0.75, 310]);
    assertEquals(snap.ownDomains, ['firma.example', 'gmail.example']);
    assertEquals([...snap.mutedContacts].sort(), ['bulten@haber.example', 'selin@ajans.example']);
    for (const table of [
      'email_threads',
      'commitments',
      'life_events',
      'calendar_events',
      'tasks',
      'approval_actions',
      'insights',
    ]) {
      assertEquals(pg.to(table)[0]?.params.user_id, `eq.${USER_A}`, table);
    }
    const since = new Date(NOW.getTime() - 30 * 86_400_000).toISOString();
    assertEquals(
      pg.to('email_threads')[0]?.params.or,
      '(reply_state.neq.none,deadline_at.not.is.null)',
    );
    assertEquals(pg.to('email_threads')[0]?.params.last_message_at, `gte.${since}`);
    assertEquals(pg.to('life_events')[0]?.params.suppressed, 'eq.false');
    const inbound = pg.to('email_messages')[0]!;
    assertEquals(
      [inbound.params.thread_id, inbound.params.direction, inbound.params.limit],
      [`in.(${T1})`, 'eq.inbound', '5'],
    );
    assertEquals(pg.to('contacts')[0]?.params.id, `in.(${C1})`);
  },
);

Deno.test(
  'intel insight store: expiry only touches open/snoozed rows; thread patches go one by one',
  async () => {
    const pg = postgrest({ 'PATCH insights': undefined, 'PATCH email_threads': undefined });
    const store = supabaseInsightStore(pg.db);
    await store.expireInsights(USER_A, []);
    assertEquals(pg.calls.length, 0);
    await store.expireInsights(USER_A, [T1, T2]);
    const q = pg.calls[0]!;
    assertEquals(q.body, { status: 'expired' });
    assertEquals(q.params, {
      user_id: `eq.${USER_A}`,
      id: `in.(${T1},${T2})`,
      status: 'in.(open,snoozed)',
    });
    await store.updateThreads([
      { id: T1, patch: { follow_up_state: 'resolved' } },
      { id: T2, patch: { topic_label: 'Teklif' } },
    ]);
    assertEquals(
      pg.to('email_threads').map((c) => [c.params.id, c.body]),
      [
        [`eq.${T1}`, { follow_up_state: 'resolved' }],
        [`eq.${T2}`, { topic_label: 'Teklif' }],
      ],
    );
  },
);

// ── Briefing store ───────────────────────────────────────────────────────────

Deno.test(
  'intel briefing store: ensure is an ignore-duplicates upsert on (user, kind, day) then a re-read',
  async () => {
    const row = {
      user_id: USER_A,
      kind: 'morning' as const,
      local_date: '2026-09-24',
      time_zone: 'Europe/Istanbul',
      scheduled_for: NOW.toISOString(),
      idempotency_key: `briefing:${USER_A}:morning:2026-09-24`,
      origin: 'scheduled',
    };
    const pg = postgrest({ 'POST briefings': undefined, 'GET briefings': [{ id: T1, ...row }] });
    const store = supabaseBriefingStore(pg.db);
    assertEquals((await store.ensure(row)).id, T1);
    const upsert = pg.to('briefings', 'POST')[0]!;
    assertEquals(upsert.params.on_conflict, 'user_id,kind,local_date');
    assert(upsert.prefer.includes('resolution=ignore-duplicates'));
    const read = pg.to('briefings', 'GET')[0]!;
    assertEquals([read.params.kind, read.params.local_date], ['eq.morning', 'eq.2026-09-24']);

    const missing = postgrest({ 'POST briefings': undefined, 'GET briefings': [] });
    await assertRejects(
      () => supabaseBriefingStore(missing.db).ensure(row),
      Error,
      'briefing_ensure_failed',
    );
  },
);

Deno.test(
  'intel briefing store: reads, item replacement keeps carried-over rows, batch ledger',
  async () => {
    const pg = postgrest({
      'GET briefings': [{ id: T1, kind: 'evening' }],
      'PATCH briefings': undefined,
      'DELETE briefing_items': undefined,
      'POST briefing_items': undefined,
      'GET briefing_items': [{ id: 'bi1', confidence: '0.95', position: 0 }],
      'POST ai_batches': undefined,
      'PATCH ai_batches': undefined,
    });
    const store = supabaseBriefingStore(pg.db);
    assertEquals((await store.byId(T1))?.id, T1);
    assertEquals((await store.forDate(USER_A, 'evening', '2026-09-24'))?.id, T1);
    const forDate = pg.to('briefings', 'GET')[1]!;
    assertEquals(forDate.params, {
      user_id: `eq.${USER_A}`,
      kind: 'eq.evening',
      local_date: 'eq.2026-09-24',
    });
    await store.update(T1, { status: 'ready' });
    assertEquals(pg.to('briefings', 'PATCH')[0]?.body, { status: 'ready' });

    await store.replaceItems(T1, []);
    assertEquals(pg.to('briefing_items', 'DELETE')[0]?.params, {
      briefing_id: `eq.${T1}`,
      carried_over_to: 'is.null',
    });
    assertEquals(pg.to('briefing_items', 'POST').length, 0, 'no insert for an empty item list');
    await store.replaceItems(T1, [
      { briefing_id: T1, position: 0 } as unknown as BriefingItemInsert,
    ]);
    assertEquals(pg.to('briefing_items', 'POST')[0]?.body, [{ briefing_id: T1, position: 0 }]);

    assertEquals((await store.items(T1))[0]?.confidence, 0.95);
    assertEquals(pg.to('briefing_items', 'GET')[0]?.params.order, 'section.asc,position.asc');
    await store.carriedTo(USER_A, '2026-09-25');
    const carried = pg.to('briefing_items', 'GET')[1]!;
    assertEquals(
      [carried.params.carried_over_to, carried.params.done_at],
      ['eq.2026-09-25', 'is.null'],
    );

    assertEquals(await store.byJobIds([]), []);
    await store.byJobIds(['j1', 'j2']);
    assertEquals(pg.to('briefings', 'GET').at(-1)?.params.job_id, 'in.(j1,j2)');

    await store.recordBatch({
      batch_id: 'msgbatch_01',
      feature: 'weekly_summary',
      request_count: 4,
      correlation_id: 'corr-1',
    });
    const batch = pg.to('ai_batches', 'POST')[0]!.body as Record<string, unknown>;
    assertEquals(
      [batch.provider, batch.status, batch.batch_id, batch.request_count, batch.correlation_id],
      ['anthropic', 'submitted', 'msgbatch_01', 4, 'corr-1'],
    );
    assert(typeof batch.submitted_at === 'string');
    await store.updateBatch('msgbatch_01', { status: 'ended' });
    assertEquals(pg.to('ai_batches', 'PATCH')[0]?.params, {
      provider: 'eq.anthropic',
      batch_id: 'eq.msgbatch_01',
    });
  },
);

// ── Stats store ──────────────────────────────────────────────────────────────

Deno.test(
  'intel stats store: mail counts are exact head counts over the local-day window',
  async () => {
    const pg = postgrest((req) => {
      if (req.path === 'calendar_events') return pgCount(4);
      return pgCount(req.params.classification === undefined ? 37 : 6);
    });
    const from = new Date('2026-09-23T21:00:00Z');
    const to = new Date('2026-09-24T21:00:00Z');
    assertEquals(await supabaseStatsStore(pg.db).mailCounts(USER_A, from, to), {
      total: 37,
      attention: 6,
      calendars: 4,
    });
    for (const c of pg.calls) {
      assertEquals(c.method, 'HEAD');
      assert(c.prefer.includes('count=exact'));
      assertEquals(c.params.user_id, `eq.${USER_A}`);
    }
    const attention = pg.calls.find((c) => c.params.classification !== undefined)!;
    assertEquals(attention.params.classification, 'in.(important,awaiting_my_reply,has_deadline)');
    assertEquals(attention.params.received_at, `gte.${from.toISOString()}&lt.${to.toISOString()}`);
  },
);

Deno.test(
  'intel stats store: weekly counts cap derived ratios and find the busiest meeting day',
  async () => {
    const counts: Record<string, number> = {
      email_messages: 120,
      meeting_preps: 3,
      analytics_events: 5,
      reply_drafts: 2,
      insights: 2,
    };
    const pg = postgrest((req) => {
      if (req.method === 'HEAD') {
        if (req.path === 'email_messages') return pgCount(req.params.classification ? 18 : 120);
        if (req.path === 'email_threads') return pgCount(req.params.follow_up_state ? 4 : 7);
        return pgCount(counts[req.path] ?? 0);
      }
      if (req.path === 'calendar_events') {
        return [
          // Tuesday 22 Sep (Istanbul): three real meetings, a 90-minute gap in the middle.
          {
            start_at: '2026-09-22T06:00:00Z',
            end_at: '2026-09-22T07:00:00Z',
            status: 'confirmed',
            all_day: false,
            attendee_count: 3,
            is_online: false,
          },
          {
            start_at: '2026-09-22T08:30:00Z',
            end_at: '2026-09-22T09:00:00Z',
            status: 'confirmed',
            all_day: false,
            attendee_count: 1,
            is_online: true,
          },
          {
            start_at: '2026-09-22T09:00:00Z',
            end_at: '2026-09-22T10:00:00Z',
            status: 'confirmed',
            all_day: false,
            attendee_count: '2',
            is_online: false,
          },
          // Wednesday: one meeting; a cancelled one, an all-day one and a solo focus block do not count.
          {
            start_at: '2026-09-23T07:00:00Z',
            end_at: '2026-09-23T08:00:00Z',
            status: 'confirmed',
            all_day: false,
            attendee_count: 2,
            is_online: false,
          },
          {
            start_at: '2026-09-23T09:00:00Z',
            end_at: '2026-09-23T10:00:00Z',
            status: 'cancelled',
            all_day: false,
            attendee_count: 4,
            is_online: false,
          },
          {
            start_at: '2026-09-23T00:00:00Z',
            end_at: '2026-09-24T00:00:00Z',
            status: 'confirmed',
            all_day: true,
            attendee_count: 5,
            is_online: false,
          },
          {
            start_at: '2026-09-23T11:00:00Z',
            end_at: '2026-09-23T12:00:00Z',
            status: 'confirmed',
            all_day: false,
            attendee_count: 1,
            is_online: false,
          },
        ];
      }
      // Deadline insights: one surfaced before its due time, one created after it.
      return [
        { created_at: '2026-09-20T08:00:00Z', due_at: '2026-09-22T12:00:00Z' },
        { created_at: '2026-09-23T13:00:00Z', due_at: '2026-09-23T12:00:00Z' },
        { created_at: '2026-09-21T08:00:00Z', due_at: '2026-09-24T12:00:00Z' },
      ];
    });
    const w = await supabaseStatsStore(pg.db).weekly(
      USER_A,
      new Date('2026-09-20T21:00:00Z'),
      new Date('2026-09-27T21:00:00Z'),
      'Europe/Istanbul',
    );
    assertEquals(w, {
      mailsAnalyzed: 120,
      importantCount: 18,
      meetings: 4,
      prepNotes: 3,
      prepNotesOpened: 3,
      followups: 7,
      followupsAnswered: 4,
      deadlines: 2,
      deadlinesSurfacedInTime: 2,
      draftsSent: 2,
      meetingsByWeekday: { 2: 3, 3: 1 },
      busiest: { weekday: 2, meetings: 3, maxGapMin: 90 },
    });
    const analyzed = pg.calls.find(
      (c) => c.path === 'email_messages' && c.params.ai_status !== undefined,
    )!;
    assertEquals(analyzed.params.ai_status, 'in.(classified,t0_final)');
    const opened = pg.to('analytics_events')[0]!;
    assertEquals(opened.params.event_name, 'eq.meeting_prep_opened');
    assertEquals(pg.to('reply_drafts')[0]?.params.status, 'eq.sent');
  },
);

Deno.test(
  'intel stats store: freshness lists connected accounts with their last successful sync',
  async () => {
    const pg = postgrest({
      'GET connected_accounts': [
        { provider: 'google', status: 'healthy', last_successful_sync_at: '2026-09-24T06:25:00Z' },
        { provider: 'microsoft', status: 'reauth_required', last_successful_sync_at: null },
      ],
    });
    assertEquals(await supabaseStatsStore(pg.db).freshness(USER_A), {
      accounts: [
        { provider: 'google', status: 'healthy', last_sync_at: '2026-09-24T06:25:00Z' },
        { provider: 'microsoft', status: 'reauth_required', last_sync_at: null },
      ],
    });
    assertEquals(pg.calls[0]?.params.disconnected_at, 'is.null');
  },
);

Deno.test('intel stats store: a failed count surfaces as a mapped error', async () => {
  const pg = postgrest(() => pgError('42501', 'permission denied for table email_messages', 403));
  const e = await appError(supabaseStatsStore(pg.db).mailCounts(USER_A, NOW, NOW));
  assertEquals(e.code, 'FORBIDDEN');
});

// ── Memory store ─────────────────────────────────────────────────────────────

Deno.test(
  'intel memory store (IT-AI-09): every source kind becomes a derived chunk with provenance and expiry',
  async () => {
    const pg = postgrest((req) => {
      switch (req.path) {
        case 'email_threads':
          if (req.select === 'topic_label')
            return [{ topic_label: 'Teklif' }, { topic_label: 'Sevkiyat' }];
          return [
            threadRow({
              id: T1,
              subject: 'Yılmaz Endüstri teklif',
              participants: [
                {
                  email: 'mehmet@yilmazendustri.example',
                  name: 'Mehmet Yılmaz',
                  contact_id: C1,
                  role: 'from',
                },
                { email: 'yunus@firma.example', name: null, contact_id: null, role: 'to' },
              ] as never,
              last_message_at: '2026-09-23T09:00:00.000Z',
              ai_summary: 'Revize teklif cuma gününe kadar bekleniyor.',
              key_points: [{ text: 'Fiyat %5 düştü' }, { text: '' }],
              topic_label: 'Teklif',
              category_confidence: null,
              expires_at: '2027-09-23T09:00:00.000Z',
            }),
            threadRow({ id: T2, ai_summary: null, rolling_summary: null, key_points: [] }),
          ];
        case 'life_events':
          return [
            {
              id: 'l1',
              type: 'shipment',
              title: 'Yurtiçi Kargo gönderisi',
              event_at: null,
              due_at: '2026-09-25T12:00:00Z',
              payload: { carrier: 'Yurtiçi Kargo' },
              amount: 1250.5,
              currency: 'TRY',
              expires_at: null,
              source_provider: 'google',
              source_timestamp: '2026-09-23T07:00:00Z',
              confidence: '0.92',
              evidence: [{ quote: 'Kargonuz yola çıktı' }],
            },
          ];
        case 'commitments':
          return [
            {
              id: 'c1',
              contact_id: C1,
              counterparty_name: 'Mehmet Yılmaz',
              direction: 'user_owes',
              text: 'Revize teklifi göndereceğim',
              due_at: '2026-09-26T09:00:00Z',
              created_at: '2026-09-23T09:05:00Z',
              expires_at: null,
              source_timestamp: '2026-09-23T09:00:00Z',
              confidence: 0.8,
              evidence: null,
            },
          ];
        case 'captures':
          return [
            {
              id: 'cap1',
              extracted: [{ title: 'Fatura', amount: '1.250,50 TL', note: '' }],
              created_at: '2026-09-22T10:00:00Z',
              expires_at: null,
              status: 'ready',
            },
            {
              id: 'cap2',
              extracted: [],
              created_at: '2026-09-22T10:00:00Z',
              expires_at: null,
              status: 'ready',
            },
          ];
        case 'meeting_notes':
          return [
            {
              id: 'n1',
              calendar_event_id: 'e1',
              kind: 'post_meeting',
              body: 'Teklif onaylandı.',
              created_at: '2026-09-23T12:00:00Z',
              expires_at: null,
            },
          ];
        case 'assistant_messages':
          return [
            {
              id: 'am1',
              role: 'user',
              content: 'Mehmet Bey çay sever.',
              created_at: '2026-09-21T10:00:00Z',
              expires_at: null,
            },
          ];
        case 'contacts':
          return [
            {
              id: C1,
              display_name: 'Mehmet Yılmaz',
              organization: 'Yılmaz Endüstri',
              title: null,
              primary_email: 'mehmet@yilmazendustri.example',
              last_contact_at: null,
              updated_at: '2026-09-23T09:00:00Z',
            },
          ];
        default:
          return pgError('UNMATCHED', req.path, 500);
      }
    });
    const out = await supabaseMemoryStore(pg.db).sources(USER_A, [
      { kind: 'email_summary', id: T1 },
      { kind: 'email_summary', id: T2 },
      { kind: 'life_event', id: 'l1' },
      { kind: 'commitment', id: 'c1' },
      { kind: 'capture', id: 'cap1' },
      { kind: 'capture', id: 'cap2' },
      { kind: 'meeting_note', id: 'n1' },
      { kind: 'assistant_fact', id: 'am1' },
      { kind: 'person_profile', id: C1 },
    ]);
    assertEquals(
      out.map((s) => [s.chunkKind, s.sourceType, s.sourceId]),
      [
        ['thread_summary', 'email_thread', T1],
        ['life_event', 'life_event', 'l1'],
        ['commitment', 'commitment', 'c1'],
        ['capture_extract', 'capture', 'cap1'],
        ['meeting_note', 'post_meeting_note', 'n1'],
        ['person_fact', 'assistant_message', 'am1'],
        ['person_fact', 'contact', C1],
      ],
    );
    const [thread, life, commitment, capture, , , person] = out;
    assertEquals(thread?.contactIds, [C1]);
    assertEquals(thread?.confidence, 0.8, 'an unscored thread defaults to 0.8');
    assertEquals(thread?.expiresAt, '2027-09-23T09:00:00.000Z');
    assert(thread?.content.includes('Özet: Revize teklif cuma gününe kadar bekleniyor.'));
    assert(thread?.content.includes('- Fiyat %5 düştü'));
    assert(thread?.content.includes('Kişiler: Mehmet Yılmaz, yunus@firma.example'));
    assertEquals(
      [life?.confidence, life?.occurredAt, life?.sourceProvider],
      [0.92, '2026-09-25T12:00:00Z', 'google'],
    );
    assert(life?.content.includes('1250.5 TRY'));
    assertEquals([commitment?.contactIds, commitment?.evidence], [[C1], []]);
    assertEquals(capture?.content, 'title: Fatura · amount: 1.250,50 TL');
    assertEquals(
      person?.content,
      'Mehmet Yılmaz\nKurum: Yılmaz Endüstri\nKonular: Teklif, Sevkiyat',
    );
    const topics = pg.calls.find((c) => c.select === 'topic_label')!;
    assertEquals(topics.params.topic_label, 'not.is.null');
    assertEquals(topics.params.participants, `cs.[{"contact_id":"${C1}"}]`);
    assertEquals(pg.to('captures')[0]?.params.status, 'neq.discarded');
    assertEquals(pg.to('assistant_messages')[0]?.params.role, 'eq.user');
    for (const c of pg.calls) assertEquals(c.params.user_id, `eq.${USER_A}`, c.path);
    assertEquals(await supabaseMemoryStore(pg.db).sources(USER_A, []), []);
  },
);

Deno.test(
  'intel memory store: chunk upserts dedupe on content hash and replace the stale chunk',
  async () => {
    const hash = 'ab'.repeat(32);
    const pg = postgrest({
      'POST memory_chunks': [{ id: 'mc1', user_id: USER_A, content: 'x', embedding_model: null }],
      'DELETE memory_chunks': undefined,
      'GET memory_chunks': [{ id: 'mc1', user_id: USER_A, content: 'x', embedding_model: null }],
      'PATCH memory_chunks': undefined,
    });
    const store = supabaseMemoryStore(pg.db);
    assertEquals(await store.upsertChunks([]), []);
    const chunk = {
      user_id: USER_A,
      chunk_kind: 'thread_summary',
      content: 'x',
      content_hash: hash,
      source_type: 'email_thread',
      source_id: T1,
    } as unknown as MemoryChunkInsert;
    assertEquals((await store.upsertChunks([chunk])).length, 1);
    const upsert = pg.to('memory_chunks', 'POST')[0]!;
    assertEquals(
      upsert.params.on_conflict,
      'user_id,source_type,source_id,chunk_kind,content_hash',
    );
    assertEquals((upsert.body as Record<string, unknown>[])[0]?.content_hash, `\\x${hash}`);
    assert(upsert.prefer.includes('resolution=ignore-duplicates'));
    assertEquals(pg.to('memory_chunks', 'DELETE')[0]?.params, {
      user_id: `eq.${USER_A}`,
      source_type: 'eq.email_thread',
      source_id: `eq.${T1}`,
      chunk_kind: 'eq.thread_summary',
      content_hash: `neq.\\x${hash}`,
    });

    await store.pendingChunks(USER_A, null, 50);
    await store.pendingChunks(USER_A, ['mc1'], 10);
    const [all, some] = pg.to('memory_chunks', 'GET');
    assertEquals(
      [all?.params.embedding_model, all?.params.limit, all?.params.id],
      ['is.null', '50', undefined],
    );
    assertEquals(some?.params.id, 'in.(mc1)');

    await store.writeEmbeddings([{ id: 'mc1', embedding: [0.1, -0.2, 0.3], model: 'embed-model' }]);
    const write = pg.to('memory_chunks', 'PATCH')[0]!;
    const body = write.body as Record<string, unknown>;
    assertEquals(
      [body.embedding, body.embedding_model, write.params.id],
      ['[0.1,-0.2,0.3]', 'embed-model', 'eq.mc1'],
    );
  },
);
