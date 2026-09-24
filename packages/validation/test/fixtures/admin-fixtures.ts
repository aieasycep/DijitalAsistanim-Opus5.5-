import { FORBIDDEN_MODEL_FAMILIES } from '../../src/admin/ai.ts';
import type { AdminRouteKey } from '../../src/admin/routes.ts';
import {
  SHA,
  TS,
  TS_LATER,
  DAY,
  dataSources,
  jobRef,
  ok,
  paged,
  uuid,
  withPath,
  B64_32,
} from './samples.ts';
import type { InvalidCase, RouteFixture } from './types.ts';

const REASON = 'Kullanıcı talebi üzerine inceleme yapıldı.';
const sensitive = { reason: REASON, confirm: true };
const reasonOnly = { reason: REASON };
const idParams = { id: uuid(1) };

const badPageSize: InvalidCase = {
  part: 'query',
  why: 'page size not in 10|25|50|100',
  value: { page_size: '30' },
};
const badPage: InvalidCase = { part: 'query', why: 'page below 1', value: { page: '0' } };
const shortReason = (extra: Record<string, unknown> = {}): InvalidCase => ({
  part: 'body',
  why: 'reason shorter than 10 chars',
  value: { reason: 'kısa', confirm: true, ...extra },
});
const noConfirm = (extra: Record<string, unknown> = {}): InvalidCase => ({
  part: 'body',
  why: 'sensitive mutation needs confirm:true',
  value: { reason: REASON, ...extra },
});
const badId: InvalidCase = { part: 'params', why: 'id not a uuid', value: { id: 'user-1' } };
const badRange: InvalidCase = { part: 'query', why: 'unknown range', value: { range: '1y' } };
const response = (value: unknown, why: string): InvalidCase => ({ part: 'response', why, value });

const adminIdentity = {
  id: uuid(100),
  email: 'ops@dijitalasistan.app',
  role: 'operations',
  mfa_enrolled: true,
};
const preferences = {
  theme: 'light',
  locale: 'tr',
  timezone: 'Europe/Istanbul',
  density: 'comfortable',
  table_prefs: {},
  dashboard_range: '7d',
  recent_items: [],
  sidebar_collapsed: false,
};
const ownSession = {
  id: uuid(101),
  current: true,
  aal: 'aal2',
  created_at: TS,
  last_activity_at: TS,
  idle_expires_at: TS_LATER,
  absolute_expires_at: TS_LATER,
  ended_at: null,
  end_reason: null,
  browser_family: 'Chrome 153 · macOS',
};
const metric = { value: 10, delta: 0.1 };
const dashboardMetrics = Object.fromEntries(
  [
    'total_users',
    'active_users',
    'new_users',
    'pro_users',
    'trials',
    'connected_emails',
    'connected_calendars',
    'ai_requests',
    'ai_cost_usd',
    'briefings_generated',
    'push_sent',
    'ai_cost_per_active_user',
    'classification_rate',
    'briefing_success_rate',
    'suppression_rate',
    'approval_conversion',
    'sync_success_rate',
    'reconnect_rate',
  ].map((k) => [k, metric]),
);
const userRow = {
  id: uuid(2),
  email_masked: 'yu***@gmail.com',
  plan: 'pro',
  created_at: TS,
  last_active_at: TS,
  platform: 'ios',
  connected_accounts: 2,
  last_sync_at: TS,
  status: 'active',
};
const recentJob = {
  id: uuid(70),
  type: 'gmail_sync',
  status: 'completed',
  last_error_code: null,
  created_at: TS,
};
const userIntegration = {
  account_id: uuid(10),
  provider: 'google',
  email_masked: 'yu***@gmail.com',
  capabilities_granted: ['mail_read'],
  status: 'healthy',
  error_class: null,
  resources: [
    {
      resource: 'mail',
      last_success_at: TS,
      last_error_code: null,
      consecutive_failures: 0,
      watch_expires_at: TS_LATER,
      watch_status: 'active',
    },
  ],
  data_sources: dataSources,
  recent_jobs: [recentJob],
};
const userBriefingRow = {
  id: uuid(64),
  kind: 'morning',
  local_date: DAY,
  status: 'delivered',
  scheduled_for: TS,
  generated_at: TS,
  delivered_at: TS,
  latency_ms: 4200,
  item_count: 5,
  ai_cost_usd: 0.004,
  notification_decision: 'sent',
  skip_reason: null,
  error_code: null,
};
const userUsage = {
  ai: {
    days: [
      {
        date: DAY,
        feature: 'email_triage',
        requests: 12,
        input_tokens: 9000,
        output_tokens: 800,
        cost_usd: 0.01,
        units: 12,
      },
    ],
    daily_budget_units: 50,
    budget_hit_days: 0,
  },
  feature_usage: {
    briefing_opened: 5,
    assistant_query_sent: 2,
    capture_created: 0,
    meeting_prep_opened: 1,
    follow_up_actioned: 1,
    search_performed: 3,
    approval_decided: 2,
  },
  approvals: { created: 3, approved: 2, executed: 2 },
  reminders_created: 1,
  captures: { count: 0, bytes: 0 },
  content_volumes: { email_threads: 120, calendar_events: 40, insights: 30, memory_chunks: 0 },
  notifications_by_decision: { sent: 10, suppressed: 3 },
};
const grant = {
  id: uuid(11),
  source: 'support',
  duration_days: 7,
  starts_at: TS,
  ends_at: TS_LATER,
  state: 'active',
  granted_by: 'ops',
  reason: REASON,
  revoked_at: null,
};
const userSubscription = {
  store: {
    store: 'app_store',
    product_id: 'da_pro_annual',
    period_type: 'normal',
    is_active: true,
    will_renew: true,
    expires_at: TS_LATER,
    billing_issue_detected_at: null,
    environment: 'PRODUCTION',
    synced_at: TS,
    last_event_id: 'evt_1',
    original_transaction_id: '…4821',
  },
  grants: [grant],
  effective: { entitlement: 'pro', source: 'store', until: TS_LATER },
};
const ticketRow = {
  id: uuid(82),
  reference: 'DA-7K3M9Q',
  category: 'sync',
  status: 'open',
  subject: 'Senkron sorunu',
  platform: 'ios',
  app_version: '1.0.0',
  assignee: null,
  created_at: TS,
  contact_email_masked: 'yu***@gmail.com',
};
const accessGrant = {
  id: uuid(102),
  user_id: uuid(2),
  scopes: ['email_metadata'],
  reason: REASON,
  starts_at: TS,
  expires_at: TS_LATER,
  revoked_at: null,
  reveal_count: 0,
};
const integrationRow = {
  account_id: uuid(10),
  user_id: uuid(2),
  provider: 'microsoft',
  email_masked: 'yu***@outlook.com',
  status: 'needs_reauth',
  last_sync_at: TS,
  last_error_code: 'PROVIDER_REAUTH_REQUIRED',
  watch_expires_at: null,
  key_version: 1,
};
const jobRow = {
  id: uuid(70),
  type: 'approval_execute',
  status: 'dead_letter',
  attempts: 5,
  max_attempts: 5,
  last_error_code: 'PROVIDER_UNAVAILABLE',
  run_after: TS,
  created_at: TS,
  correlation_id: 'corr-12345678',
  user_id: uuid(2),
};
const modelTarget = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };
const modelConfig = {
  profile: 'balanced',
  feature: 'email_triage',
  tier: 't1',
  enabled: true,
  primary_target: modelTarget,
  fallback_targets: [{ provider: 'openai', model: 'gpt-5.6-luna' }],
  escalation_target: null,
  batch_policy: 'micro_batch',
  cache_ttl: '5m',
  max_input_tokens: 8000,
  eval_status: 'passed',
  retires_not_before: '2026-10-15T00:00:00Z',
  version: 3,
};
const promptSummary = {
  version: 2,
  status: 'active',
  created_by: 'ai_ops',
  created_at: TS,
  activated_at: TS,
  telemetry: { requests: 100, error_rate: 0.01, feedback_positive_rate: 0.9 },
};
const flagRow = {
  key: 'feature.midday',
  enabled: true,
  rollout_percent: 100,
  platforms: ['ios', 'android'],
  plans: ['pro'],
  min_version: '1.0.0',
  max_version: null,
  payload: null,
  updated_by: 'ops',
  updated_at: TS,
};
const announcementRow = {
  id: uuid(3),
  title_tr: 'Yeni: Öğle özeti',
  title_en: 'New: Midday pulse',
  audience: 'all',
  platforms: ['ios', 'android'],
  status: 'live',
  starts_at: TS,
  ends_at: null,
};
const announcementBody = {
  title_tr: 'Yeni: Öğle özeti',
  title_en: 'New: Midday pulse',
  body_tr: 'Öğle saatinde yalnızca değişenleri özetliyoruz.',
  body_en: 'At midday we summarise only what changed.',
  audience: 'pro',
  platforms: ['ios'],
  cta_route: '/briefing/latest',
  starts_at: TS,
  ends_at: TS_LATER,
};
const dataRequestRow = {
  id: uuid(78),
  kind: 'export',
  status: 'ready',
  origin: 'app',
  requested_at: TS,
  completed_at: TS,
  steps_summary: null,
  user_ref: uuid(2),
};
const auditRow = {
  id: uuid(103),
  ts: TS,
  actor: 'op***@dijitalasistan.app',
  role: 'operations',
  action: 'admin.job.retried',
  target: `job:${uuid(70)}`,
  reason: REASON,
  result: 'success',
  correlation_id: 'corr-12345678',
};
const adminUserRow = { ...adminIdentity, status: 'active', last_login_at: TS };
const healthResult = {
  probe: 'database',
  status: 'healthy',
  latency_ms: 12,
  detail_code: null,
  checked_at: TS,
};

export const adminFixtures = {
  // ADM-00
  'POST /session/start': {
    valid: {
      body: {},
      response: ok({
        admin: adminIdentity,
        permissions: ['dashboard.read', 'jobs.retry'],
        idle_expires_at: TS_LATER,
        absolute_expires_at: TS_LATER,
      }),
    },
    invalid: [
      response(
        ok({
          admin: adminIdentity,
          permissions: ['everything'],
          idle_expires_at: TS,
          absolute_expires_at: TS,
        }),
        'unknown permission string',
      ),
    ],
  },
  'POST /session/heartbeat': {
    valid: { body: {}, response: ok({ idle_expires_at: TS_LATER }) },
    invalid: [response(ok({}), 'idle_expires_at missing')],
  },
  'GET /me': {
    valid: {
      headers: { 'x-da-activity': 'background' },
      response: ok({
        admin: {
          id: uuid(100),
          email: 'ops@dijitalasistan.app',
          display_name: 'Ops',
          role: 'operations',
          status: 'active',
          mfa_enrolled: true,
          mfa_factor_count: 1,
          recovery_codes_remaining: 8,
        },
        permissions: ['dashboard.read'],
        session: {
          id: uuid(101),
          idle_expires_at: TS_LATER,
          absolute_expires_at: TS_LATER,
          step_up_valid_until: null,
        },
        preferences,
      }),
    },
    invalid: [
      { part: 'headers', why: 'unknown activity kind', value: { 'x-da-activity': 'robot' } },
      response(
        ok({ admin: {}, permissions: [], session: {}, preferences }),
        'admin identity incomplete',
      ),
    ],
  },
  'GET /me/sessions': {
    valid: { response: ok([ownSession]) },
    invalid: [response(ok([{ ...ownSession, ip_hash: SHA }]), 'ip_hash is never returned')],
  },
  'POST /session/logout': {
    valid: { body: {}, response: ok({ ended_sessions: 1 }) },
    invalid: [response(ok({ ended_sessions: -1 }), 'negative count')],
  },
  'POST /session/logout-all': {
    valid: { body: { confirm: true, scope: 'others' }, response: ok({ ended_sessions: 3 }) },
    invalid: [
      { part: 'body', why: 'unknown scope', value: { confirm: true, scope: 'everyone' } },
      response(ok({}), 'count missing'),
    ],
  },
  'GET /preferences': {
    valid: { response: ok(preferences) },
    invalid: [response(ok({ ...preferences, theme: 'sepia' }), 'unknown theme')],
  },
  'PATCH /preferences': {
    valid: { body: { dashboard_range: '30d' }, response: ok(preferences) },
    invalid: [
      { part: 'body', why: 'no changes', value: {} },
      {
        part: 'body',
        why: 'more than 10 recent items',
        value: {
          recent_items: Array.from({ length: 11 }, () => ({ type: 'user', id: 'x', label: 'y' })),
        },
      },
      response(ok({ ...preferences, density: 'tiny' }), 'unknown density'),
    ],
  },
  'POST /auth/preflight': {
    valid: { body: { email_hash: SHA, ip_hash: SHA }, response: ok({ allowed: true }) },
    invalid: [
      { part: 'body', why: 'raw email is never sent', value: { email: 'a@b.co', ip_hash: SHA } },
      response(ok({ retry_after: 10 }), 'allowed missing'),
    ],
  },
  'POST /auth/attempt': {
    valid: {
      body: { email_hash: SHA, ip_hash: SHA, kind: 'mfa', success: false },
      response: ok({ recorded: true }),
    },
    invalid: [
      {
        part: 'body',
        why: 'passwords do not exist (R-08)',
        value: { email_hash: SHA, ip_hash: SHA, kind: 'password', success: true },
      },
      response(ok({ recorded: false }), 'recorded is always true'),
    ],
  },
  'GET /auth/status': {
    valid: { response: ok({ is_admin: true, status: 'active', mfa_verified_factors: 1 }) },
    invalid: [
      response(
        ok({ is_admin: true, status: 'suspended', mfa_verified_factors: 0 }),
        'unknown admin status',
      ),
    ],
  },
  'POST /auth/invite/redeem': {
    valid: {
      body: { token: B64_32 },
      response: ok({ email: 'new@dijitalasistan.app', accepted: true }),
    },
    invalid: [
      { part: 'body', why: 'token malformed', value: { token: 'abc' } },
      response(ok({ email: 'x', accepted: true }), 'email malformed'),
    ],
  },
  'POST /auth/recovery-code/redeem': {
    valid: {
      body: { code: 'ABCD-EFGH-12' },
      response: ok({ factors_removed: 1, reenrol_required: true }),
    },
    invalid: [
      { part: 'body', why: 'code malformed', value: { code: '1' } },
      response(ok({ factors_removed: 1, reenrol_required: false }), 're-enrolment always required'),
    ],
  },
  'POST /me/recovery-codes': {
    valid: {
      body: {},
      response: ok({
        codes: Array.from({ length: 10 }, (_, i) => `CODE-${String(i)}`),
        generated_at: TS,
      }),
    },
    invalid: [response(ok({ codes: ['A'], generated_at: TS }), 'exactly 10 codes')],
  },
  'POST /session/step-up': {
    valid: { body: {}, response: ok({ step_up_valid_until: TS_LATER }) },
    invalid: [response(ok({ step_up_valid_until: 'soon' }), 'not a timestamp')],
  },
  // ADM-01
  'GET /dashboard/metrics': {
    valid: { query: { range: '30d' }, response: ok(dashboardMetrics) },
    invalid: [
      badRange,
      response(ok({ ...dashboardMetrics, total_users: 10 }), 'metric needs value and delta'),
    ],
  },
  'GET /dashboard/charts': {
    valid: { query: { series: 'ai_costs' }, response: ok({ points: [{ t: TS, value: 1.2 }] }) },
    invalid: [
      { part: 'query', why: 'series required', value: { range: '7d' } },
      response(ok({ points: [{ t: 'x', value: 1 }] }), 'bad timestamp'),
    ],
  },
  'GET /metrics/ops': {
    valid: {
      query: { range: '24h' },
      response: ok({ range: '24h', groups: { sync: { success_rate: 0.99 } } }),
    },
    invalid: [
      badRange,
      response(ok({ range: '24h', groups: { sync: { success_rate: 'high' } } }), 'numbers only'),
    ],
  },
  'GET /metrics/product': {
    valid: { query: {}, response: ok({ range: '7d', groups: { approvals: { conversion: 0.6 } } }) },
    invalid: [badRange, response(ok({ range: '1y', groups: {} }), 'unknown range')],
  },
  'GET /security-events': {
    valid: {
      query: { range: '7d' },
      response: ok({
        range: '7d',
        login_failures: 2,
        lockouts: 0,
        recovery_codes_used: 0,
        permission_denials: 1,
        webhook_signature_failures: 0,
        by_admin: [{ admin_id: uuid(100), count: 1 }],
      }),
    },
    invalid: [badRange, response(ok({ range: '7d' }), 'counts missing')],
  },
  // ADM-02
  'GET /users': {
    valid: {
      query: { page: '2', page_size: '50', sort: 'last_active_at', 'filter[plan]': 'pro' },
      response: paged(userRow),
    },
    invalid: [
      badPageSize,
      { part: 'query', why: 'sort column not allow-listed', value: { sort: 'email' } },
      { part: 'query', why: 'unknown filter', value: { 'filter[email]': 'a@b.co' } },
      response(paged({ ...userRow, email_masked: 'yunus@gmail.com' }), 'email must be masked'),
    ],
  },
  'POST /users/lookup': {
    valid: { body: { email: 'yunus@gmail.com' }, response: ok({ user_id: uuid(2) }) },
    invalid: [
      { part: 'body', why: 'partial search is not supported', value: { email: 'yunus' } },
      response(ok({}), 'user id missing'),
    ],
  },
  'GET /users/:id': {
    valid: {
      params: idParams,
      response: ok({
        user_id: uuid(2),
        account_status: 'active',
        plan: 'pro',
        integrations: [
          {
            provider: 'google',
            status: 'healthy',
            last_sync_at: TS,
            last_error_code: null,
            watch_expires_at: TS_LATER,
          },
        ],
        job_errors: ['PROVIDER_UNAVAILABLE'],
        briefing_status: [{ local_date: DAY, kind: 'morning', status: 'delivered' }],
        push_status: { tokens_enabled: 1, last_receipt_error: null },
        app_version: '1.0.0',
        platform: 'ios',
      }),
    },
    invalid: [badId, response(ok({ user_id: uuid(2) }), 'overview incomplete')],
  },
  'GET /users/:id/integrations': {
    valid: { params: idParams, response: ok([userIntegration]) },
    invalid: [
      badId,
      response(ok([{ ...userIntegration, refresh_token: 'x' }]), 'no token field can exist'),
    ],
  },
  'GET /users/:id/briefings': {
    valid: {
      params: idParams,
      query: { 'filter[kind]': 'morning', sort: 'local_date' },
      response: paged(userBriefingRow),
    },
    invalid: [
      badId,
      badPage,
      response(paged({ ...userBriefingRow, narrative: 'Günaydın' }), 'narrative is never returned'),
    ],
  },
  'GET /users/:id/usage': {
    valid: { params: idParams, query: { range: '7d' }, response: ok(userUsage) },
    invalid: [
      { part: 'query', why: '24h is not a usage range', value: { range: '24h' } },
      response(ok({ ...userUsage, prompts: ['x'] }), 'counts only'),
    ],
  },
  'GET /users/:id/subscription': {
    valid: { params: idParams, query: { grants_page: '1' }, response: ok(userSubscription) },
    invalid: [
      { part: 'query', why: 'page below 1', value: { events_page: '0' } },
      response(
        ok(withPath(userSubscription, 'store.original_transaction_id', '1000000123454821')),
        'transaction id shows last 4 only',
      ),
    ],
  },
  'GET /users/:id/referrals': {
    valid: {
      params: idParams,
      query: {},
      response: ok({
        code: 'AB3K7M9Q',
        as_referrer: [
          {
            id: uuid(77),
            referee_masked: 'A***',
            status: 'rewarded',
            risk_score: 0.1,
            signal_labels: ['same_device'],
            created_at: TS,
            qualified_at: TS,
            rewarded_at: TS,
          },
        ],
        as_referee: null,
        credits: [{ referral_id: uuid(77), side: 'referrer', grant_id: uuid(11), days: 14 }],
        yearly_rewards: { used: 1, max: 6 },
      }),
    },
    invalid: [
      badId,
      response(
        ok({
          code: null,
          as_referrer: [
            {
              id: uuid(77),
              referee_masked: 'A***',
              status: 'pending',
              risk_score: null,
              signal_labels: [],
              created_at: TS,
              qualified_at: null,
              rewarded_at: null,
              signals: { device_hash: SHA },
            },
          ],
          as_referee: null,
          credits: [],
          yearly_rewards: { used: 0, max: 6 },
        }),
        'hashed signals are never returned',
      ),
    ],
  },
  'GET /users/:id/support': {
    valid: {
      params: idParams,
      query: {},
      response: ok({
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
            expires_at: TS_LATER,
            revoked_at: null,
            reveal_count: 1,
            active: true,
          },
        ],
      }),
    },
    invalid: [
      badId,
      response(
        ok({
          tickets: [],
          access_grants: [
            {
              id: uuid(102),
              admin: { id: uuid(100), display_name: null },
              scopes: ['tokens'],
              reason: 'r',
              starts_at: TS,
              expires_at: TS,
              revoked_at: null,
              reveal_count: 0,
              active: false,
            },
          ],
        }),
        'unknown support access scope',
      ),
    ],
  },
  'GET /users/:id/audit': {
    valid: { params: idParams, query: { 'filter[result]': 'denied' }, response: paged(auditRow) },
    invalid: [
      badId,
      { part: 'query', why: 'unknown result', value: { 'filter[result]': 'maybe' } },
      response(paged({ ...auditRow, result: 'ok' }), 'unknown result'),
    ],
  },
  'GET /users/:id/devices': {
    valid: {
      params: idParams,
      response: ok([
        {
          installation_id: uuid(1),
          platform: 'ios',
          app_version: '1.0.0',
          build_number: '42',
          os_version: '18.0',
          push_enabled: true,
          token_masked: 'ExponentPushToken[ab…yz]',
          last_seen_at: TS,
          last_receipt_status: 'ok',
          last_receipt_error: null,
        },
      ]),
    },
    invalid: [
      badId,
      response(
        ok([
          {
            installation_id: uuid(1),
            platform: 'ios',
            app_version: '1',
            build_number: '1',
            os_version: null,
            push_enabled: true,
            token_masked: 'ExponentPushToken[abcdefghijkl]',
            last_seen_at: TS,
            last_receipt_status: null,
            last_receipt_error: null,
          },
        ]),
        'raw push token is never returned',
      ),
    ],
  },
  'POST /users/:id/reveal': {
    valid: {
      params: idParams,
      body: { field: 'email', reason: REASON, confirm: true },
      response: ok({ value: 'yunus@gmail.com', expires_in_s: 60 }),
    },
    invalid: [
      {
        part: 'body',
        why: 'only email can be revealed',
        value: { field: 'phone', reason: REASON, confirm: true },
      },
      response(ok({ value: 'x', expires_in_s: 3600 }), 'reveal expires in 60 s'),
    ],
  },
  'POST /users/:id/force-sync': {
    valid: {
      params: idParams,
      body: { ...sensitive, resources: ['mail'] },
      response: ok({ jobs: [{ job_id: uuid(70), type: 'gmail_sync' }] }),
    },
    invalid: [
      shortReason(),
      response(ok({ jobs: [{ job_id: uuid(70), type: 'sync_all' }] }), 'unknown job type'),
    ],
  },
  'POST /users/:id/disable': {
    valid: {
      params: idParams,
      body: sensitive,
      response: ok({ user_id: uuid(2), account_status: 'disabled' }),
    },
    invalid: [
      noConfirm(),
      response(ok({ user_id: uuid(2), account_status: 'banned' }), 'unknown state'),
    ],
  },
  'POST /users/:id/restore': {
    valid: {
      params: idParams,
      body: sensitive,
      response: ok({ user_id: uuid(2), account_status: 'active' }),
    },
    invalid: [
      shortReason(),
      response(ok({ user_id: 'x', account_status: 'active' }), 'user id not a uuid'),
    ],
  },
  'POST /users/:id/entitlement-grants': {
    valid: {
      params: idParams,
      body: { duration_days: 7, source: 'support', reason: REASON, confirm: true },
      response: ok({
        id: uuid(11),
        user_id: uuid(2),
        source: 'support',
        duration_days: 7,
        starts_at: TS,
        ends_at: TS_LATER,
        state: 'active',
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'durations are 1/7/14/30',
        value: { duration_days: 10, source: 'admin', reason: REASON, confirm: true },
      },
      {
        part: 'body',
        why: 'referral grants are not manual',
        value: { duration_days: 7, source: 'referral_referee', reason: REASON, confirm: true },
      },
      response(
        ok({
          id: uuid(11),
          user_id: uuid(2),
          source: 'support',
          duration_days: 7,
          starts_at: TS,
          ends_at: TS,
          state: 'paused',
        }),
        'unknown grant state',
      ),
    ],
  },
  'POST /users/:id/entitlement-grants/:grantId/revoke': {
    valid: {
      params: { id: uuid(2), grantId: uuid(11) },
      body: sensitive,
      response: ok({
        id: uuid(11),
        user_id: uuid(2),
        source: 'admin',
        duration_days: 14,
        starts_at: TS,
        ends_at: TS_LATER,
        state: 'revoked',
      }),
    },
    invalid: [
      { part: 'params', why: 'grant id missing', value: { id: uuid(2) } },
      noConfirm(),
      response(ok({}), 'grant missing'),
    ],
  },
  'POST /users/:id/integrations/:accountId/disconnect': {
    valid: {
      params: { id: uuid(2), accountId: uuid(10) },
      body: { ...sensitive, purge_content: false },
      response: ok({
        account_id: uuid(10),
        status: 'disconnected',
        revocation: 'provider_revoked',
      }),
    },
    invalid: [
      { part: 'body', why: 'purge_content required', value: sensitive },
      response(
        ok({ account_id: uuid(10), status: 'gone', revocation: 'local_only' }),
        'unknown status',
      ),
    ],
  },
  'POST /users/:id/internal': {
    valid: {
      params: idParams,
      body: { internal: true, reason: REASON },
      response: ok({ user_id: uuid(2), internal: true }),
    },
    invalid: [
      { part: 'body', why: 'internal must be boolean', value: { internal: 'yes', reason: REASON } },
      response(ok({ user_id: uuid(2) }), 'flag missing'),
    ],
  },
  // ADM-03
  'GET /support/tickets': {
    valid: { query: { 'filter[source]': 'web', q: 'DA-7K3M9Q' }, response: paged(ticketRow) },
    invalid: [
      badPageSize,
      { part: 'query', why: 'unknown source', value: { 'filter[source]': 'fax' } },
      response(
        paged({ ...ticketRow, contact_email_masked: 'yunus@gmail.com' }),
        'contact email must be masked',
      ),
    ],
  },
  'GET /support/tickets/:id': {
    valid: {
      params: idParams,
      response: ok({
        ...ticketRow,
        message: 'Mailler gelmiyor.',
        diagnostics: { app_version: '1.0.0' },
        notes: [
          { id: uuid(104), kind: 'internal', body: 'İnceleniyor', author: 'Ops', created_at: TS },
        ],
      }),
    },
    invalid: [
      badId,
      response(
        ok({
          ...ticketRow,
          message: 'm',
          diagnostics: null,
          notes: [{ id: uuid(104), kind: 'sms', body: 'b', author: null, created_at: TS }],
        }),
        'unknown note kind',
      ),
    ],
  },
  'PATCH /support/tickets/:id': {
    valid: { params: idParams, body: { status: 'in_progress' }, response: ok(ticketRow) },
    invalid: [
      { part: 'body', why: 'no changes', value: {} },
      response(ok({ ...ticketRow, status: 'pending' }), 'unknown status'),
    ],
  },
  'POST /support/tickets/:id/notes': {
    valid: {
      params: idParams,
      body: { body: 'Kullanıcıya dönüş yapıldı.' },
      response: ok({ note_id: uuid(104), created_at: TS }),
    },
    invalid: [
      { part: 'body', why: 'note over 5,000 chars', value: { body: 'x'.repeat(5001) } },
      response(ok({ created_at: TS }), 'note id missing'),
    ],
  },
  'POST /support/tickets/:id/reply': {
    valid: {
      params: idParams,
      body: { body: 'Merhaba, sorun giderildi.' },
      response: ok({ note_id: uuid(104), email_job_id: uuid(70), created_at: TS }),
    },
    invalid: [
      { part: 'body', why: 'empty reply', value: { body: ' ' } },
      response(ok({ note_id: uuid(104), created_at: TS }), 'email job missing'),
    ],
  },
  'POST /support-access/grants': {
    valid: {
      body: {
        user_id: uuid(2),
        scopes: ['email_metadata', 'insights'],
        reason: REASON,
        duration_minutes: 30,
      },
      response: ok(accessGrant),
    },
    invalid: [
      {
        part: 'body',
        why: 'duration 120 min is above the 60 min cap',
        value: { user_id: uuid(2), scopes: ['pii'], reason: REASON, duration_minutes: 120 },
      },
      {
        part: 'body',
        why: 'tokens are never a scope (R-09)',
        value: { user_id: uuid(2), scopes: ['tokens'], reason: REASON, duration_minutes: 15 },
      },
      response(ok({ ...accessGrant, scopes: ['attachments'] }), 'unknown scope'),
    ],
  },
  'POST /support-access/grants/:id/revoke': {
    valid: {
      params: { id: uuid(102) },
      body: reasonOnly,
      response: ok({ ...accessGrant, revoked_at: TS }),
    },
    invalid: [
      { part: 'body', why: 'reason missing', value: {} },
      response(ok({ ...accessGrant, reveal_count: -1 }), 'negative reveal count'),
    ],
  },
  'GET /support-access/grants/:id/content/:scope': {
    valid: {
      params: { id: uuid(102), scope: 'email_metadata' },
      query: { entity_type: 'email_message', entity_id: uuid(90) },
      response: ok({ value: 'Konu: Fiyat güncellemesi', expires_in_s: 60 }),
    },
    invalid: [
      {
        part: 'params',
        why: 'original mail is never a scope',
        value: { id: uuid(102), scope: 'original_mail' },
      },
      { part: 'query', why: 'entity id required', value: { entity_type: 'email_message' } },
      response(ok({ value: 'x', expires_in_s: 120 }), 'reveal lasts 60 s'),
    ],
  },
  // ADM-04
  'GET /integrations': {
    valid: { query: { 'filter[issue]': 'needs_reconnect' }, response: paged(integrationRow) },
    invalid: [
      { part: 'query', why: 'demo is not an admin filter', value: { 'filter[provider]': 'demo' } },
      response(paged({ ...integrationRow, ciphertext: 'x' }), 'no ciphertext field'),
    ],
  },
  'GET /integrations/summary': {
    valid: {
      query: { range: '24h' },
      response: ok({
        by_provider_status: [{ provider: 'google', status: 'healthy', count: 10 }],
        reconnect_rate: 0.02,
        watches_expiring_24h: 1,
        watch_renewals_failed_24h: 0,
        oldest_healthy_last_sync_at: TS,
      }),
    },
    invalid: [
      badRange,
      response(
        ok({
          by_provider_status: [],
          reconnect_rate: 2,
          watches_expiring_24h: 0,
          watch_renewals_failed_24h: 0,
          oldest_healthy_last_sync_at: null,
        }),
        'rate above 1',
      ),
    ],
  },
  'GET /integrations/:accountId': {
    valid: {
      params: { accountId: uuid(10) },
      response: ok({
        account: integrationRow,
        granted_scopes: ['Mail.Read'],
        sync_states: [
          {
            resource: 'inbox',
            status: 'error',
            last_success_at: TS,
            last_error_code: 'PROVIDER_REAUTH_REQUIRED',
            watch_expires_at: null,
          },
        ],
        recent_jobs: [recentJob],
        webhook_stats: { received_24h: 10, unmatched_24h: 0, last_received_at: TS },
      }),
    },
    invalid: [
      { part: 'params', why: 'account id not a uuid', value: { accountId: 'acc' } },
      response(ok({ account: integrationRow }), 'detail incomplete'),
    ],
  },
  'POST /integrations/:accountId/force-sync': {
    valid: {
      params: { accountId: uuid(10) },
      body: sensitive,
      response: ok({ jobs: [{ job_id: uuid(70), type: 'outlook_sync' }] }),
    },
    invalid: [noConfirm(), response(ok({ jobs: 'all' }), 'jobs must be a list')],
  },
  'POST /integrations/:accountId/renew-watch': {
    valid: {
      params: { accountId: uuid(10) },
      body: sensitive,
      response: ok({ jobs: [{ job_id: uuid(70), type: 'watch_renewal' }] }),
    },
    invalid: [shortReason(), response(ok({}), 'jobs missing')],
  },
  // ADM-05
  'GET /jobs': {
    valid: {
      query: { 'filter[status]': 'dead_letter', q: 'corr-12345678' },
      response: paged(jobRow),
    },
    invalid: [
      { part: 'query', why: 'unknown job status', value: { 'filter[status]': 'stuck' } },
      response(paged({ ...jobRow, max_attempts: 0 }), 'max attempts ≥ 1'),
    ],
  },
  'GET /jobs/stats': {
    valid: {
      query: {},
      response: ok({
        by_type_status: [{ type: 'gmail_sync', status: 'completed', count: 100 }],
        dead_letter: 2,
      }),
    },
    invalid: [badRange, response(ok({ by_type_status: [], dead_letter: -1 }), 'negative count')],
  },
  'POST /jobs/retry-bulk': {
    valid: {
      body: {
        filter: { type: 'gmail_sync', status: 'dead_letter', from: TS, to: TS_LATER },
        max: 100,
        reason: REASON,
        confirm: true,
      },
      response: ok({ retried: 12 }),
    },
    invalid: [
      {
        part: 'body',
        why: 'max above 500',
        value: {
          filter: { type: 'gmail_sync', status: 'failed', from: TS, to: TS_LATER },
          max: 501,
          reason: REASON,
          confirm: true,
        },
      },
      {
        part: 'body',
        why: 'range reversed',
        value: {
          filter: { type: 'gmail_sync', status: 'failed', from: TS_LATER, to: TS },
          max: 1,
          reason: REASON,
          confirm: true,
        },
      },
      response(ok({ retried: 'many' }), 'count must be integer'),
    ],
  },
  'GET /jobs/:id': {
    valid: {
      params: idParams,
      response: ok({
        ...jobRow,
        payload: { approval_id: uuid(30), payload_version: 1 },
        attempts_history: [
          {
            attempt: 1,
            outcome: 'retrying',
            error_code: 'PROVIDER_UNAVAILABLE',
            duration_ms: 300,
            started_at: TS,
          },
        ],
        children: [],
      }),
    },
    invalid: [
      badId,
      response(
        ok({
          ...jobRow,
          payload: { body: { text: 'mail content' } },
          attempts_history: [],
          children: [],
        }),
        'payload redacted to scalar id fields',
      ),
    ],
  },
  'GET /correlation/:id': {
    valid: {
      params: { id: 'corr-12345678' },
      response: ok([
        {
          kind: 'job',
          id: uuid(70),
          ts: TS,
          status: 'completed',
          label_key: 'trace.job',
          link: '/jobs/x',
        },
      ]),
    },
    invalid: [
      { part: 'params', why: 'correlation id too short', value: { id: 'x' } },
      response(
        ok([{ kind: 'email', id: 'x', ts: TS, status: null, label_key: 'k', link: null }]),
        'unknown trace kind',
      ),
    ],
  },
  'POST /jobs/:id/retry': {
    valid: {
      params: idParams,
      body: { ...sensitive, reset_attempts: true },
      response: ok({ id: uuid(70), status: 'queued' }),
    },
    invalid: [
      { part: 'body', why: 'reset_attempts required', value: sensitive },
      response(ok({ id: uuid(70), status: 'requeued' }), 'unknown status'),
    ],
  },
  'POST /jobs/:id/cancel': {
    valid: { params: idParams, body: sensitive, response: ok({ id: uuid(70), status: 'failed' }) },
    invalid: [noConfirm(), response(ok({ id: uuid(70) }), 'status missing')],
  },
  // ADM-06
  'GET /briefings/metrics': {
    valid: {
      query: { kind: 'morning' },
      response: ok({
        scheduled: 10,
        generated: 10,
        delivered: 9,
        failed: 1,
        skipped: 0,
        p50_latency_ms: 3000,
        p95_latency_ms: 9000,
        ai_cost_usd: 0.4,
        template_fallback_rate: 0.05,
      }),
    },
    invalid: [
      { part: 'query', why: 'unknown kind', value: { kind: 'night' } },
      response(ok({ scheduled: 1 }), 'metrics incomplete'),
    ],
  },
  'GET /briefings': {
    valid: {
      query: { 'filter[status]': 'failed' },
      response: paged({
        id: uuid(64),
        user_id: uuid(2),
        kind: 'morning',
        local_date: DAY,
        status: 'failed',
        generated_at: null,
        delivered_at: null,
        latency_ms: null,
        narrative_mode: null,
      }),
    },
    invalid: [
      badPage,
      response(
        paged({
          id: uuid(64),
          user_id: uuid(2),
          kind: 'morning',
          local_date: DAY,
          status: 'ready',
          generated_at: TS,
          delivered_at: null,
          latency_ms: 1,
          narrative_mode: 'llm',
          sections: [],
        }),
        'sections are never returned',
      ),
    ],
  },
  'POST /briefings/:id/regenerate': {
    valid: {
      params: idParams,
      body: sensitive,
      response: ok({ briefing_id: uuid(64), job: jobRef }),
    },
    invalid: [shortReason(), response(ok({ briefing_id: uuid(64) }), 'job missing')],
  },
  // ADM-07
  'GET /notifications/metrics': {
    valid: {
      query: { category: 'meeting' },
      response: ok({
        scheduled: 5,
        sent: 4,
        failed: 0,
        suppressed: 1,
        deduplicated: 0,
        suppression_reasons: { quiet_hours: 1 },
        receipt_errors: {},
      }),
    },
    invalid: [
      { part: 'query', why: 'unknown category', value: { category: 'weekly' } },
      response(ok({ sent: 4 }), 'metrics incomplete'),
    ],
  },
  'GET /notifications': {
    valid: {
      query: { 'filter[user_id]': uuid(2) },
      response: paged({
        id: uuid(105),
        category: 'meeting',
        decision: 'sent',
        decision_reason: null,
        detail_mode: 'title_only',
        sent_at: TS,
        receipt_status: 'ok',
      }),
    },
    invalid: [
      { part: 'query', why: 'user id not a uuid', value: { 'filter[user_id]': 'me' } },
      response(
        paged({
          id: uuid(105),
          category: 'meeting',
          decision: 'sent',
          decision_reason: null,
          detail_mode: 'full',
          sent_at: TS,
          receipt_status: null,
          title_rendered: 'Toplantın 10 dk sonra',
        }),
        'rendered text is never listed',
      ),
    ],
  },
  'POST /notifications/test-push': {
    valid: {
      body: { user_id: uuid(2), reason: REASON, confirm: true },
      response: ok({ notification_id: uuid(105), job: jobRef, deferred_until: null }),
    },
    invalid: [
      {
        part: 'body',
        why: 'custom text is not accepted (generic content only)',
        value: { user_id: uuid(2), reason: REASON, confirm: true, title: 'Merhaba' },
      },
      response(ok({ notification_id: uuid(105) }), 'job missing'),
    ],
  },
  // ADM-08
  'GET /ai/metrics': {
    valid: {
      query: { group_by: 'model' },
      response: ok([
        {
          key: 'claude-haiku-4-5-20251001',
          requests: 10,
          input_tokens: 1000,
          output_tokens: 100,
          cache_read_tokens: 0,
          cost_usd: 0.01,
          error_rate: 0,
          p50_ms: 800,
          p95_ms: 1500,
        },
      ]),
    },
    invalid: [
      { part: 'query', why: 'unknown grouping', value: { group_by: 'user' } },
      response(ok([{ key: 'k' }]), 'row incomplete'),
    ],
  },
  'GET /ai/metrics/series': {
    valid: {
      query: { split: 'feature' },
      response: ok({ points: [{ t: TS, key: 'email_triage', requests: 10, cost_usd: 0.01 }] }),
    },
    invalid: [
      { part: 'query', why: 'unknown split', value: { split: 'user' } },
      response(
        ok({ points: [{ t: TS, key: 'x', requests: -1, cost_usd: 0 }] }),
        'negative requests',
      ),
    ],
  },
  'GET /ai/requests': {
    valid: {
      query: { 'filter[feature]': 'email_triage' },
      response: paged({
        id: uuid(106),
        feature: 'email_triage',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        prompt_version_id: uuid(107),
        status: 'ok',
        input_tokens: 1000,
        output_tokens: 100,
        cache_read_tokens: 0,
        latency_ms: 900,
        cost_usd: 0.001,
        correlation_id: null,
        created_at: TS,
      }),
    },
    invalid: [
      { part: 'query', why: 'unknown feature', value: { 'filter[feature]': 'summarise' } },
      response(
        paged({
          id: uuid(106),
          feature: 'email_triage',
          provider: 'anthropic',
          model: 'm',
          prompt_version_id: null,
          status: 'ok',
          input_tokens: 1,
          output_tokens: 1,
          cache_read_tokens: 0,
          latency_ms: 1,
          cost_usd: 0,
          correlation_id: null,
          created_at: TS,
          prompt: 'içerik',
        }),
        'no content field',
      ),
    ],
  },
  'GET /ai/models': {
    valid: {
      response: ok({
        configs: [modelConfig],
        plan_profiles: { free: 'lean', pro: 'balanced' },
        credentials: {
          anthropic: 'configured',
          openai: 'external_credential_required',
          voyage: 'configured',
        },
      }),
    },
    invalid: [
      response(
        ok({
          configs: [],
          plan_profiles: { free: 'cheap', pro: 'balanced' },
          credentials: { anthropic: 'configured', openai: 'configured', voyage: 'configured' },
        }),
        'unknown profile',
      ),
    ],
  },
  'PATCH /ai/models/:profile/:feature': {
    valid: {
      params: { profile: 'balanced', feature: 'email_triage' },
      body: { primary_target: modelTarget, expected_version: 3, reason: REASON, confirm: true },
      response: ok({ ...modelConfig, version: 4 }),
    },
    invalid: [
      {
        part: 'params',
        why: 'unknown feature',
        value: { profile: 'balanced', feature: 'summarise' },
      },
      {
        part: 'body',
        why: 'Fable models are refused (R-02)',
        value: {
          primary_target: {
            provider: 'anthropic',
            model: `claude-${FORBIDDEN_MODEL_FAMILIES[0]}-5-1`,
          },
          expected_version: 3,
          reason: REASON,
          confirm: true,
        },
      },
      {
        part: 'body',
        why: 'expected_version required',
        value: { enabled: false, reason: REASON, confirm: true },
      },
      response(ok({ ...modelConfig, tier: 't9' }), 'unknown tier'),
    ],
  },
  'POST /ai/models/:profile/:feature/test': {
    valid: {
      params: { profile: 'lean', feature: 'reply_draft' },
      body: { fixture_set: 'reply_tr_basic' },
      response: ok({ latency_ms: 1200, schema_pass: true, cost_usd: 0.002 }),
    },
    invalid: [
      { part: 'body', why: 'fixture set name malformed', value: { fixture_set: 'User Data!' } },
      response(ok({ latency_ms: 1 }), 'probe result incomplete'),
    ],
  },
  'PATCH /ai/routing-profile': {
    valid: {
      body: { plan: 'pro', profile: 'lean', reason: REASON, confirm: true },
      response: ok({ plan: 'pro', before: 'balanced', after: 'lean' }),
    },
    invalid: [
      {
        part: 'body',
        why: 'unknown plan',
        value: { plan: 'enterprise', profile: 'lean', reason: REASON, confirm: true },
      },
      response(ok({ plan: 'pro', before: 'balanced', after: 'turbo' }), 'unknown profile'),
    ],
  },
  // ADM-09
  'GET /ai/prompts': {
    valid: { response: ok([{ key: 'email_classification', active_version: 2 }]) },
    invalid: [response(ok([{ key: 'unknown_prompt', active_version: 1 }]), 'unknown prompt key')],
  },
  'GET /ai/prompts/:key': {
    valid: {
      params: { key: 'assistant' },
      response: ok({ key: 'assistant', versions: [promptSummary] }),
    },
    invalid: [
      { part: 'params', why: 'unknown key', value: { key: 'chat' } },
      response(
        ok({ key: 'assistant', versions: [{ ...promptSummary, status: 'live' }] }),
        'unknown status',
      ),
    ],
  },
  'GET /ai/prompts/:key/diff': {
    valid: {
      params: { key: 'assistant' },
      query: { from: '1', to: '2' },
      response: ok({ from: 1, to: 2, diff: '@@ -1 +1 @@' }),
    },
    invalid: [
      { part: 'query', why: 'same version', value: { from: '2', to: '2' } },
      response(ok({ from: 1, to: 2 }), 'diff missing'),
    ],
  },
  'GET /ai/prompts/:key/versions/:v': {
    valid: {
      params: { key: 'reply_draft', v: '2' },
      response: ok({
        ...promptSummary,
        key: 'reply_draft',
        template_system: 's',
        template_user: 'u',
        output_schema: 'ReplyDraftsV1',
        schema_hash: SHA,
        notes: null,
      }),
    },
    invalid: [
      { part: 'params', why: 'version below 1', value: { key: 'reply_draft', v: '0' } },
      response(
        ok({
          ...promptSummary,
          key: 'reply_draft',
          template_system: 's',
          template_user: 'u',
          output_schema: 'MiddayPulseV1',
          schema_hash: null,
          notes: null,
        }),
        'code payloads are not prompt outputs',
      ),
    ],
  },
  'POST /ai/prompts/:key/versions': {
    valid: {
      params: { key: 'reply_draft' },
      body: {
        template_system: 'Sen bir asistansın.',
        template_user: '{{thread}}',
        output_schema: 'ReplyDraftsV1',
      },
      response: ok({ key: 'reply_draft', version: 3, status: 'draft' }),
    },
    invalid: [
      {
        part: 'body',
        why: 'unregistered output schema',
        value: { template_system: 's', template_user: 'u', output_schema: 'FreeText' },
      },
      response(ok({ key: 'reply_draft', version: 0, status: 'draft' }), 'version below 1'),
    ],
  },
  'PATCH /ai/prompts/:key/versions/:v': {
    valid: {
      params: { key: 'reply_draft', v: '3' },
      body: { notes: 'Ton düzeltmesi' },
      response: ok({ key: 'reply_draft', version: 3, status: 'draft' }),
    },
    invalid: [
      { part: 'body', why: 'no changes', value: {} },
      response(ok({ key: 'reply_draft', version: 3, status: 'editing' }), 'unknown status'),
    ],
  },
  'POST /ai/prompts/:key/versions/:v/test': {
    valid: {
      params: { key: 'reply_draft', v: '3' },
      body: { fixture_set: 'reply_tr_basic' },
      response: ok({ cases: 20, schema_pass_rate: 1, grounding_pass_rate: 0.95 }),
    },
    invalid: [
      { part: 'body', why: 'fixture set required', value: {} },
      response(ok({ cases: 20, schema_pass_rate: 1.5, grounding_pass_rate: 1 }), 'rate above 1'),
    ],
  },
  'POST /ai/prompts/:key/versions/:v/activate': {
    valid: {
      params: { key: 'reply_draft', v: '3' },
      body: sensitive,
      response: ok({ key: 'reply_draft', version: 3, status: 'active' }),
    },
    invalid: [noConfirm(), response(ok({ key: 'reply_draft', version: 3 }), 'status missing')],
  },
  'POST /ai/prompts/:key/rollback': {
    valid: {
      params: { key: 'reply_draft' },
      body: { to_version: 2, reason: REASON, confirm: true },
      response: ok({ key: 'reply_draft', version: 2, status: 'active' }),
    },
    invalid: [
      { part: 'body', why: 'target version required', value: sensitive },
      response(ok({ key: 'x', version: 2, status: 'active' }), 'unknown key'),
    ],
  },
  'POST /ai/prompts/:key/versions/:v/archive': {
    valid: {
      params: { key: 'reply_draft', v: '1' },
      body: reasonOnly,
      response: ok({ key: 'reply_draft', version: 1, status: 'archived' }),
    },
    invalid: [
      { part: 'body', why: 'reason missing', value: {} },
      response(ok({ key: 'reply_draft', version: 1, status: 'deleted' }), 'unknown status'),
    ],
  },
  // ADM-10
  'GET /ai/feedback/aggregates': {
    valid: {
      query: { group_by: 'prompt_version' },
      response: ok([{ key: 'reply_draft@3', positive: 10, negative: 2, rate: 0.83 }]),
    },
    invalid: [
      { part: 'query', why: 'unknown grouping', value: { group_by: 'user' } },
      response(ok([{ key: 'k', positive: 1, negative: 1, rate: 2 }]), 'rate above 1'),
    ],
  },
  'GET /ai/feedback': {
    valid: {
      query: {},
      response: paged({
        id: uuid(108),
        feature: 'reply_draft',
        model: 'claude-sonnet-5',
        prompt_version: '3',
        rating: -1,
        reason_code: 'tone',
        created_at: TS,
      }),
    },
    invalid: [
      badPageSize,
      response(
        paged({
          id: uuid(108),
          feature: null,
          model: null,
          prompt_version: null,
          rating: -1,
          reason_code: null,
          created_at: TS,
          comment: 'metin',
        }),
        'comment hidden by default',
      ),
    ],
  },
  'POST /ai/feedback/:id/reveal': {
    valid: {
      params: { id: uuid(108) },
      body: reasonOnly,
      response: ok({ value: 'Ton çok resmi.', expires_in_s: 60 }),
    },
    invalid: [
      { part: 'body', why: 'reason too short', value: { reason: 'x' } },
      response(ok({ value: 'x' }), 'expiry missing'),
    ],
  },
  // ADM-11
  'GET /subscriptions/metrics': {
    valid: {
      query: {},
      response: ok({
        active_pro: 100,
        trials: 5,
        cancelled: 3,
        expired: 2,
        refunded: 0,
        by_store: { app_store: 60, play_store: 40 },
        by_product: { da_pro_monthly: 70 },
        renewal_rate: 0.9,
        store_pro: 95,
        grant_pro: 10,
        both: 5,
      }),
    },
    invalid: [badRange, response(ok({ active_pro: 1 }), 'metrics incomplete')],
  },
  'GET /subscriptions': {
    valid: {
      query: { 'filter[environment]': 'PRODUCTION' },
      response: paged({
        user_id: uuid(2),
        status: 'active',
        store: 'app_store',
        product_id: 'da_pro_monthly',
        period_type: 'normal',
        expires_at: TS_LATER,
        will_renew: true,
        source: 'store',
      }),
    },
    invalid: [
      { part: 'query', why: 'unknown environment', value: { 'filter[environment]': 'STAGING' } },
      response(
        paged({
          user_id: uuid(2),
          status: 'active',
          store: null,
          product_id: null,
          period_type: null,
          expires_at: null,
          will_renew: false,
          source: 'grant',
        }),
        'store list rows only',
      ),
    ],
  },
  'GET /subscriptions/events': {
    valid: {
      query: {},
      response: paged({
        event_id: 'evt_1',
        type: 'RENEWAL',
        environment: 'PRODUCTION',
        received_at: TS,
        processed: true,
      }),
    },
    invalid: [
      badPage,
      response(
        paged({
          event_id: 'evt_1',
          type: 'RENEWAL',
          environment: 'PRODUCTION',
          received_at: TS,
          processed: true,
          payload: {},
        }),
        'payload redacted',
      ),
    ],
  },
  'GET /subscriptions/trial-stream': {
    valid: {
      query: { range: '30d' },
      response: ok({
        events: [
          {
            event_id: 'evt_2',
            kind: 'trial_converted',
            email_masked: 'yu***@gmail.com',
            product_id: 'da_pro_annual',
            store: 'play_store',
            event_at: TS,
          },
        ],
        summary: { conversions: 3, trial_expirations: 1, conversion_rate: 0.75 },
      }),
    },
    invalid: [
      { part: 'query', why: 'unknown environment', value: { 'filter[environment]': 'TEST' } },
      response(
        ok({
          events: [
            {
              event_id: 'e',
              kind: 'trial_converted',
              email_masked: null,
              product_id: null,
              store: null,
              event_at: TS,
              price_usd: 9.99,
            },
          ],
          summary: { conversions: 0, trial_expirations: 0, conversion_rate: 0 },
        }),
        'no prices in the trial stream',
      ),
    ],
  },
  'GET /subscriptions/events/:id': {
    valid: {
      params: { id: 'evt_1' },
      response: ok({
        event_id: 'evt_1',
        type: 'INITIAL_PURCHASE',
        store: 'APP_STORE',
        environment: 'PRODUCTION',
        product_id: 'da_pro_monthly',
        period_type: 'TRIAL',
        purchased_at: TS,
        expiration_at: TS_LATER,
        event_at: TS,
        price_usd: 0,
        price_local: 0,
        currency: 'TRY',
        cancel_reason: null,
        expiration_reason: null,
        is_trial_conversion: false,
        received_at: TS,
        processed_at: TS,
        processing_error_code: null,
        job_id: uuid(70),
        user_id: uuid(2),
      }),
    },
    invalid: [
      { part: 'params', why: 'empty id', value: { id: '' } },
      response(
        ok({
          event_id: 'e',
          type: 't',
          store: null,
          environment: 'PRODUCTION',
          product_id: null,
          period_type: null,
          purchased_at: null,
          expiration_at: null,
          event_at: TS,
          price_usd: null,
          price_local: null,
          currency: null,
          cancel_reason: null,
          expiration_reason: null,
          is_trial_conversion: null,
          received_at: TS,
          processed_at: null,
          processing_error_code: null,
          job_id: null,
          user_id: null,
          subscriber_attributes: {},
        }),
        'subscriber_attributes are never returned',
      ),
    ],
  },
  'GET /entitlement-grants': {
    valid: {
      query: { 'filter[state]': 'active' },
      response: paged({
        ...grant,
        user_id: uuid(2),
        email_masked: 'yu***@gmail.com',
        revoked_by: null,
      }),
    },
    invalid: [
      { part: 'query', why: 'unknown state', value: { 'filter[state]': 'paused' } },
      response(
        paged({
          ...grant,
          user_id: uuid(2),
          email_masked: 'yu***@gmail.com',
          revoked_by: null,
          duration_days: 0,
        }),
        'duration below 1',
      ),
    ],
  },
  'POST /subscriptions/:userId/sync': {
    valid: { params: { userId: uuid(2) }, body: reasonOnly, response: ok({ job: jobRef }) },
    invalid: [
      { part: 'params', why: 'user id not a uuid', value: { userId: 'rc_1' } },
      response(ok({}), 'job missing'),
    ],
  },
  // ADM-12
  'GET /referrals/metrics': {
    valid: {
      query: {},
      response: ok({
        invites: 20,
        signups: 10,
        qualified: 6,
        rewarded: 5,
        conversion: 0.5,
        bonus_days_granted: 140,
        flagged: 1,
      }),
    },
    invalid: [badRange, response(ok({ invites: 1 }), 'metrics incomplete')],
  },
  'GET /referrals': {
    valid: {
      query: { 'filter[status]': 'flagged' },
      response: paged({
        id: uuid(77),
        code: 'AB3K7M9Q',
        referrer_id: uuid(2),
        referee_id: uuid(4),
        status: 'flagged',
        risk_score: 0.8,
        signals_summary: ['same_device'],
        created_at: TS,
      }),
    },
    invalid: [
      { part: 'query', why: 'unknown status', value: { 'filter[status]': 'fraud' } },
      response(
        paged({
          id: uuid(77),
          code: 'c',
          referrer_id: uuid(2),
          referee_id: uuid(4),
          status: 'flagged',
          risk_score: 1.5,
          signals_summary: [],
          created_at: TS,
        }),
        'risk above 1',
      ),
    ],
  },
  'POST /referrals/:id/approve': {
    valid: {
      params: { id: uuid(77) },
      body: sensitive,
      response: ok({ id: uuid(77), status: 'rewarded' }),
    },
    invalid: [noConfirm(), response(ok({ id: uuid(77), status: 'approved' }), 'unknown status')],
  },
  'POST /referrals/:id/reject': {
    valid: {
      params: { id: uuid(77) },
      body: sensitive,
      response: ok({ id: uuid(77), status: 'rejected' }),
    },
    invalid: [shortReason(), response(ok({ status: 'rejected' }), 'id missing')],
  },
  // ADM-13
  'GET /feedback': {
    valid: {
      query: { 'filter[type]': 'ai_quality' },
      response: paged({
        id: uuid(83),
        type: 'ai_quality',
        rating: 2,
        message: 'Özet eksik.',
        screen: 'M-TD-01',
        status: 'new',
        platform: 'ios',
        app_version: '1.0.0',
        assignee: null,
        user_email_masked: 'yu***@gmail.com',
        created_at: TS,
      }),
    },
    invalid: [
      {
        part: 'query',
        why: 'app version must be semver',
        value: { 'filter[app_version]': 'latest' },
      },
      response(
        paged({
          id: uuid(83),
          type: 'praise',
          rating: null,
          message: null,
          screen: null,
          status: 'new',
          platform: null,
          app_version: null,
          assignee: null,
          user_email_masked: null,
          created_at: TS,
        }),
        'unknown feedback type',
      ),
    ],
  },
  'GET /feedback/summary': {
    valid: {
      query: { 'filter[platform]': 'android' },
      response: ok({
        by_type: { bug: 3, feature: 2, general: 1, ai_quality: 4 },
        rating_distribution: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, unrated: 0 },
        by_app_version: [{ app_version: '1.0.0', count: 10 }],
        by_status: { new: 5, triaged: 3, planned: 1, closed: 1 },
      }),
    },
    invalid: [
      { part: 'query', why: 'unknown platform', value: { 'filter[platform]': 'web' } },
      response(
        ok({
          by_type: { bug: 0, feature: 0, general: 0, ai_quality: 0 },
          rating_distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unrated: 0 },
          by_app_version: [],
          by_status: { new: 0, triaged: 0, planned: 0, closed: 0 },
          latest_message: 'x',
        }),
        'no message field in the summary',
      ),
    ],
  },
  'PATCH /feedback/:id': {
    valid: {
      params: { id: uuid(83) },
      body: { status: 'triaged' },
      response: ok({
        id: uuid(83),
        type: 'bug',
        rating: null,
        message: 'm',
        screen: null,
        status: 'triaged',
        platform: 'ios',
        app_version: '1.0.0',
        assignee: null,
        user_email_masked: null,
        created_at: TS,
      }),
    },
    invalid: [
      { part: 'body', why: 'status outside the DB check', value: { status: 'done' } },
      response(ok({ id: uuid(83) }), 'row incomplete'),
    ],
  },
  'POST /feedback/:id/reveal': {
    valid: {
      params: { id: uuid(83) },
      body: reasonOnly,
      response: ok({ value: 'Özet eksik, yunus@gmail.com', expires_in_s: 60 }),
    },
    invalid: [
      { part: 'body', why: 'reason missing', value: {} },
      response(ok({ value: 1, expires_in_s: 60 }), 'value must be text'),
    ],
  },
  // ADM-14
  'GET /flags': {
    valid: { query: { 'filter[archived]': 'true' }, response: ok([flagRow]) },
    invalid: [
      { part: 'query', why: 'flag must be true|false', value: { 'filter[archived]': 'yes' } },
      response(ok([{ ...flagRow, rollout_percent: 150 }]), 'rollout above 100'),
    ],
  },
  'GET /flags/:key': {
    valid: {
      params: { key: 'feature.midday' },
      response: ok({
        ...flagRow,
        description: 'Öğle özeti',
        is_kill_switch: true,
        archived_at: null,
        overrides: [],
        history: [
          {
            ts: TS,
            actor: 'op***@x.app',
            action: 'admin.flag.updated',
            reason: REASON,
            before: {},
            after: {},
          },
        ],
      }),
    },
    invalid: [
      { part: 'params', why: 'upper-case key', value: { key: 'Feature.Midday' } },
      response(ok({ ...flagRow }), 'detail fields missing'),
    ],
  },
  'GET /flags/:key/evaluate': {
    valid: {
      params: { key: 'feature.midday' },
      query: { user_id: uuid(2), platform: 'ios' },
      response: ok({
        key: 'feature.midday',
        user_id: uuid(2),
        value: true,
        matched_rule: 'plan',
        bucket: 42,
      }),
    },
    invalid: [
      { part: 'query', why: 'user id required', value: { platform: 'ios' } },
      response(
        ok({
          key: 'feature.midday',
          user_id: uuid(2),
          value: true,
          matched_rule: 'plan',
          bucket: 100,
        }),
        'bucket is 0–99',
      ),
    ],
  },
  'POST /flags': {
    valid: {
      body: {
        key: 'ai.budget.org_daily_usd',
        description: 'Kurum günlük AI bütçesi',
        enabled: false,
        payload: { usd: 50 },
        reason: REASON,
      },
      response: ok(flagRow),
    },
    invalid: [
      {
        part: 'body',
        why: 'new flags start disabled',
        value: { key: 'feature.x', description: 'd', enabled: true, reason: REASON },
      },
      {
        part: 'body',
        why: 'payload fails its key schema',
        value: {
          key: 'ai.budget.org_daily_usd',
          description: 'd',
          enabled: false,
          payload: { usd: -1 },
          reason: REASON,
        },
      },
      response(ok({ ...flagRow, key: 'Bad Key' }), 'key format'),
    ],
  },
  'PATCH /flags/:key': {
    valid: {
      params: { key: 'feature.midday' },
      body: { rollout_percent: 50, reason: REASON },
      response: ok(flagRow),
    },
    invalid: [
      { part: 'body', why: 'reason required', value: { rollout_percent: 50 } },
      response(ok({ ...flagRow, platforms: ['web'] }), 'unknown platform'),
    ],
  },
  'POST /flags/:key/kill': {
    valid: {
      params: { key: 'ai.global.enabled' },
      body: sensitive,
      response: ok({ ...flagRow, key: 'ai.global.enabled', enabled: false }),
    },
    invalid: [noConfirm(), response(ok({ key: 'ai.global.enabled' }), 'row incomplete')],
  },
  'POST /flags/:key/archive': {
    valid: {
      params: { key: 'feature.old_banner' },
      body: sensitive,
      response: ok({ ...flagRow, key: 'feature.old_banner', enabled: false }),
    },
    invalid: [shortReason(), response(ok({ ...flagRow, updated_at: 'now' }), 'bad timestamp')],
  },
  'POST /flags/:key/overrides': {
    valid: {
      params: { key: 'feature.midday' },
      body: { user_id: uuid(2), enabled: true, reason: REASON },
      response: ok({ key: 'feature.midday', user_id: uuid(2), enabled: true }),
    },
    invalid: [
      { part: 'body', why: 'user id required', value: { enabled: true, reason: REASON } },
      response(ok({ key: 'feature.midday', enabled: true }), 'user id missing'),
    ],
  },
  'DELETE /flags/:key/overrides/:userId': {
    valid: {
      params: { key: 'feature.midday', userId: uuid(2) },
      body: {},
      response: ok({ key: 'feature.midday', user_id: uuid(2), enabled: null }),
    },
    invalid: [
      { part: 'params', why: 'user id not a uuid', value: { key: 'feature.midday', userId: 'me' } },
      response(
        ok({ key: 'feature.midday', user_id: uuid(2), enabled: 'removed' }),
        'enabled is boolean or null',
      ),
    ],
  },
  // ADM-15
  'GET /announcements': {
    valid: { query: { 'filter[status]': 'live' }, response: paged(announcementRow) },
    invalid: [
      { part: 'query', why: 'unknown status', value: { 'filter[status]': 'paused' } },
      response(paged({ ...announcementRow, audience: 'vip' }), 'unknown audience'),
    ],
  },
  'POST /announcements/audience-estimate': {
    valid: {
      body: { audience: 'free', platforms: ['android'] },
      response: ok({ estimated_users: 1200 }),
    },
    invalid: [
      { part: 'body', why: 'platforms required', value: { audience: 'free', platforms: [] } },
      response(ok({ estimated_users: -5 }), 'negative estimate'),
    ],
  },
  'GET /announcements/:id': {
    valid: {
      params: { id: uuid(3) },
      response: ok({
        ...announcementRow,
        body_tr: 'b',
        body_en: 'b',
        min_version: null,
        max_version: null,
        cta_route: null,
        published_at: TS,
        cancelled_at: null,
        dismissal_count: 12,
        created_by: 'ops',
        updated_at: TS,
      }),
    },
    invalid: [
      badId,
      response(ok({ ...announcementRow, status: 'published' }), 'unknown derived status'),
    ],
  },
  'POST /announcements': {
    valid: { body: announcementBody, response: ok({ ...announcementRow, status: 'draft' }) },
    invalid: [
      {
        part: 'body',
        why: 'cta_route outside the app routes',
        value: { ...announcementBody, cta_route: 'https://evil.example.com' },
      },
      {
        part: 'body',
        why: 'ends before it starts',
        value: { ...announcementBody, ends_at: '2026-09-23T08:00:00Z' },
      },
      response(ok({ ...announcementRow, status: 'queued' }), 'unknown status'),
    ],
  },
  'PATCH /announcements/:id': {
    valid: {
      params: { id: uuid(3) },
      body: { body_tr: 'Güncellendi.' },
      response: ok(announcementRow),
    },
    invalid: [
      { part: 'body', why: 'no changes', value: {} },
      response(ok({ id: uuid(3) }), 'row incomplete'),
    ],
  },
  'POST /announcements/:id/preview': {
    valid: {
      params: { id: uuid(3) },
      body: { locale: 'tr', platform: 'ios' },
      response: ok({
        id: uuid(3),
        title: 'Yeni',
        body: 'Öğle özeti',
        cta_route: null,
        ends_at: null,
      }),
    },
    invalid: [
      { part: 'body', why: 'unknown locale', value: { locale: 'de', platform: 'ios' } },
      response(ok({ id: uuid(3), title: 'Yeni' }), 'card incomplete'),
    ],
  },
  'POST /announcements/:id/schedule': {
    valid: {
      params: { id: uuid(3) },
      body: reasonOnly,
      response: ok({ ...announcementRow, status: 'scheduled' }),
    },
    invalid: [
      { part: 'body', why: 'reason missing', value: {} },
      response(ok({ ...announcementRow, platforms: 'ios' }), 'platforms must be a list'),
    ],
  },
  'POST /announcements/:id/cancel': {
    valid: {
      params: { id: uuid(3) },
      body: reasonOnly,
      response: ok({ ...announcementRow, status: 'cancelled' }),
    },
    invalid: [
      { part: 'body', why: 'reason too short', value: { reason: 'iptal' } },
      response(ok({ ...announcementRow, status: 'removed' }), 'unknown status'),
    ],
  },
  // ADM-16
  'GET /data-requests': {
    valid: {
      query: { tab: 'exports', 'filter[status]': 'ready' },
      response: paged(dataRequestRow),
    },
    invalid: [
      { part: 'query', why: 'tab required', value: {} },
      response(paged({ ...dataRequestRow, status: 'deleted' }), 'unknown status'),
    ],
  },
  'POST /data-requests/export/:id/regenerate': {
    valid: {
      params: { id: uuid(78) },
      body: sensitive,
      response: ok({ export_request_id: uuid(109), job_id: uuid(70) }),
    },
    invalid: [
      noConfirm(),
      response(
        ok({
          export_request_id: uuid(109),
          job_id: uuid(70),
          signed_url: 'https://x.test/file.zip',
        }),
        'the admin never receives the file',
      ),
    ],
  },
  'GET /data-requests/:kind/:id': {
    valid: {
      params: { kind: 'account_deletion', id: uuid(81) },
      response: ok({
        ...dataRequestRow,
        kind: 'account_deletion',
        status: 'processing',
        job: { id: uuid(70), status: 'running', progress: { step: 3 } },
        steps: [
          { step: 'provider_revoke', status: 'warning', detail_code: 'graph_local_only', at: TS },
        ],
      }),
    },
    invalid: [
      { part: 'params', why: 'unknown kind', value: { kind: 'purge', id: uuid(81) } },
      response(
        ok({
          ...dataRequestRow,
          job: null,
          steps: [{ step: 's', status: 'fake_done', detail_code: null, at: null }],
        }),
        'unknown step status',
      ),
    ],
  },
  'POST /data-requests/:kind/:id/retry': {
    valid: {
      params: { kind: 'history_deletion', id: uuid(79) },
      body: sensitive,
      response: ok({ id: uuid(79), job_id: uuid(70) }),
    },
    invalid: [shortReason(), response(ok({ id: uuid(79) }), 'job missing')],
  },
  // ADM-17
  'GET /audit': {
    valid: {
      query: { 'filter[action]': 'admin.pii.revealed', 'filter[from]': TS },
      response: paged(auditRow),
    },
    invalid: [
      { part: 'query', why: 'from must be a timestamp', value: { 'filter[from]': 'yesterday' } },
      response(paged({ ...auditRow, result: 'ok' }), 'unknown result'),
    ],
  },
  'GET /audit/verify-chain': {
    valid: {
      query: { from: TS, to: TS_LATER },
      response: ok({ verified: false, first_broken_id: uuid(103) }),
    },
    invalid: [
      { part: 'query', why: 'range reversed', value: { from: TS_LATER, to: TS } },
      response(ok({ first_broken_id: uuid(103) }), 'verified missing'),
    ],
  },
  'GET /audit/:id': {
    valid: {
      params: { id: uuid(103) },
      response: ok({
        id: uuid(103),
        chain_seq: 1042,
        ts: TS,
        actor_type: 'admin',
        actor: 'op***@dijitalasistan.app',
        role: 'operations',
        action: 'admin.job.retried',
        target_type: 'job',
        target_id: uuid(70),
        target_user: 'deleted:ab12',
        reason: REASON,
        result: 'success',
        correlation_id: 'corr-12345678',
        metadata: {},
        prev_hash: SHA,
        hash: SHA,
      }),
    },
    invalid: [
      badId,
      response(
        ok({
          id: uuid(103),
          chain_seq: 1,
          ts: TS,
          actor_type: 'admin',
          actor: 'a',
          role: null,
          action: 'x',
          target_type: null,
          target_id: null,
          target_user: null,
          reason: null,
          result: 'success',
          correlation_id: null,
          metadata: {},
          prev_hash: null,
          hash: SHA,
          ua_hash: SHA,
        }),
        'ua_hash is never returned',
      ),
    ],
  },
  // ADM-18
  'GET /health/summary': {
    valid: {
      response: ok({
        components: [
          {
            component: 'ai_voyage',
            status: 'external_credential_required',
            latency_ms: null,
            checked_at: TS,
            detail_code: 'voyage_key_missing',
          },
        ],
        credential_expiry: [
          { key: 'MICROSOFT_CERT_NOT_AFTER', not_after: TS_LATER, days_left: 200 },
        ],
      }),
    },
    invalid: [
      response(
        ok({
          components: [
            {
              component: 'database',
              status: 'green',
              latency_ms: 1,
              checked_at: TS,
              detail_code: null,
            },
          ],
          credential_expiry: [],
        }),
        'unknown status',
      ),
    ],
  },
  'GET /health/history': {
    valid: {
      query: { component: 'gmail', range: '7d' },
      response: ok([
        {
          checked_at: TS,
          component: 'gmail',
          status: 'degraded',
          latency_ms: 400,
          detail_code: 'error_rate',
          checked_by: 'cron',
        },
      ]),
    },
    invalid: [
      {
        part: 'query',
        why: '90d is not a history range',
        value: { component: 'gmail', range: '90d' },
      },
      { part: 'query', why: 'unknown component', value: { component: 'redis' } },
      response(
        ok([
          {
            checked_at: TS,
            component: 'gmail',
            status: 'down',
            latency_ms: null,
            detail_code: null,
            checked_by: 'cron',
            url: 'https://x',
          },
        ]),
        'never URLs',
      ),
    ],
  },
  'POST /health/run': {
    valid: { body: { probes: ['database', 'cron'] }, response: ok({ results: [healthResult] }) },
    invalid: [
      { part: 'body', why: 'unknown probe', value: { probes: ['redis'] } },
      response(ok({ results: [{ ...healthResult, status: 'ok' }] }), 'unknown status'),
    ],
  },
  'GET /health/app-versions': {
    valid: {
      query: {},
      response: ok({
        versions: [
          {
            platform: 'ios',
            app_version: '1.0.0',
            installations: 100,
            sync_error_rate: 0.01,
            below_minimum: false,
          },
        ],
      }),
    },
    invalid: [
      badRange,
      response(
        ok({
          versions: [
            {
              platform: 'web',
              app_version: '1',
              installations: 1,
              sync_error_rate: 0,
              below_minimum: false,
            },
          ],
        }),
        'unknown platform',
      ),
    ],
  },
  'GET /health/cron': {
    valid: {
      response: ok({
        schedules: [
          { name: 'scheduler_tick', last_run_at: TS, duration_ms: 120, status: 'succeeded' },
        ],
        worker_lag_s: 3,
      }),
    },
    invalid: [response(ok({ schedules: [], worker_lag_s: -1 }), 'negative lag')],
  },
  // ADM-19
  'GET /admins': {
    valid: { response: ok([adminUserRow]) },
    invalid: [response(ok([{ ...adminUserRow, role: 'owner' }]), 'unknown role')],
  },
  'POST /admins/invite': {
    valid: {
      body: {
        email: 'new@dijitalasistan.app',
        full_name: 'Yeni Admin',
        role: 'support',
        reason: REASON,
      },
      response: ok({
        ...adminUserRow,
        status: 'invited',
        last_login_at: null,
        mfa_enrolled: false,
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'passwords do not exist (R-08)',
        value: {
          email: 'new@dijitalasistan.app',
          full_name: 'Yeni',
          role: 'support',
          reason: REASON,
          password: 'x',
        },
      },
      response(ok({ ...adminUserRow, status: 'pending' }), 'unknown status'),
    ],
  },
  'PATCH /admins/:id': {
    valid: {
      params: { id: uuid(100) },
      body: { role: 'readonly', reason: REASON, confirm: true },
      response: ok({ ...adminUserRow, role: 'readonly' }),
    },
    invalid: [
      { part: 'body', why: 'unknown role', value: { role: 'root', reason: REASON, confirm: true } },
      response(ok({ ...adminUserRow, email: 'x' }), 'bad email'),
    ],
  },
  'POST /admins/:id/disable': {
    valid: {
      params: { id: uuid(100) },
      body: sensitive,
      response: ok({ ...adminUserRow, status: 'disabled' }),
    },
    invalid: [noConfirm(), response(ok({ ...adminUserRow, status: 'inactive' }), 'unknown status')],
  },
  'POST /admins/:id/enable': {
    valid: { params: { id: uuid(100) }, body: sensitive, response: ok(adminUserRow) },
    invalid: [
      shortReason(),
      response(ok({ ...adminUserRow, mfa_enrolled: 'yes' }), 'boolean expected'),
    ],
  },
  'POST /admins/:id/revoke-sessions': {
    valid: { params: { id: uuid(100) }, body: reasonOnly, response: ok({ ended_sessions: 2 }) },
    invalid: [
      { part: 'body', why: 'reason missing', value: {} },
      response(ok({ ended_sessions: 'all' }), 'count expected'),
    ],
  },
  'POST /admins/:id/resend-invite': {
    valid: {
      params: { id: uuid(100) },
      body: reasonOnly,
      response: ok({ ...adminUserRow, status: 'invited' }),
    },
    invalid: [
      { part: 'body', why: 'reason too short', value: { reason: 'tekrar' } },
      response(ok({ id: uuid(100) }), 'row incomplete'),
    ],
  },
  'POST /admins/:id/reset-mfa': {
    valid: {
      params: { id: uuid(100) },
      body: sensitive,
      response: ok({ ...adminUserRow, mfa_enrolled: false }),
    },
    invalid: [
      noConfirm(),
      response(ok({ ...adminUserRow, last_login_at: 'never' }), 'bad timestamp'),
    ],
  },
  'POST /admins/:id/unlock': {
    valid: { params: { id: uuid(100) }, body: reasonOnly, response: ok(adminUserRow) },
    invalid: [
      { part: 'params', why: 'id not a uuid', value: { id: 'admin' } },
      response(ok({}), 'row missing'),
    ],
  },
  // ADM-20
  'GET /settings': {
    valid: {
      response: ok({
        plan_limits: {
          free: { max_mail_accounts: 1, ai_daily_budget_units: 50, ai_routing_profile: 'lean' },
          pro: {
            max_mail_accounts: 10,
            ai_daily_budget_units: null,
            ai_routing_profile: 'balanced',
          },
        },
        app_settings: { 'app.min_supported_version': { ios: '1.0.0', android: '1.0.0' } },
      }),
    },
    invalid: [
      response(
        ok({ plan_limits: { free: { max_mail_accounts: -1 }, pro: {} }, app_settings: {} }),
        'negative limit',
      ),
    ],
  },
  'PATCH /settings/plan-limits': {
    valid: {
      body: {
        plan: 'free',
        key: 'ai_daily_budget_units',
        value: 50,
        reason: REASON,
        confirm: true,
      },
      response: ok({ key: 'ai_daily_budget_units', before: 40, after: 50 }),
    },
    invalid: [
      {
        part: 'body',
        why: 'unknown plan limit key',
        value: { plan: 'free', key: 'max_everything', value: true, reason: REASON, confirm: true },
      },
      {
        part: 'body',
        why: 'value out of range',
        value: {
          plan: 'pro',
          key: 'ai_briefing_reserve_pct',
          value: 150,
          reason: REASON,
          confirm: true,
        },
      },
      {
        part: 'body',
        why: 'Free always has a unit budget',
        value: {
          plan: 'free',
          key: 'ai_daily_budget_units',
          value: null,
          reason: REASON,
          confirm: true,
        },
      },
      response(ok({ before: 1, after: 2 }), 'key missing'),
    ],
  },
  'PATCH /settings/config/:key': {
    valid: {
      params: { key: 'referral.reward_days' },
      body: { value: 14, reason: REASON, confirm: true },
      response: ok({ key: 'referral.reward_days', before: 14, after: 14 }),
    },
    invalid: [
      { part: 'params', why: 'key must be dotted', value: { key: 'reward' } },
      noConfirm({ value: 1 }),
      response(ok({ before: 1 }), 'key missing'),
    ],
  },
  // ADM-21
  'GET /search': {
    valid: {
      query: { q: 'DA-7K3M9Q' },
      response: ok({
        results: [
          {
            type: 'ticket',
            id: uuid(82),
            label: 'DA-7K3M9Q · Senkron',
            route: `/support/${uuid(82)}`,
          },
        ],
      }),
    },
    invalid: [
      { part: 'query', why: 'query under 3 chars', value: { q: 'yu' } },
      response(
        ok({ results: [{ type: 'email', id: 'x', label: 'l', route: '/x' }] }),
        'email content is never a result',
      ),
    ],
  },
} satisfies Record<AdminRouteKey, RouteFixture>;
