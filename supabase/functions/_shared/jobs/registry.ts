/**
 * Job handler registry (IMPLEMENTATION_PLAN T-3.06). Each `job_type` has at most one definition with
 * its payload schema and timeout; `worker/handlers/index.ts` builds the registry the runner uses.
 * Later tasks add their handlers there.
 */
import type { JobType } from '@da/domain';
import type { z } from 'zod';
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
}): JobDefinition<P> {
  return {
    type: input.type,
    payload: input.payload,
    handler: input.handler,
    timeoutMs: input.timeoutMs ?? timeoutFor(input.type),
  };
}

export interface JobRegistry {
  readonly types: readonly JobType[];
  get(type: JobType): JobDefinition<unknown> | undefined;
}

export function createRegistry(definitions: readonly JobDefinition<never>[]): JobRegistry {
  const map = new Map<JobType, JobDefinition<unknown>>();
  for (const def of definitions) {
    if (map.has(def.type)) throw new Error(`duplicate_job_handler:${def.type}`);
    map.set(def.type, def as unknown as JobDefinition<unknown>);
  }
  return {
    types: [...map.keys()],
    get: (type) => map.get(type),
  };
}
