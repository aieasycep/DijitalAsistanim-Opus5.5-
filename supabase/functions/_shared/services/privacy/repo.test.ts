/**
 * `supabasePrivacyRepo` against a PostgREST double: each export/deletion/retention call reaches
 * its `public` service-role wrapper with the documented arguments (DATABASE_AND_RLS_PLAN privacy
 * functions), bytea columns round-trip as hex, export reads are owner-filtered and paged
 * (IT-PRIV-02/05), and purge results are sanitised to `{deleted, storage_paths}` (IT-PRIV-01/03).
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { AppError } from '../../errors.ts';
import { USER_A } from '../../testing/jwt.ts';
import { pgError, postgrest } from '../../testing/postgrest.ts';
import { supabasePrivacyRepo } from './repo.ts';

const R = '66666666-0000-4000-8000-000000000001';
const NOW = new Date('2026-09-24T03:00:00.000Z');

Deno.test(
  'privacy repo (IT-PRIV-02): export rows — hex sha256, owner filters, ordered pages',
  async () => {
    const pg = postgrest((req) => {
      if (req.path === 'data_export_requests') {
        if (req.method === 'PATCH') return undefined;
        return [{ id: R, user_id: USER_A, status: 'ready', sha256: `\\x${'ab'.repeat(32)}` }];
      }
      return [{ id: 1 }];
    });
    const repo = supabasePrivacyRepo(pg.db);
    assertEquals((await repo.getExport(R))?.sha256, 'ab'.repeat(32));
    await repo.updateExport(R, USER_A, { status: 'ready', sha256: 'cd'.repeat(32) });
    await repo.updateExport(R, USER_A, { sha256: null });
    await repo.updateExport(R, USER_A, { status: 'expired' });
    const [ready, cleared, expired] = pg.to('data_export_requests', 'PATCH');
    assertEquals(ready?.body, { status: 'ready', sha256: `\\x${'cd'.repeat(32)}` });
    assertEquals(cleared?.body, { sha256: null });
    assertEquals(expired?.body, { status: 'expired' });
    assertEquals(ready?.params, { id: `eq.${R}`, user_id: `eq.${USER_A}` });

    await repo.readRows(
      { table: 'insights', columns: 'id,title', owner: 'user_id', order: 'created_at,id' },
      USER_A,
      500,
      250,
    );
    await repo.readRows(
      { table: 'referrals', columns: 'id', owner: 'referrals', order: 'id' },
      USER_A,
      0,
      100,
    );
    await repo.readRows(
      { table: 'audit_log', columns: 'id', owner: 'audit', order: 'occurred_at' },
      USER_A,
      0,
      100,
    );
    const [insights, referrals, audit] = [
      pg.to('insights')[0]!,
      pg.to('referrals')[0]!,
      pg.to('audit_log')[0]!,
    ];
    assertEquals(
      [
        insights.select,
        insights.params.user_id,
        insights.params.order,
        insights.params.offset,
        insights.params.limit,
      ],
      ['id,title', `eq.${USER_A}`, 'created_at.asc,id.asc', '500', '250'],
    );
    assertEquals(referrals.params.or, `(referrer_id.eq.${USER_A},referee_id.eq.${USER_A})`);
    assertEquals(audit.params.target_user_id, `eq.${USER_A}`);

    const none = postgrest({ 'GET data_export_requests': [] });
    assertEquals(await supabasePrivacyRepo(none.db).getExport(R), null);
  },
);

Deno.test('privacy repo: locale and timezone for the notice; read failures map', async () => {
  const pg = postgrest({ 'GET profiles': [{ locale: 'tr' }], 'GET user_preferences': [] });
  assertEquals(await supabasePrivacyRepo(pg.db).userLocale(USER_A), {
    locale: 'tr',
    timezone: null,
  });
  const bad = postgrest({
    'GET profiles': [],
    'GET user_preferences': pgError('57014', 'timeout', 500),
  });
  const e = await assertRejects(() => supabasePrivacyRepo(bad.db).userLocale(USER_A));
  assert(e instanceof AppError && e.code === 'SERVICE_UNAVAILABLE');
  const bad2 = postgrest({
    'GET profiles': pgError('42501', 'denied', 403),
    'GET user_preferences': [],
  });
  const e2 = await assertRejects(() => supabasePrivacyRepo(bad2.db).userLocale(USER_A));
  assert(e2 instanceof AppError && e2.code === 'FORBIDDEN');
});

Deno.test(
  'privacy repo (IT-PRIV-03/04): deletion RPCs carry the reauth origin and hex hashes',
  async () => {
    const token = new Uint8Array([1, 2, 254, 255]);
    const pg = postgrest((req) => {
      switch (req.rpc) {
        case 'create_export_request':
          return { created: true, request_id: R, status: 'queued' };
        case 'history_deletion_counts':
          return { summaries: 3, insights: 9 };
        case 'create_deletion_request':
          return { request_id: R, status: 'queued', created: true };
        case 'deletion_request_update':
          return { status: 'running', steps: { revoke: 'done' } };
        case 'purge_history':
          return {
            deleted: { insights: 9, junk: 'x' },
            storage_paths: { captures: [`${USER_A}/a.pdf`, 7], exports: 'nope' },
          };
        case 'account_deletion_context':
          return {
            user_exists: true,
            email: null,
            locale: 'tr',
            installation_ids: [],
            apple_sub: null,
            accounts: [],
          };
        case 'account_deletion_begin':
          return { state: 'running', steps: {} };
        case 'account_deletion_system_purge':
          return { notifications: 4, bad: null };
        case 'privacy_tombstones_upsert':
          return 2;
        case 'user_rows_remaining':
          return null;
        case 'pseudonymize_audit_subject':
          return undefined;
        case 'retention_cleanup':
          return null;
        case 'recompute_expires_at':
          return 120;
        case 'retention_orphan_objects':
          return { exports: [`${USER_A}/old.zip`] };
        case 'retention_system_sweep':
          return { webhook_events: 50 };
        case 'enqueue_job':
          return 'job-1';
        default:
          return req.path === 'data_deletion_requests'
            ? [
                {
                  id: R,
                  user_id: USER_A,
                  kind: 'account',
                  status: 'queued',
                  steps: {},
                  notify_email_ciphertext: '\\x0102feff',
                },
              ]
            : pgError('UNMATCHED', req.path, 500);
      }
    });
    const repo = supabasePrivacyRepo(pg.db);
    assertEquals((await repo.createExportRequest(USER_A, ['insights'], 'corr')).request_id, R);
    assertEquals(pg.to('rpc/create_export_request')[0]?.body, {
      p_user: USER_A,
      p_include: ['insights'],
      p_correlation_id: 'corr',
    });
    assertEquals((await repo.historyCounts(USER_A, null)).insights, 9);

    await repo.createDeletionRequest({
      userId: USER_A,
      kind: 'account',
      statusTokenHash: token,
      scope: null,
      accountId: null,
      correlationId: null,
    });
    const create = pg.to('rpc/create_deletion_request')[0]!.body as Record<string, unknown>;
    assertEquals(
      [create.p_origin, create.p_confirmation, create.p_source, create.p_status_token_hash],
      ['app', 'reauth', 'app', '\\x0102feff'],
    );
    await repo.createDeletionRequest({
      userId: USER_A,
      kind: 'history',
      statusTokenHash: null,
      scope: 'all_analysis',
      accountId: null,
      correlationId: 'c',
    });
    assertEquals(
      (pg.to('rpc/create_deletion_request')[1]!.body as Record<string, unknown>)
        .p_status_token_hash,
      null,
    );

    const got = await repo.getDeletionRequest(R);
    assertEquals(got?.notify_email_ciphertext, token);

    await repo.updateDeletionRequest(R, {
      status: 'processing',
      notify: token,
      notifyLocale: 'en',
    });
    await repo.updateDeletionRequest(R, { clearNotify: true });
    const [u1, u2] = pg.to('rpc/deletion_request_update');
    assertEquals(u1?.body, {
      p_request: R,
      p_status: 'processing',
      p_steps: {},
      p_error_code: null,
      p_notify: '\\x0102feff',
      p_notify_locale: 'en',
      p_clear_notify: false,
    });
    assertEquals((u2?.body as Record<string, unknown>).p_clear_notify, true);

    assertEquals(await repo.purgeHistory(USER_A, null), {
      deleted: { insights: 9 },
      storage_paths: { captures: [`${USER_A}/a.pdf`] },
    });
    assertEquals((await repo.accountContext(USER_A)).user_exists, true);
    assertEquals((await repo.beginAccountDeletion(R, USER_A, 'job-1')).state, 'running');
    assertEquals(pg.to('rpc/account_deletion_begin')[0]?.body, {
      p_request: R,
      p_user: USER_A,
      p_job: 'job-1',
    });
    assertEquals(await repo.systemPurge(USER_A, null), { notifications: 4 });
    assertEquals(await repo.upsertTombstones([{ kind: 'referral_device', hash: 'h' }]), 2);
    assertEquals(await repo.rowsRemaining(USER_A), {});
    await repo.pseudonymizeAudit(USER_A);
    assertEquals(pg.to('rpc/pseudonymize_audit_subject')[0]?.body, { p_user: USER_A });

    assertEquals(await repo.retentionCleanup(500, NOW), { deleted: {}, storage_paths: {} });
    assertEquals(pg.to('rpc/retention_cleanup')[0]?.body, {
      p_batch: 500,
      p_now: NOW.toISOString(),
    });
    assertEquals(await repo.recomputeExpiresAt(USER_A, 1000), 120);
    assertEquals(await repo.orphanObjects(NOW, 100), { exports: [`${USER_A}/old.zip`] });
    assertEquals(await repo.systemSweep(500, NOW), { webhook_events: 50 });
    assertEquals(
      await repo.enqueue({
        type: 'retention',
        payload: {},
        idempotencyKey: 'retention:2026-09-24',
      } as never),
      'job-1',
    );
    for (const c of pg.calls)
      assertEquals(c.profile, 'public', `${c.path} goes through a public wrapper`);
  },
);

Deno.test(
  'privacy repo: an absent deletion request is null; a plain request has no ciphertext',
  async () => {
    const pg = postgrest({ 'GET data_deletion_requests': [] });
    assertEquals(await supabasePrivacyRepo(pg.db).getDeletionRequest(R), null);
    const plain = postgrest({
      'GET data_deletion_requests': [{ id: R, notify_email_ciphertext: null }],
    });
    assertEquals(
      (await supabasePrivacyRepo(plain.db).getDeletionRequest(R))?.notify_email_ciphertext,
      null,
    );
  },
);
