import { z } from 'zod';
import { AI_FEATURE_VALUES, AI_TIER_VALUES, ROUTING_PROFILE_VALUES } from '@da/domain';
import { IsoDateTime, Uuid } from '../api/common.ts';
import {
  MetricsRange,
  PagedSuccess,
  Reason,
  RevealResponse,
  Success,
  adminListQuery,
} from './common.ts';

/* ADM-08 · AI Operations and Model Config, ADM-10 · AI Feedback (§12.3). No content anywhere. */

export const AiFeature = z.enum(AI_FEATURE_VALUES);
export const RoutingProfile = z.enum(ROUTING_PROFILE_VALUES);

export const AiMetricsQuery = z.strictObject({
  range: MetricsRange.default('7d'),
  group_by: z.enum(['feature', 'model', 'day', 'prompt_version', 'profile']).default('feature'),
});
export const AiMetricsResponse = Success(
  z.array(
    z.object({
      key: z.string(),
      requests: z.int().min(0),
      input_tokens: z.int().min(0),
      output_tokens: z.int().min(0),
      cache_read_tokens: z.int().min(0),
      cost_usd: z.number().min(0),
      error_rate: z.number().min(0).max(1),
      p50_ms: z.int().min(0).nullable(),
      p95_ms: z.int().min(0).nullable(),
    }),
  ),
);
export const AiMetricsSeriesQuery = z.strictObject({
  range: MetricsRange.default('7d'),
  split: z.enum(['feature', 'model']).default('feature'),
});
export const AiMetricsSeriesResponse = Success(
  z.object({
    points: z.array(
      z.object({
        t: IsoDateTime,
        key: z.string(),
        requests: z.int().min(0),
        cost_usd: z.number().min(0),
      }),
    ),
  }),
);
export const AiRequestsQuery = adminListQuery({
  sort: ['created_at', 'cost_usd', 'latency_ms'],
  filters: {
    feature: AiFeature,
    model: z.string().max(120),
    status: z.enum(['ok', 'error', 'invalid_output', 'timeout', 'refused', 'cached']),
    user_id: Uuid,
  },
  q: false,
});
export const AiRequestRow = z.strictObject({
  id: Uuid,
  feature: AiFeature,
  provider: z.string(),
  model: z.string(),
  prompt_version_id: Uuid.nullable(),
  status: z.string(),
  input_tokens: z.int().min(0),
  output_tokens: z.int().min(0),
  cache_read_tokens: z.int().min(0),
  latency_ms: z.int().min(0),
  cost_usd: z.number().min(0),
  correlation_id: z.string().nullable(),
  created_at: IsoDateTime,
});
export const AiRequestsResponse = PagedSuccess(AiRequestRow);

/** A model target; `native` = on-device TTS/STT, `fixture` = deterministic (rejected in production). */
export const ModelTarget = z.strictObject({
  provider: z.enum(['anthropic', 'openai', 'voyage', 'fixture', 'native']),
  model: z.string().min(1).max(120),
  effort: z.enum(['low', 'medium', 'high']).optional(),
  max_output_tokens: z.int().min(1).max(64000).optional(),
});
/**
 * R-02: model families that are never routable. Fable is a Covered Model whose mandatory 30-day
 * retention conflicts with the privacy copy; the DB check constraint enforces the same rule.
 */
export const FORBIDDEN_MODEL_FAMILIES = ['fable'] as const;
export const isForbiddenModel = (model: string): boolean => {
  const family = /^claude-([a-z]+)-/i.exec(model)?.[1]?.toLowerCase();
  return family !== undefined && (FORBIDDEN_MODEL_FAMILIES as readonly string[]).includes(family);
};
/** R-01: embedding features accept only 1024-d models. */
export const EMBEDDING_1024_MODELS = [
  'voyage-4',
  'voyage-4-lite',
  'text-embedding-3-small',
] as const;

const BatchPolicy = z.enum(['realtime', 'micro_batch', 'message_batches']);
export const ModelConfigRow = z.object({
  profile: RoutingProfile,
  feature: AiFeature,
  tier: z.enum(AI_TIER_VALUES),
  enabled: z.boolean(),
  primary_target: ModelTarget,
  fallback_targets: z.array(ModelTarget),
  escalation_target: ModelTarget.nullable(),
  batch_policy: BatchPolicy,
  cache_ttl: z.enum(['5m', '1h']).nullable(),
  max_input_tokens: z.int().min(1),
  eval_status: z.enum(['pending', 'passed', 'failed']),
  retires_not_before: IsoDateTime.nullable(),
  version: z.int().min(1),
});
export const AiModelsResponse = Success(
  z.object({
    configs: z.array(ModelConfigRow),
    plan_profiles: z.object({ free: RoutingProfile, pro: RoutingProfile }),
    credentials: z.record(
      z.enum(['anthropic', 'openai', 'voyage']),
      z.enum(['configured', 'external_credential_required']),
    ),
  }),
);
export const ModelConfigParams = z.strictObject({ profile: RoutingProfile, feature: AiFeature });
export const ModelConfigPatch = z
  .strictObject({
    primary_target: ModelTarget.optional(),
    fallback_targets: z.array(ModelTarget).max(4).optional(),
    escalation_target: ModelTarget.nullable().optional(),
    batch_policy: BatchPolicy.optional(),
    cache_ttl: z.enum(['5m', '1h']).nullable().optional(),
    max_input_tokens: z.int().min(256).max(200000).optional(),
    enabled: z.boolean().optional(),
    expected_version: z.int().min(1),
    reason: Reason,
    confirm: z.literal(true),
  })
  .superRefine((patch, ctx) => {
    const targets = [
      patch.primary_target,
      ...(patch.fallback_targets ?? []),
      patch.escalation_target ?? undefined,
    ].filter((t): t is z.infer<typeof ModelTarget> => t !== undefined);
    if (targets.some((target) => isForbiddenModel(target.model))) {
      ctx.addIssue({ code: 'custom', path: [], message: 'model_forbidden' });
    }
  });
/**
 * Route-aware checks that need the path params and the environment: embeddings take only 1024-d
 * models; `fixture` is rejected in production.
 */
export function modelConfigViolations(
  feature: z.infer<typeof AiFeature>,
  patch: z.infer<typeof ModelConfigPatch>,
  production: boolean,
): string[] {
  const targets = [
    patch.primary_target,
    ...(patch.fallback_targets ?? []),
    patch.escalation_target ?? undefined,
  ].filter((t): t is z.infer<typeof ModelTarget> => t !== undefined);
  const violations: string[] = [];
  if (production && targets.some((t) => t.provider === 'fixture'))
    violations.push('fixture_in_production');
  if (feature === 'embedding_doc' || feature === 'embedding_query') {
    const allowed = EMBEDDING_1024_MODELS as readonly string[];
    if (targets.some((t) => !allowed.includes(t.model))) violations.push('embedding_dimensions');
  }
  if (targets.some((t) => isForbiddenModel(t.model))) violations.push('model_forbidden');
  return violations;
}
export const ModelConfigResponse = Success(ModelConfigRow);
export const ModelProbeBody = z.strictObject({
  fixture_set: z.string().regex(/^[a-z0-9_]{2,40}$/),
});
export const ModelProbeResponse = Success(
  z.object({ latency_ms: z.int().min(0), schema_pass: z.boolean(), cost_usd: z.number().min(0) }),
);
export const RoutingProfileBody = z.strictObject({
  plan: z.enum(['free', 'pro']),
  profile: RoutingProfile,
  reason: Reason,
  confirm: z.literal(true),
});
export const RoutingProfileResponse = Success(
  z.object({ plan: z.enum(['free', 'pro']), before: RoutingProfile, after: RoutingProfile }),
);

// ADM-10 · AI Feedback
export const AiFeedbackAggregatesQuery = z.strictObject({
  range: MetricsRange.default('30d'),
  group_by: z.enum(['feature', 'model', 'prompt_version']).default('feature'),
});
export const AiFeedbackAggregatesResponse = Success(
  z.array(
    z.object({
      key: z.string(),
      positive: z.int().min(0),
      negative: z.int().min(0),
      rate: z.number().min(0).max(1),
    }),
  ),
);
export const AiFeedbackListQuery = adminListQuery({
  sort: ['created_at'],
  filters: { feature: AiFeature, rating: z.enum(['1', '-1']), prompt_version: z.string().max(40) },
  q: false,
});
/** Comment text is hidden (strict row); visible only via reveal or Support Access `ai_feedback`. */
export const AiFeedbackRow = z.strictObject({
  id: Uuid,
  feature: AiFeature.nullable(),
  model: z.string().nullable(),
  prompt_version: z.string().nullable(),
  rating: z.union([z.literal(1), z.literal(-1)]),
  reason_code: z.string().nullable(),
  created_at: IsoDateTime,
});
export const AiFeedbackListResponse = PagedSuccess(AiFeedbackRow);
export const AiFeedbackRevealBody = z.strictObject({ reason: Reason });
export const AiFeedbackRevealResponse = RevealResponse;
