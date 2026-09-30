/**
 * Job queue access (API_CONTRACTS §1 `jobs/enqueue.ts`, §11; DATABASE_AND_RLS_PLAN §6.2).
 *
 * - `enqueueJob()` → `public.enqueue_job(...)` (service role; `on conflict (idempotency_key) do
 *   nothing`, so a duplicate enqueue returns the existing job id and creates nothing).
 * - `pokeWorker()` → an immediate `POST /functions/v1/worker/run` with the automations secret, for
 *   latency-sensitive enqueues; it never throws (the 15 s cron poke is the backstop).
 * - `JobsRepo`: the runner's claim / complete / fail / lease calls.
 */
import type { JobStatus, JobType } from '@da/domain';
import { OUTBOUND } from '../config.ts';
import type { DbClient } from '../db/clients.ts';
import { DB_FN, rpc } from '../db/functions.ts';
import type { Logger } from '../logging/logger.ts';
import type { EnqueueInput, Json, JobRow } from './types.ts';

export interface JobsRepo {
  enqueue(input: EnqueueInput): Promise<string>;
  claim(
    workerId: string,
    types: readonly JobType[],
    limit: number,
    leaseSeconds: number,
  ): Promise<JobRow[]>;
  extendLease(jobId: string, workerId: string, seconds: number): Promise<boolean>;
  /** Throws `LeaseLostError` when the lease now belongs to another worker. */
  complete(jobId: string, workerId: string, result: Json | null): Promise<void>;
  fail(input: {
    jobId: string;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
    retryAfterSeconds: number | null;
  }): Promise<JobStatus>;
  progress(jobId: string, workerId: string, progress: Record<string, Json>): Promise<void>;
}

export class LeaseLostError extends Error {
  constructor(readonly jobId: string) {
    super('LEASE_LOST');
    this.name = 'LeaseLostError';
  }
}

function enqueueArgs(input: EnqueueInput): Record<string, unknown> {
  return {
    p_type: input.type,
    p_idempotency_key: input.idempotencyKey,
    p_payload: input.payload ?? {},
    p_user_id: input.userId ?? null,
    p_account_id: input.accountId ?? null,
    p_run_after: (input.runAfter ?? new Date()).toISOString(),
    p_priority: input.priority ?? 100,
    p_max_attempts: input.maxAttempts ?? 5,
    p_correlation_id: input.correlationId ?? null,
  };
}

/** Enqueues a job (idempotent on `idempotencyKey`) and returns its id. */
export function enqueueJob(client: DbClient, input: EnqueueInput): Promise<string> {
  return rpc<string>(client, DB_FN.enqueueJob, enqueueArgs(input));
}

function isLeaseLost(error: unknown): boolean {
  const message = (error as { message?: string } | null)?.message ?? '';
  const cause = (error as { cause?: { message?: string } } | null)?.cause?.message ?? '';
  return message.includes('LEASE_LOST') || cause.includes('LEASE_LOST');
}

export function supabaseJobsRepo(client: DbClient): JobsRepo {
  return {
    enqueue: (input) => enqueueJob(client, input),
    async claim(workerId, types, limit, leaseSeconds) {
      const rows = await rpc<JobRow[] | null>(client, DB_FN.claimJobs, {
        p_worker_id: workerId,
        p_types: types,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      return rows ?? [];
    },
    async extendLease(jobId, workerId, seconds) {
      return (
        (await rpc<boolean>(client, DB_FN.extendJobLease, {
          p_job_id: jobId,
          p_worker_id: workerId,
          p_seconds: seconds,
        })) === true
      );
    },
    async complete(jobId, workerId, result) {
      try {
        await rpc<null>(client, DB_FN.completeJob, {
          p_job_id: jobId,
          p_worker_id: workerId,
          p_result: result,
        });
      } catch (error) {
        if (isLeaseLost(error)) throw new LeaseLostError(jobId);
        throw error;
      }
    },
    async fail(input) {
      try {
        return await rpc<JobStatus>(client, DB_FN.failJob, {
          p_job_id: input.jobId,
          p_worker_id: input.workerId,
          p_error_code: input.errorCode,
          p_error_message: input.errorMessage.slice(0, 500),
          p_retryable: input.retryable,
          p_retry_after_seconds: input.retryAfterSeconds,
        });
      } catch (error) {
        if (isLeaseLost(error)) throw new LeaseLostError(input.jobId);
        throw error;
      }
    },
    async progress(jobId, workerId, progress) {
      await rpc<null>(client, DB_FN.updateJobProgress, {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_progress: progress,
      });
    },
  };
}

export interface PokeOptions {
  /** `SUPABASE_URL` or `API_PUBLIC_BASE_URL`. */
  readonly baseUrl: string;
  /** `CRON_SECRET` (the automations secret key). */
  readonly secret: string | undefined;
  readonly reason: string;
  readonly fetch?: typeof fetch;
  readonly log?: Logger;
}

/** Wakes the worker immediately. Best effort: failures are logged, never thrown. */
export async function pokeWorker(options: PokeOptions): Promise<boolean> {
  if (options.secret === undefined || options.secret === '') {
    options.log?.warn('worker_poke_skipped', { reason: 'secret_not_configured' });
    return false;
  }
  const url = `${options.baseUrl.replace(/\/+$/, '')}/functions/v1/worker/run`;
  try {
    const response = await (options.fetch ?? fetch)(url, {
      method: 'POST',
      headers: {
        apikey: options.secret,
        'Content-Type': 'application/json',
        'x-da-reason': options.reason,
      },
      body: '{}',
      signal: AbortSignal.timeout(OUTBOUND.workerPokeTimeoutMs),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    options.log?.warn('worker_poke_failed', { reason: options.reason });
    return false;
  }
}
