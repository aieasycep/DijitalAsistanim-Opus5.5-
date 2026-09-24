/** ADM-02 users: SQL-shaped outputs of the `admin_api.user_*` functions and the mapped responses. */
import { assert, assertEquals } from '@std/assert';
import {
  argsOf,
  authCalls,
  type Cases,
  data,
  LATER,
  pokes,
  REASON,
  rows,
  sqlAuditRow,
  sqlPage,
  TS,
  uuid,
} from './case-helpers.ts';

const sqlUserRow = (n: number, extra: Record<string, unknown> = {}) => ({
  id: uuid(n),
  email_masked: 'yu***@gmail.com',
  plan: 'pro',
  is_trial: false,
  created_at: TS,
  last_active_at: TS,
  platform: 'ios',
  connected_accounts: 2,
  last_sync_at: TS,
  status: 'active',
  is_internal: false,
  is_demo: false,
  ...extra,
});

const sqlIntegration = {
  account_id: uuid(10),
  provider: 'google',
  email_masked: 'yu***@gmail.com',
  capabilities_granted: ['mail_read', 'calendar_read'],
  status: 'healthy',
  status_reason: null,
  error_class: null,
  data_sources: {
    mail_read: true,
    attachments_analyze: true,
    deadline_detect: true,
    draft_replies: true,
    calendar_read: true,
    schedule_suggest: true,
    calendar_write_with_approval: true,
    tasks_read: false,
  },
  connected_at: TS,
  disconnected_at: null,
  resources: [
    {
      resource: 'gmail_mailbox',
      status: 'idle',
      last_success_at: TS,
      last_error_code: null,
      consecutive_failures: 0,
      watch_expires_at: LATER,
      watch_status: 'active',
    },
    {
      resource: 'google_calendar_primary',
      status: 'error',
      last_success_at: null,
      last_error_code: 'PROVIDER_UNAVAILABLE',
      consecutive_failures: 3,
      watch_expires_at: null,
      watch_status: 'expired',
    },
    {
      resource: 'drive_changes',
      status: 'idle',
      last_success_at: TS,
      last_error_code: null,
      consecutive_failures: 0,
    },
  ],
  recent_jobs: [
    {
      id: uuid(70),
      type: 'gmail_sync',
      status: 'completed',
      last_error_code: null,
      created_at: TS,
    },
  ],
};

const sqlGrant = (extra: Record<string, unknown> = {}) => ({
  id: uuid(11),
  user_id: uuid(2),
  email_masked: 'yu***@gmail.com',
  source: 'admin',
  duration_days: 14,
  starts_at: TS,
  ends_at: LATER,
  state: 'active',
  granted_by: uuid(100),
  reason: REASON,
  revoked_at: null,
  revoked_by: null,
  ...extra,
});

export const USER_CASES: Cases = {
  'GET /users': {
    sql: {
      users_list: () =>
        sqlPage(
          [
            sqlUserRow(2, { is_trial: true }),
            sqlUserRow(3, {
              plan: 'free',
              platform: null,
              last_active_at: null,
              last_sync_at: null,
              status: 'disabled',
            }),
          ],
          57,
          2,
          50,
        ),
    },
    calls: ['users_list'],
    expect(h, body) {
      assertEquals(argsOf(h, 'users_list'), {
        p_page: 2,
        p_page_size: 50,
        p_sort: '-last_active_at',
        p_filter: { plan: 'pro' },
      });
      const list = rows(body);
      assertEquals(
        list.map((r) => r.plan),
        ['trial', 'free'],
      );
      assertEquals(list[1]?.status, 'disabled');
      assert(!('is_internal' in (list[0] ?? {})));
      assertEquals([body.meta.page, body.meta.page_size, body.meta.total], [2, 50, 57]);
    },
  },
  'POST /users/lookup': {
    sql: { user_lookup_email: () => ({ user_id: uuid(2) }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'user_lookup_email'), { p_email: 'yunus@gmail.com' });
      assertEquals(data(body), { user_id: uuid(2) });
    },
  },
  'GET /users/:id': {
    sql: {
      user_overview: () => ({
        user_id: uuid(2),
        email_masked: 'yu***@gmail.com',
        display_name_masked: 'Y***',
        account_status: 'active',
        disabled_at: null,
        is_internal: false,
        is_demo: false,
        created_at: TS,
        last_active_at: TS,
        onboarding_completed_at: TS,
        plan: 'pro',
        plan_source: 'store',
        plan_until: LATER,
        time_zone: 'Europe/Istanbul',
        integrations: [
          {
            account_id: uuid(10),
            provider: 'google',
            status: 'healthy',
            last_sync_at: TS,
            last_error_code: null,
            watch_expires_at: LATER,
          },
        ],
        job_errors: [
          {
            job_id: uuid(70),
            type: 'gmail_sync',
            status: 'failed',
            error_code: 'PROVIDER_UNAVAILABLE',
            at: TS,
          },
          { job_id: uuid(71), type: 'gmail_sync', status: 'failed', error_code: null, at: TS },
        ],
        briefing_status: [
          {
            id: uuid(64),
            kind: 'morning',
            local_date: '2026-09-24',
            status: 'delivered',
            skipped_reason: null,
            error_code: null,
          },
        ],
        push_status: { tokens_enabled: 1, last_receipt_error: null },
        app_version: '1.0.0',
        platform: 'ios',
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'user_overview'), { p_user: uuid(1) });
      const d = data(body);
      assertEquals(d.job_errors, ['PROVIDER_UNAVAILABLE']);
      assert(!('email_masked' in d), 'overview carries no PII beyond the contract');
      assertEquals((d.integrations as Record<string, unknown>[])[0], {
        provider: 'google',
        status: 'healthy',
        last_sync_at: TS,
        last_error_code: null,
        watch_expires_at: LATER,
      });
    },
  },
  'GET /users/:id/integrations': {
    sql: { user_integrations: () => [sqlIntegration] },
    expect(_h, body) {
      const account = rows(body)[0] ?? {};
      assertEquals(
        (account.resources as Record<string, unknown>[]).map((r) => r.resource),
        ['mail', 'calendar'],
      );
      assert(!('status_reason' in account));
    },
  },
  'GET /users/:id/briefings': {
    sql: {
      user_briefings: () =>
        sqlPage([
          {
            id: uuid(64),
            kind: 'morning',
            local_date: '2026-09-24',
            status: 'delivered',
            scheduled_for: TS,
            generated_at: TS,
            delivered_at: TS,
            latency_ms: 4200,
            item_count: 5,
            ai_cost_usd: 0.0042,
            skip_reason: null,
            error_code: null,
            origin: 'scheduled',
            version: 1,
            notification_decision: 'sent',
          },
        ]),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'user_briefings'), {
        p_user: uuid(1),
        p_filter: { kind: 'morning' },
        p_page: 1,
        p_page_size: 25,
      });
      assertEquals(rows(body)[0]?.ai_cost_usd, 0.0042);
      assert(!('origin' in (rows(body)[0] ?? {})));
    },
  },
  'GET /users/:id/usage': {
    sql: {
      user_usage: () => ({
        range: '7d',
        ai: {
          days: [
            {
              date: '2026-09-24',
              feature: 'email_triage',
              requests: 12,
              input_tokens: 9000,
              output_tokens: 800,
              cost_usd: 0.0112,
              units: 12,
            },
          ],
          daily_budget_units: 50,
          budget_hit_days: 0,
        },
        feature_usage: { briefing_opened: 5, search_performed: 3 },
        approvals: { created: 3, approved: 2, executed: 2 },
        reminders_created: 1,
        captures: { count: 0, bytes: 0 },
        content_volumes: {
          email_threads: 120,
          calendar_events: 40,
          insights: 30,
          memory_chunks: 0,
        },
        notifications_by_decision: { sent: 10, suppressed: 3 },
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'user_usage'), { p_user: uuid(1), p_range: '7d' });
      const d = data(body);
      assertEquals((d.feature_usage as Record<string, number>).briefing_opened, 5);
      assertEquals((d.feature_usage as Record<string, number>).capture_created, 0);
    },
  },
  'GET /users/:id/subscription': {
    sql: {
      user_subscription: () => ({
        store: {
          store: 'app_store',
          product_id: 'da_pro_annual',
          period_type: 'normal',
          status: 'active',
          is_active: true,
          will_renew: true,
          expires_at: LATER,
          billing_issue_detected_at: null,
          environment: 'production',
          synced_at: TS,
          last_event_id: 'evt_1',
        },
        grants: [
          {
            id: uuid(11),
            source: 'support',
            duration_days: 7,
            starts_at: TS,
            ends_at: LATER,
            reason: REASON,
            revoked_at: null,
            granted_by: uuid(100),
            state: 'active',
          },
        ],
        effective: { entitlement: 'pro', source: 'store', until: LATER, is_trial: false },
        billing_events: [
          {
            event_id: 'evt_1',
            type: 'RENEWAL',
            environment: 'production',
            product_id: 'da_pro_annual',
            event_at: TS,
            received_at: TS,
            processed: true,
          },
        ],
      }),
    },
    expect(_h, body) {
      const d = data(body);
      const store = d.store as Record<string, unknown>;
      assertEquals(store.environment, 'PRODUCTION');
      assertEquals(store.original_transaction_id, null);
      assertEquals((d.billing_events as Record<string, unknown>[])[0]?.environment, 'PRODUCTION');
    },
  },
  'GET /users/:id/referrals': {
    request: { query: { 'filter[status]': 'rewarded' } },
    sql: {
      user_referrals: () => ({
        code: 'AB3K7M9Q',
        as_referrer: [
          {
            id: uuid(77),
            referee_masked: 'a***@example.com',
            status: 'rewarded',
            risk_score: 10,
            signal_labels: ['same_device'],
            created_at: TS,
            qualified_at: TS,
            rewarded_at: TS,
          },
          {
            id: uuid(78),
            referee_masked: null,
            status: 'pending',
            risk_score: null,
            signal_labels: [],
            created_at: TS,
            qualified_at: null,
            rewarded_at: null,
          },
        ],
        as_referee: { id: uuid(79), status: 'qualified', referrer_masked: 'b***@example.com' },
        credits: [{ referral_id: uuid(77), side: 'referrer', grant_id: uuid(11), days: 14 }],
        yearly_rewards: { used: 1, max: 6 },
      }),
    },
    expect(_h, body) {
      const d = data(body);
      const referrer = d.as_referrer as Record<string, unknown>[];
      assertEquals(referrer.length, 1);
      assertEquals(referrer[0]?.risk_score, 0.1);
    },
  },
  'GET /users/:id/support': {
    sql: {
      user_support: () => ({
        tickets: [
          {
            id: uuid(82),
            reference: 'DA-7K3M9Q',
            category: 'sync',
            status: 'open',
            subject: 'Senkron',
            assignee: null,
            created_at: TS,
          },
        ],
        access_grants: [
          {
            id: uuid(102),
            admin: { id: uuid(100), display_name: 'Ops' },
            scopes: ['pii'],
            reason: REASON,
            starts_at: TS,
            expires_at: LATER,
            revoked_at: null,
            reveal_count: 1,
            active: true,
          },
        ],
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'user_support'), { p_user: uuid(1) });
      const grants = data(body).access_grants as Record<string, unknown>[];
      assertEquals([grants[0]?.scopes, grants[0]?.active], [['pii'], true]);
    },
  },
  'GET /users/:id/audit': {
    sql: { user_audit: () => sqlPage([sqlAuditRow(1042, { result: 'denied' })]) },
    expect(h, body) {
      assertEquals(argsOf(h, 'user_audit'), {
        p_user: uuid(1),
        p_page: 1,
        p_page_size: 25,
        p_filter: { result: 'denied' },
      });
      const row = rows(body)[0] ?? {};
      assertEquals(row.id, '00000000-0000-4000-8000-000000000412');
      assertEquals(row.actor, 'op***@dijitalasistan.app');
      assertEquals(row.target, `job:${uuid(70)}`);
    },
  },
  'GET /users/:id/devices': {
    sql: {
      user_devices: () => [
        {
          installation_id: uuid(1),
          platform: 'ios',
          app_version: '1.0.0',
          build_number: '42',
          os_version: '18.0',
          push_enabled: true,
          last_seen_at: TS,
          token_masked: 'ExponentPushToken[…wxyz]',
          last_receipt_status: 'ok',
          last_receipt_error: null,
        },
      ],
    },
    expect(_h, body) {
      assertEquals(rows(body)[0]?.token_masked, 'ExponentPushToken[…yz]');
    },
  },
  'POST /users/:id/reveal': {
    sql: { user_reveal_email: () => ({ value: 'yunus@gmail.com', expires_in_s: 60 }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'user_reveal_email'), {
        p_user: uuid(1),
        p_reason: REASON,
        p_field: 'email',
      });
      assertEquals(data(body), { value: 'yunus@gmail.com', expires_in_s: 60 });
    },
  },
  'POST /users/:id/force-sync': {
    sql: {
      user_force_sync: () => ({
        job_ids: [uuid(70)],
        jobs: [{ job_id: uuid(70), type: 'gmail_sync' }],
      }),
    },
    expect(h) {
      assertEquals(argsOf(h, 'user_force_sync'), {
        p_user: uuid(1),
        p_account: null,
        p_reason: REASON,
        p_resources: ['mail'],
      });
      assertEquals(pokes(h), ['admin_force_sync']);
    },
  },
  'POST /users/:id/disable': {
    sql: { user_disable: () => ({ user_id: uuid(1), state: 'disabled' }) },
    expect(h, body) {
      assertEquals(data(body), { user_id: uuid(1), account_status: 'disabled' });
      assertEquals(authCalls(h), [`PUT /admin/users/${uuid(1)}`]);
      const ban = h.calls.find((c) => c.method === 'PUT');
      assertEquals(JSON.parse(ban?.body ?? '{}').ban_duration, '876000h');
    },
  },
  'POST /users/:id/restore': {
    sql: { user_restore: () => ({ user_id: uuid(1), state: 'active' }) },
    expect(h, body) {
      assertEquals(data(body), { user_id: uuid(1), account_status: 'active' });
      const unban = h.calls.find((c) => c.method === 'PUT');
      assertEquals(JSON.parse(unban?.body ?? '{}').ban_duration, 'none');
    },
  },
  'POST /users/:id/entitlement-grants': {
    sql: {
      entitlement_grant: () => ({
        id: uuid(11),
        user_id: uuid(1),
        source: 'support',
        duration_days: 7,
        starts_at: TS,
        ends_at: '2026-10-01T08:00:00Z',
      }),
    },
    expect(h, body) {
      const args = argsOf(h, 'entitlement_grant') ?? {};
      assertEquals(
        [args.p_user, args.p_days, args.p_source, args.p_reason],
        [uuid(1), 7, 'support', REASON],
      );
      assert(typeof args.p_idempotency_key === 'string');
      assertEquals(data(body).state, 'active');
    },
  },
  'POST /users/:id/entitlement-grants/:grantId/revoke': {
    sql: {
      entitlement_grants_list: () => sqlPage([sqlGrant()]),
      entitlement_revoke: () => ({ id: uuid(11), revoked: true }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'entitlement_grants_list')?.p_filter, { user_id: uuid(2) });
      assertEquals(argsOf(h, 'entitlement_revoke'), { p_grant: uuid(11), p_reason: REASON });
      assertEquals(data(body).state, 'revoked');
      assertEquals(data(body).source, 'admin');
    },
  },
  'POST /users/:id/integrations/:accountId/disconnect': {
    sql: {
      user_integrations: () => [{ ...sqlIntegration, status: 'healthy' }],
      integration_disconnect: () => ({ job_id: uuid(70) }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'integration_disconnect'), {
        p_account: uuid(10),
        p_reason: REASON,
        p_purge_content: false,
      });
      assertEquals(data(body), {
        account_id: uuid(10),
        status: 'healthy',
        revocation: 'local_only',
      });
      assertEquals(pokes(h), ['admin_integration_disconnect']);
    },
  },
  'POST /users/:id/internal': {
    sql: { user_mark_internal: () => ({ user_id: uuid(1), is_internal: true }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'user_mark_internal'), {
        p_user: uuid(1),
        p_internal: true,
        p_reason: REASON,
      });
      assertEquals(data(body), { user_id: uuid(1), internal: true });
    },
  },
};
