/**
 * ADM-08 AI operations and model config, ADM-10 AI feedback (API_CONTRACTS §12.3; BACKOFFICE_PLAN
 * §6.9, §6.10, §6.12; AI_PIPELINE_PLAN §3.6; T-10.10). Telemetry and aggregates only — no content.
 *
 * Model config edits are validated here before `ai_model_config_update` (R-01 1024-d embedding
 * models, R-02 no Covered-Model family, no `fixture` in production, a configured provider) and
 * re-read afterwards. The contract vocabulary differs from the DB columns in two places, mapped
 * both ways: `batch_policy` (`realtime | micro_batch | message_batches` ↔ `never | non_urgent |
 * always`) and `eval_status` (`pending` ↔ `missing`). Targets whose provider the contract cannot
 * express (premium STT/TTS vendors) are left out of `GET /ai/models`.
 */
import { admin as A } from '@da/validation';
import type { AiFeature } from '@da/domain';
import type { z } from 'zod';
import { FEATURE_PROMPT_KEY } from '../../_shared/ai/prompts/registry.ts';
import type { ModelTarget as AiTarget, ProviderId, TargetParams } from '../../_shared/ai/types.ts';
import { credentialStatus } from '../../_shared/env.ts';
import { AppError, fieldError } from '../../_shared/errors.ts';
import { auditWrite, authorize } from '../middleware/audit.ts';
import { filterValue, listArgs, paged } from '../lib/list.ts';
import { arr, count, type Json, num, obj, ratio, str, usd } from '../lib/map.ts';
import { defineRoutes, type RouteCtx } from '../lib/route.ts';
import {
  currentPrice,
  fixtureSet,
  runEmbeddingProbe,
  runStructuredCase,
  schemaNameForFeature,
} from '../services/ai-probe.ts';

const CONTRACT_PROVIDERS = new Set(['anthropic', 'openai', 'voyage', 'fixture', 'native']);
const EFFORTS = new Set(['low', 'medium', 'high']);
const BATCH_TO_CONTRACT: Readonly<Record<string, string>> = {
  never: 'realtime',
  non_urgent: 'micro_batch',
  always: 'message_batches',
};
const BATCH_TO_DB: Readonly<Record<string, string>> = {
  realtime: 'never',
  micro_batch: 'non_urgent',
  message_batches: 'always',
};

type ContractTarget = z.infer<typeof A.ModelTarget>;

/** A DB target (`{provider, model, params}` or the flattened primary) → the contract `ModelTarget`. */
function toContractTarget(value: unknown): ContractTarget | null {
  const t = obj(value);
  const provider = str(t.provider);
  const model = str(t.model);
  if (provider === null || model === null || !CONTRACT_PROVIDERS.has(provider)) return null;
  const params = t.params === undefined ? t : obj(t.params);
  const effort = str(params.effort);
  const maxOut = num(params.max_output_tokens);
  return {
    provider: provider as ContractTarget['provider'],
    model,
    ...(effort !== null && EFFORTS.has(effort)
      ? { effort: effort as 'low' | 'medium' | 'high' }
      : {}),
    ...(maxOut !== null && maxOut >= 1 ? { max_output_tokens: Math.round(maxOut) } : {}),
  };
}

function retiresAt(value: unknown): string | null {
  const s = str(value);
  if (s === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s;
}

/** An `ai_model_config_list` row → `ModelConfigRow`, or `null` when the contract cannot carry it. */
export function configRow(r: Json) {
  const primary = toContractTarget(r.primary_target);
  if (primary === null) return null;
  const fallbacks = arr(r.fallback_targets).map(toContractTarget);
  if (fallbacks.some((t) => t === null)) return null;
  const escalation =
    r.escalation_target === null || r.escalation_target === undefined
      ? null
      : toContractTarget(r.escalation_target);
  if (r.escalation_target !== null && r.escalation_target !== undefined && escalation === null)
    return null;
  const evalStatus = str(r.eval_status);
  return {
    profile: r.profile,
    feature: r.feature,
    tier: r.tier,
    enabled: r.enabled === true,
    primary_target: primary,
    fallback_targets: fallbacks,
    escalation_target: escalation,
    batch_policy: BATCH_TO_CONTRACT[str(r.batch_policy) ?? ''] ?? 'realtime',
    cache_ttl: str(r.cache_ttl),
    max_input_tokens: Math.max(1, count(r.max_input_tokens)),
    eval_status: evalStatus === 'passed' || evalStatus === 'failed' ? evalStatus : 'pending',
    retires_not_before: retiresAt(r.retires_not_before),
    version: Math.max(1, count(r.version)),
  };
}

async function listConfig(ctx: RouteCtx): Promise<Json> {
  return obj(await ctx.db.call('ai_model_config_list'));
}

function findConfig(list: Json, profile: string, feature: string, id?: unknown): Json | null {
  const rows = arr(list.rows).filter((r) => r.profile === profile && r.feature === feature);
  return rows.find((r) => id !== undefined && r.id === id) ?? rows[0] ?? null;
}

async function models(ctx: RouteCtx) {
  const list = await listConfig(ctx);
  const configs = arr(list.rows)
    .map(configRow)
    .filter((r) => r !== null);
  const profiles = obj(list.routing_profiles);
  const credentials: Record<string, string> = {};
  for (const provider of ['anthropic', 'openai', 'voyage'] as const) {
    credentials[provider] = credentialStatus(provider, ctx.rt.env.raw).status;
  }
  return {
    data: {
      configs,
      plan_profiles: {
        free: profiles.free === 'balanced' ? 'balanced' : 'lean',
        pro: profiles.pro === 'lean' ? 'lean' : 'balanced',
      },
      credentials,
    },
  };
}

function targetParams(existing: unknown, target: ContractTarget): TargetParams {
  const base = { ...obj(existing) };
  delete base.provider;
  delete base.model;
  if (target.effort !== undefined) base.effort = target.effort;
  if (target.max_output_tokens !== undefined) base.max_output_tokens = target.max_output_tokens;
  return base as TargetParams;
}

function dbTarget(existing: Json[], target: ContractTarget) {
  const match = existing.find((t) => t.provider === target.provider && t.model === target.model);
  return {
    provider: target.provider,
    model: target.model,
    params: targetParams(match?.params, target),
  };
}

async function patchModel(ctx: RouteCtx) {
  const profile = String(ctx.params.profile);
  const feature = String(ctx.params.feature) as AiFeature;
  const patch = ctx.body as z.infer<typeof A.ModelConfigPatch>;
  const violations = A.modelConfigViolations(feature, patch, ctx.rt.env.appEnv === 'production');
  if (violations.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      fieldErrors: violations.map((code) => ({
        path: 'primary_target',
        code,
        message_key: `validation.${code}`,
      })),
    });
  }
  const targets = [
    patch.primary_target,
    ...(patch.fallback_targets ?? []),
    patch.escalation_target ?? undefined,
  ];
  for (const target of targets) {
    if (target === undefined) continue;
    if (
      target.provider === 'anthropic' ||
      target.provider === 'openai' ||
      target.provider === 'voyage'
    ) {
      if (credentialStatus(target.provider, ctx.rt.env.raw).status !== 'configured') {
        throw fieldError('primary_target.provider', 'provider_not_configured');
      }
    }
  }
  const list = await listConfig(ctx);
  const row = findConfig(list, profile, feature);
  if (row === null) throw new AppError('NOT_FOUND');
  const existingFallbacks = arr(row.fallback_targets);
  const updated = obj(
    await ctx.db.call('ai_model_config_update', {
      p_profile: profile,
      p_role: str(row.role),
      p_feature: feature,
      p_provider: patch.primary_target?.provider ?? null,
      p_model: patch.primary_target?.model ?? null,
      p_params:
        patch.primary_target === undefined
          ? null
          : targetParams(row.primary_target, patch.primary_target),
      p_fallback_targets:
        patch.fallback_targets === undefined
          ? null
          : patch.fallback_targets.map((t) => dbTarget(existingFallbacks, t)),
      p_escalation_target:
        patch.escalation_target === undefined || patch.escalation_target === null
          ? null
          : dbTarget([obj(row.escalation_target)], patch.escalation_target),
      p_enabled: patch.enabled ?? null,
      p_expected_version: patch.expected_version,
      p_reason: patch.reason,
      p_batch_policy: patch.batch_policy === undefined ? null : BATCH_TO_DB[patch.batch_policy],
      p_cache_ttl: patch.cache_ttl ?? null,
      p_max_input_tokens: patch.max_input_tokens ?? null,
      p_clear_escalation: patch.escalation_target === null,
      p_clear_cache_ttl: patch.cache_ttl === null,
    }),
  );
  const fresh = findConfig(await listConfig(ctx), profile, feature, updated.id);
  const mapped = fresh === null ? null : configRow(fresh);
  if (mapped === null) throw new AppError('NOT_FOUND');
  return { data: mapped };
}

function aiTarget(row: Json): AiTarget {
  const primary = obj(row.primary_target);
  const params = { ...primary };
  delete params.provider;
  delete params.model;
  return {
    provider: String(primary.provider) as ProviderId,
    model: String(primary.model),
    params: params as TargetParams,
  };
}

function providerOrCredential(ctx: RouteCtx, provider: ProviderId) {
  const adapter = ctx.rt.ai.get(provider);
  if (adapter === null) {
    const name =
      provider === 'anthropic' || provider === 'openai' || provider === 'voyage' ? provider : null;
    throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
      details: {
        feature: 'ai',
        provider,
        credential_keys: name === null ? [] : [...credentialStatus(name, ctx.rt.env.raw).missing],
      },
    });
  }
  return adapter;
}

/** The active prompt text of a feature, for the probe (a neutral instruction without one). */
async function probePrompt(ctx: RouteCtx, feature: AiFeature) {
  const key = FEATURE_PROMPT_KEY[feature];
  if (key !== undefined) {
    const prompts = obj(await ctx.db.call('prompts_list'));
    const active = arr(prompts.rows).find((p) => p.prompt_key === key);
    const version = num(active?.active_version);
    if (version !== null) {
      const v = obj(await ctx.db.call('prompt_version_get', { p_key: key, p_version: version }));
      return { system: str(v.system_prompt) ?? '', user: str(v.user_template) ?? '' };
    }
  }
  return {
    system:
      'Return one JSON object that matches the requested output schema for the synthetic input.',
    user: '{{today}}',
  };
}

async function probeModel(ctx: RouteCtx) {
  const profile = String(ctx.params.profile);
  const feature = String(ctx.params.feature) as AiFeature;
  const body = ctx.body as z.infer<typeof A.ModelProbeBody>;
  const cases = fixtureSet(body.fixture_set);
  await authorize(ctx.db, 'ai.models.write');
  const row = findConfig(await listConfig(ctx), profile, feature);
  if (row === null) throw new AppError('NOT_FOUND');
  const target = aiTarget(row);
  const provider = providerOrCredential(ctx, target.provider);
  const prices = arr(obj(await ctx.db.call('ai_model_prices_list')).rows);
  const price = currentPrice(prices, target.provider, target.model);
  const schemaName = schemaNameForFeature(feature);
  let outcome: { latencyMs: number; schemaPass: boolean; costMicros: number };
  if (schemaName === null) {
    outcome = await runEmbeddingProbe(
      provider,
      target,
      feature,
      cases.slice(0, 1),
      price,
      ctx.rt.now,
    );
  } else {
    const prompt = await probePrompt(ctx, feature);
    outcome = await runStructuredCase(
      {
        provider,
        target,
        feature,
        schemaName,
        systemPrompt: prompt.system,
        userTemplate: prompt.user,
        price,
        correlationId: ctx.c.get('correlationId'),
      },
      cases[0] ?? { id: 'empty', context: {}, documents: [] },
    );
  }
  const data = {
    latency_ms: outcome.latencyMs,
    schema_pass: outcome.schemaPass,
    cost_usd: usd(outcome.costMicros / 1e6),
  };
  await auditWrite(ctx.db, {
    action: 'admin.ai.model_probed',
    targetType: 'ai_model_config',
    targetId: str(row.id),
    reason: `synthetic model probe (${body.fixture_set})`,
    result: 'success',
    details: {
      profile,
      feature,
      provider: target.provider,
      model: target.model,
      fixture_set: body.fixture_set,
      ...data,
    },
    idempotencyKey: ctx.idempotencyKey,
  });
  return { data };
}

async function routingProfile(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.RoutingProfileBody>;
  const list = await listConfig(ctx);
  const before =
    str(obj(list.routing_profiles)[body.plan]) ?? (body.plan === 'free' ? 'lean' : 'balanced');
  const out = obj(
    await ctx.db.call('plan_routing_profile_set', {
      p_plan: body.plan,
      p_profile: body.profile,
      p_reason: body.reason,
    }),
  );
  return { data: { plan: body.plan, before, after: str(out.profile) ?? body.profile } };
}

function aiMetricRow(r: Json) {
  return {
    key: str(r.key) ?? 'none',
    requests: count(r.requests),
    input_tokens: count(r.input_tokens),
    output_tokens: count(r.output_tokens),
    cache_read_tokens: count(r.cache_read_tokens),
    cost_usd: usd(r.cost_usd),
    error_rate: ratio(r.error_rate),
    p50_ms: num(r.p50_ms) === null ? null : count(r.p50_ms),
    p95_ms: num(r.p95_ms) === null ? null : count(r.p95_ms),
  };
}

const PROMPT_VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function feedbackList(ctx: RouteCtx) {
  const extra: Json = {};
  const promptVersion = filterValue(ctx.query, 'prompt_version');
  if (promptVersion !== undefined) {
    if (!PROMPT_VERSION_ID.test(promptVersion))
      throw fieldError('query.filter[prompt_version]', 'invalid_format');
    extra.prompt_version_id = promptVersion;
  }
  const out = await ctx.db.call(
    'ai_feedback_list',
    listArgs(ctx.query, { filters: { feature: 'feature', rating: 'rating' }, extraFilter: extra }),
  );
  return paged(ctx.query, out, (f) => ({
    id: f.id,
    feature: str(f.feature),
    model: str(f.model),
    prompt_version: num(f.prompt_version) === null ? null : String(f.prompt_version),
    rating: num(f.rating) === 1 ? 1 : -1,
    reason_code: str(f.reason_code),
    created_at: f.created_at,
  }));
}

export const aiRoutes = defineRoutes({
  'GET /ai/metrics': {
    rate: 'R',
    async handle(ctx) {
      const query = ctx.query as z.infer<typeof A.AiMetricsQuery>;
      const out = obj(
        await ctx.db.call('ai_metrics', { p_range: query.range, p_group: query.group_by }),
      );
      return { data: arr(out.rows).map(aiMetricRow) };
    },
  },
  'GET /ai/metrics/series': {
    rate: 'R',
    async handle(ctx) {
      const query = ctx.query as z.infer<typeof A.AiMetricsSeriesQuery>;
      const out = obj(
        await ctx.db.call('ai_cost_series', { p_range: query.range, p_split: query.split }),
      );
      return {
        data: {
          points: arr(out.points).map((p) => ({
            t: p.t,
            key: str(p.key) ?? 'none',
            requests: count(p.requests),
            cost_usd: usd(p.cost_usd),
          })),
        },
      };
    },
  },
  'GET /ai/requests': {
    rate: 'R',
    async handle(ctx) {
      const out = await ctx.db.call(
        'ai_requests_list',
        listArgs(ctx.query, {
          filters: { feature: 'feature', model: 'model', status: 'status', user_id: 'user_id' },
          sortAliases: { cost_usd: 'cost' },
        }),
      );
      return paged(ctx.query, out, (r) => ({
        id: r.id,
        feature: r.feature,
        provider: str(r.provider) ?? 'unknown',
        model: str(r.model) ?? 'unknown',
        prompt_version_id: str(r.prompt_version_id),
        status: str(r.status) ?? 'unknown',
        input_tokens: count(r.input_tokens),
        output_tokens: count(r.output_tokens),
        cache_read_tokens: count(r.cache_read_tokens),
        latency_ms: count(r.latency_ms),
        cost_usd: usd(r.cost_usd),
        correlation_id: str(r.correlation_id),
        created_at: r.created_at,
      }));
    },
  },
  'GET /ai/models': { rate: 'R', handle: models },
  'PATCH /ai/models/:profile/:feature': { rate: 'X', handle: patchModel },
  'POST /ai/models/:profile/:feature/test': { rate: 'X', handle: probeModel },
  'PATCH /ai/routing-profile': { rate: 'X', handle: routingProfile },
  'GET /ai/feedback/aggregates': {
    rate: 'R',
    async handle(ctx) {
      const query = ctx.query as z.infer<typeof A.AiFeedbackAggregatesQuery>;
      const out = obj(
        await ctx.db.call('ai_feedback_aggregate', {
          p_range: query.range,
          p_group: query.group_by,
        }),
      );
      return {
        data: arr(out.rows).map((r) => ({
          key: str(r.key) ?? 'none',
          positive: count(r.positive),
          negative: count(r.negative),
          rate: ratio(r.rate),
        })),
      };
    },
  },
  'GET /ai/feedback': { rate: 'R', handle: feedbackList },
  'POST /ai/feedback/:id/reveal': {
    rate: 'X',
    replay: 'refuse',
    async handle(ctx) {
      const body = ctx.body as z.infer<typeof A.AiFeedbackRevealBody>;
      const out = obj(
        await ctx.db.call('ai_feedback_reveal_comment', {
          p_id: String(ctx.params.id),
          p_reason: body.reason,
        }),
      );
      return { data: { value: str(out.value) ?? '', expires_in_s: 60 } };
    },
  },
});

/** Exported for the prompt dry run. */
export { aiTarget, findConfig, listConfig, providerOrCredential };
