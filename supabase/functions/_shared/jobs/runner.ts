/**
 * Job runner (ADR-04, API_CONTRACTS §11.1–§11.2, IMPLEMENTATION_PLAN T-3.06).
 *
 * - Claims with `claim_jobs(worker_id, types, limit, 120 s lease)`; `FOR UPDATE SKIP LOCKED` in SQL
 *   guarantees no double claim. `claim_jobs` also opens the `job_attempts` row; `complete_job` /
 *   `fail_job` close it.
 * - Wall-clock budget: no new claims after 110 s (the lease minus a safety margin) or `budget_ms`.
 * - Every job runs under `AbortSignal.timeout(timeout_ms)` from the registry; a timeout is a
 *   retryable `UPSTREAM_TIMEOUT`. Jobs longer than the heartbeat interval extend their lease.
 * - Payloads are parsed with the registered zod schema; a parse failure is a poison payload and is
 *   never retried.
 * - Retries: exponential backoff with full jitter, base 30 s, cap 1 h; a provider `Retry-After`
 *   overrides it. After `max_attempts` `fail_job` moves the job to `dead_letter`.
 * - If the lease was reclaimed meanwhile (`LEASE_LOST`), the late result is discarded: the reclaimed
 *   attempt owns the job.
 * - The job's `correlation_id` is attached to every log line and inherited by follow-up jobs.
 */
import type { JobType } from '@da/domain';
import { JOBS } from '../config.ts';
import type { Logger } from '../logging/logger.ts';
import { isAppError } from '../errors.ts';
import { type JobsRepo, LeaseLostError } from './client.ts';
import type { JobRegistry } from './registry.ts';
import { type AttemptOutcome, type Json, JobError, type JobRow, type RunSummary } from './types.ts';

export interface RunnerOptions {
  readonly repo: JobsRepo;
  readonly registry: JobRegistry;
  readonly log: Logger;
  readonly workerId?: string;
  /** Restrict to these types (intersected with the registry). */
  readonly types?: readonly JobType[];
  readonly maxJobs?: number;
  readonly budgetMs?: number;
  readonly leaseSeconds?: number;
  readonly now?: () => number;
  /** `[0, 1)`; injectable for deterministic backoff tests. */
  readonly random?: () => number;
}

/** Full-jitter exponential backoff in whole seconds: `random × min(cap, base × 2^(attempt−1))`. */
export function backoffSeconds(attempt: number, random: () => number = Math.random): number {
  const exp = Math.min(
    JOBS.backoffCapSeconds,
    JOBS.backoffBaseSeconds * 2 ** Math.max(0, attempt - 1),
  );
  return Math.max(1, Math.ceil(random() * exp));
}

/** The retry delay for one failure; `null` when the job is not retried. */
export function retryDelaySeconds(
  error: JobError,
  attempt: number,
  random: () => number = Math.random,
): number | null {
  if (!error.retryable) return null;
  if (error.retryAfterSeconds !== null && error.retryAfterSeconds > 0) {
    return Math.min(JOBS.retryAfterOverrideMaxSeconds, Math.ceil(error.retryAfterSeconds));
  }
  return backoffSeconds(attempt, random);
}

/** Normalises anything a handler throws into a `JobError`. */
export function toJobError(error: unknown, timedOut: boolean): JobError {
  if (timedOut) return new JobError('UPSTREAM_TIMEOUT', true, null, 'handler timeout');
  if (error instanceof JobError) return error;
  if (isAppError(error)) {
    const retryAfter = Number(error.headers['Retry-After'] ?? 'NaN');
    return new JobError(
      error.code,
      error.retryable,
      Number.isFinite(retryAfter) ? retryAfter : null,
    );
  }
  const name = error instanceof Error ? error.name : 'Error';
  return new JobError('HANDLER_ERROR', true, null, name);
}

class TimeoutSignal {
  readonly controller = new AbortController();
  private timer: number | undefined;
  timedOut = false;
  constructor(ms: number) {
    this.timer = setTimeout(() => {
      this.timedOut = true;
      this.controller.abort(new DOMException('job timeout', 'TimeoutError'));
    }, ms);
  }
  clear() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function runOne(
  job: JobRow,
  options: RunnerOptions,
  workerId: string,
): Promise<AttemptOutcome> {
  const log = options.log.child({
    job_id: job.id,
    job_type: job.type,
    correlation_id: job.correlation_id,
    attempt: job.attempts,
  });
  const random = options.random ?? Math.random;
  const definition = options.registry.get(job.type);
  const fail = async (error: JobError): Promise<AttemptOutcome> => {
    const delay = retryDelaySeconds(error, job.attempts, random);
    const status = await options.repo.fail({
      jobId: job.id,
      workerId,
      errorCode: error.code,
      errorMessage: error.message,
      retryable: error.retryable,
      retryAfterSeconds: delay,
    });
    const outcome: AttemptOutcome =
      status === 'dead_letter' ? 'dead_letter' : status === 'retrying' ? 'retrying' : 'failed';
    log[outcome === 'retrying' ? 'warn' : 'error']('job_failed', {
      error_code: error.code,
      retryable: error.retryable,
      outcome,
      retry_after_s: delay,
    });
    return outcome;
  };

  if (definition === undefined) {
    return fail(new JobError('NO_HANDLER', false, null, 'no handler registered'));
  }
  const parsed = definition.payload.safeParse(job.payload);
  if (!parsed.success)
    return fail(new JobError('POISON_PAYLOAD', false, null, 'payload failed validation'));

  const timeout = new TimeoutSignal(definition.timeoutMs);
  const leaseSeconds = options.leaseSeconds ?? JOBS.leaseSeconds;
  const heartbeat =
    definition.timeoutMs > JOBS.heartbeatEveryMs
      ? setInterval(() => {
          options.repo.extendLease(job.id, workerId, leaseSeconds).catch(() => undefined);
        }, JOBS.heartbeatEveryMs)
      : undefined;
  const started = (options.now ?? Date.now)();
  try {
    const result = await raceAbort(
      definition.handler({
        job,
        payload: parsed.data,
        signal: timeout.controller.signal,
        log,
        correlationId: job.correlation_id,
        workerId,
        enqueue: (input) =>
          options.repo.enqueue({
            ...input,
            correlationId: input.correlationId ?? job.correlation_id,
          }),
        progress: (progress) => options.repo.progress(job.id, workerId, progress),
        now: () => new Date((options.now ?? Date.now)()),
      }),
      timeout.controller.signal,
    );
    timeout.clear();
    await options.repo.complete(job.id, workerId, (result ?? null) as Json | null);
    log.info('job_completed', { duration_ms: (options.now ?? Date.now)() - started });
    return 'completed';
  } catch (error) {
    timeout.clear();
    if (error instanceof LeaseLostError) {
      log.warn('job_lease_lost');
      return 'lease_lost';
    }
    try {
      return await fail(toJobError(error, timeout.timedOut));
    } catch (failError) {
      if (failError instanceof LeaseLostError) {
        log.warn('job_lease_lost');
        return 'lease_lost';
      }
      throw failError;
    }
  } finally {
    if (heartbeat !== undefined) clearInterval(heartbeat);
  }
}

/** Drains claimable jobs within the wall-clock budget. */
export async function runWorker(options: RunnerOptions): Promise<RunSummary> {
  const now = options.now ?? Date.now;
  const started = now();
  const workerId = options.workerId ?? `worker-${crypto.randomUUID()}`;
  const maxJobs = options.maxJobs ?? JOBS.defaultMaxJobs;
  const budgetMs = options.budgetMs ?? 120_000;
  const stopClaimingAt =
    started + Math.min(Math.max(0, budgetMs - 10_000), JOBS.stopClaimingAfterMs);
  const registered = new Set(options.registry.types);
  const types = (options.types ?? options.registry.types).filter((t) => registered.has(t));
  const summary: RunSummary = {
    claimed: 0,
    completed: 0,
    retried: 0,
    failed: 0,
    dead_lettered: 0,
    lease_lost: 0,
    duration_ms: 0,
  };
  if (types.length === 0) {
    summary.duration_ms = now() - started;
    return summary;
  }
  while (summary.claimed < maxJobs && now() < stopClaimingAt) {
    const limit = Math.min(JOBS.claimBatch, maxJobs - summary.claimed);
    const jobs = await options.repo.claim(
      workerId,
      types,
      limit,
      options.leaseSeconds ?? JOBS.leaseSeconds,
    );
    if (jobs.length === 0) break;
    summary.claimed += jobs.length;
    for (const job of jobs) {
      const outcome = await runOne(job, options, workerId);
      if (outcome === 'completed') summary.completed++;
      else if (outcome === 'retrying') summary.retried++;
      else if (outcome === 'failed') summary.failed++;
      else if (outcome === 'dead_letter') summary.dead_lettered++;
      else summary.lease_lost++;
    }
  }
  summary.duration_ms = now() - started;
  options.log.info('worker_run', { ...summary, worker_id: workerId });
  return summary;
}
