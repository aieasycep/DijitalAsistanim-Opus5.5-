/**
 * Module routes of the mock admin-api (BACKOFFICE_PLAN §13.4): registry-driven route matching,
 * params/query/body validation with each route's own schemas, the §4 permission rules (`require`,
 * `also`, `or`, `grant_limited`, `flags.write_ai`), step-up for `step_up` routes, audit rows for
 * every audited mutation and for denials, and stateful handlers over `mock-data.ts`.
 */
import { randomUUID } from 'node:crypto';

import { ROLE_PERMISSIONS, checkAdminChange } from '@da/domain';
import { adminRoutes } from '@da/validation';
import { isLimitedGrantAllowed } from '@da/validation/admin/users';
import { isAiFlagKey, isKillSwitchKey } from '@da/validation/admin/product';
import { isForbiddenModel } from '@da/validation/admin/ai';

import { ADMIN_EMAIL, ADMIN_ID, chartPoints, dashboardMetrics, searchResults } from './fixtures.ts';
import {
  MAIN_USER_ID,
  buildDataset,
  istanbulDate,
  maskEmail,
  uid,
  type Dataset,
  type MockAudit,
  type MockUser,
  type Role,
} from './mock-data.ts';

export type RouteKey = keyof typeof adminRoutes;
type Json = Record<string, unknown>;
type Query = Record<string, unknown>;

export interface PageInfo {
  page: number;
  page_size: number;
  total: number;
  total_is_estimate: boolean;
}

export type Outcome =
  | { ok: true; data: unknown; page?: PageInfo; status?: number }
  | { ok: false; status: number; code: string; details?: Json };

export interface Ctx {
  key: RouteKey;
  params: Record<string, string>;
  query: Query;
  body: Json;
  now: number;
  permissions: readonly string[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ── Route matching ───────────────────────────────────────────────────────────
const MATCHERS = (Object.keys(adminRoutes) as RouteKey[])
  .map((key) => {
    const [method = 'GET', path = '/'] = key.split(' ');
    const names: string[] = [];
    const pattern = path.replace(/:([A-Za-z_]+)/g, (_, name: string) => {
      names.push(name);
      return '([^/]+)';
    });
    return { key, method, names, regex: new RegExp(`^${pattern}$`) };
  })
  .sort((a, b) => a.names.length - b.names.length);

export function matchRoute(
  method: string,
  path: string,
): { key: RouteKey; params: Record<string, string> } | null {
  for (const matcher of MATCHERS) {
    if (matcher.method !== method) continue;
    const match = matcher.regex.exec(path);
    if (match === null) continue;
    const params: Record<string, string> = {};
    matcher.names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1] ?? '');
    });
    return { key: matcher.key, params };
  }
  return null;
}

// ── State ────────────────────────────────────────────────────────────────────
export const mock = {
  role: 'operations' as Role,
  data: buildDataset(Date.now(), 'operations'),
};

export function resetData(now: number, role: Role): void {
  mock.role = role;
  mock.data = buildDataset(now, role);
}

export function permissionsOf(role: Role): string[] {
  return [...ROLE_PERMISSIONS[role]];
}

// ── Access (BACKOFFICE_PLAN §4, API_CONTRACTS §12.2) ─────────────────────────
export function accessDenied(ctx: Ctx): string | null {
  const access = adminRoutes[ctx.key].access;
  const has = (permission: string) => ctx.permissions.includes(permission);
  if (['own', 'any_admin', 'aal1', 'bff'].includes(access.require)) return null;
  const alternatives = (access as { or?: readonly string[] }).or ?? [];
  let primary = has(access.require);
  if (
    !primary &&
    ctx.key === 'POST /users/:id/entitlement-grants' &&
    has('entitlements.grant_limited')
  ) {
    const body = ctx.body as {
      duration_days: 1 | 7 | 14 | 30;
      source: 'admin' | 'support' | 'compensation';
      reason: string;
      confirm: true;
    };
    primary = isLimitedGrantAllowed(body);
    if (!primary) return 'entitlements.grant';
  } else if (!primary && access.require === 'flags.write' && has('flags.write_ai')) {
    const key = ctx.params.key ?? (typeof ctx.body.key === 'string' ? ctx.body.key : '');
    primary = isAiFlagKey(key);
    if (!primary) return 'flags.write';
  } else if (!primary) {
    primary = alternatives.some(has);
  }
  if (!primary) return access.require;
  const missing = ((access as { also?: readonly string[] }).also ?? []).find((p) => !has(p));
  return missing ?? null;
}

export function requiresStepUp(key: RouteKey): boolean {
  return (adminRoutes[key].access as { step_up?: boolean }).step_up === true;
}

// ── Audit ────────────────────────────────────────────────────────────────────
function actorRow(
  now: number,
  fields: Partial<MockAudit['row']> & { action: string; result: MockAudit['row']['result'] },
): void {
  const audit = mock.data.audit;
  const last = audit.at(-1);
  const seq = (last?.row.chain_seq ?? 0) + 1;
  audit.push({
    actor_id: ADMIN_ID,
    row: {
      id: uid('eeee', 1_000 + seq),
      chain_seq: seq,
      ts: new Date(now).toISOString(),
      actor_type: 'admin',
      actor: ADMIN_EMAIL,
      role: mock.role,
      target_type: null,
      target_id: null,
      target_user: null,
      reason: null,
      correlation_id: `corr-${randomUUID().slice(0, 8)}`,
      metadata: {},
      prev_hash: last?.row.hash ?? null,
      hash: seq.toString(16).padStart(64, 'b'),
      ...fields,
    },
  });
}

export function auditDenied(ctx: Ctx, permission: string): void {
  actorRow(ctx.now, {
    action: 'admin.permission_denied',
    result: 'denied',
    target_type: 'route',
    target_id: ctx.key,
    metadata: { permission },
  });
}

function targetOf(ctx: Ctx): { type: string | null; id: string | null; user: string | null } {
  const [, path = ''] = ctx.key.split(' ');
  const segment = path.split('/')[1] ?? null;
  const id =
    ctx.params.accountId ??
    ctx.params.key ??
    ctx.params.userId ??
    ctx.params.id ??
    (typeof ctx.body.user_id === 'string' ? ctx.body.user_id : null);
  const user =
    segment === 'users'
      ? (ctx.params.id ?? null)
      : typeof ctx.body.user_id === 'string'
        ? ctx.body.user_id
        : (ctx.params.userId ?? null);
  return { type: segment, id, user };
}

export function auditMutation(ctx: Ctx): void {
  const action = (adminRoutes[ctx.key] as { audit?: string }).audit;
  if (action === undefined) return;
  const target = targetOf(ctx);
  actorRow(ctx.now, {
    action,
    result: 'success',
    target_type: target.type,
    target_id: target.id,
    target_user: target.user,
    reason: typeof ctx.body.reason === 'string' ? ctx.body.reason : null,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const ok = (data: unknown, status?: number): Outcome => ({
  ok: true,
  data,
  ...(status === undefined ? {} : { status }),
});
const fail = (status: number, code: string, details?: Json): Outcome => ({
  ok: false,
  status,
  code,
  ...(details === undefined ? {} : { details }),
});
const notFound = (): Outcome => fail(404, 'NOT_FOUND');
const conflict = (reason: string): Outcome => fail(409, 'STATE_CONFLICT', { reason });
const iso = (ms: number): string => new Date(ms).toISOString();

type Predicate<T> = (row: T, value: unknown) => boolean;

function paged<T extends object>(
  rows: readonly T[],
  query: Query,
  options: {
    filters?: Record<string, Predicate<T>>;
    search?: (row: T, q: string) => boolean;
    sortKey?: (row: T, sort: string) => string | number | null;
  } = {},
): Outcome {
  let result = [...rows];
  for (const [name, value] of Object.entries(query)) {
    const match = /^filter\[(.+)\]$/.exec(name);
    if (match === null || value === undefined) continue;
    const key = match[1] ?? '';
    const predicate = options.filters?.[key] ?? ((row: T, v: unknown) => (row as Json)[key] === v);
    result = result.filter((row) => predicate(row, value));
  }
  const q = typeof query.q === 'string' ? query.q.toLowerCase() : '';
  if (q !== '' && options.search !== undefined)
    result = result.filter((row) => options.search?.(row, q));
  const sort = typeof query.sort === 'string' ? query.sort : null;
  if (sort !== null) {
    const direction = query.order === 'asc' ? 1 : -1;
    const value = (row: T) =>
      options.sortKey?.(row, sort) ?? ((row as Json)[sort] as string | number | null);
    result.sort((a, b) => {
      const x = value(a);
      const y = value(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return x < y ? -direction : direction;
    });
  }
  const page = typeof query.page === 'number' ? query.page : 1;
  const size = typeof query.page_size === 'number' ? query.page_size : 25;
  return {
    ok: true,
    data: result.slice((page - 1) * size, page * size),
    page: { page, page_size: size, total: result.length, total_is_estimate: false },
  };
}

function user(id: string | undefined): MockUser | undefined {
  return mock.data.users.find((u) => u.id === id);
}

function newJob(
  now: number,
  type: Dataset['jobs'][number]['type'],
  userId: string | null,
): { job_id: string; type: typeof type } {
  const id = uid('4444', 500 + mock.data.jobs.length);
  mock.data.jobs.unshift({
    id,
    type,
    status: 'queued',
    attempts: 0,
    max_attempts: 5,
    last_error_code: null,
    run_after: iso(now),
    created_at: iso(now),
    correlation_id: `corr-${id.slice(-8)}-mk`,
    user_id: userId,
    payload: userId === null ? {} : { user_id: userId },
    attempts_history: [],
    children: [],
  });
  return { job_id: id, type };
}

function jobRef(now: number, type: Dataset['jobs'][number]['type'], userId: string | null) {
  return {
    job_id: newJob(now, type, userId).job_id,
    status: 'queued' as const,
    poll_after_ms: 2_000,
  };
}

function rangeDays(range: unknown): number {
  return range === '24h' ? 1 : range === '30d' ? 30 : range === '90d' ? 90 : 7;
}

function dayPoints(now: number, days: number): number[] {
  const count = Math.min(Math.max(days, 1), 30);
  const start = Date.parse(`${istanbulDate(now - (count - 1) * DAY)}T00:00:00+03:00`);
  return Array.from({ length: count }, (_, i) => start + i * DAY);
}

function effectiveEntitlement(userId: string, now: number) {
  const u = user(userId);
  const store = mock.data.subscriptions.find(
    (s) => s.user_id === userId && (s.status === 'active' || s.status === 'trial'),
  );
  const grant = mock.data.grants
    .map((g) => g.row)
    .filter(
      (g) =>
        g.user_id === userId &&
        g.revoked_at === null &&
        Date.parse(g.starts_at) <= now &&
        Date.parse(g.ends_at) > now,
    )
    .sort((a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at))[0];
  if (store !== undefined)
    return { entitlement: 'pro' as const, source: 'store', until: store.expires_at };
  if (grant !== undefined)
    return { entitlement: 'pro' as const, source: grant.source, until: grant.ends_at };
  return {
    entitlement: u?.plan === 'free' ? ('free' as const) : ('free' as const),
    source: null,
    until: null,
  };
}

function grantState(
  row: { starts_at: string; ends_at: string; revoked_at: string | null },
  now: number,
) {
  if (row.revoked_at !== null) return 'revoked' as const;
  if (Date.parse(row.starts_at) > now) return 'scheduled' as const;
  return Date.parse(row.ends_at) > now ? ('active' as const) : ('ended' as const);
}

const SUPPORT_CONTENT: Record<string, string> = {
  pii: 'Ad: Yusuf Demir · Telefon: +90 5** *** ** 41',
  email_metadata: 'Konu: Fatura hatırlatması · Gönderen: fa***@banka.com.tr · Tarih: dün 09:12',
  insights: 'Öngörü: Yarın 10:00 toplantısı için hazırlık notu bekliyor.',
  notifications: 'Bildirim: Sabah brifingi · Karar: gönderildi · Saat: 07:30',
  captures: 'Yakalama: Kargo fişi · Çıkarılan: teslim tarihi cuma',
  assistant_transcript: 'Soru: Bu hafta hangi faturalarım var? · Yanıt: 2 fatura, toplam 1.240 TL',
  ai_feedback: 'Geri bildirim: Özet toplantı saatini yanlış gösterdi.',
};

// ── Handlers ─────────────────────────────────────────────────────────────────
type Handler = (ctx: Ctx) => Outcome;
const d = () => mock.data;

const handlers: Partial<Record<RouteKey, Handler>> = {
  'GET /me/sessions': ({ now }) =>
    ok([
      {
        id: randomUUID(),
        current: true,
        aal: 'aal2',
        created_at: iso(now - HOUR),
        last_activity_at: iso(now),
        idle_expires_at: iso(now + 30 * 60_000),
        absolute_expires_at: iso(now + 11 * HOUR),
        ended_at: null,
        end_reason: null,
        browser_family: 'Chrome',
      },
      {
        id: randomUUID(),
        current: false,
        aal: 'aal2',
        created_at: iso(now - 2 * DAY),
        last_activity_at: iso(now - 2 * DAY + HOUR),
        idle_expires_at: iso(now - 2 * DAY + 90 * 60_000),
        absolute_expires_at: iso(now - DAY),
        ended_at: iso(now - 2 * DAY + 90 * 60_000),
        end_reason: 'idle_timeout',
        browser_family: 'Firefox',
      },
    ]),

  // Dashboard and metrics
  'GET /dashboard/metrics': () => ok(dashboardMetrics()),
  'GET /dashboard/charts': ({ query }) => {
    const series = typeof query.series === 'string' ? query.series : 'user_growth';
    const points = chartPoints(series).map((p) =>
      series === 'ai_costs'
        ? {
            ...p,
            breakdown: {
              briefing_morning: Math.round(p.value * 0.42 * 100) / 100,
              email_triage: Math.round(p.value * 0.31 * 100) / 100,
              assistant_qa: Math.round(p.value * 0.19 * 100) / 100,
              embedding_doc: Math.round(p.value * 0.08 * 100) / 100,
            },
          }
        : p,
    );
    return ok({ points });
  },
  'GET /metrics/ops': ({ query }) =>
    ok({
      range: query.range,
      groups: {
        sync: { success_rate: 0.985, failure_rate: 0.015, reconnect_rate: 0.012 },
        jobs: { throughput: 184_220, dead_letters: 2, failure_rate: 0.004 },
        briefings: { success_rate: 0.992, skipped: 312 },
        notifications: { suppression_rate: 0.41 },
        email: { classification_rate: 0.97, llm_reach_rate: 0.22 },
      },
    }),
  'GET /metrics/product': ({ query }) =>
    ok({
      range: query.range,
      groups: {
        approvals: { approval_conversion: 0.38, execution_success_rate: 0.994 },
        feature_usage: {
          briefing_opened: 21_904,
          assistant_query_sent: 8_311,
          capture_created: 1_207,
          meeting_prep_opened: 2_455,
          search_performed: 5_930,
        },
        referrals: {
          invites: 1_120,
          applied: 402,
          successful: 188,
          bonus_days: 2_632,
          abuse_flags: 9,
        },
        trials: { conversion: 0.31 },
      },
    }),
  'GET /security-events': ({ query }) =>
    ok({
      range: query.range,
      login_failures: 14,
      lockouts: 1,
      recovery_codes_used: 0,
      permission_denials: d().audit.filter((a) => a.row.result === 'denied').length,
      webhook_signature_failures: 3,
      by_admin: [{ admin_id: ADMIN_ID, count: 2 }],
    }),
  'GET /search': ({ query }) =>
    ok({ results: searchResults(typeof query.q === 'string' ? query.q : '') }),

  // Users
  'GET /users': ({ query, now }) =>
    paged(
      d().users.map((u) => ({
        id: u.id,
        email_masked: maskEmail(u.email),
        plan: u.plan,
        created_at: u.created_at,
        last_active_at: u.last_active_at,
        platform: u.platform,
        connected_accounts: d().accounts.filter(
          (a) => a.user_id === u.id && a.status !== 'disconnected',
        ).length,
        last_sync_at: d().accounts.find((a) => a.user_id === u.id)?.last_sync_at ?? null,
        status: u.status,
      })),
      query,
      {
        filters: {
          state: (row, value) => {
            const accounts = d().accounts.filter((a) => a.user_id === row.id);
            if (value === 'disabled') return row.status === 'disabled';
            if (value === 'inactive')
              return row.last_active_at === null || Date.parse(row.last_active_at) < now - 14 * DAY;
            if (value === 'sync_error') return accounts.some((a) => a.status === 'error');
            return accounts.some((a) => a.status === 'needs_reauth');
          },
        },
        search: (row, q) => row.id.startsWith(q),
      },
    ),
  'POST /users/lookup': ({ body }) => {
    const email = String(body.email).toLowerCase();
    const found = d().users.find((u) => u.email === email);
    return found === undefined ? notFound() : ok({ user_id: found.id });
  },
  'GET /users/:id': ({ params }) => {
    const u = user(params.id);
    if (u === undefined) return notFound();
    const briefings = d()
      .briefings.filter((b) => b.user_id === u.id)
      .slice(0, 7);
    return ok({
      user_id: u.id,
      account_status: u.status,
      plan: u.plan,
      integrations: d()
        .accounts.filter((a) => a.user_id === u.id)
        .map((a) => ({
          provider: a.provider,
          status: a.status,
          last_sync_at: a.last_sync_at,
          last_error_code: a.last_error_code,
          watch_expires_at: a.watch_expires_at,
        })),
      job_errors: d()
        .jobs.filter((j) => j.user_id === u.id && j.last_error_code !== null)
        .map((j) => `${j.type}: ${j.last_error_code ?? ''}`)
        .slice(0, 5),
      briefing_status: briefings.map((b) => ({
        local_date: b.local_date,
        kind: b.kind,
        status: b.status,
      })),
      push_status: {
        tokens_enabled: u.status === 'active' ? 2 : 0,
        last_receipt_error: u.id === MAIN_USER_ID ? null : 'DeviceNotRegistered',
      },
      app_version: u.app_version,
      platform: u.platform,
    });
  },
  'GET /users/:id/integrations': ({ params }) => {
    if (user(params.id) === undefined) return notFound();
    return ok(
      d()
        .accounts.filter((a) => a.user_id === params.id)
        .map((a) => ({
          account_id: a.account_id,
          provider: a.provider,
          email_masked: a.email === null ? null : maskEmail(a.email),
          capabilities_granted:
            a.provider === 'google'
              ? ['mail_read', 'calendar_read', 'calendar_write']
              : ['mail_read', 'calendar_read', 'tasks_read'],
          status: a.status,
          error_class:
            a.last_error_code === null ? null : a.status === 'needs_reauth' ? 'auth' : 'provider',
          resources: (['mail', 'calendar'] as const).map((resource, i) => ({
            resource,
            last_success_at: a.last_sync_at,
            last_error_code: i === 0 ? a.last_error_code : null,
            consecutive_failures: i === 0 && a.last_error_code !== null ? 3 : 0,
            watch_expires_at: a.watch_expires_at,
            watch_status: a.status === 'disconnected' ? null : 'active',
          })),
          data_sources: {
            mail_read: true,
            attachments_analyze: a.provider === 'google',
            deadline_detect: true,
            draft_replies: true,
            calendar_read: true,
            schedule_suggest: true,
            calendar_write_with_approval: a.provider === 'google',
            tasks_read: a.provider === 'microsoft',
          },
          recent_jobs: d()
            .jobs.filter((j) => j.user_id === params.id)
            .slice(0, 3)
            .map((j) => ({
              id: j.id,
              type: j.type,
              status: j.status,
              last_error_code: j.last_error_code,
              created_at: j.created_at,
            })),
        })),
    );
  },
  'GET /users/:id/briefings': ({ params, query }) => {
    if (user(params.id) === undefined) return notFound();
    const rows = d()
      .briefings.filter((b) => b.user_id === params.id)
      .map((b) => {
        const extra = d().briefingExtra.get(b.id);
        return {
          id: b.id,
          kind: b.kind,
          local_date: b.local_date,
          status: b.status,
          scheduled_for: extra?.scheduled_for ?? null,
          generated_at: b.generated_at,
          delivered_at: b.delivered_at,
          latency_ms: b.latency_ms,
          item_count: extra?.item_count ?? 0,
          ai_cost_usd: extra?.ai_cost_usd ?? 0,
          notification_decision: extra?.decision ?? null,
          skip_reason: extra?.skip_reason ?? null,
          error_code: extra?.error_code ?? null,
        };
      });
    return paged(rows, query, {
      filters: {
        from: (row, value) => row.local_date >= String(value),
        to: (row, value) => row.local_date <= String(value),
      },
    });
  },
  'GET /users/:id/usage': ({ params, query, now }) => {
    if (user(params.id) === undefined) return notFound();
    const days = dayPoints(now, rangeDays(query.range));
    const features = ['email_triage', 'briefing_morning', 'assistant_qa'];
    return ok({
      ai: {
        days: days.flatMap((ms, i) =>
          features.map((feature, j) => ({
            date: istanbulDate(ms),
            feature,
            requests: 6 + ((i * 3 + j * 5) % 11),
            input_tokens: 9_000 + i * 310 + j * 1_200,
            output_tokens: 1_100 + i * 40 + j * 150,
            cost_usd: Math.round((0.004 + i * 0.0003 + j * 0.002) * 1e4) / 1e4,
            units: 3 + ((i + j) % 4),
          })),
        ),
        daily_budget_units: null,
        budget_hit_days: 0,
      },
      feature_usage: {
        briefing_opened: 26,
        assistant_query_sent: 41,
        capture_created: 7,
        meeting_prep_opened: 9,
        follow_up_actioned: 12,
        search_performed: 18,
        approval_decided: 6,
      },
      approvals: { created: 9, approved: 6, executed: 6 },
      reminders_created: 11,
      captures: { count: 7, bytes: 3_482_112 },
      content_volumes: {
        email_threads: 1_284,
        calendar_events: 212,
        insights: 96,
        memory_chunks: 4_410,
      },
      notifications_by_decision: { sent: 58, suppressed: 21, deduplicated: 4, failed: 1 },
    });
  },
  'GET /users/:id/subscription': ({ params, query, now, permissions }) => {
    const u = user(params.id);
    if (u === undefined) return notFound();
    const sub = d().subscriptions.find((s) => s.user_id === u.id);
    const grants = d()
      .grants.map((g) => g.row)
      .filter((g) => g.user_id === u.id)
      .map((g) => ({
        id: g.id,
        source: g.source,
        duration_days: g.duration_days,
        starts_at: g.starts_at,
        ends_at: g.ends_at,
        state: grantState(g, now),
        granted_by: g.granted_by,
        reason: g.reason,
        revoked_at: g.revoked_at,
      }));
    const page = typeof query.grants_page === 'number' ? query.grants_page : 1;
    return ok({
      store:
        sub === undefined
          ? null
          : {
              store: sub.store,
              product_id: sub.product_id,
              period_type: sub.period_type,
              is_active: sub.status === 'active' || sub.status === 'trial',
              will_renew: sub.will_renew,
              expires_at: sub.expires_at,
              billing_issue_detected_at: sub.status === 'billing_issue' ? iso(now - 2 * DAY) : null,
              environment: 'PRODUCTION',
              synced_at: iso(now - 3 * HOUR),
              last_event_id: d().billingEvents.find((e) => e.user_id === u.id)?.event_id ?? null,
              original_transaction_id: '…7f3a',
              ...(permissions.includes('metrics.revenue.read')
                ? { price_usd: sub.product_id === 'da_pro_annual' ? 39.99 : 4.99 }
                : {}),
            },
      grants: grants.slice((page - 1) * 10, page * 10),
      effective: effectiveEntitlement(u.id, now),
      ...(permissions.includes('billing_events.read')
        ? {
            billing_events: d()
              .billingEvents.filter((e) => e.user_id === u.id)
              .map((e) => ({
                event_id: e.event_id,
                type: e.type,
                environment: e.environment,
                received_at: e.received_at,
                processed: e.processed_at !== null,
              })),
          }
        : {}),
    });
  },
  'GET /users/:id/referrals': ({ params }) => {
    const u = user(params.id);
    if (u === undefined) return notFound();
    const asReferrer = d().referrals.filter((r) => r.referrer_id === u.id);
    const asReferee = d().referrals.find((r) => r.referee_id === u.id);
    return ok({
      code: u.id === MAIN_USER_ID ? 'DA-4821' : null,
      as_referrer: asReferrer.map((r) => ({
        id: r.id,
        referee_masked: maskEmail(user(r.referee_id)?.email ?? 'bi@bilinmiyor.com'),
        status: r.status,
        risk_score: r.risk_score,
        signal_labels: r.signals_summary,
        created_at: r.created_at,
        qualified_at: r.status === 'qualified' || r.status === 'rewarded' ? r.created_at : null,
        rewarded_at: r.status === 'rewarded' ? r.created_at : null,
      })),
      as_referee:
        asReferee === undefined
          ? null
          : {
              id: asReferee.id,
              referrer_masked: maskEmail(
                MAIN_USER_ID === asReferee.referrer_id
                  ? 'yusuf.demir@gmail.com'
                  : 'bi@bilinmiyor.com',
              ),
              status: asReferee.status,
            },
      credits: asReferrer
        .filter((r) => r.status === 'rewarded')
        .map((r) => ({
          referral_id: r.id,
          side: 'referrer' as const,
          grant_id: uid('9999', 1),
          days: 14,
        })),
      yearly_rewards: { used: asReferrer.filter((r) => r.status === 'rewarded').length, max: 6 },
    });
  },
  'GET /users/:id/support': ({ params, now }) => {
    if (user(params.id) === undefined) return notFound();
    return ok({
      tickets: d()
        .tickets.filter((t) => t.user_id === params.id)
        .map((t) => ({
          id: t.row.id,
          reference: t.row.reference,
          category: t.row.category,
          status: t.row.status,
          subject: t.row.subject,
          assignee: t.row.assignee,
          created_at: t.row.created_at,
        })),
      access_grants: d()
        .supportGrants.filter((g) => g.user_id === params.id)
        .map((g) => ({
          id: g.id,
          admin: { id: g.admin_id, display_name: g.admin_name },
          scopes: g.scopes,
          reason: g.reason,
          starts_at: g.starts_at,
          expires_at: g.expires_at,
          revoked_at: g.revoked_at,
          reveal_count: g.reveal_count,
          active: g.revoked_at === null && Date.parse(g.expires_at) > now,
        })),
    });
  },
  'GET /users/:id/audit': ({ params, query }) =>
    mapPage(
      paged(
        [...d().audit].reverse().filter((a) => a.row.target_user === params.id),
        query,
        {
          filters: {
            actor_id: (a, v) => a.actor_id === v,
            actor_role: (a, v) => a.row.role === v,
            action: (a, v) => a.row.action === v,
            result: (a, v) => a.row.result === v,
            from: (a, v) => a.row.ts >= String(v),
            to: (a, v) => a.row.ts <= String(v),
          },
          sortKey: (a) => a.row.ts,
        },
      ),
      auditListRow,
    ),
  'GET /users/:id/devices': ({ params, now }) => {
    const u = user(params.id);
    if (u === undefined) return notFound();
    return ok([
      {
        installation_id: uid('1313', 1),
        platform: u.platform ?? 'ios',
        app_version: u.app_version ?? '1.4.1',
        build_number: '412',
        os_version: u.platform === 'android' ? 'Android 16' : 'iOS 19.1',
        push_enabled: true,
        token_masked: 'ExponentPushToken[ab…yz]',
        last_seen_at: iso(now - 20 * 60_000),
        last_receipt_status: 'ok',
        last_receipt_error: null,
      },
      {
        installation_id: uid('1313', 2),
        platform: 'ios',
        app_version: '1.3.9',
        build_number: '388',
        os_version: 'iPadOS 18.6',
        push_enabled: false,
        token_masked: null,
        last_seen_at: iso(now - 9 * DAY),
        last_receipt_status: null,
        last_receipt_error: null,
      },
    ]);
  },
  'POST /users/:id/reveal': ({ params }) => {
    const u = user(params.id);
    return u === undefined ? notFound() : ok({ value: u.email, expires_in_s: 60 });
  },
  'POST /users/:id/force-sync': ({ params, body, now }) => {
    if (user(params.id) === undefined) return notFound();
    const resources = (body.resources as string[] | undefined) ?? ['mail', 'calendar'];
    return ok({
      jobs: resources.map((resource) =>
        newJob(
          now,
          resource === 'mail'
            ? 'gmail_sync'
            : resource === 'calendar'
              ? 'calendar_sync'
              : 'tasks_sync',
          params.id ?? null,
        ),
      ),
    });
  },
  'POST /users/:id/disable': ({ params }) => {
    const u = user(params.id);
    if (u === undefined) return notFound();
    if (u.status === 'disabled') return conflict('already_disabled');
    u.status = 'disabled';
    return ok({ user_id: u.id, account_status: u.status });
  },
  'POST /users/:id/restore': ({ params }) => {
    const u = user(params.id);
    if (u === undefined) return notFound();
    if (u.status !== 'disabled') return conflict('not_disabled');
    u.status = 'active';
    return ok({ user_id: u.id, account_status: u.status });
  },
  'POST /users/:id/internal': ({ params, body }) => {
    const u = user(params.id);
    if (u === undefined) return notFound();
    u.internal = body.internal === true;
    return ok({ user_id: u.id, internal: u.internal });
  },
  'POST /users/:id/entitlement-grants': ({ params, body, now }) => {
    const u = user(params.id);
    if (u === undefined) return notFound();
    const days = Number(body.duration_days);
    let start = now;
    for (const g of d().grants) {
      if (g.row.user_id === u.id && g.row.revoked_at === null && Date.parse(g.row.ends_at) > start)
        start = Date.parse(g.row.ends_at);
    }
    const row = {
      id: uid('9999', 100 + d().grants.length),
      user_id: u.id,
      email_masked: maskEmail(u.email),
      source: body.source as 'admin',
      duration_days: days,
      starts_at: iso(start),
      ends_at: iso(start + days * DAY),
      state: start > now ? ('scheduled' as const) : ('active' as const),
      granted_by: ADMIN_EMAIL,
      reason: String(body.reason),
      revoked_at: null,
      revoked_by: null,
    };
    d().grants.push({ row });
    return ok(
      {
        id: row.id,
        user_id: row.user_id,
        source: row.source,
        duration_days: row.duration_days,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        state: row.state,
      },
      201,
    );
  },
  'POST /users/:id/entitlement-grants/:grantId/revoke': ({ params, now }) => {
    const grant = d().grants.find(
      (g) => g.row.id === params.grantId && g.row.user_id === params.id,
    );
    if (grant === undefined) return notFound();
    if (grant.row.revoked_at !== null) return conflict('already_revoked');
    grant.row.revoked_at = iso(now);
    grant.row.revoked_by = ADMIN_EMAIL;
    grant.row.state = 'revoked';
    const r = grant.row;
    return ok({
      id: r.id,
      user_id: r.user_id,
      source: r.source,
      duration_days: r.duration_days,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      state: r.state,
    });
  },
  'POST /users/:id/integrations/:accountId/disconnect': ({ params }) => {
    const account = d().accounts.find(
      (a) => a.account_id === params.accountId && a.user_id === params.id,
    );
    if (account === undefined) return notFound();
    account.status = 'disconnected';
    account.watch_expires_at = null;
    return ok({
      account_id: account.account_id,
      status: account.status,
      revocation: 'provider_revoked',
    });
  },

  // Support
  'GET /support/tickets': ({ query }) =>
    mapPage(
      paged(d().tickets, query, {
        filters: {
          status: (t, v) => t.row.status === v,
          category: (t, v) => t.row.category === v,
          assignee: (t, v) => t.assignee_id === v,
          source: (t, v) => t.source === v,
        },
        search: (t, q) =>
          t.row.reference.toLowerCase().includes(q) || t.row.subject.toLowerCase().includes(q),
        sortKey: (t, sort) => (sort === 'status' ? t.row.status : t.row.created_at),
      }),
      (t: Dataset['tickets'][number]) => t.row,
    ),
  'GET /support/tickets/:id': ({ params }) => {
    const ticket = d().tickets.find((t) => t.row.id === params.id);
    return ticket === undefined
      ? notFound()
      : ok({
          ...ticket.row,
          message: ticket.message,
          diagnostics: ticket.diagnostics,
          notes: ticket.notes,
        });
  },
  'PATCH /support/tickets/:id': ({ params, body }) => {
    const ticket = d().tickets.find((t) => t.row.id === params.id);
    if (ticket === undefined) return notFound();
    if (typeof body.status === 'string')
      ticket.row.status = body.status as typeof ticket.row.status;
    if (typeof body.category === 'string')
      ticket.row.category = body.category as typeof ticket.row.category;
    if (body.assignee_admin_id !== undefined) {
      const admin = d().admins.find((a) => a.row.id === body.assignee_admin_id);
      ticket.assignee_id = admin?.row.id ?? null;
      ticket.row.assignee = admin?.display_name ?? null;
    }
    return ok(ticket.row);
  },
  'POST /support/tickets/:id/notes': ({ params, body, now }) => {
    const ticket = d().tickets.find((t) => t.row.id === params.id);
    if (ticket === undefined) return notFound();
    const note = {
      id: uid('1212', 100 + ticket.notes.length),
      kind: 'internal' as const,
      body: String(body.body),
      author: ADMIN_EMAIL,
      created_at: iso(now),
    };
    ticket.notes.push(note);
    return ok({ note_id: note.id, created_at: note.created_at }, 201);
  },
  'POST /support/tickets/:id/reply': ({ params, body, now }) => {
    const ticket = d().tickets.find((t) => t.row.id === params.id);
    if (ticket === undefined) return notFound();
    const note = {
      id: uid('1212', 200 + ticket.notes.length),
      kind: 'reply' as const,
      body: String(body.body),
      author: ADMIN_EMAIL,
      created_at: iso(now),
    };
    ticket.notes.push(note);
    if (ticket.row.status === 'open') ticket.row.status = 'waiting_user';
    return ok(
      {
        note_id: note.id,
        email_job_id: newJob(now, 'transactional_email', ticket.user_id).job_id,
        created_at: note.created_at,
      },
      201,
    );
  },
  'POST /support-access/grants': ({ body, now }) => {
    if (user(String(body.user_id)) === undefined) return notFound();
    const grant = {
      id: uid('ffff', 100 + d().supportGrants.length),
      user_id: String(body.user_id),
      admin_id: ADMIN_ID,
      admin_name: 'Ayşe Operasyon',
      scopes: body.scopes as Dataset['supportGrants'][number]['scopes'],
      reason: String(body.reason),
      starts_at: iso(now),
      expires_at: iso(now + Number(body.duration_minutes) * 60_000),
      revoked_at: null,
      reveal_count: 0,
    };
    d().supportGrants.push(grant);
    const { admin_id: _admin, admin_name: _name, ...row } = grant;
    return ok(row, 201);
  },
  'POST /support-access/grants/:id/revoke': ({ params, now }) => {
    const grant = d().supportGrants.find((g) => g.id === params.id);
    if (grant === undefined) return notFound();
    if (grant.revoked_at !== null) return conflict('already_revoked');
    grant.revoked_at = iso(now);
    const { admin_id: _admin, admin_name: _name, ...row } = grant;
    return ok(row);
  },
  'GET /support-access/grants/:id/content/:scope': ({ params, now }) => {
    const grant = d().supportGrants.find((g) => g.id === params.id);
    if (grant === undefined) return notFound();
    const scope = params.scope as (typeof grant.scopes)[number];
    if (
      grant.admin_id !== ADMIN_ID ||
      grant.revoked_at !== null ||
      Date.parse(grant.expires_at) <= now ||
      !grant.scopes.includes(scope)
    ) {
      return fail(403, 'FORBIDDEN', { reason: 'support_access_inactive' });
    }
    grant.reveal_count += 1;
    return ok({ value: SUPPORT_CONTENT[scope] ?? '', expires_in_s: 60 });
  },

  // Integrations
  'GET /integrations': ({ query }) =>
    paged(
      d().accounts.map((a) => ({
        account_id: a.account_id,
        user_id: a.user_id,
        provider: a.provider,
        email_masked: a.email === null ? null : maskEmail(a.email),
        status: a.status,
        last_sync_at: a.last_sync_at,
        last_error_code: a.last_error_code,
        watch_expires_at: a.watch_expires_at,
        key_version: a.key_version,
      })),
      query,
      {
        filters: {
          issue: (a, v) =>
            v === 'needs_reconnect'
              ? a.status === 'needs_reauth'
              : v === 'watch_issue'
                ? a.watch_expires_at !== null && Date.parse(a.watch_expires_at) < Date.now() + DAY
                : v === 'refresh_error'
                  ? a.last_error_code === 'invalid_grant'
                  : a.status === 'error',
        },
        search: (a, q) => a.user_id.startsWith(q) || a.account_id.startsWith(q),
      },
    ),
  'GET /integrations/summary': ({ now }) => {
    const counts = new Map<string, number>();
    for (const a of d().accounts)
      counts.set(`${a.provider}|${a.status}`, (counts.get(`${a.provider}|${a.status}`) ?? 0) + 1);
    return ok({
      by_provider_status: [...counts.entries()].map(([k, count]) => {
        const [provider, status] = k.split('|');
        return { provider: provider as 'google', status: status as 'healthy', count };
      }),
      reconnect_rate: 0.012,
      watches_expiring_24h: d().accounts.filter(
        (a) => a.watch_expires_at !== null && Date.parse(a.watch_expires_at) < now + DAY,
      ).length,
      watch_renewals_failed_24h: 1,
      oldest_healthy_last_sync_at: iso(now - 2 * HOUR),
    });
  },
  'GET /integrations/:accountId': ({ params, now }) => {
    const a = d().accounts.find((x) => x.account_id === params.accountId);
    if (a === undefined) return notFound();
    return ok({
      account: {
        account_id: a.account_id,
        user_id: a.user_id,
        provider: a.provider,
        email_masked: a.email === null ? null : maskEmail(a.email),
        status: a.status,
        last_sync_at: a.last_sync_at,
        last_error_code: a.last_error_code,
        watch_expires_at: a.watch_expires_at,
        key_version: a.key_version,
      },
      granted_scopes:
        a.provider === 'google'
          ? ['gmail.readonly', 'calendar.readonly', 'calendar.events.owned']
          : ['Mail.Read', 'Calendars.Read', 'Tasks.Read'],
      sync_states: ['mail', 'calendar'].map((resource) => ({
        resource,
        status: a.status === 'healthy' ? 'idle' : 'error',
        last_success_at: a.last_sync_at,
        last_error_code: resource === 'mail' ? a.last_error_code : null,
        watch_expires_at: a.watch_expires_at,
      })),
      recent_jobs: d()
        .jobs.filter((j) => j.user_id === a.user_id)
        .slice(0, 5)
        .map((j) => ({
          id: j.id,
          type: j.type,
          status: j.status,
          last_error_code: j.last_error_code,
          created_at: j.created_at,
        })),
      webhook_stats: {
        received_24h: 142,
        unmatched_24h: 1,
        last_received_at: iso(now - 4 * 60_000),
      },
    });
  },
  'POST /integrations/:accountId/force-sync': ({ params, now }) => {
    const a = d().accounts.find((x) => x.account_id === params.accountId);
    return a === undefined
      ? notFound()
      : ok({
          jobs: [
            newJob(now, a.provider === 'microsoft' ? 'outlook_sync' : 'gmail_sync', a.user_id),
          ],
        });
  },
  'POST /integrations/:accountId/renew-watch': ({ params, now }) => {
    const a = d().accounts.find((x) => x.account_id === params.accountId);
    return a === undefined ? notFound() : ok({ jobs: [newJob(now, 'watch_renewal', a.user_id)] });
  },

  // Jobs
  'GET /jobs': ({ query }) =>
    paged(
      d().jobs.map(({ payload: _p, attempts_history: _h, children: _c, ...row }) => row),
      query,
      {
        filters: {
          from: (row, v) => row.created_at >= String(v),
          to: (row, v) => row.created_at <= String(v),
          account_id: () => true,
        },
        search: (row, q) =>
          row.id.startsWith(q) || (row.correlation_id ?? '').toLowerCase().includes(q),
      },
    ),
  'GET /jobs/stats': () => {
    const counts = new Map<string, number>();
    for (const j of d().jobs)
      counts.set(`${j.type}|${j.status}`, (counts.get(`${j.type}|${j.status}`) ?? 0) + 1);
    return ok({
      by_type_status: [...counts.entries()].map(([k, count]) => {
        const [type, status] = k.split('|');
        return { type: type as 'gmail_sync', status: status as 'queued', count };
      }),
      dead_letter: d().jobs.filter((j) => j.status === 'dead_letter').length,
    });
  },
  'GET /jobs/:id': ({ params }) => {
    const job = d().jobs.find((j) => j.id === params.id);
    return job === undefined ? notFound() : ok(job);
  },
  'GET /correlation/:id': ({ params, now }) => {
    const job = d().jobs.find((j) => j.correlation_id === params.id);
    if (job === undefined) return ok([]);
    return ok([
      {
        kind: 'webhook',
        id: `wh_${job.id.slice(-6)}`,
        ts: iso(Date.parse(job.created_at) - 2_000),
        status: 'received',
        label_key: 'webhook_received',
        link: null,
      },
      {
        kind: 'job',
        id: job.id,
        ts: job.created_at,
        status: job.status,
        label_key: 'job_created',
        link: `/jobs/${job.id}`,
      },
      ...job.attempts_history.map((a) => ({
        kind: 'job_attempt' as const,
        id: `${job.id}#${String(a.attempt)}`,
        ts: a.started_at,
        status: a.outcome,
        label_key: 'job_attempt',
        link: null,
      })),
      ...(job.user_id === null
        ? []
        : [
            {
              kind: 'audit' as const,
              id: uid('eeee', 900),
              ts: iso(now - HOUR),
              status: 'success',
              label_key: 'admin_action',
              link: `/audit?id=${uid('eeee', 900)}`,
            },
          ]),
    ]);
  },
  'POST /jobs/:id/retry': ({ params, body, now }) => {
    const job = d().jobs.find((j) => j.id === params.id);
    if (job === undefined) return notFound();
    if (job.status !== 'failed' && job.status !== 'dead_letter')
      return conflict('job_not_retryable');
    job.status = 'queued';
    job.run_after = iso(now);
    if (body.reset_attempts === true) job.attempts = 0;
    return ok({ id: job.id, status: job.status });
  },
  'POST /jobs/:id/cancel': ({ params }) => {
    const job = d().jobs.find((j) => j.id === params.id);
    if (job === undefined) return notFound();
    if (job.status !== 'queued' && job.status !== 'retrying')
      return conflict('job_not_cancellable');
    job.status = 'failed';
    job.last_error_code = 'cancelled_by_admin';
    return ok({ id: job.id, status: job.status });
  },
  'POST /jobs/retry-bulk': ({ body, now }) => {
    const filter = body.filter as { type: string; status: string; from: string; to: string };
    const matching = d()
      .jobs.filter(
        (j) =>
          j.type === filter.type &&
          j.status === filter.status &&
          j.created_at >= filter.from &&
          j.created_at <= filter.to,
      )
      .slice(0, Number(body.max));
    for (const job of matching) {
      job.status = 'queued';
      job.run_after = iso(now);
    }
    return ok({ retried: matching.length });
  },

  // Briefings and notifications
  'GET /briefings/metrics': ({ query }) => {
    const rows = d().briefings.filter((b) => query.kind === undefined || b.kind === query.kind);
    return ok({
      scheduled: rows.length * 410,
      generated: rows.filter((b) => b.generated_at !== null).length * 400,
      delivered: rows.filter((b) => b.status === 'delivered').length * 398,
      failed: rows.filter((b) => b.status === 'failed').length * 4,
      skipped: rows.filter((b) => b.status === 'skipped').length * 52,
      p50_latency_ms: 4_300,
      p95_latency_ms: 11_800,
      ai_cost_usd: Math.round(rows.length * 4.12 * 100) / 100,
      template_fallback_rate: 0.018,
    });
  },
  'GET /briefings': ({ query }) => paged(d().briefings, query),
  'POST /briefings/:id/regenerate': ({ params, now }) => {
    const b = d().briefings.find((x) => x.id === params.id);
    if (b === undefined) return notFound();
    if (b.status !== 'failed' && b.status !== 'skipped')
      return conflict('briefing_not_regenerable');
    b.status = 'generating';
    return ok({ briefing_id: b.id, job: jobRef(now, 'briefing', b.user_id) }, 202);
  },
  'GET /notifications/metrics': () =>
    ok({
      scheduled: 61_204,
      sent: 51_302,
      failed: 211,
      suppressed: 8_920,
      deduplicated: 771,
      suppression_reasons: { quiet_hours: 5_120, daily_cap: 2_410, user_muted: 1_390 },
      receipt_errors: { DeviceNotRegistered: 164, MessageRateExceeded: 31, InvalidCredentials: 16 },
    }),
  'GET /notifications': ({ query }) =>
    mapPage(
      paged(d().notifications, query),
      ({ user_id: _u, ...row }: Dataset['notifications'][number]) => row,
    ),
  'POST /notifications/test-push': ({ body, now }) => {
    const u = user(String(body.user_id));
    if (u === undefined) return notFound();
    const id = uid('6666', 100 + d().notifications.length);
    d().notifications.unshift({
      id,
      user_id: u.id,
      category: 'account',
      decision: 'sent',
      decision_reason: 'admin_test',
      detail_mode: 'generic',
      sent_at: iso(now),
      receipt_status: null,
    });
    return ok(
      { notification_id: id, job: jobRef(now, 'notification', u.id), deferred_until: null },
      202,
    );
  },

  // AI
  'GET /ai/metrics': ({ query }) => {
    const group = typeof query.group_by === 'string' ? query.group_by : 'feature';
    const keyOf = (r: Dataset['aiRequests'][number]) =>
      group === 'model'
        ? r.model
        : group === 'day'
          ? r.created_at.slice(0, 10)
          : group === 'prompt_version'
            ? r.prompt_version_id === null
              ? 'none'
              : `v${r.prompt_version_id.slice(-1)}`
            : group === 'profile'
              ? d().users.find((u) => u.id === r.user_id)?.plan === 'pro'
                ? 'balanced'
                : 'lean'
              : r.feature;
    const groups = new Map<string, Dataset['aiRequests']>();
    for (const r of d().aiRequests) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
    return ok(
      [...groups.entries()].map(([key, rows]) => ({
        key,
        requests: rows.length * 1_250,
        input_tokens: rows.reduce((s, r) => s + r.input_tokens, 0) * 1_250,
        output_tokens: rows.reduce((s, r) => s + r.output_tokens, 0) * 1_250,
        cache_read_tokens: rows.reduce((s, r) => s + r.cache_read_tokens, 0) * 1_250,
        cost_usd: Math.round(rows.reduce((s, r) => s + r.cost_usd, 0) * 1_250 * 100) / 100,
        error_rate:
          rows.filter((r) => r.status !== 'ok' && r.status !== 'cached').length / rows.length,
        p50_ms: Math.round(rows.reduce((s, r) => s + r.latency_ms, 0) / rows.length),
        p95_ms: Math.max(...rows.map((r) => r.latency_ms)),
      })),
    );
  },
  'GET /ai/metrics/series': ({ query, now }) => {
    const keys =
      query.split === 'model'
        ? ['claude-sonnet-4-5', 'claude-haiku-4-5', 'voyage-4-lite']
        : ['briefing_morning', 'email_triage', 'assistant_qa', 'embedding_doc'];
    return ok({
      points: dayPoints(now, rangeDays(query.range)).flatMap((ms, i) =>
        keys.map((key, j) => ({
          t: iso(ms),
          key,
          requests: 4_000 + i * 120 + j * 900,
          cost_usd: Math.round((22 - j * 5 + i * 0.7) * 100) / 100,
        })),
      ),
    });
  },
  'GET /ai/requests': ({ query }) =>
    mapPage(
      paged(d().aiRequests, query),
      ({ user_id: _u, ...row }: Dataset['aiRequests'][number]) => row,
    ),
  'GET /ai/models': () =>
    ok({
      configs: d().models,
      plan_profiles: d().planProfiles,
      credentials: {
        anthropic: 'configured',
        openai: 'external_credential_required',
        voyage: 'configured',
      },
    }),
  'PATCH /ai/models/:profile/:feature': ({ params, body }) => {
    const row = d().models.find(
      (m) => m.profile === params.profile && m.feature === params.feature,
    );
    if (row === undefined) return notFound();
    if (body.expected_version !== row.version) return conflict('version_conflict');
    const targets = [
      body.primary_target,
      ...((body.fallback_targets as unknown[] | undefined) ?? []),
      body.escalation_target,
    ] as ({ model?: string } | null | undefined)[];
    if (targets.some((t) => typeof t?.model === 'string' && isForbiddenModel(t.model)))
      return fail(422, 'VALIDATION_FAILED', { reason: 'model_forbidden' });
    const { expected_version: _v, reason: _r, confirm: _c, ...patch } = body;
    Object.assign(row, patch);
    row.version += 1;
    row.eval_status = 'pending';
    return ok(row);
  },
  'POST /ai/models/:profile/:feature/test': ({ params }) =>
    d().models.some((m) => m.profile === params.profile && m.feature === params.feature)
      ? ok({ latency_ms: 1_184, schema_pass: true, cost_usd: 0.0021 })
      : notFound(),
  'PATCH /ai/routing-profile': ({ body }) => {
    const plan = body.plan as 'free' | 'pro';
    const before = d().planProfiles[plan];
    d().planProfiles[plan] = body.profile as 'balanced' | 'lean';
    return ok({ plan, before, after: d().planProfiles[plan] });
  },
  'GET /ai/prompts': () =>
    ok(
      [...d().prompts.entries()].map(([key, versions]) => ({
        key,
        active_version: versions.find((v) => v.status === 'active')?.version ?? null,
      })),
    ),
  'GET /ai/prompts/:key': ({ params }) => {
    const versions = d().prompts.get(params.key ?? '');
    if (versions === undefined) return notFound();
    return ok({ key: params.key, versions: [...versions].reverse().map(promptSummary) });
  },
  'GET /ai/prompts/:key/diff': ({ params, query }) => {
    const versions = d().prompts.get(params.key ?? '');
    const from = versions?.find((v) => v.version === query.from);
    const to = versions?.find((v) => v.version === query.to);
    if (from === undefined || to === undefined) return notFound();
    const lines = (v: typeof from) => `${v.template_system}\n${v.template_user}`.split('\n');
    const a = lines(from);
    const b = lines(to);
    const diff = [
      `--- v${String(from.version)}`,
      `+++ v${String(to.version)}`,
      ...a.flatMap((line, i) =>
        b[i] === line ? [` ${line}`] : [`-${line}`, ...(b[i] === undefined ? [] : [`+${b[i]}`])],
      ),
      ...b.slice(a.length).map((line) => `+${line}`),
    ].join('\n');
    return ok({ from: from.version, to: to.version, diff });
  },
  'GET /ai/prompts/:key/versions/:v': ({ params }) => {
    const version = d()
      .prompts.get(params.key ?? '')
      ?.find((v) => v.version === Number(params.v));
    if (version === undefined) return notFound();
    return ok({
      ...promptSummary(version),
      key: params.key,
      template_system: version.template_system,
      template_user: version.template_user,
      output_schema: version.output_schema,
      schema_hash: 'c'.repeat(64),
      notes: version.notes,
    });
  },
  'POST /ai/prompts/:key/versions': ({ params, body, now }) => {
    const versions = d().prompts.get(params.key ?? '');
    if (versions === undefined) return notFound();
    if (versions.some((v) => v.status === 'draft')) return conflict('draft_exists');
    const version = Math.max(...versions.map((v) => v.version)) + 1;
    versions.push({
      version,
      status: 'draft',
      created_by: ADMIN_EMAIL,
      created_at: iso(now),
      activated_at: null,
      template_system: String(body.template_system),
      template_user: String(body.template_user),
      output_schema: body.output_schema as 'BriefingMorningV1',
      notes: typeof body.notes === 'string' ? body.notes : null,
      requests: 0,
      error_rate: 0,
      feedback_positive_rate: null,
    });
    return ok({ key: params.key, version, status: 'draft' }, 201);
  },
  'PATCH /ai/prompts/:key/versions/:v': ({ params, body }) => {
    const version = d()
      .prompts.get(params.key ?? '')
      ?.find((v) => v.version === Number(params.v));
    if (version === undefined) return notFound();
    if (version.status !== 'draft') return conflict('not_draft');
    if (typeof body.template_system === 'string') version.template_system = body.template_system;
    if (typeof body.template_user === 'string') version.template_user = body.template_user;
    if (typeof body.notes === 'string') version.notes = body.notes;
    return ok({ key: params.key, version: version.version, status: version.status });
  },
  'POST /ai/prompts/:key/versions/:v/test': ({ params }) =>
    d()
      .prompts.get(params.key ?? '')
      ?.some((v) => v.version === Number(params.v)) === true
      ? ok({ cases: 24, schema_pass_rate: 1, grounding_pass_rate: 0.958 })
      : notFound(),
  'POST /ai/prompts/:key/versions/:v/activate': ({ params, now }) => {
    const versions = d().prompts.get(params.key ?? '');
    const version = versions?.find((v) => v.version === Number(params.v));
    if (versions === undefined || version === undefined) return notFound();
    if (version.status === 'active') return conflict('already_active');
    for (const v of versions) if (v.status === 'active') v.status = 'archived';
    version.status = 'active';
    version.activated_at = iso(now);
    return ok({ key: params.key, version: version.version, status: version.status });
  },
  'POST /ai/prompts/:key/rollback': ({ params, body, now }) => {
    const versions = d().prompts.get(params.key ?? '');
    const target = versions?.find((v) => v.version === body.to_version);
    if (versions === undefined || target === undefined) return notFound();
    for (const v of versions) if (v.status === 'active') v.status = 'archived';
    target.status = 'active';
    target.activated_at = iso(now);
    return ok({ key: params.key, version: target.version, status: target.status });
  },
  'POST /ai/prompts/:key/versions/:v/archive': ({ params }) => {
    const version = d()
      .prompts.get(params.key ?? '')
      ?.find((v) => v.version === Number(params.v));
    if (version === undefined) return notFound();
    if (version.status === 'active') return conflict('active_version');
    version.status = 'archived';
    return ok({ key: params.key, version: version.version, status: version.status });
  },
  'GET /ai/feedback/aggregates': ({ query }) => {
    const groups = new Map<string, { positive: number; negative: number }>();
    for (const row of d().aiFeedback) {
      const key =
        (query.group_by === 'model'
          ? row.model
          : query.group_by === 'prompt_version'
            ? row.prompt_version
            : row.feature) ?? 'unknown';
      const entry = groups.get(key) ?? { positive: 0, negative: 0 };
      if (row.rating === 1) entry.positive += 40;
      else entry.negative += 9;
      groups.set(key, entry);
    }
    return ok(
      [...groups.entries()].map(([key, v]) => ({
        key,
        ...v,
        rate: v.positive / (v.positive + v.negative),
      })),
    );
  },
  'GET /ai/feedback': ({ query }) =>
    paged(d().aiFeedback, query, { filters: { rating: (row, v) => String(row.rating) === v } }),
  'POST /ai/feedback/:id/reveal': ({ params }) => {
    const comment = d().aiFeedbackComments.get(params.id ?? '');
    return d().aiFeedback.some((f) => f.id === params.id)
      ? ok({ value: comment ?? '—', expires_in_s: 60 })
      : notFound();
  },

  // Subscriptions and referrals
  'GET /subscriptions/metrics': ({ permissions }) =>
    ok({
      active_pro: 1_204,
      trials: 238,
      cancelled: 61,
      expired: 44,
      refunded: 3,
      ...(permissions.includes('metrics.revenue.read')
        ? { mrr_usd: 5_318.4, arr_estimate_usd: 63_820.8 }
        : {}),
      by_store: { app_store: 842, play_store: 362 },
      by_product: { da_pro_monthly: 911, da_pro_annual: 293 },
      renewal_rate: 0.86,
      store_pro: 1_204,
      grant_pro: 97,
      both: 12,
    }),
  'GET /subscriptions': ({ query }) =>
    paged(d().subscriptions, query, {
      filters: { product: (row, v) => row.product_id === v, environment: () => true },
      search: (row, q) => row.user_id.startsWith(q),
    }),
  'GET /subscriptions/events': ({ query }) =>
    mapPage(
      paged(d().billingEvents, query, { filters: { user: (row, v) => row.user_id === v } }),
      (e: Dataset['billingEvents'][number]) => ({
        event_id: e.event_id,
        type: e.type,
        environment: e.environment,
        received_at: e.received_at,
        processed: e.processed_at !== null,
      }),
    ),
  'GET /subscriptions/trial-stream': ({ now }) =>
    ok({
      events: d()
        .users.filter((u) => u.plan === 'trial' || u.plan === 'pro')
        .slice(0, 5)
        .map((u, i) => ({
          event_id: `evt_trial_${String(i)}`,
          kind:
            (
              [
                'trial_started',
                'trial_converted',
                'trial_cancelled',
                'trial_expired',
                'trial_started',
              ] as const
            )[i] ?? 'trial_started',
          email_masked: maskEmail(u.email),
          product_id: 'da_pro_monthly',
          store: u.platform === 'android' ? 'play_store' : 'app_store',
          event_at: iso(now - (i + 1) * 11 * HOUR),
        })),
      summary: { conversions: 74, trial_expirations: 161, conversion_rate: 0.31 },
    }),
  'GET /subscriptions/events/:id': ({ params }) => {
    const event = d().billingEvents.find((e) => e.event_id === params.id);
    return event === undefined ? notFound() : ok(event);
  },
  'GET /entitlement-grants': ({ query, now }) =>
    paged(
      d().grants.map((g) => ({ ...g.row, state: grantState(g.row, now) })),
      query,
      {
        filters: {
          granted_by_admin_id: (row, v) =>
            v === ADMIN_ID ? row.granted_by === ADMIN_EMAIL : false,
        },
      },
    ),
  'POST /subscriptions/:userId/sync': ({ params, now }) =>
    user(params.userId) === undefined
      ? notFound()
      : ok({ job: jobRef(now, 'billing_sync', params.userId ?? null) }, 202),
  'GET /referrals/metrics': () =>
    ok({
      invites: 1_120,
      signups: 402,
      qualified: 188,
      rewarded: 173,
      conversion: 0.168,
      bonus_days_granted: 2_632,
      flagged: d().referrals.filter((r) => r.status === 'flagged').length,
    }),
  'GET /referrals': ({ query }) =>
    paged(d().referrals, query, {
      search: (row, q) => row.code.toLowerCase().includes(q) || row.referrer_id.startsWith(q),
    }),
  'POST /referrals/:id/approve': ({ params }) => reviewReferral(params.id, 'qualified'),
  'POST /referrals/:id/reject': ({ params }) => reviewReferral(params.id, 'rejected'),

  // Feedback
  'GET /feedback': ({ query }) =>
    mapPage(
      paged(d().feedback, query, {
        filters: { assignee: () => true },
        search: (row, q) => (row.message ?? '').toLowerCase().includes(q),
      }),
      ({ user_email: _e, ...row }: Dataset['feedback'][number]) => row,
    ),
  'GET /feedback/summary': () => {
    const rows = d().feedback;
    const count = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).length;
    return ok({
      by_type: {
        bug: count((r) => r.type === 'bug'),
        feature: count((r) => r.type === 'feature'),
        general: count((r) => r.type === 'general'),
        ai_quality: count((r) => r.type === 'ai_quality'),
      },
      rating_distribution: {
        1: count((r) => r.rating === 1),
        2: count((r) => r.rating === 2),
        3: count((r) => r.rating === 3),
        4: count((r) => r.rating === 4),
        5: count((r) => r.rating === 5),
        unrated: count((r) => r.rating === null),
      },
      by_app_version: [
        ...new Set(rows.map((r) => r.app_version).filter((v): v is string => v !== null)),
      ].map((v) => ({ app_version: v, count: count((r) => r.app_version === v) })),
      by_status: {
        new: count((r) => r.status === 'new'),
        triaged: count((r) => r.status === 'triaged'),
        planned: count((r) => r.status === 'planned'),
        closed: count((r) => r.status === 'closed'),
      },
    });
  },
  'PATCH /feedback/:id': ({ params, body }) => {
    const row = d().feedback.find((f) => f.id === params.id);
    if (row === undefined) return notFound();
    if (typeof body.status === 'string') row.status = body.status as typeof row.status;
    if (body.assignee_admin_id !== undefined)
      row.assignee =
        d().admins.find((a) => a.row.id === body.assignee_admin_id)?.display_name ?? null;
    const { user_email: _e, ...rest } = row;
    return ok(rest);
  },
  'POST /feedback/:id/reveal': ({ params }) => {
    const row = d().feedback.find((f) => f.id === params.id);
    const email = row?.user_email ?? null;
    return email === null ? notFound() : ok({ value: email, expires_in_s: 60 });
  },

  // Flags
  'GET /flags': ({ query }) =>
    ok(
      d()
        .flags.filter((f) =>
          query['filter[archived]'] === true ? f.archived_at !== null : f.archived_at === null,
        )
        .map((f) => f.row),
    ),
  'GET /flags/:key': ({ params }) => {
    const flag = d().flags.find((f) => f.row.key === params.key);
    return flag === undefined
      ? notFound()
      : ok({
          ...flag.row,
          description: flag.description,
          is_kill_switch: isKillSwitchKey(flag.row.key),
          archived_at: flag.archived_at,
          overrides: flag.overrides,
          history: flag.history,
        });
  },
  'GET /flags/:key/evaluate': ({ params, query }) => {
    const flag = d().flags.find((f) => f.row.key === params.key);
    if (flag === undefined) return notFound();
    const userId = String(query.user_id);
    const bucket = parseInt(userId.replace(/-/g, '').slice(-2), 16) % 100;
    const override = flag.overrides.find((o) => o.user_id === userId);
    const plan = user(userId)?.plan === 'free' ? 'free' : 'pro';
    const result =
      flag.archived_at !== null
        ? { value: false, matched_rule: 'archived' as const }
        : !flag.row.enabled
          ? { value: false, matched_rule: 'disabled' as const }
          : override !== undefined
            ? { value: override.enabled, matched_rule: 'override' as const }
            : flag.row.plans.length > 0 && !flag.row.plans.includes(plan)
              ? { value: false, matched_rule: 'plan' as const }
              : flag.row.rollout_percent < 100
                ? { value: bucket < flag.row.rollout_percent, matched_rule: 'percentage' as const }
                : { value: true, matched_rule: 'default' as const };
    return ok({ key: flag.row.key, user_id: userId, bucket, ...result });
  },
  'POST /flags': ({ body, now }) => {
    if (d().flags.some((f) => f.row.key === body.key)) return conflict('flag_exists');
    const row = {
      key: String(body.key),
      enabled: false,
      rollout_percent: Number(body.rollout_percent ?? 0),
      platforms: (body.platforms ?? []) as ('ios' | 'android')[],
      plans: (body.plans ?? []) as ('free' | 'pro')[],
      min_version: (body.min_version ?? null) as string | null,
      max_version: (body.max_version ?? null) as string | null,
      payload: body.payload ?? null,
      updated_by: ADMIN_EMAIL,
      updated_at: iso(now),
    };
    d().flags.push({
      row,
      description: String(body.description),
      archived_at: null,
      overrides: [],
      history: [],
    });
    return ok(row, 201);
  },
  'PATCH /flags/:key': ({ params, body, now }) => {
    const flag = d().flags.find((f) => f.row.key === params.key);
    if (flag === undefined) return notFound();
    const before = { ...flag.row };
    const { reason, ...patch } = body;
    Object.assign(flag.row, patch, { updated_by: ADMIN_EMAIL, updated_at: iso(now) });
    flag.history.unshift({
      ts: iso(now),
      actor: ADMIN_EMAIL,
      action: 'admin.flag.updated',
      reason: String(reason),
      before: { enabled: before.enabled, rollout_percent: before.rollout_percent },
      after: { enabled: flag.row.enabled, rollout_percent: flag.row.rollout_percent },
    });
    return ok(flag.row);
  },
  'POST /flags/:key/kill': ({ params, body, now }) => {
    const flag = d().flags.find((f) => f.row.key === params.key);
    if (flag === undefined) return notFound();
    flag.row.enabled = false;
    flag.row.updated_by = ADMIN_EMAIL;
    flag.row.updated_at = iso(now);
    flag.history.unshift({
      ts: iso(now),
      actor: ADMIN_EMAIL,
      action: 'admin.flag.killed',
      reason: String(body.reason),
      before: { enabled: true },
      after: { enabled: false },
    });
    return ok(flag.row);
  },
  'POST /flags/:key/archive': ({ params, now }) => {
    const flag = d().flags.find((f) => f.row.key === params.key);
    if (flag === undefined) return notFound();
    if (isKillSwitchKey(flag.row.key)) return conflict('kill_switch_not_archivable');
    flag.archived_at = iso(now);
    return ok(flag.row);
  },
  'POST /flags/:key/overrides': ({ params, body, now }) => {
    const flag = d().flags.find((f) => f.row.key === params.key);
    const u = user(String(body.user_id));
    if (flag === undefined || u === undefined) return notFound();
    flag.overrides = [
      ...flag.overrides.filter((o) => o.user_id !== u.id),
      {
        user_id: u.id,
        email_masked: maskEmail(u.email),
        enabled: body.enabled === true,
        expires_at: null,
        created_at: iso(now),
      },
    ];
    return ok({ key: flag.row.key, user_id: u.id, enabled: body.enabled === true }, 201);
  },
  'DELETE /flags/:key/overrides/:userId': ({ params }) => {
    const flag = d().flags.find((f) => f.row.key === params.key);
    if (!flag?.overrides.some((o) => o.user_id === params.userId)) return notFound();
    flag.overrides = flag.overrides.filter((o) => o.user_id !== params.userId);
    return ok({ key: flag.row.key, user_id: params.userId, enabled: null });
  },

  // Announcements
  'GET /announcements': ({ query }) =>
    mapPage(
      paged(d().announcements, query, {
        filters: { status: (a, v) => a.detail.status === v },
        search: (a, q) =>
          a.detail.title_tr.toLowerCase().includes(q) ||
          a.detail.title_en.toLowerCase().includes(q),
        sortKey: (a) => a.detail.starts_at,
      }),
      (a: Dataset['announcements'][number]) => announcementRow(a),
    ),
  'POST /announcements/audience-estimate': ({ body }) => {
    const users = d().users.filter(
      (u) =>
        (body.audience === 'all' ||
          (body.audience === 'pro' ? u.plan !== 'free' : u.plan === 'free')) &&
        (body.platforms as string[]).includes(u.platform ?? ''),
    );
    return ok({ estimated_users: users.length * 1_040 });
  },
  'GET /announcements/:id': ({ params }) => {
    const a = d().announcements.find((x) => x.detail.id === params.id);
    return a === undefined ? notFound() : ok(a.detail);
  },
  'POST /announcements': ({ body, now }) => {
    const id = uid('cccc', 100 + d().announcements.length);
    const detail = {
      id,
      title_tr: String(body.title_tr),
      title_en: String(body.title_en),
      body_tr: String(body.body_tr),
      body_en: String(body.body_en),
      audience: body.audience as 'all',
      platforms: body.platforms as ('ios' | 'android')[],
      status: 'draft' as const,
      starts_at: String(body.starts_at),
      ends_at: typeof body.ends_at === 'string' ? body.ends_at : null,
      min_version: typeof body.min_version === 'string' ? body.min_version : null,
      max_version: typeof body.max_version === 'string' ? body.max_version : null,
      cta_route: typeof body.cta_route === 'string' ? body.cta_route : null,
      published_at: null,
      cancelled_at: null,
      dismissal_count: 0,
      created_by: ADMIN_EMAIL,
      updated_at: iso(now),
    };
    d().announcements.unshift({ detail });
    return ok(announcementRow({ detail }), 201);
  },
  'PATCH /announcements/:id': ({ params, body, now }) => {
    const a = d().announcements.find((x) => x.detail.id === params.id);
    if (a === undefined) return notFound();
    if (a.detail.status !== 'draft' && a.detail.status !== 'scheduled')
      return conflict('not_editable');
    Object.assign(a.detail, body, { updated_at: iso(now) });
    return ok(announcementRow(a));
  },
  'POST /announcements/:id/preview': ({ params, body }) => {
    const a = d().announcements.find((x) => x.detail.id === params.id);
    if (a === undefined) return notFound();
    const tr = body.locale === 'tr';
    return ok({
      id: a.detail.id,
      title: tr ? a.detail.title_tr : a.detail.title_en,
      body: tr ? a.detail.body_tr : a.detail.body_en,
      cta_route: a.detail.cta_route,
      ends_at: a.detail.ends_at,
    });
  },
  'POST /announcements/:id/schedule': ({ params, now }) => {
    const a = d().announcements.find((x) => x.detail.id === params.id);
    if (a === undefined) return notFound();
    if (a.detail.status !== 'draft') return conflict('not_draft');
    a.detail.status = Date.parse(a.detail.starts_at) <= now ? 'live' : 'scheduled';
    if (a.detail.status === 'live') a.detail.published_at = iso(now);
    return ok(announcementRow(a));
  },
  'POST /announcements/:id/cancel': ({ params, now }) => {
    const a = d().announcements.find((x) => x.detail.id === params.id);
    if (a === undefined) return notFound();
    if (a.detail.status !== 'scheduled' && a.detail.status !== 'live')
      return conflict('not_cancellable');
    a.detail.status = 'cancelled';
    a.detail.cancelled_at = iso(now);
    return ok(announcementRow(a));
  },

  // Data requests and audit
  'GET /data-requests': ({ query }) => {
    const kind = query.tab === 'exports' ? 'export' : query.tab;
    return mapPage(
      paged(
        d().dataRequests.filter((r) => r.row.kind === kind),
        query,
        {
          filters: { status: (r, v) => r.row.status === v },
          sortKey: (r, sort) => (sort === 'completed_at' ? r.row.completed_at : r.row.requested_at),
        },
      ),
      (r: Dataset['dataRequests'][number]) => r.row,
    );
  },
  'GET /data-requests/:kind/:id': ({ params }) => {
    const r = d().dataRequests.find((x) => x.row.id === params.id && x.row.kind === params.kind);
    return r === undefined ? notFound() : ok({ ...r.row, job: r.job, steps: r.steps });
  },
  'POST /data-requests/:kind/:id/retry': ({ params, now }) => {
    const r = d().dataRequests.find((x) => x.row.id === params.id && x.row.kind === params.kind);
    if (r === undefined) return notFound();
    if (r.row.status !== 'failed') return conflict('not_failed');
    r.row.status = params.kind === 'export' ? 'processing' : 'queued';
    const job = newJob(
      now,
      params.kind === 'export'
        ? 'export'
        : params.kind === 'history_deletion'
          ? 'history_deletion'
          : 'account_deletion',
      r.user_id,
    );
    r.job = { id: job.job_id, status: 'queued', progress: null };
    for (const step of r.steps) if (step.status === 'failed') step.status = 'pending';
    return ok({ id: r.row.id, job_id: job.job_id }, 202);
  },
  'POST /data-requests/export/:id/regenerate': ({ params, now }) => {
    const r = d().dataRequests.find((x) => x.row.id === params.id && x.row.kind === 'export');
    if (r === undefined) return notFound();
    if (r.row.status !== 'expired') return conflict('not_expired');
    r.row.status = 'processing';
    const job = newJob(now, 'export', r.user_id);
    return ok({ export_request_id: r.row.id, job_id: job.job_id }, 202);
  },
  'GET /audit': ({ query }) =>
    mapPage(
      paged([...d().audit].reverse(), query, {
        filters: {
          actor_id: (a, v) => a.actor_id === v,
          actor_role: (a, v) => a.row.role === v,
          action: (a, v) => a.row.action === v,
          target_type: (a, v) => a.row.target_type === v,
          target_id: (a, v) => a.row.target_id === v,
          result: (a, v) => a.row.result === v,
          from: (a, v) => a.row.ts >= String(v),
          to: (a, v) => a.row.ts <= String(v),
        },
        sortKey: (a) => a.row.ts,
      }),
      auditListRow,
    ),
  'GET /audit/verify-chain': () => ok({ verified: true }),
  'GET /audit/:id': ({ params }) => {
    const a = d().audit.find((x) => x.row.id === params.id);
    return a === undefined ? notFound() : ok(a.row);
  },

  // Health
  'GET /health/summary': ({ now }) =>
    ok({
      components: d().health,
      credential_expiry: [
        { key: 'apns_auth_key', not_after: iso(now + 41 * DAY), days_left: 41 },
        { key: 'google_oauth_client_secret', not_after: null, days_left: null },
        { key: 'microsoft_client_secret', not_after: iso(now + 12 * DAY), days_left: 12 },
      ],
    }),
  'GET /health/history': ({ query, now }) => {
    const component = query.component as Dataset['health'][number]['component'];
    const current = d().health.find((h) => h.component === component);
    const hours = query.range === '30d' ? 30 * 24 : query.range === '7d' ? 7 * 24 : 24;
    const step = Math.max(1, Math.round(hours / 24));
    return ok(
      Array.from({ length: 24 }, (_, i) => ({
        checked_at: iso(now - i * step * HOUR),
        component,
        status:
          i === 5 && current?.status === 'healthy'
            ? ('degraded' as const)
            : (current?.status ?? 'unknown'),
        latency_ms: current?.latency_ms === null ? null : (current?.latency_ms ?? 50) + (i % 5) * 7,
        detail_code: current?.detail_code ?? null,
        checked_by: i === 0 ? ('admin' as const) : ('cron' as const),
      })),
    );
  },
  'POST /health/run': ({ body, now }) => {
    const probes = (body.probes as string[] | undefined) ?? d().health.map((h) => h.component);
    const results = d()
      .health.filter((h) => probes.includes(h.component))
      .map((h) => {
        h.checked_at = iso(now);
        return {
          probe: h.component,
          status: h.status,
          latency_ms: h.latency_ms,
          detail_code: h.detail_code,
          checked_at: h.checked_at,
        };
      });
    return ok({ results });
  },
  'GET /health/app-versions': () =>
    ok({
      versions: [
        {
          platform: 'ios',
          app_version: '1.4.2',
          installations: 3_912,
          sync_error_rate: 0.004,
          below_minimum: false,
        },
        {
          platform: 'ios',
          app_version: '1.4.1',
          installations: 2_207,
          sync_error_rate: 0.006,
          below_minimum: false,
        },
        {
          platform: 'ios',
          app_version: '1.3.9',
          installations: 318,
          sync_error_rate: 0.031,
          below_minimum: true,
        },
        {
          platform: 'android',
          app_version: '1.3.9',
          installations: 2_644,
          sync_error_rate: 0.008,
          below_minimum: false,
        },
        {
          platform: 'android',
          app_version: '1.3.7',
          installations: 205,
          sync_error_rate: 0.044,
          below_minimum: true,
        },
      ],
    }),
  'GET /health/cron': ({ now }) =>
    ok({
      schedules: [
        {
          name: 'briefing-scheduler',
          last_run_at: iso(now - 60_000),
          duration_ms: 1_420,
          status: 'succeeded',
        },
        {
          name: 'watch-renewal',
          last_run_at: iso(now - 15 * 60_000),
          duration_ms: 8_230,
          status: 'succeeded',
        },
        {
          name: 'push-receipts',
          last_run_at: iso(now - 5 * 60_000),
          duration_ms: 2_110,
          status: 'failed',
        },
        {
          name: 'retention',
          last_run_at: iso(now - 9 * HOUR),
          duration_ms: 64_900,
          status: 'succeeded',
        },
        { name: 'health-probes', last_run_at: null, duration_ms: null, status: null },
      ],
      worker_lag_s: 4.2,
    }),

  // Admins and settings
  'GET /admins': () => ok(d().admins.map((a) => a.row)),
  'POST /admins/invite': ({ body }) => {
    if (d().admins.some((a) => a.row.email === body.email)) return conflict('admin_exists');
    const row = {
      id: uid('0000', 100 + d().admins.length),
      email: String(body.email),
      role: body.role as 'readonly',
      status: 'invited' as const,
      last_login_at: null,
      mfa_enrolled: false,
    };
    d().admins.push({ row, display_name: String(body.full_name) });
    return ok(row, 201);
  },
  'PATCH /admins/:id': ({ params, body }) =>
    adminChange(params.id, { kind: 'update', role: body.role as 'readonly' }, (a) => {
      a.row.role = body.role as 'readonly';
    }),
  'POST /admins/:id/disable': ({ params }) =>
    adminChange(params.id, { kind: 'update', status: 'disabled' }, (a) => {
      a.row.status = 'disabled';
    }),
  'POST /admins/:id/enable': ({ params }) =>
    adminChange(params.id, { kind: 'update', status: 'active' }, (a) => {
      a.row.status = 'active';
    }),
  'POST /admins/:id/reset-mfa': ({ params }) =>
    adminChange(params.id, { kind: 'mfa_reset' }, (a) => {
      a.row.mfa_enrolled = false;
    }),
  'POST /admins/:id/revoke-sessions': ({ params }) =>
    params.id === ADMIN_ID
      ? conflict('self_change_forbidden')
      : d().admins.some((a) => a.row.id === params.id)
        ? ok({ ended_sessions: 2 })
        : notFound(),
  'POST /admins/:id/resend-invite': ({ params }) => {
    const a = d().admins.find((x) => x.row.id === params.id);
    return a === undefined
      ? notFound()
      : a.row.status !== 'invited'
        ? conflict('not_invited')
        : ok(a.row);
  },
  'POST /admins/:id/unlock': ({ params }) => {
    const a = d().admins.find((x) => x.row.id === params.id);
    return a === undefined ? notFound() : ok(a.row);
  },
  'GET /settings': () => ok({ plan_limits: d().planLimits, app_settings: d().appSettings }),
  'PATCH /settings/plan-limits': ({ body }) => {
    const plan = body.plan as 'free' | 'pro';
    const key = body.key as keyof Dataset['planLimits']['free'];
    const before = d().planLimits[plan][key];
    (d().planLimits[plan] as Record<string, unknown>)[key] = body.value;
    return ok({ key, before, after: body.value });
  },
  'PATCH /settings/config/:key': ({ params, body }) => {
    const key = params.key ?? '';
    const before = d().appSettings[key];
    if (
      key.startsWith('session.') &&
      typeof before === 'number' &&
      typeof body.value === 'number' &&
      body.value > before
    ) {
      return fail(422, 'VALIDATION_FAILED', { reason: 'session_tighten_only' });
    }
    d().appSettings[key] = body.value;
    return ok({ key, before, after: body.value });
  },
};

function auditListRow(a: MockAudit) {
  return {
    id: a.row.id,
    ts: a.row.ts,
    actor: a.row.actor,
    role: a.row.role,
    action: a.row.action,
    target: a.row.target_type === null ? null : `${a.row.target_type}:${a.row.target_id ?? ''}`,
    reason: a.row.reason,
    result: a.row.result,
    correlation_id: a.row.correlation_id,
  };
}

function promptSummary(v: Dataset['prompts'] extends Map<string, (infer V)[]> ? V : never) {
  return {
    version: v.version,
    status: v.status,
    created_by: v.created_by,
    created_at: v.created_at,
    activated_at: v.activated_at,
    telemetry: {
      requests: v.requests,
      error_rate: v.error_rate,
      feedback_positive_rate: v.feedback_positive_rate,
    },
  };
}

function announcementRow(a: Dataset['announcements'][number]) {
  const { id, title_tr, title_en, audience, platforms, status, starts_at, ends_at } = a.detail;
  return { id, title_tr, title_en, audience, platforms, status, starts_at, ends_at };
}

function reviewReferral(id: string | undefined, status: 'qualified' | 'rejected'): Outcome {
  const referral = d().referrals.find((r) => r.id === id);
  if (referral === undefined) return notFound();
  if (referral.status !== 'flagged' && referral.status !== 'pending')
    return conflict('not_reviewable');
  referral.status = status;
  return ok({ id: referral.id, status: referral.status });
}

function adminChange(
  id: string | undefined,
  change: Parameters<typeof checkAdminChange>[0]['change'],
  apply: (admin: Dataset['admins'][number]) => void,
): Outcome {
  const admin = d().admins.find((a) => a.row.id === id);
  if (admin === undefined) return notFound();
  const violation = checkAdminChange({
    admins: d().admins.map((a) => a.row),
    targetId: admin.row.id,
    callerId: ADMIN_ID,
    change,
  });
  if (violation !== null) return conflict(violation);
  apply(admin);
  return ok(admin.row);
}

/** Projects the rows of a paged outcome (internal fields dropped before the contract check). */
function mapPage(outcome: Outcome, map: (row: never) => unknown): Outcome {
  if (!outcome.ok || !Array.isArray(outcome.data)) return outcome;
  return { ...outcome, data: (outcome.data as never[]).map(map) };
}

export function handleModule(ctx: Ctx): Outcome | null {
  const handler = handlers[ctx.key];
  return handler === undefined ? null : handler(ctx);
}

export function mainUser(): MockUser | undefined {
  return user(MAIN_USER_ID);
}
