/** Job queue types (ADR-04, API_CONTRACTS §11, DATABASE_AND_RLS_PLAN §4.7 `jobs`, §6.2). */
import type { JobStatus, JobType } from '@da/domain';
import type { z } from 'zod';
import type { Logger } from '../logging/logger.ts';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** The `jobs` columns the runner reads (a row returned by `claim_jobs`). */
export interface JobRow {
  readonly id: string;
  readonly type: JobType;
  readonly status: JobStatus;
  readonly user_id: string | null;
  readonly connected_account_id: string | null;
  readonly payload: Json;
  readonly idempotency_key: string;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly correlation_id: string;
  readonly lease_owner: string | null;
  readonly lease_expires_at: string | null;
  readonly run_after: string;
}

export interface EnqueueInput {
  readonly type: JobType;
  readonly idempotencyKey: string;
  readonly payload?: Json;
  readonly userId?: string | null;
  readonly accountId?: string | null;
  readonly runAfter?: Date;
  readonly priority?: number;
  readonly maxAttempts?: number;
  readonly correlationId?: string | null;
}

export interface JobContext<P> {
  readonly job: JobRow;
  readonly payload: P;
  readonly signal: AbortSignal;
  readonly log: Logger;
  readonly correlationId: string;
  readonly workerId: string;
  /** Enqueue a follow-up job; the correlation id is inherited. */
  enqueue(input: EnqueueInput): Promise<string>;
  /** Persists `jobs.progress` (e.g. First Analysis counters). */
  progress(progress: Record<string, Json>): Promise<void>;
  now(): Date;
}

export type JobResult = Record<string, Json> | null;

export type JobHandler<P> = (ctx: JobContext<P>) => Promise<JobResult>;

export interface JobDefinition<P = unknown> {
  readonly type: JobType;
  /** Payload schema: a parse failure is a poison payload (never retried). */
  readonly payload: z.ZodType<P>;
  readonly timeoutMs: number;
  readonly handler: JobHandler<P>;
  /** Scoped definition predicate (see `defineJob`). */
  readonly match?: (payload: unknown) => boolean;
}

/**
 * A handler failure with its retry semantics. `retryable=false` ends the job as `failed` (business
 * failure); retryable failures are retried with backoff until `max_attempts`, then `dead_letter`.
 */
export class JobError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds: number | null = null,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'JobError';
  }
}

export type AttemptOutcome = 'completed' | 'retrying' | 'failed' | 'dead_letter' | 'lease_lost';

export interface RunSummary {
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
  dead_lettered: number;
  lease_lost: number;
  duration_ms: number;
}
