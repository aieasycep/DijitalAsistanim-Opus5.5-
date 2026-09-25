/**
 * ADM-09 prompt management (API_CONTRACTS §12.3; BACKOFFICE_PLAN §6.11; AI_PIPELINE_PLAN §5;
 * T-10.10): the 18 prompt keys with their active version, per-version telemetry, the full template
 * of one version, a unified diff, drafts (create / edit while `draft`), a dry run against synthetic
 * fixtures only, and the atomic activate / rollback / archive functions (one `active` per key).
 */
import { admin as A, AI_SCHEMAS, type AiSchemaName } from '@da/validation';
import type { AiFeature } from '@da/domain';
import type { z } from 'zod';
import { AppError } from '../../_shared/errors.ts';
import { auditWrite, authorize } from '../middleware/audit.ts';
import { arr, count, type Json, num, obj, ratio, str } from '../lib/map.ts';
import { defineRoutes, type RouteCtx } from '../lib/route.ts';
import { unifiedDiff } from '../services/diff.ts';
import { currentPrice, fixtureSet, runStructuredCase } from '../services/ai-probe.ts';
import { aiTarget, findConfig, listConfig, providerOrCredential } from './ai.ts';

function key(ctx: RouteCtx): string {
  return String(ctx.params.key);
}

function version(ctx: RouteCtx): number {
  return Number(ctx.params.v);
}

function versionSummary(v: Json) {
  const telemetry = obj(v.telemetry);
  const feedback = obj(v.feedback);
  const positiveRate = num(feedback.positive_rate);
  return {
    version: Math.max(1, count(v.version)),
    status: v.status,
    created_by: str(v.created_by),
    created_at: v.created_at,
    activated_at: str(v.activated_at),
    telemetry: {
      requests: count(telemetry.requests),
      error_rate: ratio(telemetry.error_rate),
      feedback_positive_rate: positiveRate === null ? null : ratio(positiveRate),
    },
  };
}

async function versions(ctx: RouteCtx): Promise<Json[]> {
  return arr(
    obj(await ctx.db.call('prompt_versions_list', { p_key: key(ctx), p_range: '30d' })).rows,
  );
}

async function versionGet(ctx: RouteCtx, v: number): Promise<Json> {
  return obj(await ctx.db.call('prompt_version_get', { p_key: key(ctx), p_version: v }));
}

async function versionDetail(ctx: RouteCtx) {
  const v = await versionGet(ctx, version(ctx));
  const summary = (await versions(ctx)).find((row) => count(row.version) === version(ctx)) ?? v;
  return {
    data: {
      ...versionSummary({ ...v, telemetry: summary.telemetry, feedback: summary.feedback }),
      key: v.prompt_key,
      template_system: str(v.system_prompt) ?? '',
      template_user: str(v.user_template) ?? '',
      output_schema: v.output_schema_ref,
      schema_hash: str(v.schema_hash),
      notes: str(v.notes),
    },
  };
}

async function diff(ctx: RouteCtx) {
  const query = ctx.query as z.infer<typeof A.PromptDiffQuery>;
  const [a, b] = await Promise.all([versionGet(ctx, query.from), versionGet(ctx, query.to)]);
  const out = obj(await ctx.db.call('prompt_diff', { p_a: a.id, p_b: b.id }));
  const from = obj(out.from);
  const to = obj(out.to);
  const parts = [
    unifiedDiff(
      str(from.system_prompt) ?? '',
      str(to.system_prompt) ?? '',
      `system v${query.from}`,
      `system v${query.to}`,
    ),
    unifiedDiff(
      str(from.user_template) ?? '',
      str(to.user_template) ?? '',
      `user v${query.from}`,
      `user v${query.to}`,
    ),
    unifiedDiff(
      str(from.output_schema_ref) ?? '',
      str(to.output_schema_ref) ?? '',
      `output_schema v${query.from}`,
      `output_schema v${query.to}`,
    ),
  ].filter((p) => p !== '');
  return { data: { from: query.from, to: query.to, diff: parts.join('\n') } };
}

function versionResponse(v: Json, fallbackKey: string) {
  return {
    key: str(v.prompt_key) ?? fallbackKey,
    version: Math.max(1, count(v.version)),
    status: v.status,
  };
}

async function dryRun(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.PromptTestBody>;
  const cases = fixtureSet(body.fixture_set);
  await authorize(ctx.db, 'prompts.write');
  const v = await versionGet(ctx, version(ctx));
  const schemaName = str(v.output_schema_ref) as AiSchemaName | null;
  const entry = schemaName === null ? undefined : AI_SCHEMAS[schemaName];
  if (entry === undefined || entry.kind !== 'wire' || schemaName === null) {
    throw new AppError('STATE_CONFLICT', { details: { reason: 'output_schema_not_model_facing' } });
  }
  const feature = entry.features[0] as AiFeature;
  const row = findConfig(await listConfig(ctx), 'balanced', feature);
  if (row === null)
    throw new AppError('STATE_CONFLICT', { details: { reason: 'no_model_config' } });
  const target = aiTarget(row);
  const provider = providerOrCredential(ctx, target.provider);
  const prices = arr(obj(await ctx.db.call('ai_model_prices_list')).rows);
  const run = {
    provider,
    target,
    feature,
    schemaName,
    systemPrompt: str(v.system_prompt) ?? '',
    userTemplate: str(v.user_template) ?? '',
    price: currentPrice(prices, target.provider, target.model),
    correlationId: ctx.c.get('correlationId'),
  };
  const outcomes = [];
  for (const c of cases) outcomes.push(await runStructuredCase(run, c));
  const total = outcomes.length;
  const data = {
    cases: total,
    schema_pass_rate: total === 0 ? 0 : outcomes.filter((o) => o.schemaPass).length / total,
    grounding_pass_rate: total === 0 ? 0 : outcomes.filter((o) => o.groundingPass).length / total,
  };
  await auditWrite(ctx.db, {
    action: 'prompt.tested',
    targetType: 'prompt_version',
    targetId: str(v.id),
    reason: `prompt dry run on synthetic fixtures (${body.fixture_set})`,
    result: 'success',
    details: {
      prompt_key: key(ctx),
      version: version(ctx),
      fixture_set: body.fixture_set,
      ...data,
    },
    idempotencyKey: ctx.idempotencyKey,
  });
  return { data };
}

export const promptsRoutes = defineRoutes({
  'GET /ai/prompts': {
    rate: 'R',
    async handle(ctx) {
      const out = obj(await ctx.db.call('prompts_list'));
      return {
        data: arr(out.rows).map((p) => ({
          key: p.prompt_key,
          active_version: num(p.active_version) === null ? null : count(p.active_version),
        })),
      };
    },
  },
  'GET /ai/prompts/:key': {
    rate: 'R',
    async handle(ctx) {
      return { data: { key: key(ctx), versions: (await versions(ctx)).map(versionSummary) } };
    },
  },
  'GET /ai/prompts/:key/diff': { rate: 'R', handle: diff },
  'GET /ai/prompts/:key/versions/:v': { rate: 'R', handle: versionDetail },
  'POST /ai/prompts/:key/versions': {
    rate: 'M',
    async handle(ctx) {
      const body = ctx.body as z.infer<typeof A.PromptDraftBody>;
      const out = obj(
        await ctx.db.call('prompt_create_draft', {
          p_key: key(ctx),
          p_from_version: null,
          p_system_prompt: body.template_system,
          p_user_template: body.template_user,
          p_output_schema_ref: body.output_schema,
          p_notes: body.notes ?? null,
        }),
      );
      return { data: versionResponse(out, key(ctx)), status: 201 as const };
    },
  },
  'PATCH /ai/prompts/:key/versions/:v': {
    rate: 'M',
    async handle(ctx) {
      const body = ctx.body as z.infer<typeof A.PromptDraftPatch>;
      const out = obj(
        await ctx.db.call('prompt_update_draft', {
          p_key: key(ctx),
          p_version: version(ctx),
          p_system_prompt: body.template_system ?? null,
          p_user_template: body.template_user ?? null,
          p_output_schema_ref: body.output_schema ?? null,
          p_notes: body.notes ?? null,
          p_changelog: null,
        }),
      );
      return { data: versionResponse(out, key(ctx)) };
    },
  },
  'POST /ai/prompts/:key/versions/:v/test': { rate: 'X', handle: dryRun },
  'POST /ai/prompts/:key/versions/:v/activate': {
    rate: 'X',
    async handle(ctx) {
      const body = ctx.body as z.infer<typeof A.PromptActivateBody>;
      const v = await versionGet(ctx, version(ctx));
      const out = obj(
        await ctx.db.call('prompt_activate', { p_version: v.id, p_reason: body.reason }),
      );
      return { data: versionResponse(out, key(ctx)) };
    },
  },
  'POST /ai/prompts/:key/rollback': {
    rate: 'X',
    async handle(ctx) {
      const body = ctx.body as z.infer<typeof A.PromptRollbackBody>;
      const out = obj(
        await ctx.db.call('prompt_rollback', {
          p_key: key(ctx),
          p_version: body.to_version,
          p_reason: body.reason,
        }),
      );
      return { data: versionResponse(out, key(ctx)) };
    },
  },
  'POST /ai/prompts/:key/versions/:v/archive': {
    rate: 'M',
    async handle(ctx) {
      const body = ctx.body as z.infer<typeof A.PromptArchiveBody>;
      const v = await versionGet(ctx, version(ctx));
      const out = obj(
        await ctx.db.call('prompt_archive', { p_version: v.id, p_reason: body.reason }),
      );
      return { data: { key: key(ctx), version: version(ctx), status: out.status } };
    },
  },
});
