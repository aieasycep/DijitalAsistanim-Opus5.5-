/** ADM-18 health, ADM-19 admin users, ADM-20 settings, ADM-21 search: SQL-shaped outputs and responses. */
import { assert, assertEquals, assertMatch } from '@std/assert';
import { jsonResponse } from '../../_shared/testing/fetch.ts';
import { TEST_SUPABASE_URL } from '../../_shared/testing/env.ts';
import { FACTOR_ID, NEW_AUTH_USER } from './harness.ts';
import {
  argsOf,
  authCalls,
  type Cases,
  data,
  LATER,
  pokes,
  REASON,
  rows,
  TS,
  uuid,
} from './case-helpers.ts';

const ADMIN = uuid(100);

const sqlAdmin = (extra: Record<string, unknown> = {}) => ({
  id: ADMIN,
  email: 'ops@dijitalasistan.app',
  display_name: 'Ops',
  role: 'operations',
  status: 'active',
  last_login_at: TS,
  locked: false,
  locked_until: null,
  mfa_enrolled: true,
  invited_at: TS,
  invite_expires_at: null,
  activated_at: TS,
  disabled_at: null,
  active_sessions: 1,
  ...extra,
});

/** `admins_list` answering with `after` once the mutation ran (`before` for the pre-read). */
function adminsList(after: Record<string, unknown>, before: Record<string, unknown> = {}) {
  let calls = 0;
  return () => {
    calls += 1;
    return {
      rows: [
        sqlAdmin(calls === 1 && Object.keys(before).length > 0 ? before : after),
        sqlAdmin({ id: uuid(104), email: 'sa@dijitalasistan.app', role: 'super_admin' }),
      ],
    };
  };
}

export const SYSTEM_CASES: Cases = {
  'GET /health/summary': {
    env: { MICROSOFT_CERT_NOT_AFTER: '2027-04-12' },
    sql: {
      health_latest: () => ({
        components: [
          {
            component: 'ai_voyage',
            status: 'external_credential_required',
            latency_ms: null,
            checked_at: TS,
            checked_by: 'cron',
            detail_code: 'voyage_key_missing',
            stale: false,
          },
          {
            component: 'legacy_probe',
            status: 'healthy',
            latency_ms: 3,
            checked_at: TS,
            checked_by: 'cron',
            detail_code: null,
            stale: false,
          },
        ],
        credential_expiry: [
          { component: 'apns_key', not_after: '2026-12-01T00:00:00Z', rotation_due_at: null },
        ],
      }),
    },
    expect(_h, body) {
      const d = data(body);
      assertEquals(
        (d.components as Record<string, unknown>[]).map((c) => c.component),
        ['ai_voyage'],
      );
      assertEquals(d.credential_expiry, [
        { key: 'apns_key', not_after: '2026-12-01T00:00:00.000Z', days_left: 67 },
        { key: 'MICROSOFT_CERT_NOT_AFTER', not_after: '2027-04-12T00:00:00.000Z', days_left: 199 },
      ]);
    },
  },
  'GET /health/history': {
    sql: {
      health_history: () => ({
        component: 'gmail',
        range: '7d',
        rows: [
          {
            checked_at: TS,
            component: 'gmail',
            status: 'degraded',
            latency_ms: 400,
            detail_code: 'error_rate',
            checked_by: 'cron',
          },
          {
            checked_at: LATER,
            component: 'gmail',
            status: 'healthy',
            latency_ms: 90.4,
            detail_code: null,
            checked_by: 'admin',
          },
        ],
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'health_history'), { p_component: 'gmail', p_range: '7d' });
      assertEquals(
        rows(body).map((r) => [r.latency_ms, r.checked_by]),
        [
          [400, 'cron'],
          [90, 'admin'],
        ],
      );
    },
  },
  'POST /health/run': {
    outbound: (call) =>
      call.url === `${TEST_SUPABASE_URL}/functions/v1/health/run`
        ? jsonResponse({
            data: {
              results: [
                {
                  probe: 'database',
                  status: 'healthy',
                  latency_ms: 12,
                  detail_code: null,
                  checked_at: TS,
                },
                {
                  probe: 'cron',
                  status: 'degraded',
                  latency_ms: 40,
                  detail_code: 'lag',
                  checked_at: TS,
                },
              ],
            },
            meta: {},
          })
        : null,
    expect(h, body) {
      assertEquals(argsOf(h, 'authorize'), { p_permission: 'health.run' });
      const run = h.calls.find((c) => c.url.endsWith('/functions/v1/health/run'));
      assertEquals(JSON.parse(run?.body ?? '{}'), { probes: ['database', 'cron'] });
      assertMatch(run?.headers.get('authorization') ?? '', /^Bearer ey/);
      assert(run?.headers.get('x-da-bff') !== null);
      const audit = argsOf(h, 'audit_write') ?? {};
      assertEquals([audit.p_action, audit.p_result], ['health.run_requested', 'success']);
      assertEquals(audit.p_details, { probes: 2, healthy: 1, degraded: 1 });
      const order = h.rpcNames().filter((n) => n === 'authorize' || n === 'audit_write');
      assertEquals(order, ['authorize', 'audit_write'], 'authorize first, audit after');
      assertEquals((data(body).results as unknown[]).length, 2);
    },
  },
  'GET /health/app-versions': {
    sql: {
      app_versions_breakdown: () => ({
        range: '7d',
        total_active: 100,
        min_supported_version: { ios: '1.0.0', android: '1.0.0' },
        versions: [
          {
            platform: 'ios',
            app_version: '0.9.0',
            build_number: '12',
            active_installs: 100,
            installations: 100,
            share: 1,
            push_enabled_share: 0.9,
            old: false,
            below_minimum: true,
            sync_error_rate: 0.0123,
          },
        ],
        os_versions: [],
        old_version_share: 0,
        sync_failure_by_provider: [],
      }),
    },
    expect(_h, body) {
      assertEquals(data(body).versions, [
        {
          platform: 'ios',
          app_version: '0.9.0',
          installations: 100,
          sync_error_rate: 0.0123,
          below_minimum: true,
          crash_free_sessions: null,
          crash_free_users: null,
        },
      ]);
      assertEquals(data(body).crash_reporting, {
        status: 'external_credential_required',
        credential_keys: ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'],
      });
    },
  },
  'GET /health/cron': {
    sql: {
      cron_status: () => ({
        available: true,
        jobs: [
          {
            name: 'scheduler_tick',
            schedule: '* * * * *',
            active: true,
            last_status: 'succeeded',
            last_start: TS,
            last_end: TS,
            last_duration_ms: 120,
          },
          { name: 'rollup_metrics_daily', schedule: '15 0 * * *', active: true },
        ],
        worker_lag_s: 3,
        running_jobs: 1,
        last_rollup_at: TS,
      }),
    },
    expect(_h, body) {
      assertEquals(data(body), {
        schedules: [
          { name: 'scheduler_tick', last_run_at: TS, duration_ms: 120, status: 'succeeded' },
          { name: 'rollup_metrics_daily', last_run_at: null, duration_ms: null, status: null },
        ],
        worker_lag_s: 3,
      });
    },
  },
  'GET /admins': {
    sql: { admins_list: adminsList({}) },
    expect(_h, body) {
      assert(!('locked_until' in (rows(body)[0] ?? {})));
      assertEquals(rows(body).length, 2);
    },
  },
  'POST /admins/invite': {
    sql: {
      admin_invite_record: () => ({
        id: NEW_AUTH_USER,
        status: 'invited',
        role: 'support',
        invite_expires_at: LATER,
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'authorize'), { p_permission: 'admins.manage' });
      const created = h.calls.find(
        (c) => c.url.endsWith('/auth/v1/admin/users') && c.method === 'POST',
      );
      assertEquals(JSON.parse(created?.body ?? '{}').app_metadata, { da_kind: 'admin' });
      const record = argsOf(h, 'admin_invite_record') ?? {};
      assertEquals(
        [record.p_user, record.p_email, record.p_role],
        [NEW_AUTH_USER, 'new@dijitalasistan.app', 'support'],
      );
      assertMatch(String(record.p_token_hash), /^\\x[0-9a-f]{64}$/);
      const job = argsOf(h, 'enqueue_job') ?? {};
      assertEquals(job.p_type, 'transactional_email');
      const payload = job.p_payload as {
        template_key: string;
        recipient_ref: unknown;
        params: Record<string, string>;
      };
      assertEquals(payload.template_key, 'admin_invite');
      assertEquals(payload.recipient_ref, { type: 'admin_user', id: NEW_AUTH_USER });
      assert(!JSON.stringify(payload).includes('@'), 'the job payload never carries an address');
      assertMatch(payload.params.invite_token_sealed ?? '', /^s1\./);
      assertEquals(pokes(h), ['admin_invite_email']);
      assertEquals(data(body).id, NEW_AUTH_USER);
    },
  },
  'PATCH /admins/:id': {
    sql: {
      admin_update_role: () => ({ id: ADMIN, role: 'readonly', changed: true }),
      admins_list: adminsList({ role: 'readonly' }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'admin_update_role'), {
        p_user: ADMIN,
        p_role: 'readonly',
        p_reason: REASON,
      });
      assertEquals(data(body).role, 'readonly');
    },
  },
  'POST /admins/:id/disable': {
    sql: {
      admin_disable: () => ({ id: ADMIN, status: 'disabled', sessions_ended: 2 }),
      admins_list: adminsList({ status: 'disabled' }),
    },
    expect(h, body) {
      assertEquals(authCalls(h), [`PUT /admin/users/${ADMIN}`]);
      assertEquals(data(body).status, 'disabled');
    },
  },
  'POST /admins/:id/enable': {
    sql: {
      admin_enable: () => ({ id: ADMIN, status: 'active' }),
      admins_list: adminsList({}),
    },
    expect(h) {
      const unban = h.calls.find((c) => c.method === 'PUT');
      assertEquals(JSON.parse(unban?.body ?? '{}').ban_duration, 'none');
    },
  },
  'POST /admins/:id/revoke-sessions': {
    sql: { admin_sessions_revoke_all: () => ({ id: ADMIN, sessions_ended: 2 }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'admin_sessions_revoke_all'), { p_user: ADMIN, p_reason: REASON });
      assertEquals(data(body), { ended_sessions: 2 });
    },
  },
  'POST /admins/:id/resend-invite': {
    sql: {
      admin_invite_rotate: () => ({ id: ADMIN, invite_expires_at: LATER }),
      admins_list: adminsList({ status: 'invited', last_login_at: null, mfa_enrolled: false }),
    },
    expect(h, body) {
      const args = argsOf(h, 'admin_invite_rotate') ?? {};
      assertEquals([args.p_user, args.p_reason], [ADMIN, REASON]);
      assertMatch(String(args.p_token_hash), /^\\x[0-9a-f]{64}$/);
      assertEquals(
        (argsOf(h, 'enqueue_job')?.p_payload as Record<string, unknown>).template_key,
        'admin_invite',
      );
      assertEquals(data(body).status, 'invited');
    },
  },
  'POST /admins/:id/reset-mfa': {
    sql: {
      admin_mfa_reset: () => ({ id: ADMIN, recovery_codes_invalidated: 8, sessions_ended: 1 }),
      admins_list: adminsList({ mfa_enrolled: false }),
    },
    expect(h, body) {
      assertEquals(authCalls(h), [
        `GET /admin/users/${ADMIN}/factors`,
        `DELETE /admin/users/${ADMIN}/factors/${FACTOR_ID}`,
      ]);
      assertEquals(data(body).mfa_enrolled, false);
    },
  },
  'POST /admins/:id/unlock': {
    sql: {
      admin_unlock: () => ({ id: ADMIN, locked: false }),
      admins_list: adminsList({}, { locked: true, locked_until: LATER }),
    },
    expect(h) {
      const args = argsOf(h, 'admin_unlock') ?? {};
      assertEquals([args.p_user, args.p_reason], [ADMIN, REASON]);
      assertMatch(String(args.p_email_hash), /^[0-9a-f]{64}$/);
    },
  },
  'GET /settings': {
    sql: {
      settings_get: () => ({
        app_settings: {
          'app.min_supported_version': {
            value: { ios: '1.0.0', android: '1.0.0' },
            description: 'minimum versions',
            updated_by: null,
            updated_at: TS,
          },
        },
        plan_limits: {
          free: { max_mail_accounts: 1, ai_daily_budget_units: 50, ai_routing_profile: 'lean' },
          pro: {
            max_mail_accounts: 10,
            ai_daily_budget_units: null,
            ai_routing_profile: 'balanced',
          },
        },
      }),
    },
    expect(_h, body) {
      assertEquals(
        (data(body).app_settings as Record<string, unknown>)['app.min_supported_version'],
        {
          ios: '1.0.0',
          android: '1.0.0',
        },
      );
    },
  },
  'PATCH /settings/plan-limits': {
    sql: {
      settings_get: () => ({
        app_settings: {},
        plan_limits: { free: { ai_daily_budget_units: 40 }, pro: {} },
      }),
      plan_limits_update: () => ({
        plan: 'free',
        key: 'ai_daily_budget_units',
        value: 50,
        updated_at: TS,
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'plan_limits_update'), {
        p_plan: 'free',
        p_key: 'ai_daily_budget_units',
        p_value: 50,
        p_reason: REASON,
      });
      assertEquals(data(body), { key: 'ai_daily_budget_units', before: 40, after: 50 });
    },
  },
  'PATCH /settings/config/:key': {
    sql: {
      settings_get: () => ({
        app_settings: { 'referral.reward_days': { value: 7 } },
        plan_limits: {},
      }),
      settings_update: () => ({ key: 'referral.reward_days', value: 14, updated_at: TS }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'settings_update'), {
        p_key: 'referral.reward_days',
        p_value: 14,
        p_reason: REASON,
      });
      assertEquals(data(body), { key: 'referral.reward_days', before: 7, after: 14 });
    },
  },
  'GET /search': {
    sql: {
      command_search: () => ({
        results: [
          { type: 'ticket', id: uuid(82), label: 'DA-7K3M9Q', route: `/support/${uuid(82)}` },
          { type: 'user', id: uuid(2), label: 'yu***@gmail.com', route: `/users/${uuid(2)}` },
        ],
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'command_search'), { p_q: 'DA-7K3M9Q' });
      assertEquals(
        h.rateKeys.filter((k) => k.startsWith('bo_s:')).length,
        1,
        'search runs in the S class',
      );
      assertEquals((data(body).results as unknown[]).length, 2);
    },
  },
};
