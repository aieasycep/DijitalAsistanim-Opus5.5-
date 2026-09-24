import { z } from 'zod';
import { FEEDBACK_TYPE_VALUES, PLATFORM_VALUES } from '@da/domain';
import { AppRoute, hasDefinedValue, IsoDateTime, SemVer, Uuid } from '../api/common.ts';
import {
  EmailMasked,
  PagedSuccess,
  Reason,
  ReasonBody,
  RevealResponse,
  SensitiveBody,
  Success,
  adminListQuery,
} from './common.ts';

/* ADM-13 · Feedback, ADM-14 · Feature flags, ADM-15 · Announcements (§12.3). */

// ── ADM-13 Feedback ──────────────────────────────────────────────────────────
export const FeedbackStatus = z.enum(['new', 'triaged', 'planned', 'closed']);
export const FeedbackListQuery = adminListQuery({
  sort: ['created_at', 'status'],
  filters: {
    type: z.enum(FEEDBACK_TYPE_VALUES),
    status: FeedbackStatus,
    platform: z.enum(PLATFORM_VALUES),
    app_version: SemVer,
    assignee: Uuid,
  },
});
/** User-submitted feedback, shown by design (identifiers masked). */
export const FeedbackRow = z.object({
  id: Uuid,
  type: z.enum(FEEDBACK_TYPE_VALUES),
  rating: z.int().min(1).max(5).nullable(),
  message: z.string().nullable(),
  screen: z.string().nullable(),
  status: FeedbackStatus,
  platform: z.enum(PLATFORM_VALUES).nullable(),
  app_version: z.string().nullable(),
  assignee: z.string().nullable(),
  user_email_masked: EmailMasked.nullable(),
  created_at: IsoDateTime,
});
export const FeedbackListResponse = PagedSuccess(FeedbackRow);
export const FeedbackSummaryQuery = z.strictObject({
  range: z.enum(['24h', '7d', '30d', '90d']).default('30d'),
  'filter[platform]': z.enum(PLATFORM_VALUES).optional(),
  'filter[app_version]': SemVer.optional(),
});
/** Counts only: no message or email field (strict). */
export const FeedbackSummaryResponse = Success(
  z.strictObject({
    by_type: z.strictObject({
      bug: z.int().min(0),
      feature: z.int().min(0),
      general: z.int().min(0),
      ai_quality: z.int().min(0),
    }),
    rating_distribution: z.strictObject({
      1: z.int().min(0),
      2: z.int().min(0),
      3: z.int().min(0),
      4: z.int().min(0),
      5: z.int().min(0),
      unrated: z.int().min(0),
    }),
    by_app_version: z.array(z.strictObject({ app_version: z.string(), count: z.int().min(0) })),
    by_status: z.strictObject({
      new: z.int().min(0),
      triaged: z.int().min(0),
      planned: z.int().min(0),
      closed: z.int().min(0),
    }),
  }),
);
export const FeedbackPatchBody = z
  .strictObject({
    status: FeedbackStatus.optional(),
    assignee_admin_id: Uuid.nullable().optional(),
  })
  .refine((b) => b.status !== undefined || b.assignee_admin_id !== undefined, 'no_changes');
export const FeedbackResponse = Success(FeedbackRow);
export const FeedbackRevealBody = ReasonBody;
export const FeedbackRevealResponse = RevealResponse;

// ── ADM-14 Feature flags (R-10 keys) ─────────────────────────────────────────
/** The fixed R-10 key set: product flags and kill switches. */
export const R10_FLAG_KEYS = [
  'ai.global.enabled',
  'ai.provider.anthropic.enabled',
  'ai.provider.openai.enabled',
  'ai.provider.voyage.enabled',
  'ai.model.large.enabled',
  'ai.model.opus_escalation',
  'ai.batch.enabled',
  'ai.backfill.enabled',
  'ai.budget.org_daily_usd',
  'voice.stt_server',
  'voice.tts_premium',
  'feature.midday',
  'feature.evening',
  'feature.voice',
  'feature.meeting_prep',
  'feature.capture',
  'feature.android_ni',
  'feature.weekly_review',
  'feature.new_ai_model',
] as const;
export const FlagKey = z
  .string()
  .regex(/^[a-z0-9_.]+$/)
  .max(80);
/** `ai.*` and `voice.*` keys may also be written with `flags.write_ai`. */
export const isAiFlagKey = (key: string): boolean =>
  key.startsWith('ai.') || key.startsWith('voice.');
/** Kill switches are never archived (R-10). */
export const isKillSwitchKey = (key: string): boolean =>
  (R10_FLAG_KEYS as readonly string[]).includes(key) || /^ai\.feature\.[a-z_]+$/.test(key);

/** Payload schemas for keys whose payload is structured. */
export const FLAG_PAYLOAD_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  'ai.budget.org_daily_usd': z.strictObject({ usd: z.number().positive().max(100000) }),
  'feature.android_ni': z.strictObject({
    denylist: z.array(z.string().regex(/^[a-zA-Z0-9_.]{3,120}$/)).max(500),
    catalog: z
      .array(z.string().regex(/^[a-zA-Z0-9_.]{3,120}$/))
      .max(500)
      .optional(),
  }),
};
export function flagPayloadValid(key: string, payload: unknown): boolean {
  const schema = FLAG_PAYLOAD_SCHEMAS[key];
  return schema === undefined
    ? payload === null || typeof payload === 'object'
    : schema.safeParse(payload).success;
}

const Targeting = {
  enabled: z.boolean(),
  rollout_percent: z.int().min(0).max(100),
  platforms: z.array(z.enum(PLATFORM_VALUES)),
  plans: z.array(z.enum(['free', 'pro'])),
  min_version: SemVer.nullable(),
  max_version: SemVer.nullable(),
  payload: z.unknown().nullable(),
};
export const FlagRow = z.object({
  key: FlagKey,
  ...Targeting,
  updated_by: z.string().nullable(),
  updated_at: IsoDateTime,
});
export const FlagsListQuery = z.strictObject({
  'filter[archived]': z.enum(['true', 'false']).optional(),
});
export const FlagsListResponse = Success(z.array(FlagRow));
export const FlagParams = z.strictObject({ key: FlagKey });
export const FlagDetailResponse = Success(
  FlagRow.extend({
    description: z.string().nullable(),
    is_kill_switch: z.boolean(),
    archived_at: IsoDateTime.nullable(),
    overrides: z.array(
      z.object({
        user_id: Uuid,
        email_masked: EmailMasked.nullable(),
        enabled: z.boolean(),
        expires_at: IsoDateTime.nullable(),
        created_at: IsoDateTime,
      }),
    ),
    history: z
      .array(
        z.object({
          ts: IsoDateTime,
          actor: z.string(),
          action: z.string(),
          reason: z.string().nullable(),
          before: z.unknown(),
          after: z.unknown(),
        }),
      )
      .max(50),
  }),
);
export const FlagEvaluateQuery = z.strictObject({
  user_id: Uuid,
  platform: z.enum(PLATFORM_VALUES).optional(),
  app_version: SemVer.optional(),
});
export const FlagEvaluateResponse = Success(
  z.object({
    key: FlagKey,
    user_id: Uuid,
    value: z.boolean(),
    matched_rule: z.enum([
      'disabled',
      'archived',
      'override',
      'platform',
      'plan',
      'version',
      'percentage',
      'default',
    ]),
    bucket: z.int().min(0).max(99),
  }),
);
export const FlagCreateBody = z
  .strictObject({
    key: FlagKey,
    description: z.string().min(1).max(500),
    enabled: z.literal(false),
    rollout_percent: z.int().min(0).max(100).default(0),
    platforms: z.array(z.enum(PLATFORM_VALUES)).default([]),
    plans: z.array(z.enum(['free', 'pro'])).default([]),
    min_version: SemVer.nullable().default(null),
    max_version: SemVer.nullable().default(null),
    payload: z.unknown().nullable().default(null),
    reason: Reason,
  })
  .refine((b) => flagPayloadValid(b.key, b.payload), {
    message: 'payload_invalid',
    path: ['payload'],
  });
export const FlagPatchBody = z.strictObject({
  enabled: z.boolean().optional(),
  rollout_percent: z.int().min(0).max(100).optional(),
  platforms: z.array(z.enum(PLATFORM_VALUES)).optional(),
  plans: z.array(z.enum(['free', 'pro'])).optional(),
  min_version: SemVer.nullable().optional(),
  max_version: SemVer.nullable().optional(),
  payload: z.unknown().nullable().optional(),
  reason: Reason,
});
export const FlagResponse = Success(FlagRow);
export const FlagKillBody = SensitiveBody;
export const FlagArchiveBody = SensitiveBody;
export const FlagOverrideBody = z.strictObject({
  user_id: Uuid,
  enabled: z.boolean(),
  reason: Reason,
});
export const FlagOverrideParams = z.strictObject({ key: FlagKey, userId: Uuid });
export const FlagOverrideResponse = Success(
  z.object({ key: FlagKey, user_id: Uuid, enabled: z.boolean().nullable() }),
);

// ── ADM-15 Announcements (R-25) ──────────────────────────────────────────────
export const AnnouncementStatus = z.enum(['draft', 'scheduled', 'live', 'ended', 'cancelled']);
export const AnnouncementAudience = z.enum(['all', 'free', 'pro']);
const AnnouncementFields = {
  title_tr: z.string().min(1).max(80),
  title_en: z.string().min(1).max(80),
  body_tr: z.string().min(1).max(280),
  body_en: z.string().min(1).max(280),
  audience: AnnouncementAudience,
  platforms: z.array(z.enum(PLATFORM_VALUES)).min(1),
  min_version: SemVer.optional(),
  max_version: SemVer.optional(),
  cta_route: AppRoute.optional(),
  starts_at: IsoDateTime,
  ends_at: IsoDateTime.optional(),
};
export const AnnouncementBody = z
  .strictObject(AnnouncementFields)
  .refine((b) => b.ends_at === undefined || Date.parse(b.ends_at) > Date.parse(b.starts_at), {
    message: 'ends_before_starts',
    path: ['ends_at'],
  });
export const AnnouncementPatchBody = z
  .strictObject(
    Object.fromEntries(Object.entries(AnnouncementFields).map(([k, v]) => [k, v.optional()])) as {
      [K in keyof typeof AnnouncementFields]: z.ZodOptional<(typeof AnnouncementFields)[K]>;
    },
  )
  .refine(hasDefinedValue, 'no_changes');
export const AnnouncementRow = z.object({
  id: Uuid,
  title_tr: z.string(),
  title_en: z.string(),
  audience: AnnouncementAudience,
  platforms: z.array(z.enum(PLATFORM_VALUES)),
  status: AnnouncementStatus,
  starts_at: IsoDateTime,
  ends_at: IsoDateTime.nullable(),
});
export const AnnouncementsListQuery = adminListQuery({
  sort: ['starts_at'],
  filters: { status: AnnouncementStatus },
});
export const AnnouncementsListResponse = PagedSuccess(AnnouncementRow);
export const AnnouncementDetailResponse = Success(
  AnnouncementRow.extend({
    body_tr: z.string(),
    body_en: z.string(),
    min_version: z.string().nullable(),
    max_version: z.string().nullable(),
    cta_route: z.string().nullable(),
    published_at: IsoDateTime.nullable(),
    cancelled_at: IsoDateTime.nullable(),
    dismissal_count: z.int().min(0),
    created_by: z.string().nullable(),
    updated_at: IsoDateTime,
  }),
);
export const AnnouncementResponse = Success(AnnouncementRow);
export const AnnouncementPreviewBody = z.strictObject({
  locale: z.enum(['tr', 'en']),
  platform: z.enum(PLATFORM_VALUES),
});
/** The card model the app would receive in bootstrap (`BootstrapAnnouncement`). */
export const AnnouncementPreviewResponse = Success(
  z.object({
    id: Uuid,
    title: z.string(),
    body: z.string(),
    cta_route: z.string().nullable(),
    ends_at: IsoDateTime.nullable(),
  }),
);
export const AudienceEstimateBody = z.strictObject({
  audience: AnnouncementAudience,
  platforms: z.array(z.enum(PLATFORM_VALUES)).min(1),
  min_version: SemVer.optional(),
  max_version: SemVer.optional(),
});
export const AudienceEstimateResponse = Success(z.object({ estimated_users: z.int().min(0) }));
export const AnnouncementScheduleBody = ReasonBody;
export const AnnouncementCancelBody = ReasonBody;
