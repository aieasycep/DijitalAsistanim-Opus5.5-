/**
 * An in-memory `JobsRepo` with the SQL semantics of DATABASE_AND_RLS_PLAN §6.2: `enqueue_job` is
 * `on conflict (idempotency_key) do nothing`, `claim_jobs` increments `attempts` and takes a lease,
 * `complete_job` / `fail_job` raise `LEASE_LOST` for a foreign or expired lease, and `fail_job`
 * applies the retrying / failed / dead_letter rule. `reapExpiredLeases` mirrors
 * `private.reap_expired_leases`.
 */
import type { JobStatus, JobType } from '@da/domain';
import { type JobsRepo, LeaseLostError } from '../jobs/client.ts';
import type { EnqueueInput, Json, JobRow } from '../jobs/types.ts';

export interface FakeJob {
  id: string;
  type: JobType;
  status: JobStatus;
  user_id: string | null;
  connected_account_id: string | null;
  payload: Json;
  idempotency_key: string;
  attempts: number;
  max_attempts: number;
  correlation_id: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  run_after: string;
  priority: number;
  result: Json | null;
  last_error_code: string | null;
  progress: Record<string, Json> | null;
}

export interface FakeAttempt {
  readonly jobId: string;
  readonly attempt: number;
  readonly workerId: string;
  outcome: 'running' | 'completed' | 'failed';
  errorCode: string | null;
}

export interface MemoryJobsRepo extends JobsRepo {
  readonly jobs: Map<string, FakeJob>;
  readonly attempts: FakeAttempt[];
  readonly failCalls: {
    jobId: string;
    errorCode: string;
    retryable: boolean;
    retryAfterSeconds: number | null;
  }[];
  byKey(key: string): FakeJob | undefined;
  reapExpiredLeases(): number;
}

export function memoryJobsRepo(now: () => number = Date.now): MemoryJobsRepo {
  const jobs = new Map<string, FakeJob>();
  const attempts: FakeAttempt[] = [];
  const failCalls: MemoryJobsRepo['failCalls'] = [];
  const iso = (ms: number) => new Date(ms).toISOString();

  const leased = (jobId: string, workerId: string): FakeJob => {
    const job = jobs.get(jobId);
    if (
      job === undefined ||
      job.status !== 'running' ||
      job.lease_owner !== workerId ||
      Date.parse(job.lease_expires_at ?? '') < now()
    ) {
      throw new LeaseLostError(jobId);
    }
    return job;
  };

  const closeAttempt = (
    jobId: string,
    outcome: FakeAttempt['outcome'],
    errorCode: string | null,
  ) => {
    const open = [...attempts].reverse().find((a) => a.jobId === jobId && a.outcome === 'running');
    if (open !== undefined) {
      open.outcome = outcome;
      open.errorCode = errorCode;
    }
  };

  const applyFailure = (
    job: FakeJob,
    errorCode: string,
    retryable: boolean,
    retryAfterSeconds: number | null,
  ) => {
    job.lease_owner = null;
    job.lease_expires_at = null;
    job.last_error_code = errorCode;
    if (!retryable) job.status = 'failed';
    else if (job.attempts >= job.max_attempts) job.status = 'dead_letter';
    else {
      job.status = 'retrying';
      job.run_after = iso(now() + (retryAfterSeconds ?? 30) * 1000);
    }
  };

  return {
    jobs,
    attempts,
    failCalls,
    byKey: (key) => [...jobs.values()].find((j) => j.idempotency_key === key),
    enqueue(input: EnqueueInput) {
      const existing = [...jobs.values()].find((j) => j.idempotency_key === input.idempotencyKey);
      if (existing !== undefined) return Promise.resolve(existing.id);
      const id = crypto.randomUUID();
      jobs.set(id, {
        id,
        type: input.type,
        status: 'queued',
        user_id: input.userId ?? null,
        connected_account_id: input.accountId ?? null,
        payload: input.payload ?? {},
        idempotency_key: input.idempotencyKey,
        attempts: 0,
        max_attempts: input.maxAttempts ?? 5,
        correlation_id: input.correlationId ?? crypto.randomUUID(),
        lease_owner: null,
        lease_expires_at: null,
        run_after: iso((input.runAfter ?? new Date(now())).getTime()),
        priority: input.priority ?? 100,
        result: null,
        last_error_code: null,
        progress: null,
      });
      return Promise.resolve(id);
    },
    claim(workerId, types, limit, leaseSeconds) {
      const ready = [...jobs.values()]
        .filter(
          (j) =>
            (j.status === 'queued' || j.status === 'retrying') &&
            Date.parse(j.run_after) <= now() &&
            types.includes(j.type),
        )
        .sort(
          (a, b) => a.priority - b.priority || Date.parse(a.run_after) - Date.parse(b.run_after),
        )
        .slice(0, limit);
      for (const job of ready) {
        job.status = 'running';
        job.attempts += 1;
        job.lease_owner = workerId;
        job.lease_expires_at = iso(now() + leaseSeconds * 1000);
        attempts.push({
          jobId: job.id,
          attempt: job.attempts,
          workerId,
          outcome: 'running',
          errorCode: null,
        });
      }
      return Promise.resolve(ready.map((j) => ({ ...j }) as JobRow));
    },
    extendLease(jobId, workerId, seconds) {
      const job = jobs.get(jobId);
      if (job === undefined || job.status !== 'running' || job.lease_owner !== workerId)
        return Promise.resolve(false);
      job.lease_expires_at = iso(now() + seconds * 1000);
      return Promise.resolve(true);
    },
    complete(jobId, workerId, result) {
      try {
        const job = leased(jobId, workerId);
        job.status = 'completed';
        job.result = result;
        job.lease_owner = null;
        job.lease_expires_at = null;
        closeAttempt(jobId, 'completed', null);
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error);
      }
    },
    fail(input) {
      failCalls.push({
        jobId: input.jobId,
        errorCode: input.errorCode,
        retryable: input.retryable,
        retryAfterSeconds: input.retryAfterSeconds,
      });
      try {
        const job = leased(input.jobId, input.workerId);
        applyFailure(job, input.errorCode, input.retryable, input.retryAfterSeconds);
        closeAttempt(input.jobId, 'failed', input.errorCode);
        return Promise.resolve(job.status);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    progress(jobId, workerId, progress) {
      try {
        leased(jobId, workerId).progress = progress;
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error);
      }
    },
    reapExpiredLeases() {
      let reaped = 0;
      for (const job of jobs.values()) {
        if (job.status === 'running' && Date.parse(job.lease_expires_at ?? '') < now()) {
          closeAttempt(job.id, 'failed', 'LEASE_EXPIRED');
          applyFailure(job, 'LEASE_EXPIRED', true, 0);
          job.run_after = iso(now());
          reaped++;
        }
      }
      return reaped;
    },
  };
}
