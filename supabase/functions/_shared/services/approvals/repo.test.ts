/**
 * `supabaseApprovalsRepo` against a PostgREST double: the state-machine RPCs and their SQL error
 * translation (IT-APR-03/05: `ILLEGAL_TRANSITION` → `APPROVAL_STATE_CONFLICT`; duplicate pending →
 * `DuplicatePendingError`; device mismatch → `FORBIDDEN`, IT-APR-17), bytea hashes, the user
 * context, ownership checks and the source text used by grounding, and rejection feedback.
 */
import { assert, assertEquals, assertInstanceOf, assertRejects } from '@std/assert';
import { AppError } from '../../errors.ts';
import { USER_A } from '../../testing/jwt.ts';
import { pgError, postgrest } from '../../testing/postgrest.ts';
import { DuplicatePendingError, type ApprovalRow } from './model.ts';
import { approvalDbError, supabaseApprovalsRepo, toApprovalRow } from './repo.ts';

const A = '55555555-0000-4000-8000-000000000001';
const DUP = '55555555-0000-4000-8000-000000000002';
const HASH = '0f'.repeat(32);
const row = {
  id: A,
  user_id: USER_A,
  status: 'approved',
  payload_version: 2,
  confidence: '0.9',
  side_effects: null,
};

Deno.test('approvals repo: rows normalise confidence and side effects', () => {
  const r = toApprovalRow(row);
  assertEquals([r.confidence, r.side_effects], [0.9, []]);
});

Deno.test(
  'approvals repo (IT-APR-03/05/17): state-machine SQL errors translate to contract errors',
  () => {
    const dup = approvalDbError({ code: 'P0001', message: `APPROVAL_PENDING_DUPLICATE:${DUP}` });
    assertInstanceOf(dup, DuplicatePendingError);
    assertEquals(dup.existingId, DUP);
    const illegal = approvalDbError({ code: '55000', message: 'ILLEGAL_TRANSITION' });
    assert(illegal instanceof AppError);
    assertEquals(
      [illegal.code, illegal.details],
      ['APPROVAL_STATE_CONFLICT', { reason: 'illegal_transition' }],
    );
    const mismatch = approvalDbError({
      code: '55000',
      message: 'IDEMPOTENCY_MISMATCH',
    }) as AppError;
    assertEquals(mismatch.details, { reason: 'idempotency_mismatch' });
    const device = approvalDbError({
      code: '42501',
      message: 'DEVICE_INSTALLATION_MISMATCH',
    }) as AppError;
    assertEquals([device.code, device.details], ['FORBIDDEN', { reason: 'installation_mismatch' }]);
    assertEquals(
      (approvalDbError({ code: 'P0002', message: 'no approval' }) as AppError).code,
      'NOT_FOUND',
    );
  },
);

Deno.test(
  'approvals repo: create/transition/edit/device start send the documented RPC arguments',
  async () => {
    const pg = postgrest((req) => {
      if (req.rpc !== null) return row;
      if (req.method === 'PATCH') return [{ ...row, what: 'Yeni başlık' }];
      return pgError('UNMATCHED', req.path, 500);
    });
    const repo = supabaseApprovalsRepo(pg.db);
    await repo.create(USER_A, { action_type: 'task_create' } as never, 'user');
    assertEquals(pg.to('rpc/create_approval')[0]?.body, {
      p_user: USER_A,
      p_row: { action_type: 'task_create' },
      p_actor: 'user',
    });

    await repo.transition({
      id: A,
      to: 'approved',
      actor: 'user',
      actorId: USER_A,
      idempotencyKey: 'k1',
      via: 'approval_center',
    });
    assertEquals(pg.to('rpc/transition_approval')[0]?.body, {
      p_id: A,
      p_to: 'approved',
      p_actor: 'user',
      p_actor_id: USER_A,
      p_idempotency_key: 'k1',
      p_reason: null,
      p_result: null,
      p_error_code: null,
      p_error_message: null,
      p_via: 'approval_center',
      p_device_token_hash: null,
    });
    await repo.transition({
      id: A,
      to: 'executing',
      actor: 'user',
      actorId: USER_A,
      idempotencyKey: null,
      deviceTokenHashHex: HASH,
    });
    assertEquals(
      (pg.to('rpc/transition_approval')[1]?.body as Record<string, unknown>).p_device_token_hash,
      `\\x${HASH}`,
    );

    const edited = await repo.edit({
      id: A,
      userId: USER_A,
      payload: { title: 'Yeni başlık' },
      payloadHashHex: HASH,
      changeSummary: 'Başlık değişti',
      exactChange: {},
      what: 'Yeni başlık',
      sideEffects: [],
      destinationLabel: 'Google Görevler',
      approvalExpiresAt: '2026-10-01T00:00:00Z',
      requiresScope: null,
    } as never);
    assertEquals(edited.what, 'Yeni başlık');
    assertEquals(
      (pg.to('rpc/edit_approval_payload')[0]?.body as Record<string, unknown>).p_payload_hash,
      `\\x${HASH}`,
    );
    const patch = pg.to('approval_actions', 'PATCH')[0]!;
    assertEquals(patch.params, { id: `eq.${A}`, user_id: `eq.${USER_A}`, payload_version: 'eq.2' });

    await repo.startDeviceExecution(A, USER_A, 'inst-row', HASH);
    assertEquals(pg.to('rpc/start_device_execution')[0]?.body, {
      p_id: A,
      p_user: USER_A,
      p_installation: 'inst-row',
      p_token_hash: `\\x${HASH}`,
    });
  },
);

Deno.test(
  'approvals repo: an RPC error or empty result surfaces as the translated error',
  async () => {
    const illegal = postgrest(() => pgError('55000', 'ILLEGAL_TRANSITION'));
    const e = await assertRejects(() =>
      supabaseApprovalsRepo(illegal.db).transition({
        id: A,
        to: 'approved',
        actor: 'user',
        actorId: USER_A,
        idempotencyKey: 'k',
      }),
    );
    assert(e instanceof AppError && e.code === 'APPROVAL_STATE_CONFLICT');
    const dup = postgrest(() => pgError('P0001', `APPROVAL_PENDING_DUPLICATE:${DUP}`));
    await assertRejects(
      () => supabaseApprovalsRepo(dup.db).create(USER_A, {} as never, 'system'),
      DuplicatePendingError,
    );
    const empty = postgrest(() => undefined);
    const nf = await assertRejects(() =>
      supabaseApprovalsRepo(empty.db).create(USER_A, {} as never, 'system'),
    );
    assert(nf instanceof AppError && nf.code === 'NOT_FOUND');
    // An edit whose follow-up patch finds a newer version keeps the RPC row.
    const stale = postgrest((req) => (req.rpc !== null ? row : []));
    const kept = await supabaseApprovalsRepo(stale.db).edit({
      id: A,
      userId: USER_A,
      payload: {},
      payloadHashHex: HASH,
    } as never);
    assertEquals(kept.id, A);
  },
);

Deno.test(
  'approvals repo: reads — get, device token hash, job, user context, plan feature, accounts',
  async () => {
    const pg = postgrest((req) => {
      switch (`${req.method} ${req.path}`) {
        case 'GET approval_actions':
          return req.select === 'device_token_hash' ? [{ device_token_hash: `\\x${HASH}` }] : [row];
        case 'PATCH approval_actions':
          return undefined;
        case 'GET jobs':
          return [{ id: 'j1', status: 'queued' }];
        case 'GET user_preferences':
          return [{ timezone: 'Europe/Istanbul', learn_from_interactions: false }];
        case 'GET notification_preferences':
          return [
            {
              quiet_hours_enabled: false,
              quiet_start: '23:00:00',
              quiet_end: null,
              quiet_days: [6, 7],
            },
          ];
        case 'GET profiles':
          return [{ locale: 'en' }];
        case 'POST rpc/effective_entitlement':
          return [{ is_active: true }];
        case 'POST rpc/plan_limit':
          return (req.body as { p_key: string }).p_key === 'meeting_prep' ? true : 3;
        case 'GET connected_accounts':
          return [{ id: 'acc', provider: 'google', status: 'healthy' }];
        case 'POST rpc/account_can':
          return (req.body as { p_cap: string }).p_cap === 'mail_send';
        case 'GET calendars':
          return [{ id: 'cal', can_write: true }];
        case 'GET calendar_events':
          return [{ id: 'ev', etag: '"3"' }];
        case 'GET app_installations':
          return [{ id: 'inst-row', installation_id: 'inst-1', platform: 'ios' }];
        default:
          return pgError('UNMATCHED', req.path, 500);
      }
    });
    const repo = supabaseApprovalsRepo(pg.db);
    assertEquals((await repo.get(USER_A, A))?.confidence, 0.9);
    assertEquals(await repo.deviceTokenHash(USER_A, A), HASH);
    await repo.setRequiresScope(USER_A, A, 'mail_send');
    assertEquals(pg.to('approval_actions', 'PATCH')[0]?.body, { requires_scope: 'mail_send' });
    assertEquals((await repo.job('approval_execute:k'))?.id, 'j1');

    assertEquals(await repo.userContext(USER_A), {
      timeZone: 'Europe/Istanbul',
      locale: 'en',
      isPro: true,
      learnFromInteractions: false,
      quietHours: { enabled: false, start: '23:00', end: '07:30', days: [6, 7] },
    });
    assertEquals(await repo.planFeature(USER_A, 'meeting_prep'), true);
    assertEquals(
      await repo.planFeature(USER_A, 'vip_max'),
      false,
      'only a boolean true enables a feature',
    );
    assertEquals((await repo.account(USER_A, 'acc'))?.id, 'acc');
    assertEquals(await repo.accountCan('acc', 'mail_send'), true);
    assertEquals(await repo.accountCan('acc', 'calendar_write'), false);
    assertEquals((await repo.calendar(USER_A, 'cal'))?.id, 'cal');
    assertEquals((await repo.calendarEvent(USER_A, 'ev'))?.etag, '"3"');
    assertEquals((await repo.installationByClientId(USER_A, 'inst-1'))?.id, 'inst-row');
    assertEquals(pg.to('app_installations')[0]?.params.signed_out_at, 'is.null');
    assertEquals((await repo.installationById(USER_A, 'inst-row'))?.platform, 'ios');
  },
);

Deno.test(
  'approvals repo: empty user context falls back to Istanbul, Turkish, quiet hours on',
  async () => {
    const pg = postgrest({
      'GET user_preferences': [],
      'GET notification_preferences': [],
      'GET profiles': [],
      'POST rpc/effective_entitlement': null,
      'GET approval_actions': [{ device_token_hash: null }],
    });
    const repo = supabaseApprovalsRepo(pg.db);
    assertEquals(await repo.userContext(USER_A), {
      timeZone: 'Europe/Istanbul',
      locale: 'tr',
      isPro: false,
      learnFromInteractions: true,
      quietHours: { enabled: true, start: '22:30', end: '07:30', days: [1, 2, 3, 4, 5, 6, 7] },
    });
    assertEquals(await repo.deviceTokenHash(USER_A, A), null);
  },
);

Deno.test('approvals repo: ownership per source type; user input needs no row', async () => {
  const pg = postgrest((req) => (req.params.id === 'eq.mine' ? [{ id: 'mine' }] : []));
  const repo = supabaseApprovalsRepo(pg.db);
  assertEquals(await repo.owns(USER_A, 'email_thread', 'mine'), true);
  assertEquals(await repo.owns(USER_A, 'capture', 'theirs'), false);
  assertEquals(await repo.owns(USER_A, 'user_input', 'anything'), true);
  assertEquals(
    pg.calls.map((c) => c.path),
    ['email_threads', 'captures'],
  );
  assertEquals(await repo.owns(USER_A, 'android_notification', 'mine'), true);
  assertEquals(pg.calls.at(-1)?.path, 'android_notification_signals');
});

Deno.test(
  'approvals repo: source text gathers the grounding corpus of each source type',
  async () => {
    const pg = postgrest((req) => {
      switch (req.path) {
        case 'email_threads':
          return [
            {
              subject: 'Teklif',
              ai_summary: 'Cuma teslim',
              key_points: [{ text: 'Fiyat %5 düşük' }],
              deadline_evidence: null,
            },
          ];
        case 'email_messages':
          return req.params.thread_id !== undefined
            ? [{ snippet: 'Yarın 10:00 uygun mu?', ai_summary: null }]
            : [{ subject: 'Fatura', snippet: '1.250,50 TL', ai_summary: '', key_points: [] }];
        case 'insights':
          return [{ evidence: [{ quote: 'son ödeme 30 Eylül' }] }];
        case 'commitments':
          return [];
        case 'meeting_notes':
          return [{ body: 'Kararlar: teklif onaylandı' }];
        case 'assistant_messages':
          return [{ content: 'Yarın Mehmet ile toplantı ekle' }];
        case 'captures':
          return [{ text_content: null, extracted: [{ title: 'Kira', amount: '15.000 TL' }] }];
        default:
          return pgError('UNMATCHED', req.path, 500);
      }
    });
    const repo = supabaseApprovalsRepo(pg.db);
    assertEquals(
      await repo.sourceText(USER_A, 'email_thread', 't1'),
      'Teklif\nCuma teslim\nFiyat %5 düşük\nYarın 10:00 uygun mu?\nson ödeme 30 Eylül',
    );
    assertEquals(
      await repo.sourceText(USER_A, 'email_message', 'm1'),
      'Fatura\n1.250,50 TL\nson ödeme 30 Eylül',
    );
    assert((await repo.sourceText(USER_A, 'post_meeting_note', 'n1'))?.startsWith('Kararlar'));
    assert((await repo.sourceText(USER_A, 'assistant_message', 'am1'))?.startsWith('Yarın Mehmet'));
    assertEquals(
      await repo.sourceText(USER_A, 'capture', 'c1'),
      'Kira\n15.000 TL\nson ödeme 30 Eylül',
    );
    assertEquals(
      await repo.sourceText(USER_A, 'calendar_event', 'e1'),
      null,
      'no corpus for other sources',
    );
    const evidence = pg.to('insights')[0]!;
    assertEquals([evidence.params.source_id, evidence.params.user_id], ['eq.t1', `eq.${USER_A}`]);

    const blank = postgrest(() => []);
    assertEquals(
      await supabaseApprovalsRepo(blank.db).sourceText(USER_A, 'meeting_note', 'n'),
      null,
    );
  },
);

Deno.test(
  'approvals repo: a synced draft bumps its version as a user edit; status updates scoped',
  async () => {
    const pg = postgrest({ 'GET reply_drafts': [{ version: 3 }], 'PATCH reply_drafts': undefined });
    const repo = supabaseApprovalsRepo(pg.db);
    await repo.syncReplyDraft(USER_A, 'd1', {
      subject: 'Re: Teklif',
      body: 'x'.repeat(12_000),
      to: ['mehmet@yilmazendustri.example'],
      cc: [],
    });
    const body = pg.to('reply_drafts', 'PATCH')[0]?.body as Record<string, unknown>;
    assertEquals(
      [body.version, body.generated_by, (body.body as string).length],
      [4, 'user_edit', 10_000],
    );
    await repo.replyDraftStatus(USER_A, 'd1', 'sent');
    assertEquals(pg.to('reply_drafts', 'PATCH')[1]?.body, { status: 'sent' });

    const missing = postgrest({ 'GET reply_drafts': [] });
    const e = await assertRejects(() =>
      supabaseApprovalsRepo(missing.db).syncReplyDraft(USER_A, 'd1', {
        subject: 's',
        body: 'b',
        to: [],
        cc: [],
      }),
    );
    assert(e instanceof AppError);
    assertEquals([e.code, e.details], ['NOT_FOUND', { resource: 'reply_draft' }]);
  },
);

Deno.test(
  'approvals repo: a rejection records AI feedback once and demotes future proposals',
  async () => {
    const pg = postgrest({
      'POST ai_feedback': undefined,
      'POST rpc/upsert_learned_preference': 'lp1',
    });
    const repo = supabaseApprovalsRepo(pg.db);
    const approval = {
      id: A,
      origin: 'commitment_detection',
      action_type: 'commitment_create',
    } as ApprovalRow;
    await repo.recordRejectionFeedback({
      userId: USER_A,
      approval,
      note: 'Bu bir söz değil',
      statement: 'Söz önerilerini azalt',
    });
    const fb = pg.to('ai_feedback')[0]!;
    const b = fb.body as Record<string, unknown>;
    assertEquals(
      [b.feature, b.rating, b.reason_code, b.target_id],
      ['commitment_extract', -1, 'not_a_commitment', A],
    );
    assertEquals(fb.params.on_conflict, 'user_id,feature,target_type,target_id');
    assert(fb.prefer.includes('resolution=ignore-duplicates'));
    assertEquals(pg.to('rpc/upsert_learned_preference')[0]?.body, {
      p_user: USER_A,
      p_target_type: 'topic',
      p_target_ref: 'approval:commitment_create',
      p_group_key: 'topics',
      p_effect: { demote_proposals: 'commitment_create' },
      p_evidence_delta: 1,
      p_statement: 'Söz önerilerini azalt',
    });

    // A manual approval (no AI origin) only updates the learned preference.
    await repo.recordRejectionFeedback({
      userId: USER_A,
      approval: { ...approval, origin: 'manual' } as unknown as ApprovalRow,
      note: null,
      statement: 's',
    });
    assertEquals(pg.to('ai_feedback').length, 1);
    assertEquals(pg.to('rpc/upsert_learned_preference').length, 2);
  },
);
