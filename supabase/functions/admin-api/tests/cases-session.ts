/** ADM-00 session, own account and sign-in, ADM-01 dashboard: SQL-shaped outputs and mapped responses. */
import { assert, assertEquals, assertMatch, assertNotEquals } from '@std/assert';
import { hmacSha256Hex, sha256Hex } from '../../_shared/crypto/hmac.ts';
import { ADMIN_ID, FACTOR_ID } from './harness.ts';
import {
  argsOf,
  authCalls,
  type Cases,
  data,
  LATER,
  pokes,
  rows,
  TS,
  uuid,
} from './case-helpers.ts';

const SHA = 'a'.repeat(64);
/** The backoffice's plain digests (it holds no pepper). */
const OPS_EMAIL_DIGEST = await sha256Hex('ops@dijitalasistan.app');
const IP_DIGEST = await sha256Hex('203.0.113.9');

const sqlPreferences = {
  theme: 'system',
  locale: 'en-US',
  table_prefs: { users: { columns: ['email_masked', 'plan'] } },
  dashboard_range: '30d',
  timezone: 'Europe/Istanbul',
  density: 'compact',
  recent_items: [{ type: 'user', id: uuid(2), label: 'yu***@gmail.com' }],
  sidebar_collapsed: true,
  updated_at: TS,
};

const metricBlock = (scale: number) => ({
  total_users: 100 * scale,
  active_users: 40 * scale,
  new_users: 5 * scale,
  pro_users: 12 * scale,
  trials: 3 * scale,
  connected_emails: 80 * scale,
  connected_calendars: 70 * scale,
  ai_requests: 1000 * scale,
  ai_cost_usd: 12.5 * scale,
  briefings_generated: 90 * scale,
  push_sent: 200 * scale,
  classification_rate: 0.9,
  briefing_success_rate: 0.98,
  suppression_rate: 0.2,
  approval_conversion: null,
  sync_success_rate: 0.99,
  reconnect_rate: 0.01,
});

export const SESSION_CASES: Cases = {
  'POST /session/start': {
    request: {
      headers: {
        'X-Forwarded-For': '203.0.113.9, 10.0.0.1',
        'X-DA-User-Agent': 'Mozilla/5.0 Chrome/153 Mac OS',
      },
    },
    sql: {
      admin_session_start: () => ({
        admin: {
          id: ADMIN_ID,
          email: 'ops@dijitalasistan.app',
          role: 'operations',
          mfa_enrolled: true,
        },
        permissions: ['dashboard.read', 'jobs.retry', 'future.permission'],
        session_id: uuid(101),
        idle_expires_at: '2026-09-24T10:30:00Z',
        absolute_expires_at: '2026-09-24T22:00:00Z',
      }),
    },
    expect(h, body) {
      const args = argsOf(h, 'admin_session_start') ?? {};
      assertMatch(String(args.p_ip_hash), /^\\x[0-9a-f]{64}$/);
      assertEquals(args.p_user_agent, 'Mozilla/5.0 Chrome/153 Mac OS');
      assert(!h.rpcNames().includes('admin_me'), 'session start runs before the context exists');
      assertEquals(data(body).permissions, ['dashboard.read', 'jobs.retry']);
    },
  },
  'POST /session/heartbeat': {
    expect(h, body) {
      assertEquals(argsOf(h, 'admin_me'), { p_activity: true });
      assertEquals(data(body), { idle_expires_at: '2026-09-24T10:30:00Z' });
    },
  },
  'GET /me': {
    expect(h, body) {
      assertEquals(
        argsOf(h, 'admin_me'),
        { p_activity: false },
        'background polling never extends the idle window',
      );
      const d = data(body);
      assertEquals((d.preferences as Record<string, unknown>).theme, 'light');
      assertEquals((d.preferences as Record<string, unknown>).locale, 'tr');
      assertEquals((d.admin as Record<string, unknown>).recovery_codes_remaining, 8);
    },
  },
  'GET /me/sessions': {
    sql: {
      sessions_list_own: () => [
        {
          id: uuid(101),
          current: true,
          aal: 'aal2',
          created_at: TS,
          last_activity_at: TS,
          idle_expires_at: LATER,
          absolute_expires_at: LATER,
          ended_at: null,
          end_reason: null,
          browser_family: 'Chrome · macOS',
          ip_hash: '\\x00',
        },
      ],
    },
    expect(h, body) {
      assert(h.rpcNames().includes('sessions_list_own'));
      assert(!('ip_hash' in (rows(body)[0] ?? {})), 'the IP hash never leaves SQL');
    },
  },
  'POST /session/logout': {
    sql: { admin_session_end: () => ({ ended: 1, scope: 'current' }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'admin_session_end'), { p_scope: 'current', p_reason: null });
      assertEquals(authCalls(h), ['POST /logout?scope=local']);
      assertEquals(data(body), { ended_sessions: 1 });
    },
  },
  'POST /session/logout-all': {
    sql: { admin_session_end: () => ({ ended: 3, scope: 'others' }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'admin_session_end'), {
        p_scope: 'others',
        p_reason: 'admin signed out other sessions',
      });
      assertEquals(authCalls(h), ['POST /logout?scope=others']);
      assertEquals(data(body), { ended_sessions: 3 });
    },
  },
  'GET /preferences': {
    sql: { admin_preferences_get: () => sqlPreferences },
    expect(_h, body) {
      assertEquals(data(body), {
        theme: 'light',
        locale: 'en',
        timezone: 'Europe/Istanbul',
        density: 'compact',
        table_prefs: { users: { columns: ['email_masked', 'plan'] } },
        dashboard_range: '30d',
        recent_items: [{ type: 'user', id: uuid(2), label: 'yu***@gmail.com' }],
        sidebar_collapsed: true,
      });
    },
  },
  'PATCH /preferences': {
    sql: { admin_preferences_set: () => ({ ...sqlPreferences, theme: 'dark' }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'admin_preferences_set'), {
        p_theme: null,
        p_locale: null,
        p_table_prefs: null,
        p_dashboard_range: '30d',
        p_timezone: null,
        p_density: null,
        p_recent_items: null,
        p_sidebar_collapsed: null,
      });
      assertEquals(data(body).theme, 'dark');
    },
  },
  'POST /auth/preflight': {
    request: { body: { email_hash: OPS_EMAIL_DIGEST, ip_hash: IP_DIGEST } },
    tables: {
      admin_users: () => [
        { email: 'other@dijitalasistan.app' },
        { email: 'Ops@Dijitalasistan.app ' },
      ],
    },
    sql: {
      login_preflight: () => ({ allowed: false, send: false, locked: true, retry_after: null }),
    },
    async expect(h, body) {
      const args = argsOf(h, 'login_preflight') ?? {};
      assertEquals(
        args.p_email,
        'Ops@Dijitalasistan.app ',
        'the digest matches the normalised admin email',
      );
      const pepper = h.runtime.env.piiLookupPepper ?? '';
      assertEquals(
        args.p_email_hash,
        await hmacSha256Hex(pepper, OPS_EMAIL_DIGEST),
        'digests are peppered on receipt',
      );
      assertEquals(args.p_ip_hash, await hmacSha256Hex(pepper, IP_DIGEST));
      assertEquals(data(body), { allowed: false, locked: true });
      assert(!h.rpc.some((r) => r.fn === 'admin_me'), 'BFF routes have no admin context');
    },
  },
  'POST /auth/attempt': {
    tables: { admin_users: () => [{ email: 'ops@dijitalasistan.app' }] },
    sql: { login_attempt_record: () => ({ locked: false, locked_until: null }) },
    expect(h, body) {
      const args = argsOf(h, 'login_attempt_record') ?? {};
      assertEquals(
        args.p_email,
        null,
        'an unknown digest is answered exactly like an unknown email',
      );
      assertEquals([args.p_kind, args.p_success], ['mfa', false]);
      assertNotEquals(args.p_email_hash, SHA, 'the raw digest never keys a rate limit');
      assertMatch(String(args.p_ip_hash), /^[0-9a-f]{64}$/);
      assertEquals(data(body), { recorded: true });
    },
  },
  'GET /auth/status': {
    sql: {
      auth_status: () => ({
        is_admin: true,
        status: 'active',
        locked: false,
        mfa_verified_factors: 1,
      }),
    },
    expect(h, body) {
      assert(!h.rpcNames().includes('admin_me'), 'aal1 routes run without the session context');
      assertEquals(data(body), { is_admin: true, status: 'active', mfa_verified_factors: 1 });
    },
  },
  'POST /auth/invite/redeem': {
    sql: { invite_redeem: () => ({ admin_user_id: uuid(100), email: 'new@dijitalasistan.app' }) },
    expect(h, body) {
      assertMatch(String(argsOf(h, 'invite_redeem')?.p_token_hash), /^\\x[0-9a-f]{64}$/);
      assertEquals(data(body), { email: 'new@dijitalasistan.app', accepted: true });
    },
  },
  'POST /auth/recovery-code/redeem': {
    tables: { admin_users: () => [{ user_id: uuid(100) }, { user_id: uuid(104) }] },
    sql: { recovery_code_consume: () => ({ ok: true, remaining: 7 }) },
    expect(h, body) {
      assertMatch(String(argsOf(h, 'recovery_code_consume')?.p_code_hash), /^\\x[0-9a-f]{64}$/);
      assertEquals(authCalls(h), [
        `GET /admin/users/${ADMIN_ID}/factors`,
        `DELETE /admin/users/${ADMIN_ID}/factors/${FACTOR_ID}`,
      ]);
      const emails = h.rpc.filter((r) => r.fn === 'enqueue_job');
      assertEquals(emails.length, 2);
      assertEquals(emails[0]?.args.p_type, 'transactional_email');
      assertEquals(
        (emails[0]?.args.p_payload as Record<string, unknown>).template_key,
        'admin_security_recovery_used',
      );
      assertEquals(pokes(h), ['admin_security_email']);
      assertEquals(data(body), { factors_removed: 1, reenrol_required: true });
    },
  },
  'POST /me/recovery-codes': {
    sql: { recovery_codes_store: () => 10 },
    expect(h, body) {
      const hashes = argsOf(h, 'recovery_codes_store')?.p_code_hashes as string[];
      assertEquals(hashes.length, 10);
      const codes = data(body).codes as string[];
      assertEquals(codes.length, 10);
      for (const code of codes)
        assertMatch(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}$/);
      assert(
        !hashes.some((hash) => codes.some((code) => hash.includes(code))),
        'only digests reach SQL',
      );
    },
  },
  'POST /session/step-up': {
    sql: { admin_session_step_up: () => ({ step_up_valid_until: '2026-09-24T10:10:00+00:00' }) },
    expect(_h, body) {
      assertEquals(data(body), { step_up_valid_until: '2026-09-24T10:10:00+00:00' });
    },
  },
  // ADM-01
  'GET /dashboard/metrics': {
    sql: {
      dashboard_metrics: () => ({
        range: '30d',
        start_at: TS,
        end_at: LATER,
        source: 'raw',
        computed_at: TS,
        value: metricBlock(2),
        prev_value: metricBlock(1),
        ai_cost_per_active_user: 0.3125,
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'dashboard_metrics'), { p_range: '30d' });
      const d = data<Record<string, { value: number; delta: number | null }>>(body);
      assertEquals(d.total_users, { value: 200, delta: 1 });
      assertEquals(d.ai_cost_per_active_user, { value: 0.3125, delta: 0 });
      assertEquals(d.approval_conversion, { value: 0, delta: null });
      assertEquals(d.classification_rate, { value: 0.9, delta: 0 });
    },
  },
  'GET /dashboard/charts': {
    sql: {
      dashboard_series: () => ({
        metric: 'ai_costs',
        range: '7d',
        bucket: 'day',
        points: [
          {
            t: '2026-09-23T21:00:00+00:00',
            value: 1.2,
            breakdown: { email_triage: 0.8, briefing: 0.4, x: null },
          },
          { t: '2026-09-24T21:00:00+00:00', value: 0, breakdown: null },
        ],
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'dashboard_series'), { p_metric: 'ai_costs', p_range: '7d' });
      const points = data<{ points: Record<string, unknown>[] }>(body).points;
      assertEquals(points[0]?.breakdown, { email_triage: 0.8, briefing: 0.4 });
      assert(!('breakdown' in (points[1] ?? {})));
    },
  },
  'GET /metrics/ops': {
    sql: {
      metrics_ops: () => ({
        range: '24h',
        computed_at: TS,
        kpis: { active_users: 40, sync_success_rate: 0.99, approval_conversion: null },
        decision_tiers: { t0: 10, t1: 5, none: 2 },
        jobs: { 'gmail_sync:completed': 20, 'gmail_sync:failed': 1 },
        notifications: { sent: 10, suppressed: 3 },
      }),
    },
    expect(_h, body) {
      const groups = data<{ groups: Record<string, Record<string, number>> }>(body).groups;
      assertEquals(groups.kpis, { active_users: 40, sync_success_rate: 0.99 });
      assertEquals(groups.jobs, { 'gmail_sync:completed': 20, 'gmail_sync:failed': 1 });
    },
  },
  'GET /metrics/product': {
    sql: {
      metrics_product: () => ({
        range: '7d',
        computed_at: TS,
        active_users: 40,
        feature_usage: {
          briefing_opened: { users: 30, share: 0.75 },
          capture_created: { users: 0, share: null },
        },
        approvals: { email_reply: { decided: 10, approved: 6, executed: 5, failed: 1 } },
        referrals: { applied: 4, rewarded: 1, flagged: 0 },
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'metrics_product'), { p_range: '7d' });
      const groups = data<{ groups: Record<string, Record<string, number>> }>(body).groups;
      assertEquals(groups.summary, { active_users: 40 });
      assertEquals(groups.feature_usage_users, { briefing_opened: 30, capture_created: 0 });
      assertEquals(groups.feature_usage_share, { briefing_opened: 0.75 });
      assertEquals(groups['approvals.email_reply'], {
        decided: 10,
        approved: 6,
        executed: 5,
        failed: 1,
      });
    },
  },
  'GET /security-events': {
    sql: {
      security_events: () => ({
        range: '7d',
        login_failures: 2,
        lockouts: 0,
        recovery_codes_used: 0,
        permission_denials: 1,
        webhook_signature_failures: 0,
        by_admin: [
          { admin_id: uuid(100), count: 1 },
          { admin_id: null, count: 1 },
        ],
        events: [{ action: 'admin.login_failed', count: 2 }],
      }),
    },
    expect(_h, body) {
      assertEquals(data(body).by_admin, [{ admin_id: uuid(100), count: 1 }]);
      assert(!('events' in data(body)));
    },
  },
};
