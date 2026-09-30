/**
 * `supabaseAssistStore` against a PostgREST double: user-scoped reads (IT-PRIV-05), the optimistic
 * draft version check (API-RD `expected_version`), bytea hex round-trips, the planning and First
 * Analysis readers, and DB error mapping (API_CONTRACTS §15).
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { AppError } from '../../errors.ts';
import { USER_A } from '../../testing/jwt.ts';
import { messageRow, threadRow } from '../../testing/intel.ts';
import { pgCount, pgError, postgrest } from '../../testing/postgrest.ts';
import { supabaseAssistStore } from './supabase-store.ts';
import type {
  AssistantMessageInsert,
  CaptureInsert,
  MeetingPrepUpsert,
  ReplyDraftInsert,
} from './store.ts';

const ID = 'dddddddd-0000-4000-8000-000000000001';
const EVENT = 'eeeeeeee-0000-4000-8000-000000000001';
const THREAD = 'ffffffff-0000-4000-8000-000000000001';
const HASH = 'a1'.repeat(32);

Deno.test(
  'assist store: reply drafts — insert v1, versioned update, reuse window, web link guard',
  async () => {
    const draft = {
      id: ID,
      user_id: USER_A,
      version: 2,
      status: 'draft',
      confidence: '0.82',
      attachments: null,
      body: 'Merhaba Mehmet Bey, revize teklifi cuma gönderiyorum.',
    };
    const pg = postgrest((req) => {
      if (req.path === 'email_messages') {
        return req.params.id === `eq.${ID}`
          ? [{ web_link: 'https://mail.google.com/mail/u/0/#all/abc' }]
          : [{ web_link: 'javascript:alert(1)' }];
      }
      if (req.method === 'PATCH') return req.params.version === 'eq.1' ? [draft] : [];
      return [draft];
    });
    const store = supabaseAssistStore(pg.db);
    const got = await store.replyDraft(USER_A, ID);
    assertEquals([got?.confidence, got?.attachments], [0.82, []]);
    const read = pg.calls[0]!;
    assertEquals([read.params.id, read.params.user_id], [`eq.${ID}`, `eq.${USER_A}`]);

    await store.insertReplyDraft({ user_id: USER_A, body: 'x' } as unknown as ReplyDraftInsert);
    const insert = pg.to('reply_drafts', 'POST')[0]!;
    assertEquals(insert.body, { user_id: USER_A, body: 'x', version: 1, status: 'draft' });
    assert(insert.accept.includes('vnd.pgrst.object+json'), 'insert returns the single row');

    const updated = await store.updateReplyDraft(USER_A, ID, 1, { body: 'y' });
    assertEquals(updated?.version, 2);
    const patch = pg.to('reply_drafts', 'PATCH')[0]!;
    assertEquals(patch.body, { body: 'y', version: 2 });
    assertEquals(patch.params, { id: `eq.${ID}`, user_id: `eq.${USER_A}`, version: 'eq.1' });
    assertEquals(
      await store.updateReplyDraft(USER_A, ID, 5, { body: 'z' }),
      null,
      'a stale version updates nothing',
    );

    const since = new Date('2026-09-24T06:00:00Z');
    assertEquals((await store.reusableDraft(USER_A, 'ck1', since))?.id, ID);
    const reuse = pg.to('reply_drafts', 'GET').at(-1)!;
    assertEquals(
      [reuse.params.content_key, reuse.params.status, reuse.params.created_at, reuse.params.limit],
      ['eq.ck1', 'eq.draft', `gte.${since.toISOString()}`, '1'],
    );

    assertEquals(
      await store.messageWebLink(USER_A, ID),
      'https://mail.google.com/mail/u/0/#all/abc',
    );
    assertEquals(
      await store.messageWebLink(USER_A, EVENT),
      null,
      'only https web links are handed out',
    );
  },
);

Deno.test('assist store: no reusable draft and an absent row are null', async () => {
  const pg = postgrest(() => []);
  const store = supabaseAssistStore(pg.db);
  assertEquals(await store.replyDraft(USER_A, ID), null);
  assertEquals(await store.reusableDraft(USER_A, 'ck', new Date()), null);
  assertEquals(await store.messageWebLink(USER_A, ID), null);
  assertEquals(await store.meetingEvent(USER_A, EVENT), null);
  assertEquals(await store.meetingPrep(USER_A, EVENT), null);
  assertEquals(await store.meetingPrepById(USER_A, ID), null);
  assertEquals(await store.meetingNoteByClient(USER_A, 'n'), null);
  assertEquals(await store.assistantThread(USER_A, ID), null);
  assertEquals(await store.assistantThreadByClient(USER_A, 'c'), null);
  assertEquals(await store.assistantMessageByClient(THREAD, 'c'), null);
  assertEquals(await store.streamingMessage(USER_A, new Date()), null);
  assertEquals(await store.contact(USER_A, ID), null);
  assertEquals(await store.capture(USER_A, ID), null);
  assertEquals(await store.captureByClient(USER_A, 'k'), null);
  assertEquals(await store.updateCapture(USER_A, ID, { status: 'extracted' }), null);
  assertEquals(await store.quietHours(USER_A), null);
  assertEquals(await store.planItem(USER_A, { type: 'task', id: ID }), null);
  assertEquals(await store.planInsight(USER_A, ID), null);
  assertEquals(await store.job(ID), null);
  assertEquals(await store.jobByKey('k'), null);
  assertEquals(await store.briefingAudio(USER_A, ID), null);
  for (const c of pg.calls.filter((x) => x.params.user_id !== undefined))
    assertEquals(c.params.user_id, `eq.${USER_A}`, c.path);
});

Deno.test(
  'assist store: meeting prep upsert writes the input hash as bytea and reads it back as hex',
  async () => {
    const stored = {
      id: ID,
      user_id: USER_A,
      calendar_event_id: EVENT,
      status: 'ready',
      input_hash: `\\x${HASH}`,
    };
    const pg = postgrest({
      'GET calendar_events': [{ id: EVENT, title: 'Yılmaz Endüstri ile teklif görüşmesi' }],
      'GET meeting_preps': [stored],
      'POST meeting_preps': [stored],
    });
    const store = supabaseAssistStore(pg.db);
    assertEquals((await store.meetingEvent(USER_A, EVENT))?.id, EVENT);
    assertEquals(pg.to('calendar_events')[0]?.params.provider_deleted_at, 'is.null');
    const prep = await store.meetingPrep(USER_A, EVENT);
    assertEquals(prep?.source_hash, HASH);
    assert(!('input_hash' in (prep ?? {})), 'the bytea column is renamed');
    assertEquals((await store.meetingPrepById(USER_A, ID))?.source_hash, HASH);

    const row = await store.upsertMeetingPrep({
      user_id: USER_A,
      calendar_event_id: EVENT,
      status: 'ready',
      source_hash: HASH,
    } as unknown as MeetingPrepUpsert);
    assertEquals(row.source_hash, HASH);
    const upsert = pg.to('meeting_preps', 'POST')[0]!;
    assertEquals(upsert.params.on_conflict, 'user_id,calendar_event_id');
    assertEquals(upsert.body, {
      user_id: USER_A,
      calendar_event_id: EVENT,
      status: 'ready',
      input_hash: `\\x${HASH}`,
      source_type: 'calendar_event',
      source_id: EVENT,
    });

    const nulled = postgrest({ 'POST meeting_preps': [{ ...stored, input_hash: null }] });
    const out = await supabaseAssistStore(nulled.db).upsertMeetingPrep({
      user_id: USER_A,
      calendar_event_id: EVENT,
      source_hash: null,
    } as unknown as MeetingPrepUpsert);
    assertEquals(out.source_hash, null);
    assertEquals((nulled.calls[0]?.body as Record<string, unknown>).input_hash, null);
  },
);

Deno.test('assist store: meeting notes and the people around a meeting', async () => {
  const pg = postgrest({
    'GET meeting_notes': [{ id: 'n1', body: 'Teklif onaylandı' }],
    'POST meeting_notes': [{ id: 'n2', body: 'Yeni not' }],
    'GET contacts': [
      {
        id: 'c1',
        display_name: 'Mehmet Yılmaz',
        emails: ['mehmet@yilmazendustri.example'],
        organization: 'Yılmaz Endüstri',
      },
    ],
    'GET email_messages': [messageRow({ id: ID })],
    'GET email_threads': [
      threadRow({
        id: 't1',
        reply_state: 'awaiting_my_reply',
        participants: [
          { email: 'Mehmet@YilmazEndustri.example', name: 'Mehmet', contact_id: null },
        ] as never,
      }),
      threadRow({
        id: 't2',
        reply_state: 'awaiting_their_reply',
        participants: [{ email: 'selin@ajans.example', name: 'Selin', contact_id: null }] as never,
      }),
    ],
    'GET commitments': [{ id: 'k1', confidence: '0.7', text: 'Teklifi göndereceğim' }],
  });
  const store = supabaseAssistStore(pg.db);
  assertEquals((await store.meetingNoteByClient(USER_A, 'client-n1'))?.id, 'n1');
  assertEquals(pg.to('meeting_notes')[0]?.params.client_note_id, 'eq.client-n1');
  assertEquals(
    (
      await store.insertMeetingNote({
        user_id: USER_A,
        calendar_event_id: EVENT,
        kind: 'pre_meeting',
        body: 'Yeni not',
        input: 'text',
        client_note_id: null,
      } as never)
    ).id,
    'n2',
  );
  await store.meetingNotes(USER_A, EVENT);
  const notes = pg.to('meeting_notes', 'GET')[1]!;
  assertEquals([notes.params.order, notes.params.limit], ['created_at.desc', '5']);

  const contacts = await store.contactsForEmails(USER_A, ['Mehmet@YilmazEndustri.example']);
  assertEquals(contacts[0]?.role_text, null);
  assertEquals(pg.to('contacts')[0]?.params.emails, 'ov.{mehmet@yilmazendustri.example}');
  assertEquals(await store.contactsForEmails(USER_A, []), []);

  const since = new Date('2026-06-24T00:00:00Z');
  await store.mailsWith(USER_A, ['Mehmet@YilmazEndustri.example', 'a"b@x.example'], since, 8);
  const mails = pg.to('email_messages')[0]!;
  assertEquals(
    mails.params.or,
    '(from_email.in.("mehmet@yilmazendustri.example","a"b@x.example"),to_emails.cs.{"mehmet@yilmazendustri.example"},to_emails.cs.{"ab@x.example"})',
  );
  assertEquals([mails.params.received_at, mails.params.limit], [`gte.${since.toISOString()}`, '8']);
  assertEquals(await store.mailsWith(USER_A, [], since, 8), []);

  const awaiting = await store.awaitingThreadsWith(USER_A, ['mehmet@yilmazendustri.example']);
  assertEquals(
    awaiting.map((t) => t.id),
    ['t1'],
    'only threads with one of the addresses',
  );
  assertEquals(pg.to('email_threads')[0]?.params.reply_state, 'neq.none');
  assertEquals(await store.awaitingThreadsWith(USER_A, []), []);

  const open = await store.openCommitmentsWith(USER_A, ['c1'], ['Mehmet (Yılmaz)', 'x']);
  assertEquals(open[0]?.confidence, 0.7);
  const q = pg.to('commitments')[0]!;
  assertEquals(q.params.or, '(contact_id.in.(c1),counterparty_name.ilike.Mehmet Yılmaz%)');
  assertEquals(q.params.status, 'in.(open,snoozed)');
  assertEquals(q.params.order, 'due_at.asc.nullslast');
  assertEquals(await store.openCommitmentsWith(USER_A, [], []), []);
  assertEquals(
    await store.openCommitmentsWith(USER_A, [], ['x', '%']),
    [],
    'too-short names are dropped',
  );
  assertEquals(pg.to('commitments').length, 1);
});

Deno.test(
  'assist store: assistant threads and messages (one stream per user, history oldest-first)',
  async () => {
    const pg = postgrest((req) => {
      if (req.path === 'assistant_threads') {
        if (req.method === 'GET' && req.select === 'message_count') return [{ message_count: 4 }];
        if (req.method === 'PATCH') return undefined;
        return [{ id: THREAD, user_id: USER_A, scope: 'global' }];
      }
      if (req.path === 'assistant_messages') {
        if (req.method === 'PATCH') return undefined;
        if (req.params.status === 'eq.complete') return [{ id: 'm3' }, { id: 'm2' }, { id: 'm1' }];
        return [{ id: 'm9', status: 'streaming' }];
      }
      if (req.path === 'contacts') return [{ id: 'c1', display_name: 'Mehmet Yılmaz' }];
      if (req.path === 'approval_actions') return [{ id: 'a1' }, { id: 'a2' }];
      return pgError('UNMATCHED', req.path, 500);
    });
    const store = supabaseAssistStore(pg.db);
    assertEquals((await store.assistantThread(USER_A, THREAD))?.id, THREAD);
    assertEquals(pg.calls[0]?.params.archived_at, 'is.null');
    await store.assistantThreadByClient(USER_A, 'client-t');
    assertEquals(pg.calls[1]?.params.client_thread_id, 'eq.client-t');
    await store.insertAssistantThread({
      user_id: USER_A,
      scope: 'global',
      scope_ref_id: null,
      client_thread_id: null,
    });
    assertEquals(pg.calls[2]?.method, 'POST');

    await store.assistantMessageByClient(THREAD, 'cm1');
    assertEquals(
      pg.calls[3]?.params.role,
      'eq.assistant',
      'the replay lookup finds the answer to a client message',
    );
    await store.insertAssistantMessage({
      thread_id: THREAD,
      role: 'user',
      content: 'Yarın neler var?',
    } as unknown as AssistantMessageInsert);
    await store.updateAssistantMessage('m9', { status: 'complete' });
    assertEquals(pg.to('assistant_messages', 'PATCH')[0]?.params.id, 'eq.m9');

    assertEquals(
      (await store.assistantHistory(THREAD, 3)).map((m) => m.id),
      ['m1', 'm2', 'm3'],
    );
    const since = new Date('2026-09-24T06:28:00Z');
    assertEquals((await store.streamingMessage(USER_A, since))?.id, 'm9');
    const streaming = pg.to('assistant_messages', 'GET').at(-1)!;
    assertEquals(
      [streaming.params.status, streaming.params.created_at],
      ['eq.streaming', `gte.${since.toISOString()}`],
    );

    const at = new Date('2026-09-24T06:30:00Z');
    await store.touchAssistantThread(THREAD, at);
    assertEquals(pg.to('assistant_threads', 'PATCH')[0]?.body, {
      last_message_at: at.toISOString(),
      message_count: 6,
    });

    assertEquals((await store.contactsNamed(USER_A, ['Mehmet', 'Selin*', 'x']))[0]?.id, 'c1');
    assertEquals(
      pg.to('contacts')[0]?.params.or,
      '(display_name.ilike.Mehmet%,display_name.ilike.Selin%)',
    );
    assertEquals(await store.contactsNamed(USER_A, ['a']), []);
    await store.contact(USER_A, 'c1');

    assertEquals(await store.approvalIdsByBatch(USER_A, 'batch-1'), ['a1', 'a2']);
    assertEquals(pg.to('approval_actions')[0]?.params, {
      user_id: `eq.${USER_A}`,
      batch_id: 'eq.batch-1',
      order: 'created_at.asc',
    });
  },
);

Deno.test('assist store: a thread without a counter starts at two messages', async () => {
  const pg = postgrest({ 'GET assistant_threads': [], 'PATCH assistant_threads': undefined });
  await supabaseAssistStore(pg.db).touchAssistantThread(THREAD, new Date('2026-09-24T06:30:00Z'));
  assertEquals(
    (pg.to('assistant_threads', 'PATCH')[0]?.body as Record<string, unknown>).message_count,
    2,
  );
});

Deno.test(
  'assist store: captures keep sha256 as hex and normalise extracted/progress',
  async () => {
    const row = {
      id: ID,
      user_id: USER_A,
      status: 'ready',
      sha256: `\\x${HASH}`,
      extracted: null,
      progress: null,
      storage_path: `captures/${USER_A}/${ID}.pdf`,
    };
    const pg = postgrest({
      'GET captures': [row],
      'POST captures': [row],
      'PATCH captures': [row],
      'POST rpc/discard_capture': {
        capture: { ...row, status: 'discarded' },
        storage_path: row.storage_path,
      },
    });
    const store = supabaseAssistStore(pg.db);
    const got = await store.capture(USER_A, ID);
    assertEquals([got?.sha256, got?.extracted, got?.progress], [HASH, [], {}]);
    await store.captureByClient(USER_A, 'cap-key');
    assertEquals(pg.to('captures')[1]?.params.idempotency_key, 'eq.cap-key');
    await store.insertCapture({
      user_id: USER_A,
      kind: 'file',
      sha256: HASH,
    } as unknown as CaptureInsert);
    assertEquals(
      (pg.to('captures', 'POST')[0]?.body as Record<string, unknown>).sha256,
      `\\x${HASH}`,
    );
    await store.insertCapture({
      user_id: USER_A,
      kind: 'text',
      sha256: null,
    } as unknown as CaptureInsert);
    assertEquals((pg.to('captures', 'POST')[1]?.body as Record<string, unknown>).sha256, null);
    assertEquals((await store.updateCapture(USER_A, ID, { status: 'extracted' }))?.id, ID);
    assertEquals(pg.to('captures', 'PATCH')[0]?.params, {
      id: `eq.${ID}`,
      user_id: `eq.${USER_A}`,
    });

    const discarded = await store.discardCapture(USER_A, ID);
    assertEquals(
      [discarded.capture.status, discarded.storagePath],
      ['discarded', row.storage_path],
    );
    assertEquals(pg.to('rpc/discard_capture')[0]?.body, { p_user: USER_A, p_capture_id: ID });

    const before = new Date('2026-09-23T06:30:00Z');
    await store.capturesWithStaleFiles(USER_A, before);
    const stale = pg.to('captures', 'GET').at(-1)!;
    assertEquals(
      [stale.params.file_deleted_at, stale.params.storage_path, stale.params.analyzed_at],
      ['is.null', 'not.is.null', `not.is.null&lt.${before.toISOString()}`],
    );

    const gone = postgrest({ 'POST rpc/discard_capture': pgError('P0002', 'capture not found') });
    const e = await assertRejects(() => supabaseAssistStore(gone.db).discardCapture(USER_A, ID));
    assert(e instanceof AppError && e.code === 'NOT_FOUND');
  },
);

Deno.test(
  'assist store: planning readers — sources, timed tasks, quiet hours, writable calendar',
  async () => {
    const pg = postgrest((req) => {
      switch (req.path) {
        case 'connected_accounts':
          return [{ id: 'acc', provider: 'google', status: 'healthy' }];
        case 'tasks':
          return [{ due_at: '2026-09-24T12:00:00.000Z' }];
        case 'notification_preferences':
          return [{ quiet_hours_enabled: true, quiet_start: '23:00:00', quiet_end: '07:30:00' }];
        case 'user_preferences':
          return [{ default_write_calendar_id: 'cal-default' }];
        case 'calendars':
          return req.params.id === 'eq.cal-none'
            ? []
            : [
                {
                  id: 'cal-default',
                  connected_account_id: 'acc',
                  provider: 'google',
                  can_write: true,
                  connected_accounts: {
                    data_source_toggles: { calendar_write: true },
                    status: 'healthy',
                  },
                },
              ];
        default:
          return pgError('UNMATCHED', req.path, 500);
      }
    });
    const store = supabaseAssistStore(pg.db);
    assertEquals((await store.accountSources(USER_A))[0]?.id, 'acc');
    assertEquals(pg.to('connected_accounts')[0]?.params.status, 'neq.disconnected');

    assertEquals(
      await store.timedTasks(
        USER_A,
        new Date('2026-09-24T00:00:00Z'),
        new Date('2026-09-25T00:00:00Z'),
      ),
      [{ start: '2026-09-24T11:30:00.000Z', end: '2026-09-24T12:00:00.000Z' }],
      'a timed task blocks the 30 minutes before its due time',
    );
    assertEquals(await store.quietHours(USER_A), { enabled: true, start: '23:00', end: '07:30' });

    assertEquals(await store.writableCalendar(USER_A, null), {
      id: 'cal-default',
      connected_account_id: 'acc',
      provider: 'google',
      can_write: true,
      toggles: { calendar_write: true },
    });
    const cal = pg.to('calendars')[0]!;
    assertEquals(
      [cal.params.id, cal.params.can_write, cal.params.limit],
      ['eq.cal-default', 'eq.true', '1'],
    );
    assertEquals(await store.writableCalendar(USER_A, 'cal-none'), null);
    assertEquals(
      pg.to('user_preferences').length,
      1,
      'an explicit calendar skips the default lookup',
    );
  },
);

Deno.test('assist store: without a default write calendar the selected one is used', async () => {
  const pg = postgrest({
    'GET user_preferences': [],
    'GET calendars': [
      {
        id: 'cal-sel',
        connected_account_id: 'acc',
        provider: 'microsoft',
        can_write: true,
        connected_accounts: null,
      },
    ],
  });
  const cal = await supabaseAssistStore(pg.db).writableCalendar(USER_A, null);
  assertEquals([cal?.id, cal?.toggles], ['cal-sel', {}]);
  assertEquals(pg.to('calendars')[0]?.params.selected, 'eq.true');
});

Deno.test(
  'assist store: plan items resolve their title per type; insights can be linked or dismissed',
  async () => {
    const pg = postgrest((req) => {
      if (req.method === 'PATCH') return undefined;
      switch (req.path) {
        case 'tasks':
          return [{ title: 'KDV beyannamesi', due_at: '2026-09-26T09:00:00Z' }];
        case 'commitments':
          return [{ text: 'Teklifi gönder', due_at: null }];
        case 'insights':
          if (req.select?.startsWith('id,user_id'))
            return [{ id: ID, kind: 'schedule_suggestion' }];
          return [
            { title: 'Pasaport yenileme', due_at: '2026-10-01T00:00:00Z', kind: 'life_event' },
          ];
        case 'email_messages':
          return req.select === 'snippet,ai_summary'
            ? [
                { snippet: 'Bizi +90 212 555 01 23 numarasından arayın', ai_summary: null },
                { snippet: 'Tekrar: +90 212 555 01 23', ai_summary: 'Destek hattı 0850 123 45 67' },
              ]
            : [{ subject: 'Toplantı talebi' }];
        default:
          return pgError('UNMATCHED', req.path, 500);
      }
    });
    const store = supabaseAssistStore(pg.db);
    assertEquals(await store.planItem(USER_A, { type: 'task', id: ID }), {
      title: 'KDV beyannamesi',
      due_at: '2026-09-26T09:00:00Z',
      personal: false,
    });
    assertEquals(pg.to('tasks')[0]?.select, 'title,due_at');
    assertEquals(
      (await store.planItem(USER_A, { type: 'commitment', id: ID }))?.title,
      'Teklifi gönder',
    );
    assertEquals((await store.planItem(USER_A, { type: 'insight', id: ID }))?.personal, true);
    assertEquals(
      (await store.planItem(USER_A, { type: 'email_message', id: ID }))?.title,
      'Toplantı talebi',
    );

    assertEquals((await store.planInsight(USER_A, ID))?.id, ID);
    await store.setInsightPayload(USER_A, ID, { slot: '2026-09-24T12:00:00Z' });
    await store.linkInsightApproval(USER_A, ID, 'appr-1');
    await store.dismissInsight(USER_A, ID, 'sched:ID');
    const [payload, link, dismiss] = pg.to('insights', 'PATCH');
    assertEquals(payload?.body, { payload: { slot: '2026-09-24T12:00:00Z' } });
    assertEquals(link?.body, {
      entity_type: 'approval_action',
      entity_id: 'appr-1',
      payload: { approval_id: 'appr-1' },
    });
    const d = dismiss?.body as Record<string, unknown>;
    assertEquals([d.status, d.suppression_key], ['dismissed', 'sched:ID']);
    for (const p of [payload, link, dismiss])
      assertEquals(p?.params, { id: `eq.${ID}`, user_id: `eq.${USER_A}` });

    assertEquals(await store.sourcePhones(USER_A, 'email_thread', THREAD), [
      '+90 212 555 01 23',
      '0850 123 45 67',
    ]);
    assertEquals(pg.to('email_messages').at(-1)?.params.thread_id, `eq.${THREAD}`);
    await store.sourcePhones(USER_A, 'email_message', ID);
    assertEquals(pg.to('email_messages').at(-1)?.params.id, `eq.${ID}`);
    const calls = pg.calls.length;
    assertEquals(await store.sourcePhones(USER_A, 'calendar_event', ID), []);
    assertEquals(pg.calls.length, calls, 'only mail sources are scanned for phone numbers');
  },
);

Deno.test(
  'assist store: First Analysis — jobs by key/prefix, counts RPC, top insights with total',
  async () => {
    const pg = postgrest((req) => {
      if (req.path === 'jobs') return [{ id: 'j1', type: 'initial_sync', status: 'running' }];
      if (req.path === 'rpc/first_analysis_counts')
        return { mails_found: 214, classified: '190', potential_important: 7, upcoming_events: 5 };
      if (req.path === 'insights')
        return pgCount(12, [
          {
            id: 'i1',
            kind: 'reply_needed',
            title: 'Mehmet Bey yanıt bekliyor',
            due_at: null,
            event_at: null,
          },
        ]);
      if (req.path === 'profiles') return undefined;
      return pgError('UNMATCHED', req.path, 500);
    });
    const store = supabaseAssistStore(pg.db);
    assertEquals((await store.job('j1'))?.id, 'j1');
    await store.jobByKey('initial_sync:acc');
    assertEquals(pg.calls[1]?.params.idempotency_key, 'eq.initial_sync:acc');
    await store.jobsByKeyPrefix('initial_sync:acc-1:');
    assertEquals(
      pg.calls[2]?.params.idempotency_key,
      'like.initial\\_sync:acc-1:%',
      'the literal underscore of the key prefix is escaped, not a wildcard (and not dropped)',
    );

    const since = new Date('2026-09-21T06:30:00Z');
    const now = new Date('2026-09-24T06:30:00Z');
    assertEquals(await store.firstAnalysisCounts(USER_A, since, now), {
      mails_found: 214,
      classified: 190,
      potential_important: 7,
      upcoming_events: 5,
      possible_followups: 0,
    });
    assertEquals(pg.to('rpc/first_analysis_counts')[0]?.body, {
      p_user: USER_A,
      p_since: since.toISOString(),
      p_now: now.toISOString(),
    });

    const top = await store.topInsights(USER_A, 3);
    assertEquals([top.total, top.items.length], [12, 1]);
    const q = pg.to('insights')[0]!;
    assert(q.prefer.includes('count=exact'));
    assertEquals(
      [q.params.status, q.params.order, q.params.limit],
      ['eq.open', 'rank_score.desc', '3'],
    );

    await store.setOnboardingStep(USER_A, 'ready');
    assertEquals(pg.to('profiles')[0]?.body, { onboarding_step: 'ready' });
    assertEquals(pg.to('profiles')[0]?.params.user_id, `eq.${USER_A}`);

    const failing = postgrest(() =>
      pgError('57014', 'canceling statement due to statement timeout', 500),
    );
    const e = await assertRejects(() => supabaseAssistStore(failing.db).topInsights(USER_A, 3));
    assert(e instanceof AppError && e.code === 'SERVICE_UNAVAILABLE');
  },
);

Deno.test('assist store: briefing audio rows, their items and the audio patch', async () => {
  const pg = postgrest({
    'GET briefings': [{ id: ID, audio_status: 'none' }],
    'GET briefing_items': [{ id: 'bi1', position: 0 }],
    'PATCH briefings': undefined,
  });
  const store = supabaseAssistStore(pg.db);
  assertEquals((await store.briefingAudio(USER_A, ID))?.id, ID);
  assertEquals((await store.briefingItems(USER_A, ID)).length, 1);
  assertEquals(pg.to('briefing_items')[0]?.params, {
    user_id: `eq.${USER_A}`,
    briefing_id: `eq.${ID}`,
    order: 'position.asc',
  });
  await store.updateBriefingAudio(ID, { audio_status: 'ready' });
  assertEquals(pg.to('briefings', 'PATCH')[0]?.body, { audio_status: 'ready' });
});

Deno.test(
  'assist store: write failures map to AppError (P0001 entitlement, 23505 conflict)',
  async () => {
    const limit = postgrest(() => pgError('P0001', 'ENTITLEMENT_REQUIRED:meeting_prep'));
    const e1 = await assertRejects(() =>
      supabaseAssistStore(limit.db).upsertMeetingPrep({
        user_id: USER_A,
        calendar_event_id: EVENT,
        source_hash: null,
      } as unknown as MeetingPrepUpsert),
    );
    assert(e1 instanceof AppError);
    assertEquals([e1.code, e1.details], ['ENTITLEMENT_REQUIRED', { feature: 'meeting_prep' }]);
    const dup = postgrest(() =>
      pgError('23505', 'duplicate key value violates unique constraint', 409),
    );
    const e2 = await assertRejects(() =>
      supabaseAssistStore(dup.db).insertAssistantThread({
        user_id: USER_A,
        scope: 'global',
        scope_ref_id: null,
        client_thread_id: 'c',
      }),
    );
    assert(e2 instanceof AppError && e2.code === 'STATE_CONFLICT');
  },
);
