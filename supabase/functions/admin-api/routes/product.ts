/**
 * ADM-13 feedback, ADM-14 feature flags, ADM-15 announcements (API_CONTRACTS §12.3; BACKOFFICE_PLAN
 * §6.16–§6.18; R-10, R-25; T-10.12).
 *
 * Flags: `flags.write`, or `flags.write_ai` for `ai.*` / `voice.*` keys only (checked here and in
 * SQL); kill switches are never archived; `POST /flags` creates only (an existing key is a
 * conflict); `PATCH /flags/:key` merges the targeting with the stored flag before `flag_upsert`,
 * which replaces the targeting columns. Announcements take app routes (`/flow/today`) and store
 * them as `dijitalasistan://` deep links; the list is paged in admin-api.
 */
import { admin as A } from '@da/validation';
import type { z } from 'zod';
import { AppError, fieldError } from '../../_shared/errors.ts';
import { filterValue, listArgs, pageRows, paged } from '../lib/list.ts';
import {
  arr,
  count,
  deeplinkToRoute,
  type Json,
  num,
  obj,
  routeToDeeplink,
  str,
} from '../lib/map.ts';
import { defineRoutes, type RouteCtx } from '../lib/route.ts';

// ── ADM-13 Feedback ──────────────────────────────────────────────────────────

function feedbackRow(f: Json) {
  const rating = num(f.rating);
  return {
    id: f.id,
    type: f.type,
    rating: rating === null ? null : Math.min(5, Math.max(1, Math.round(rating))),
    message: str(f.message),
    screen: str(f.screen),
    status: f.status,
    platform: str(f.platform),
    app_version: str(f.app_version),
    assignee: str(f.assigned_admin_id),
    user_email_masked: str(f.contact_email_masked),
    created_at: f.created_at,
  };
}

async function feedbackSummary(ctx: RouteCtx) {
  const query = ctx.query as z.infer<typeof A.FeedbackSummaryQuery>;
  const filter: Json = {};
  if (filterValue(ctx.query, 'platform') !== undefined)
    filter.platform = filterValue(ctx.query, 'platform');
  if (filterValue(ctx.query, 'app_version') !== undefined)
    filter.app_version = filterValue(ctx.query, 'app_version');
  const s = obj(await ctx.db.call('feedback_summary', { p_range: query.range, p_filter: filter }));
  const byType = obj(s.by_type);
  const ratings = obj(s.rating_distribution);
  const byStatus = obj(s.by_status);
  return {
    data: {
      by_type: {
        bug: count(byType.bug),
        feature: count(byType.feature),
        general: count(byType.general),
        ai_quality: count(byType.ai_quality),
      },
      rating_distribution: {
        1: count(ratings['1']),
        2: count(ratings['2']),
        3: count(ratings['3']),
        4: count(ratings['4']),
        5: count(ratings['5']),
        unrated: count(ratings.unrated),
      },
      by_app_version: arr(s.by_app_version).map((v) => ({
        app_version: str(v.app_version) ?? 'unknown',
        count: count(v.count),
      })),
      by_status: {
        new: count(byStatus.new),
        triaged: count(byStatus.triaged),
        planned: count(byStatus.planned),
        closed: count(byStatus.closed),
      },
    },
  };
}

async function feedbackReveal(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.FeedbackRevealBody>;
  const out = obj(
    await ctx.db.call('feedback_reveal', { p_id: String(ctx.params.id), p_reason: body.reason }),
  );
  const value = obj(out.value);
  const message = str(value.message) ?? '';
  const contact = str(value.contact_email);
  return {
    data: { value: contact === null ? message : `${message}\n\n${contact}`, expires_in_s: 60 },
  };
}

// ── ADM-14 Feature flags ─────────────────────────────────────────────────────

function flagRow(f: Json) {
  return {
    key: f.key,
    enabled: f.enabled === true,
    rollout_percent: Math.min(100, count(f.rollout_percent)),
    platforms: Array.isArray(f.platforms) ? f.platforms : [],
    plans: (Array.isArray(f.plans) ? f.plans : []).filter((p) => p === 'free' || p === 'pro'),
    min_version: str(f.min_version),
    max_version: str(f.max_version),
    payload: f.payload ?? null,
    updated_by: str(f.updated_by),
    updated_at: f.updated_at,
  };
}

/** `flags.write_ai` may only touch `ai.*` / `voice.*` keys (R-10). */
function assertFlagWriter(ctx: RouteCtx, key: string): void {
  if (!ctx.can('flags.write') && !A.isAiFlagKey(key)) {
    throw new AppError('FORBIDDEN', { details: { permission: 'flags.write' } });
  }
}

function payloadArg(key: string, payload: unknown): unknown {
  if (!A.flagPayloadValid(key, payload)) throw fieldError('payload', 'payload_invalid');
  return payload === undefined ? null : payload;
}

async function flagDetail(ctx: RouteCtx) {
  const f = obj(await ctx.db.call('flag_get', { p_key: String(ctx.params.key) }));
  return {
    data: {
      ...flagRow(f),
      description: str(f.description),
      is_kill_switch: f.is_kill_switch === true,
      archived_at: str(f.archived_at),
      overrides: arr(f.overrides).map((o) => ({
        user_id: o.user_id,
        email_masked: str(o.email_masked),
        enabled: o.enabled === true,
        expires_at: str(o.expires_at),
        created_at: o.created_at,
      })),
      history: arr(f.history)
        .slice(0, 50)
        .map((h) => ({
          ts: h.ts,
          actor: str(h.actor) ?? 'system',
          action: h.action,
          reason: str(h.reason),
          before: h.before ?? null,
          after: h.after ?? null,
        })),
    },
  };
}

async function flagCreate(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.FlagCreateBody>;
  assertFlagWriter(ctx, body.key);
  let exists = true;
  try {
    await ctx.db.call('flag_get', { p_key: body.key });
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error;
    exists = false;
  }
  if (exists) throw new AppError('STATE_CONFLICT', { details: { reason: 'flag_exists' } });
  const f = obj(
    await ctx.db.call('flag_upsert', {
      p_key: body.key,
      p_description: body.description,
      p_enabled: false,
      p_rollout: body.rollout_percent,
      p_platforms: body.platforms.length === 0 ? null : body.platforms,
      p_plans: body.plans.length === 0 ? null : body.plans,
      p_min_ver: body.min_version,
      p_max_ver: body.max_version,
      p_payload: payloadArg(body.key, body.payload),
      p_reason: body.reason,
    }),
  );
  return { data: flagRow(f), status: 201 as const };
}

async function flagPatch(ctx: RouteCtx) {
  const key = String(ctx.params.key);
  const body = ctx.body as z.infer<typeof A.FlagPatchBody>;
  assertFlagWriter(ctx, key);
  const current = obj(await ctx.db.call('flag_get', { p_key: key }));
  const platforms = body.platforms ?? (Array.isArray(current.platforms) ? current.platforms : []);
  const plans = body.plans ?? (Array.isArray(current.plans) ? current.plans : []);
  const f = obj(
    await ctx.db.call('flag_upsert', {
      p_key: key,
      p_description: null,
      p_enabled: body.enabled ?? null,
      p_rollout: body.rollout_percent ?? null,
      p_platforms: platforms.length === 0 ? null : platforms,
      p_plans: plans.length === 0 ? null : plans,
      p_min_ver: body.min_version === undefined ? str(current.min_version) : body.min_version,
      p_max_ver: body.max_version === undefined ? str(current.max_version) : body.max_version,
      p_payload: body.payload === undefined ? null : payloadArg(key, body.payload),
      p_reason: body.reason,
    }),
  );
  return { data: flagRow(f) };
}

async function flagArchive(ctx: RouteCtx) {
  const key = String(ctx.params.key);
  const body = ctx.body as z.infer<typeof A.FlagArchiveBody>;
  assertFlagWriter(ctx, key);
  if (A.isKillSwitchKey(key))
    throw new AppError('STATE_CONFLICT', { details: { reason: 'kill_switch' } });
  return {
    data: flagRow(obj(await ctx.db.call('flag_archive', { p_key: key, p_reason: body.reason }))),
  };
}

// ── ADM-15 Announcements ─────────────────────────────────────────────────────

function announcementRow(a: Json) {
  return {
    id: a.id,
    title_tr: a.title_tr,
    title_en: a.title_en,
    audience: a.audience,
    platforms: Array.isArray(a.platforms) ? a.platforms : [],
    status: a.status,
    starts_at: a.starts_at,
    ends_at: str(a.ends_at),
  };
}

type AnnouncementFields = Partial<z.infer<typeof A.AnnouncementBody>>;

/** Contract fields → `announcement_upsert(p_fields)` (the deep-link form of `cta_route`). */
function announcementFields(body: AnnouncementFields): Json {
  const fields: Json = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    if (key === 'cta_route') fields.cta_deeplink = routeToDeeplink(String(value));
    else fields[key] = value;
  }
  return fields;
}

async function announcementDetail(ctx: RouteCtx) {
  const a = obj(await ctx.db.call('announcement_get', { p_id: String(ctx.params.id) }));
  return {
    data: {
      ...announcementRow(a),
      body_tr: str(a.body_tr) ?? '',
      body_en: str(a.body_en) ?? '',
      min_version: str(a.min_version),
      max_version: str(a.max_version),
      cta_route: deeplinkToRoute(a.cta_deeplink),
      published_at: str(a.published_at),
      cancelled_at: str(a.cancelled_at),
      dismissal_count: count(a.dismissal_count),
      created_by: str(a.created_by),
      updated_at: a.updated_at,
    },
  };
}

async function announcementPreview(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.AnnouncementPreviewBody>;
  const a = obj(await ctx.db.call('announcement_get', { p_id: String(ctx.params.id) }));
  const en = body.locale === 'en';
  return {
    data: {
      id: a.id,
      title: str(en ? a.title_en : a.title_tr) ?? '',
      body: str(en ? a.body_en : a.body_tr) ?? '',
      cta_route: deeplinkToRoute(a.cta_deeplink),
      ends_at: str(a.ends_at),
    },
  };
}

export const productRoutes = defineRoutes({
  'GET /feedback': {
    rate: 'R',
    async handle(ctx) {
      const out = await ctx.db.call(
        'feedback_list',
        listArgs(ctx.query, {
          filters: {
            type: 'type',
            status: 'status',
            platform: 'platform',
            app_version: 'app_version',
            assignee: 'assignee',
          },
        }),
      );
      return paged(ctx.query, out, feedbackRow);
    },
  },
  'GET /feedback/summary': { rate: 'R', handle: feedbackSummary },
  'PATCH /feedback/:id': {
    rate: 'M',
    async handle(ctx) {
      const body = ctx.body as z.infer<typeof A.FeedbackPatchBody>;
      const f = obj(
        await ctx.db.call('feedback_update', {
          p_id: String(ctx.params.id),
          p_status: body.status ?? null,
          p_assignee: body.assignee_admin_id ?? null,
          p_reason: null,
        }),
      );
      return { data: feedbackRow(f) };
    },
  },
  'POST /feedback/:id/reveal': { rate: 'X', replay: 'refuse', handle: feedbackReveal },
  'GET /flags': {
    rate: 'R',
    async handle(ctx) {
      const archived = filterValue(ctx.query, 'archived') === 'true';
      const out = obj(await ctx.db.call('flags_list', { p_filter: { archived } }));
      return { data: arr(out.rows).map(flagRow) };
    },
  },
  'GET /flags/:key': { rate: 'R', handle: flagDetail },
  'GET /flags/:key/evaluate': {
    rate: 'R',
    async handle(ctx) {
      const query = ctx.query as z.infer<typeof A.FlagEvaluateQuery>;
      const e = obj(
        await ctx.db.call('flag_evaluate_preview', {
          p_key: String(ctx.params.key),
          p_user: query.user_id,
          p_platform: query.platform ?? null,
          p_app_version: query.app_version ?? null,
        }),
      );
      return {
        data: {
          key: e.key,
          user_id: e.user_id,
          value: e.value === true,
          matched_rule: e.matched_rule,
          bucket: Math.min(99, count(e.bucket)),
        },
      };
    },
  },
  'POST /flags': { rate: 'X', handle: flagCreate },
  'PATCH /flags/:key': { rate: 'X', handle: flagPatch },
  'POST /flags/:key/kill': {
    rate: 'X',
    async handle(ctx) {
      const key = String(ctx.params.key);
      const body = ctx.body as z.infer<typeof A.FlagKillBody>;
      assertFlagWriter(ctx, key);
      return {
        data: flagRow(
          obj(await ctx.db.call('flag_kill', { p_key: key, p_reason: body.reason, p_on: true })),
        ),
      };
    },
  },
  'POST /flags/:key/archive': { rate: 'X', handle: flagArchive },
  'POST /flags/:key/overrides': {
    rate: 'M',
    async handle(ctx) {
      const key = String(ctx.params.key);
      const body = ctx.body as z.infer<typeof A.FlagOverrideBody>;
      assertFlagWriter(ctx, key);
      const o = obj(
        await ctx.db.call('flag_override_set', {
          p_key: key,
          p_user: body.user_id,
          p_value: body.enabled,
          p_reason: body.reason,
          p_expires: null,
        }),
      );
      return { data: { key, user_id: o.user_id, enabled: o.value === true }, status: 201 as const };
    },
  },
  'DELETE /flags/:key/overrides/:userId': {
    rate: 'M',
    async handle(ctx) {
      const key = String(ctx.params.key);
      const userId = String(ctx.params.userId);
      assertFlagWriter(ctx, key);
      // The contract body is empty; the audit row states the action itself.
      await ctx.db.call('flag_override_delete', {
        p_key: key,
        p_user: userId,
        p_reason: 'flag override removed by an admin',
      });
      return { data: { key, user_id: userId, enabled: null } };
    },
  },
  'GET /announcements': {
    rate: 'R',
    async handle(ctx) {
      const query = ctx.query as z.infer<typeof A.AnnouncementsListQuery>;
      const filter: Json = {};
      if (filterValue(ctx.query, 'status') !== undefined)
        filter.status = filterValue(ctx.query, 'status');
      const rows = arr(obj(await ctx.db.call('announcements_list', { p_filter: filter })).rows).map(
        announcementRow,
      );
      if (query.order === 'asc') rows.reverse();
      return pageRows(ctx.query, rows);
    },
  },
  'POST /announcements/audience-estimate': {
    rate: 'R',
    async handle(ctx) {
      const body = ctx.body as z.infer<typeof A.AudienceEstimateBody>;
      const out = obj(
        await ctx.db.call('announcement_audience_estimate', {
          p_audience: body.audience,
          p_platforms: body.platforms,
          p_min_version: body.min_version ?? null,
          p_max_version: body.max_version ?? null,
        }),
      );
      return { data: { estimated_users: count(out.estimated_users) } };
    },
  },
  'GET /announcements/:id': { rate: 'R', handle: announcementDetail },
  'POST /announcements': {
    rate: 'M',
    async handle(ctx) {
      const body = ctx.body as z.infer<typeof A.AnnouncementBody>;
      const a = obj(
        await ctx.db.call('announcement_upsert', {
          p_id: null,
          p_fields: announcementFields(body),
          p_reason: 'announcement draft created',
        }),
      );
      return { data: announcementRow(a), status: 201 as const };
    },
  },
  'PATCH /announcements/:id': {
    rate: 'M',
    async handle(ctx) {
      const body = ctx.body as AnnouncementFields;
      const a = obj(
        await ctx.db.call('announcement_upsert', {
          p_id: String(ctx.params.id),
          p_fields: announcementFields(body),
          p_reason: 'announcement draft edited',
        }),
      );
      return { data: announcementRow(a) };
    },
  },
  'POST /announcements/:id/preview': { rate: 'R', handle: announcementPreview },
  'POST /announcements/:id/schedule': {
    rate: 'X',
    async handle(ctx) {
      const body = ctx.body as z.infer<typeof A.AnnouncementScheduleBody>;
      const a = obj(
        await ctx.db.call('announcement_publish', {
          p_id: String(ctx.params.id),
          p_reason: body.reason,
          p_now_live: false,
        }),
      );
      return { data: announcementRow(a) };
    },
  },
  'POST /announcements/:id/cancel': {
    rate: 'X',
    async handle(ctx) {
      const body = ctx.body as z.infer<typeof A.AnnouncementCancelBody>;
      const a = obj(
        await ctx.db.call('announcement_cancel', {
          p_id: String(ctx.params.id),
          p_reason: body.reason,
        }),
      );
      return { data: announcementRow(a) };
    },
  },
});
