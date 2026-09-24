/**
 * Shared wiring of the AI pipeline part-2 jobs (IMPLEMENTATION_PLAN T-5.09…T-5.15): JOB-13
 * `first_analysis`, JOB-15 `meeting_prep`, JOB-27 `capture_analysis` and JOB-30 `briefing_audio`.
 * They reuse the part-1 `IntelDeps` (AI runtime, stores, transient bodies) and add the part-2
 * store, private Storage and the SSRF fetcher's transport.
 */
import type { JobContext } from '../../_shared/jobs/types.ts';
import type { DnsResolver } from '../../_shared/security/ssrf-fetch.ts';
import type { AssistStore } from '../../_shared/services/assist/store.ts';
import type { AiUser } from '../../_shared/services/ai/runtime.ts';
import type { PipelineContext } from '../../_shared/services/ai/pipeline.ts';
import type { ObjectStorage } from '../../_shared/services/storage.ts';
import type { IntelDeps } from './intel.ts';

export interface AssistJobDeps {
  readonly intel: IntelDeps;
  readonly store: AssistStore;
  readonly storage: ObjectStorage;
  /** Transport of the SSRF-safe link fetcher (tests stub it; production uses global fetch). */
  readonly fetch?: typeof fetch;
  readonly resolver?: DnsResolver;
}

export function assistPipeline(
  deps: AssistJobDeps,
  user: AiUser,
  ctx: JobContext<unknown>,
): PipelineContext {
  return {
    runtime: deps.intel.ai.runtime,
    user,
    correlationId: ctx.correlationId,
    jobId: ctx.job.id,
    canary: deps.intel.ai.canary,
    signal: ctx.signal,
  };
}

/** The job's user: the payload's `user_id`, else the row's `user_id`. */
export function jobUserId(
  ctx: JobContext<unknown>,
  payloadUser: string | undefined,
): string | null {
  return payloadUser ?? ctx.job.user_id ?? null;
}
