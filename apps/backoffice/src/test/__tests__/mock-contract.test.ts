import { adminRoutes } from '@da/validation';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  accessDenied,
  handleModule,
  permissionsOf,
  resetData,
  type Ctx,
  type RouteKey,
} from '../../../e2e/mock-admin';
import {
  DEAD_JOB_ID,
  FAILED_BRIEFING_ID,
  FAILED_EXPORT_ID,
  FLAGGED_REFERRAL_ID,
  INVITED_ADMIN_ID,
  MAIN_USER_ID,
  SUPPORT_ADMIN_ID,
  TICKET_ID,
  uid,
} from '../../../e2e/mock-data';

/*
 * The Playwright mock admin-api must speak the real contract (BACKOFFICE_PLAN §13.4): every read
 * and every mutation the backoffice uses is answered with a body that parses with the route's own
 * `@da/validation` response schema, requests are validated with the route's request schemas, and
 * the permission rules follow the registry `access` block.
 */

const NOW = Date.parse('2026-09-24T09:00:00Z');
const REASON = 'Destek talebi DA-10240 için gerekli işlem';
const SESSION_ROUTES = new Set<string>([
  'GET /me',
  'GET /preferences',
  'GET /auth/status',
  // Needs an active grant of the caller; covered by the Support Access flow below.
  'GET /support-access/grants/:id/content/:scope',
]);

interface Sample {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

const READS: Partial<Record<RouteKey, Sample>> = {
  'GET /dashboard/charts': { query: { series: 'ai_costs' } },
  'GET /search': { query: { q: 'yusuf' } },
  'GET /users/:id': { params: { id: MAIN_USER_ID } },
  'GET /users/:id/integrations': { params: { id: MAIN_USER_ID } },
  'GET /users/:id/briefings': { params: { id: MAIN_USER_ID } },
  'GET /users/:id/usage': { params: { id: MAIN_USER_ID } },
  'GET /users/:id/subscription': { params: { id: MAIN_USER_ID } },
  'GET /users/:id/referrals': { params: { id: MAIN_USER_ID } },
  'GET /users/:id/support': { params: { id: MAIN_USER_ID } },
  'GET /users/:id/audit': { params: { id: MAIN_USER_ID } },
  'GET /users/:id/devices': { params: { id: MAIN_USER_ID } },
  'GET /notifications/test-push/preview': { query: { user_id: MAIN_USER_ID } },
  'GET /dashboard/metrics': { query: { platform: 'ios' } },
  'GET /support/tickets/:id': { params: { id: TICKET_ID } },
  'GET /integrations/:accountId': { params: { accountId: uid('3333', 1) } },
  'GET /jobs/:id': { params: { id: DEAD_JOB_ID } },
  'GET /correlation/:id': { params: { id: 'corr-00000001-00' } },
  'GET /ai/prompts/:key': { params: { key: 'briefing_morning' } },
  'GET /ai/prompts/:key/diff': {
    params: { key: 'briefing_morning' },
    query: { from: '2', to: '3' },
  },
  'GET /ai/prompts/:key/versions/:v': { params: { key: 'briefing_morning', v: '3' } },
  'GET /subscriptions/events/:id': { params: { id: 'evt_0001' } },
  'GET /flags/:key': { params: { key: 'feature.voice' } },
  'GET /flags/:key/evaluate': {
    params: { key: 'feature.voice' },
    query: { user_id: MAIN_USER_ID },
  },
  'GET /announcements/:id': { params: { id: uid('cccc', 1) } },
  'GET /data-requests': { query: { tab: 'exports' } },
  'GET /data-requests/:kind/:id': { params: { kind: 'export', id: FAILED_EXPORT_ID } },
  'GET /audit/verify-chain': {
    query: { from: '2026-09-23T09:00:00Z', to: '2026-09-24T09:00:00Z' },
  },
  'GET /audit/:id': { params: { id: uid('eeee', 1) } },
  'GET /health/history': { query: { component: 'microsoft_graph' } },
};

const WRITES: [RouteKey, Sample][] = [
  ['POST /users/lookup', { body: { email: 'yusuf.demir@gmail.com' } }],
  [
    'POST /users/:id/reveal',
    { params: { id: MAIN_USER_ID }, body: { field: 'email', reason: REASON, confirm: true } },
  ],
  [
    'POST /users/:id/reveal',
    {
      params: { id: MAIN_USER_ID },
      body: { field: 'display_name', reason: REASON, confirm: true },
    },
  ],
  [
    'POST /users/:id/force-sync',
    { params: { id: MAIN_USER_ID }, body: { reason: REASON, confirm: true, resources: ['mail'] } },
  ],
  [
    'POST /users/:id/entitlement-grants',
    {
      params: { id: MAIN_USER_ID },
      body: { duration_days: 7, source: 'support', reason: REASON, confirm: true },
    },
  ],
  [
    'POST /users/:id/entitlement-grants/:grantId/revoke',
    {
      params: { id: MAIN_USER_ID, grantId: uid('9999', 1) },
      body: { reason: REASON, confirm: true },
    },
  ],
  [
    'POST /users/:id/integrations/:accountId/disconnect',
    {
      params: { id: MAIN_USER_ID, accountId: uid('3333', 2) },
      body: { reason: REASON, confirm: true, purge_content: false },
    },
  ],
  [
    'POST /users/:id/internal',
    { params: { id: MAIN_USER_ID }, body: { internal: true, reason: REASON } },
  ],
  [
    'POST /users/:id/disable',
    { params: { id: MAIN_USER_ID }, body: { reason: REASON, confirm: true } },
  ],
  [
    'POST /users/:id/restore',
    { params: { id: MAIN_USER_ID }, body: { reason: REASON, confirm: true } },
  ],
  [
    'PATCH /support/tickets/:id',
    {
      params: { id: TICKET_ID },
      body: { status: 'in_progress', assignee_admin_id: SUPPORT_ADMIN_ID },
    },
  ],
  [
    'POST /support/tickets/:id/notes',
    { params: { id: TICKET_ID }, body: { body: 'Hesap bağlantısı kontrol edildi.' } },
  ],
  [
    'POST /support/tickets/:id/reply',
    { params: { id: TICKET_ID }, body: { body: 'Merhaba, sorunu inceliyoruz.' } },
  ],
  [
    'POST /support-access/grants',
    {
      body: {
        user_id: MAIN_USER_ID,
        scopes: ['email_metadata'],
        reason: REASON,
        duration_minutes: 15,
      },
    },
  ],
  [
    'POST /support-access/grants/:id/revoke',
    { params: { id: uid('ffff', 1) }, body: { reason: REASON } },
  ],
  [
    'POST /integrations/:accountId/force-sync',
    { params: { accountId: uid('3333', 1) }, body: { reason: REASON, confirm: true } },
  ],
  [
    'POST /integrations/:accountId/renew-watch',
    { params: { accountId: uid('3333', 1) }, body: { reason: REASON, confirm: true } },
  ],
  [
    'POST /jobs/:id/retry',
    { params: { id: DEAD_JOB_ID }, body: { reason: REASON, confirm: true, reset_attempts: false } },
  ],
  [
    'POST /jobs/:id/cancel',
    { params: { id: uid('4444', 8) }, body: { reason: REASON, confirm: true } },
  ],
  [
    'POST /jobs/retry-bulk',
    {
      body: {
        filter: {
          type: 'gmail_sync',
          status: 'dead_letter',
          from: '2026-09-17T00:00:00Z',
          to: '2026-09-25T00:00:00Z',
        },
        max: 10,
        reason: REASON,
        confirm: true,
      },
    },
  ],
  [
    'POST /jobs/retry-bulk',
    { body: { job_ids: [uid('4444', 1), uid('4444', 2)], reason: REASON, confirm: true } },
  ],
  [
    'POST /briefings/:id/regenerate',
    { params: { id: FAILED_BRIEFING_ID }, body: { reason: REASON, confirm: true } },
  ],
  [
    'POST /notifications/test-push',
    { body: { user_id: MAIN_USER_ID, reason: REASON, confirm: true } },
  ],
  [
    'PATCH /ai/models/:profile/:feature',
    {
      params: { profile: 'balanced', feature: 'email_triage' },
      body: { enabled: true, expected_version: 3, reason: REASON, confirm: true },
    },
  ],
  [
    'POST /ai/models/:profile/:feature/test',
    { params: { profile: 'balanced', feature: 'email_triage' }, body: { fixture_set: 'golden' } },
  ],
  [
    'PATCH /ai/routing-profile',
    { body: { plan: 'free', profile: 'balanced', reason: REASON, confirm: true } },
  ],
  [
    'PATCH /ai/prompts/:key/versions/:v',
    { params: { key: 'briefing_morning', v: '3' }, body: { notes: 'Güncellendi' } },
  ],
  [
    'POST /ai/prompts/:key/versions/:v/test',
    { params: { key: 'briefing_morning', v: '3' }, body: { fixture_set: 'golden' } },
  ],
  [
    'POST /ai/prompts/:key/versions/:v/activate',
    { params: { key: 'briefing_morning', v: '3' }, body: { reason: REASON, confirm: true } },
  ],
  [
    'POST /ai/prompts/:key/rollback',
    { params: { key: 'briefing_morning' }, body: { to_version: 2, reason: REASON, confirm: true } },
  ],
  [
    'POST /ai/prompts/:key/versions/:v/archive',
    { params: { key: 'briefing_morning', v: '3' }, body: { reason: REASON } },
  ],
  [
    'POST /ai/prompts/:key/versions',
    {
      params: { key: 'thread_summary' },
      body: {
        template_system: 'Sistem',
        template_user: 'Kullanıcı {{items_json}}',
        output_schema: 'ThreadSummaryV1',
      },
    },
  ],
  ['POST /ai/feedback/:id/reveal', { params: { id: uid('1414', 2) }, body: { reason: REASON } }],
  [
    'POST /subscriptions/:userId/sync',
    { params: { userId: MAIN_USER_ID }, body: { reason: REASON } },
  ],
  [
    'POST /referrals/:id/approve',
    { params: { id: FLAGGED_REFERRAL_ID }, body: { reason: REASON, confirm: true } },
  ],
  [
    'POST /referrals/:id/reject',
    { params: { id: uid('aaaa', 4) }, body: { reason: REASON, confirm: true } },
  ],
  ['PATCH /feedback/:id', { params: { id: uid('bbbb', 1) }, body: { status: 'triaged' } }],
  ['POST /feedback/:id/reveal', { params: { id: uid('bbbb', 1) }, body: { reason: REASON } }],
  [
    'POST /flags',
    {
      body: {
        key: 'feature.smart_folders',
        description: 'Akıllı klasörler',
        enabled: false,
        reason: REASON,
      },
    },
  ],
  [
    'PATCH /flags/:key',
    { params: { key: 'feature.voice' }, body: { rollout_percent: 50, reason: REASON } },
  ],
  [
    'POST /flags/:key/kill',
    { params: { key: 'feature.voice' }, body: { reason: REASON, confirm: true } },
  ],
  [
    'POST /flags/:key/kill',
    { params: { key: 'feature.voice' }, body: { on: false, reason: REASON, confirm: true } },
  ],
  [
    'POST /flags/:key/overrides',
    {
      params: { key: 'feature.midday' },
      body: { user_id: MAIN_USER_ID, enabled: true, reason: REASON },
    },
  ],
  [
    'DELETE /flags/:key/overrides/:userId',
    { params: { key: 'feature.voice', userId: MAIN_USER_ID } },
  ],
  [
    'POST /flags/:key/archive',
    { params: { key: 'feature.smart_folders' }, body: { reason: REASON, confirm: true } },
  ],
  [
    'POST /announcements',
    {
      body: {
        title_tr: 'Başlık',
        title_en: 'Title',
        body_tr: 'Gövde',
        body_en: 'Body',
        audience: 'all',
        platforms: ['ios'],
        starts_at: '2026-09-30T09:00:00Z',
      },
    },
  ],
  [
    'POST /announcements/audience-estimate',
    { body: { audience: 'pro', platforms: ['ios', 'android'] } },
  ],
  [
    'PATCH /announcements/:id',
    { params: { id: uid('cccc', 2) }, body: { title_tr: 'Bakım duyurusu' } },
  ],
  [
    'POST /announcements/:id/preview',
    { params: { id: uid('cccc', 2) }, body: { locale: 'tr', platform: 'ios' } },
  ],
  [
    'POST /announcements/:id/schedule',
    { params: { id: uid('cccc', 2) }, body: { reason: REASON } },
  ],
  ['POST /announcements/:id/cancel', { params: { id: uid('cccc', 1) }, body: { reason: REASON } }],
  [
    'POST /data-requests/:kind/:id/retry',
    { params: { kind: 'export', id: FAILED_EXPORT_ID }, body: { reason: REASON, confirm: true } },
  ],
  [
    'POST /data-requests/export/:id/regenerate',
    { params: { id: uid('dddd', 2) }, body: { reason: REASON, confirm: true } },
  ],
  ['POST /health/run', { body: {} }],
  [
    'POST /admins/invite',
    {
      body: {
        email: 'yeni@dijitalasistan.app',
        full_name: 'Yeni Yönetici',
        role: 'readonly',
        reason: REASON,
      },
    },
  ],
  [
    'PATCH /admins/:id',
    {
      params: { id: SUPPORT_ADMIN_ID },
      body: { role: 'operations', reason: REASON, confirm: true },
    },
  ],
  [
    'POST /admins/:id/disable',
    { params: { id: SUPPORT_ADMIN_ID }, body: { reason: REASON, confirm: true } },
  ],
  [
    'POST /admins/:id/enable',
    { params: { id: SUPPORT_ADMIN_ID }, body: { reason: REASON, confirm: true } },
  ],
  [
    'POST /admins/:id/reset-mfa',
    { params: { id: SUPPORT_ADMIN_ID }, body: { reason: REASON, confirm: true } },
  ],
  [
    'POST /admins/:id/revoke-sessions',
    { params: { id: SUPPORT_ADMIN_ID }, body: { reason: REASON } },
  ],
  [
    'POST /admins/:id/resend-invite',
    { params: { id: INVITED_ADMIN_ID }, body: { reason: REASON } },
  ],
  ['POST /admins/:id/unlock', { params: { id: SUPPORT_ADMIN_ID }, body: { reason: REASON } }],
  [
    'PATCH /settings/plan-limits',
    { body: { plan: 'free', key: 'vip_max', value: 5, reason: REASON, confirm: true } },
  ],
  [
    'PATCH /settings/config/:key',
    { params: { key: 'referral.reward_days' }, body: { value: 21, reason: REASON, confirm: true } },
  ],
];

function context(
  key: RouteKey,
  sample: Sample,
  role: Parameters<typeof permissionsOf>[0] = 'super_admin',
): Ctx {
  const route = adminRoutes[key];
  const parse = (
    schema:
      { safeParse(v: unknown): { success: boolean; data?: unknown; error?: unknown } } | undefined,
    value: unknown,
    part: string,
  ) => {
    if (schema === undefined) return {};
    const parsed = schema.safeParse(value);
    expect(parsed.success, `${key} ${part}: ${String(parsed.error)}`).toBe(true);
    return parsed.data as Record<string, unknown>;
  };
  return {
    key,
    params: parse(route.request.params, sample.params ?? {}, 'params') as Record<string, string>,
    query: parse(route.request.query, sample.query ?? {}, 'query'),
    body: parse(route.request.body, sample.body ?? {}, 'body'),
    now: NOW,
    permissions: permissionsOf(role),
  };
}

/** The first mutation sample of a route. */
function sampleOf(key: RouteKey): Sample | undefined {
  return WRITES.find(([route]) => route === key)?.[1];
}

function expectContract(key: RouteKey, sample: Sample): void {
  const outcome = handleModule(context(key, sample));
  expect(outcome, key).not.toBeNull();
  if (outcome === null) return;
  expect(outcome.ok, `${key}: ${JSON.stringify(outcome)}`).toBe(true);
  if (!outcome.ok) return;
  const body = {
    data: outcome.data,
    meta: {
      correlation_id: 'c',
      request_id: 'r',
      server_time: new Date(NOW).toISOString(),
      ...outcome.page,
    },
  };
  const parsed = adminRoutes[key].response.safeParse(body);
  expect(parsed.success, `${key}: ${parsed.success ? '' : parsed.error.message}`).toBe(true);
}

describe('mock admin-api contract', () => {
  beforeEach(() => {
    resetData(NOW, 'super_admin');
  });

  it('answers every read the backoffice uses with a registry-valid body', () => {
    const reads = (Object.keys(adminRoutes) as RouteKey[]).filter(
      (key) => key.startsWith('GET ') && !SESSION_ROUTES.has(key),
    );
    for (const key of reads) expectContract(key, READS[key] ?? {});
  });

  it('answers every module mutation with a registry-valid body', () => {
    for (const [key, sample] of WRITES) expectContract(key, sample);
  });

  it('applies the registry access rules per role', () => {
    const grant = context(
      'POST /users/:id/entitlement-grants',
      sampleOf('POST /users/:id/entitlement-grants') ?? {},
      'support',
    );
    expect(accessDenied(grant)).toBeNull();
    const longGrant = context(
      'POST /users/:id/entitlement-grants',
      {
        params: { id: MAIN_USER_ID },
        body: { duration_days: 30, source: 'admin', reason: REASON, confirm: true },
      },
      'support',
    );
    expect(accessDenied(longGrant)).toBe('entitlements.grant');
    expect(
      accessDenied(
        context(
          'POST /notifications/test-push',
          sampleOf('POST /notifications/test-push') ?? {},
          'operations',
        ),
      ),
    ).toBeNull();
    expect(accessDenied(context('GET /admins', {}, 'support'))).toBe('admins.read');
    const aiFlag = context(
      'PATCH /flags/:key',
      { params: { key: 'ai.batch.enabled' }, body: { enabled: false, reason: REASON } },
      'ai_ops',
    );
    expect(accessDenied(aiFlag)).toBeNull();
    const productFlag = context(
      'PATCH /flags/:key',
      { params: { key: 'feature.voice' }, body: { enabled: false, reason: REASON } },
      'ai_ops',
    );
    expect(accessDenied(productFlag)).toBe('flags.write');
    expect(
      accessDenied(
        context(
          'GET /users/:id/integrations',
          READS['GET /users/:id/integrations'] ?? {},
          'finance',
        ),
      ),
    ).not.toBeNull();
  });

  it("shows Support Access content only inside the caller's active grant and scopes", () => {
    const created = handleModule(
      context('POST /support-access/grants', {
        body: {
          user_id: MAIN_USER_ID,
          scopes: ['email_metadata'],
          reason: REASON,
          duration_minutes: 15,
        },
      }),
    );
    expect(created?.ok).toBe(true);
    const grantId = created?.ok === true ? (created.data as { id: string }).id : '';
    const read = (scope: string, now = NOW) =>
      handleModule({
        ...context('GET /support-access/grants/:id/content/:scope', {
          params: { id: grantId, scope },
          query: { entity_type: 'email_thread', entity_id: uid('6666', 1) },
        }),
        now,
      });
    expect(read('email_metadata')).toMatchObject({ ok: true, data: { expires_in_s: 60 } });
    expect(read('pii')).toMatchObject({ ok: false, status: 403 });
    expect(read('email_metadata', NOW + 16 * 60_000)).toMatchObject({ ok: false, status: 403 });
    const staffGrant = handleModule(
      context('GET /support-access/grants/:id/content/:scope', {
        params: { id: uid('ffff', 1), scope: 'notifications' },
        query: { entity_type: 'notification', entity_id: uid('6666', 1) },
      }),
    );
    expect(staffGrant).toMatchObject({ ok: false, status: 403 });
  });

  it('keeps the last super admin and the caller protected', () => {
    resetData(NOW, 'super_admin');
    const outcome = handleModule(
      context('POST /admins/:id/disable', {
        params: { id: '0190f5e0-0000-7000-8000-000000000001' },
        body: { reason: REASON, confirm: true },
      }),
    );
    expect(outcome).toMatchObject({
      ok: false,
      status: 409,
      details: { reason: 'self_change_forbidden' },
    });
  });
});
