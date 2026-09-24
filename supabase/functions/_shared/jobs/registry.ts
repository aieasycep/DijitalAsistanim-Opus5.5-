/**
 * Job handler registry (IMPLEMENTATION_PLAN T-3.06). Each `job_type` has at most one definition with
 * its payload schema and timeout; `worker/handlers/index.ts` builds the registry the runner uses.
 * Later tasks add their handlers there.
 */
import type { JobType } from '@da/domain';
import { z } from 'zod';
import { JOBS } from '../config.ts';
import type { JobDefinition, JobHandler } from './types.ts';

/** Per-type timeouts (ms) where the default of 60 s does not fit (API_CONTRACTS §11.4). */
export const JOB_TIMEOUTS_MS: Partial<Readonly<Record<JobType, number>>> = {
  first_analysis: 600_000,
  initial_sync: 300_000,
  export: 300_000,
  account_deletion: 300_000,
  history_deletion: 300_000,
  retention: 300_000,
  capture_analysis: 120_000,
  briefing: 90_000,
  briefing_audio: 120_000,
  ai_batch: 120_000,
  credential_reencrypt: 120_000,
  health_check: 30_000,
  notification: 20_000,
  push_receipts: 30_000,
};

export function timeoutFor(type: JobType): number {
  return JOB_TIMEOUTS_MS[type] ?? JOBS.defaultTimeoutMs;
}

export function defineJob<P>(input: {
  type: JobType;
  payload: z.ZodType<P>;
  handler: JobHandler<P>;
  timeoutMs?: number;
  /**
   * Scoped definition: claims only the payloads this predicate accepts (e.g. `reconciliation`
   * with `payload.scope='ai_cost'`, AI_PIPELINE_PLAN §8.12), so several tasks can share one
   * `job_type`. At most one definition per type may be unscoped.
   */
  match?: (payload: unknown) => boolean;
}): JobDefinition<P> {
  return {
    type: input.type,
    payload: input.payload,
    handler: input.handler,
    timeoutMs: input.timeoutMs ?? timeoutFor(input.type),
    ...(input.match === undefined ? {} : { match: input.match }),
  };
}

/**
 * One definition dispatching to scoped definitions (first matching `match`) or to the unscoped
 * one. The composed payload schema validates with the chosen definition's schema, so a payload
 * that fits none of them is still a poison payload.
 */
function composeDefinitions(defs: readonly JobDefinition<unknown>[]): JobDefinition<unknown> {
  const scoped = defs.filter((d) => d.match !== undefined);
  const fallback = defs.filter((d) => d.match === undefined);
  const type = defs[0]!.type;
  if (fallback.length > 1) throw new Error(`duplicate_job_handler:${type}`);
  const pick = (payload: unknown): JobDefinition<unknown> | undefined =>
    scoped.find((d) => d.match!(payload)) ?? fallback[0];
  const payload = z.unknown().transform((raw, ctx) => {
    const def = pick(raw);
    if (def === undefined) {
      ctx.addIssue({ code: 'custom', message: 'no_scoped_handler' });
      return z.NEVER;
    }
    const parsed = def.payload.safeParse(raw);
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', message: 'payload_invalid' });
      return z.NEVER;
    }
    return { def, data: parsed.data };
  });
  return {
    type,
    payload: payload as unknown as z.ZodType<unknown>,
    timeoutMs: Math.max(...defs.map((d) => d.timeoutMs)),
    handler: (ctx) => {
      const chosen = ctx.payload as { def: JobDefinition<unknown>; data: unknown };
      return chosen.def.handler({ ...ctx, payload: chosen.data });
    },
  };
}

export interface JobRegistry {
  readonly types: readonly JobType[];
  get(type: JobType): JobDefinition<unknown> | undefined;
}

export function createRegistry(definitions: readonly JobDefinition<never>[]): JobRegistry {
  const grouped = new Map<JobType, JobDefinition<unknown>[]>();
  for (const def of definitions) {
    const list = grouped.get(def.type) ?? [];
    list.push(def as unknown as JobDefinition<unknown>);
    grouped.set(def.type, list);
  }
  const map = new Map<JobType, JobDefinition<unknown>>();
  for (const [type, defs] of grouped) {
    if (defs.length === 1 && defs[0]!.match === undefined) map.set(type, defs[0]!);
    else if (defs.filter((d) => d.match === undefined).length > 1) {
      throw new Error(`duplicate_job_handler:${type}`);
    } else map.set(type, composeDefinitions(defs));
  }
  return {
    types: [...map.keys()],
    get: (type) => map.get(type),
  };
}
