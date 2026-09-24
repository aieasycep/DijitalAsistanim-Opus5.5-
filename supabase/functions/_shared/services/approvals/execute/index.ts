/**
 * JOB-17 `approval_execute` (IMPLEMENTATION_PLAN T-6.02…T-6.04; API_CONTRACTS §6, §11.4;
 * INTEGRATION_PLAN §3.12). Server-side execution of an approved write for every action type.
 *
 * 1. Load the approval; the job key's version must match. `approved → executing` (the DB state
 *    machine, `transition_approval`); a row already `executing` is a user retry (`failed →
 *    executing`, same key, same job row) or a crash recovery — both run the existence probe first.
 * 2. Re-check the Pro gate, open the destination account (fresh token) and write once through the
 *    provider adapter interfaces with the approval's idempotency markers.
 * 3. `executing → executed` with `provider_idempotency_ref` and `result` (provider ids stay
 *    server-side), then the related state (reply draft `sent`, thread awaiting their reply, origin
 *    insight done) and the provider re-sync.
 * 4. Terminal failures (`PROVIDER_REAUTH_REQUIRED`, `PROVIDER_SCOPE_MISSING`, `PROVIDER_REJECTED`,
 *    `APPROVAL_STALE`, `ENTITLEMENT_REQUIRED`, …) move the approval to `failed` (non-retryable) and
 *    send an `approval` push; retryable ones are retried by the queue and, once `max_attempts` is
 *    reached, leave the approval `failed {retryable:true}` for "Tekrar dene".
 */
import { z } from 'zod';
import { defineJob } from '../../../jobs/registry.ts';
import {
  JobError,
  type JobContext,
  type JobDefinition,
  type JobResult,
  type Json,
} from '../../../jobs/types.ts';
import { approvalFailedJob } from '../../notifications/triggers/approval-expiry.ts';
import type { ApprovalRow } from '../model.ts';
import { executeCalendarCreate } from './calendar-create.ts';
import { executeCalendarUpdate } from './calendar-update.ts';
import { executeCommitmentCreate } from './commitment-create.ts';
import { executeEmailSend } from './email-send.ts';
import { deriveMarker, type MarkerConfig } from './marker.ts';
import {
  type ExecEnv,
  ExecutionFailure,
  type ExecOutcome,
  type ExecuteRepo,
  type ProviderSessions,
} from './model.ts';
import { executeReminderCreate } from './reminder-create.ts';
import { executeTaskCreate } from './task-create.ts';
import { toFailure } from './common.ts';

const Uuid = z.uuid();

/** `{approval_id}` (enqueued by `transition_approval`) or the documented JOB-17 payload. */
export const ApprovalExecutePayload = z.union([
  z.object({
    approval_action_id: Uuid,
    idempotency_key: z.string().max(80),
    payload_version: z.int().min(1),
    attempt_kind: z.enum(['initial', 'retry']),
  }),
  z.object({ approval_id: Uuid }),
]);
export type ApprovalExecutePayload = z.infer<typeof ApprovalExecutePayload>;

export interface ApprovalExecuteDeps {
  readonly repo: ExecuteRepo;
  readonly sessions: ProviderSessions;
  readonly markers: MarkerConfig;
  readonly sleep?: (ms: number) => Promise<void>;
}

const KEY_RE = /^approval_execute:([0-9a-f-]{36}):v(\d+)$/i;

function jobVersion(key: string): number | null {
  const match = KEY_RE.exec(key);
  return match?.[2] === undefined ? null : Number(match[2]);
}

async function planGate(deps: ApprovalExecuteDeps, approval: ApprovalRow): Promise<void> {
  const key =
    approval.action_type === 'commitment_create'
      ? 'follow_up_commitments'
      : approval.origin === 'plan_proposal' || approval.origin === 'conflict_resolution'
        ? 'advanced_planning'
        : null;
  if (key !== null && !(await deps.repo.planFeature(approval.user_id, key))) {
    throw new ExecutionFailure('ENTITLEMENT_REQUIRED', false, null, key);
  }
}

function dispatch(env: ExecEnv): Promise<ExecOutcome> {
  switch (env.approval.action_type) {
    case 'email_send':
      return executeEmailSend(env);
    case 'calendar_create':
      return executeCalendarCreate(env);
    case 'calendar_update':
      return executeCalendarUpdate(env);
    case 'task_create':
      return executeTaskCreate(env);
    case 'reminder_create':
      return executeReminderCreate(env);
    case 'commitment_create':
      return executeCommitmentCreate(env);
  }
}

async function afterExecuted(
  deps: ApprovalExecuteDeps,
  ctx: JobContext<ApprovalExecutePayload>,
  approval: ApprovalRow,
  outcome: ExecOutcome,
): Promise<void> {
  const payload = approval.payload;
  if (payload.action_type === 'email_send') {
    await deps.repo.markReplyDraftSent(approval.user_id, payload.reply_draft_id);
    await deps.repo.markThreadAwaitingReply(approval.user_id, payload.thread.email_thread_id);
  }
  if (approval.origin === 'insight' && approval.origin_ref_id !== null) {
    await deps.repo.markInsightDone(approval.user_id, approval.origin_ref_id);
  }
  for (const job of outcome.followUps) await ctx.enqueue(job);
}

async function fail(
  deps: ApprovalExecuteDeps,
  ctx: JobContext<ApprovalExecutePayload>,
  approval: ApprovalRow,
  failure: ExecutionFailure,
  finalAttempt: boolean,
): Promise<never> {
  if (!failure.retryable || finalAttempt) {
    const failed = await deps.repo.transition({
      id: approval.id,
      to: 'failed',
      actor: 'worker',
      actorId: null,
      idempotencyKey: null,
      reason: failure.retryable ? 'retries_exhausted' : 'terminal_failure',
      result: {
        ...(failure.detail ?? {}),
        retryable: failure.retryable,
        failure_code: failure.code,
        target: 'provider',
      },
      errorCode: failure.code,
      errorMessage: failure.message.slice(0, 300),
    });
    await ctx.enqueue(approvalFailedJob(failed));
  }
  throw new JobError(failure.code, failure.retryable, failure.retryAfterSeconds, failure.message);
}

export async function runApprovalExecute(
  deps: ApprovalExecuteDeps,
  ctx: JobContext<ApprovalExecutePayload>,
): Promise<JobResult> {
  const id =
    'approval_id' in ctx.payload ? ctx.payload.approval_id : ctx.payload.approval_action_id;
  let approval = await deps.repo.approval(id);
  if (approval === null) return { skipped: 'approval_missing' };
  const version =
    'payload_version' in ctx.payload
      ? ctx.payload.payload_version
      : jobVersion(ctx.job.idempotency_key);
  if (version !== null && version !== approval.payload_version) return { skipped: 'state_changed' };
  if (
    'idempotency_key' in ctx.payload &&
    ctx.payload.idempotency_key !== approval.idempotency_key
  ) {
    return { skipped: 'state_changed' };
  }
  if (approval.executor !== 'server') return { skipped: 'device_executor' };
  if (approval.status === 'executed') return { skipped: 'already_executed' };

  let recovering = ctx.job.attempts > 1;
  if (approval.status === 'approved') {
    approval = await deps.repo.transition({
      id: approval.id,
      to: 'executing',
      actor: 'worker',
      actorId: null,
      idempotencyKey: null,
      reason: 'job_claimed',
    });
  } else if (approval.status === 'executing') {
    recovering = true;
  } else {
    return { skipped: 'state_changed', status: approval.status };
  }

  const finalAttempt = ctx.job.attempts >= ctx.job.max_attempts;
  let outcome: ExecOutcome;
  try {
    await planGate(deps, approval);
    outcome = await dispatch({
      approval,
      repo: deps.repo,
      sessions: deps.sessions,
      marker: deriveMarker(approval.id, approval.idempotency_key, deps.markers),
      probeFirst: recovering || approval.attempt_count > 1,
      now: ctx.now(),
      signal: ctx.signal,
      log: ctx.log,
      correlationId: ctx.correlationId,
      sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    });
  } catch (error) {
    return await fail(deps, ctx, approval, toFailure(error), finalAttempt);
  }

  const executed = await deps.repo.transition({
    id: approval.id,
    to: 'executed',
    actor: 'worker',
    actorId: null,
    idempotencyKey: null,
    reason: outcome.result.already_existed === true ? 'already_existed' : 'executed',
    result: { ...outcome.result, provider_idempotency_ref: outcome.providerRef } as Record<
      string,
      Json
    >,
  });
  await afterExecuted(deps, ctx, executed, outcome);
  return {
    approval_id: executed.id,
    status: executed.status,
    action_type: executed.action_type,
    already_existed: outcome.result.already_existed === true,
  };
}

export function approvalExecuteJob(
  deps: ApprovalExecuteDeps,
): JobDefinition<ApprovalExecutePayload> {
  return defineJob({
    type: 'approval_execute',
    payload: ApprovalExecutePayload,
    handler: (ctx) => runApprovalExecute(deps, ctx),
  });
}
