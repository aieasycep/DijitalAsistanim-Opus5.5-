/**
 * One structured model call of the pipeline: prompt assembly from the active prompt version
 * (static system prefix + trusted context + nonce-wrapped untrusted documents + instruction), the
 * output-validator context (sources and request aliases) and the user's plan, profile and flags.
 * Extraction calls never carry tools (the provider adapters send none for structured output), so a
 * hijacked model can only fill the schema (AI_PIPELINE_PLAN §9 item 2).
 */
import type { AiFeature, InjectionScan } from '@da/domain';
import { isoWeekdayOf, localDate, localTime } from '@da/domain';
import type { PromptKey } from '@da/validation';
import type { z } from 'zod';
import { type AiRuntime, generateStructured, type StructuredCallResult } from '../../ai/call.ts';
import { assemblePrompt } from '../../ai/prompts/assemble.ts';
import type { ModelRole } from '../../ai/types.ts';
import type { UntrustedDoc } from '../../ai/untrusted.ts';
import type { AiUser } from './runtime.ts';

export interface PipelineContext {
  readonly runtime: AiRuntime;
  readonly user: AiUser;
  readonly correlationId: string;
  readonly jobId?: string | null;
  readonly canary?: string | undefined;
  readonly signal?: AbortSignal;
}

export interface ModelCallInput<T> {
  readonly feature: AiFeature;
  readonly schema: z.ZodType<T>;
  readonly schemaName: string;
  readonly context: readonly string[];
  readonly docs: readonly UntrustedDoc[];
  readonly vars?: Readonly<Record<string, string | number>>;
  /** Normalised content for the per-user result cache; omit to skip the cache. */
  readonly cacheContent?: string;
  readonly refreshCache?: boolean;
  readonly units: number;
  readonly injection?: InjectionScan;
  readonly skipPrimary?: boolean;
  readonly cacheTtl?: '5m' | '1h' | null;
  readonly promptKey?: PromptKey;
  readonly role?: ModelRole;
  /** Extra texts the output may cite (e.g. trusted item display fields). */
  readonly extraSources?: readonly string[];
}

export function callModel<T>(
  ctx: PipelineContext,
  input: ModelCallInput<T>,
): Promise<StructuredCallResult<T>> {
  const sources = [...input.docs.map((d) => d.text), ...input.context, ...(input.extraSources ?? [])];
  return generateStructured(ctx.runtime, {
    feature: input.feature,
    userId: ctx.user.userId,
    plan: ctx.user.plan,
    profile: ctx.user.profile,
    flags: ctx.user.flags,
    schema: input.schema,
    schemaName: input.schemaName,
    buildPrompt: (version) =>
      assemblePrompt({
        version,
        context: input.context,
        docs: input.docs,
        ...(input.vars === undefined ? {} : { vars: input.vars }),
        ...(ctx.canary === undefined ? {} : { canary: ctx.canary }),
        cacheTtl: input.cacheTtl ?? null,
      }),
    ...(input.cacheContent === undefined ? {} : { cacheContent: input.cacheContent }),
    ...(input.refreshCache === true ? { refreshCache: true } : {}),
    sources,
    aliases: new Set(input.docs.map((d) => d.ref)),
    ...(input.injection === undefined ? {} : { injection: input.injection }),
    units: input.units,
    correlationId: ctx.correlationId,
    jobId: ctx.jobId ?? null,
    ...(input.role === undefined ? {} : { role: input.role }),
    ...(input.promptKey === undefined ? {} : { promptKey: input.promptKey }),
    userRef: ctx.user.userRef,
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    ...(ctx.canary === undefined ? {} : { canary: ctx.canary }),
    ...(input.skipPrimary === true ? { skipPrimary: true } : {}),
  });
}

/** Prompt-side weekday names (model input, not product copy). */
const WEEKDAYS_TR = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

export function weekdayTr(localDateString: string): string {
  return WEEKDAYS_TR[isoWeekdayOf(localDateString) - 1] ?? '';
}

/** The trusted "who and when" lines every prompt receives (never ids, tokens or addresses). */
export function trustedHeader(user: AiUser, now: Date): string[] {
  const day = localDate(now, user.timeZone);
  return [
    `Kullanıcı: ${user.displayName ?? 'Kullanıcı'}`,
    `Bugün: ${day} ${weekdayTr(day)} ${localTime(now, user.timeZone)}`,
    `Saat dilimi: ${user.timeZone}`,
  ];
}
