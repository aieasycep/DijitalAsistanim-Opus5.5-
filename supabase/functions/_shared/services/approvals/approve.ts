/**
 * API-APR-03 `POST /approvals/:id/approve` ("Onayla", "Göndermeyi Onayla", "Tekrar dene").
 *
 * - `pending → approved` with the key and version the user saw, a tap surface (R-03), an unexpired
 *   row, the Pro re-check, a healthy account with the write capability (424 `PROVIDER_SCOPE_MISSING`
 *   + `ScopeUpgrade` otherwise; the approval stays `pending`) and, for `calendar_update`, a fresh
 *   precondition (`APPROVAL_STALE`).
 * - Server targets: `transition_approval` enqueues `approval_execute:{id}:v{n}` with `run_after=now()`
 *   (no server-side undo window, R-06) and the worker is poked.
 * - Device targets (§6.7): on the destination installation the approval moves on to `executing` in
 *   the same request and the response carries a one-time `device_token` and the instructions;
 *   elsewhere it stays `approved` until the destination claims it (API-APR-05).
 * - `failed → executing` retries with the same key re-queue the same job row (retryable failures,
 *   or a reauth / scope failure after the account was fixed).
 * - A repeat on an approved / executing / executed row with the same key returns `already: true`.
 */
import { approvalExecuteJobKey, type ApprovalVia } from '@da/domain';
import type { ApprovalPayload, ApprovalView } from '@da/validation';
import { toBase64Url, toHex } from '../../crypto/encoding.ts';
import { sha256 } from '../../crypto/hmac.ts';
import { AppError } from '../../errors.ts';
import {
  type ApprovalServiceDeps,
  assertAccountWritable,
  requireApproval,
  stateConflict,
} from './context.ts';
import type { AccountInfo, ApprovalRow, JobInfo } from './model.ts';
import { scopeUpgrade, toApprovalView } from './view.ts';

export interface ApproveRequest {
  readonly userId: string;
  readonly approvalId: string;
  readonly idempotencyKey: string;
  readonly payloadVersion: number;
  readonly approvedVia: ApprovalVia;
  /** `X-DA-Installation-Id` of the calling app (the client installation id). */
  readonly installationId: string | null;
}

export interface JobRefView {
  readonly job_id: string;
  readonly status: JobInfo['status'];
  readonly poll_after_ms: number;
}

export interface ApproveResult {
  readonly approval: ApprovalView;
  readonly job: JobRefView | null;
  readonly execution: {
    readonly mode: 'server' | 'device';
    readonly device_token: string | null;
    readonly instructions: ApprovalPayload | null;
  };
  readonly already?: boolean;
}

/** Clients poll RPC-10 while `approved` / `executing` (R-19). */
export const POLL_AFTER_MS = 1500;

/** Failure codes a user retry may re-run once the account is fixed (API-APR-03). */
const FIXABLE_FAILURES = new Set(['PROVIDER_REAUTH_REQUIRED', 'PROVIDER_SCOPE_MISSING']);

/** A one-time device execution token: 32 random bytes as base64url (43 chars) and its sha256. */
export async function newDeviceToken(): Promise<{ token: string; hashHex: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toBase64Url(bytes);
  return { token, hashHex: toHex(await sha256(token)) };
}

async function jobRef(deps: ApprovalServiceDeps, row: ApprovalRow): Promise<JobRefView | null> {
  if (row.executor !== 'server') return null;
  const job = await deps.repo.job(approvalExecuteJobKey(row.id, row.payload_version));
  return job === null ? null : { job_id: job.id, status: job.status, poll_after_ms: POLL_AFTER_MS };
}

async function destinationAccount(
  deps: ApprovalServiceDeps,
  userId: string,
  row: ApprovalRow,
): Promise<AccountInfo | null> {
  if (row.destination_account_id === null) return null;
  const account = await deps.repo.account(userId, row.destination_account_id);
  if (account === null) throw new AppError('NOT_FOUND', { details: { resource: 'account' } });
  return account;
}

/** Account health, capability and precondition checks shared by approve and retry. */
async function preflight(
  deps: ApprovalServiceDeps,
  userId: string,
  row: ApprovalRow,
): Promise<AccountInfo | null> {
  const account = await destinationAccount(deps, userId, row);
  const capability = row.exact_change.card.capability;
  if (account === null || capability === null) return account;
  assertAccountWritable(account);
  if (!(await deps.repo.accountCan(account.id, capability))) {
    await deps.repo.setRequiresScope(userId, row.id, capability);
    const upgrade = scopeUpgrade(account, capability, row.id);
    throw new AppError('PROVIDER_SCOPE_MISSING', {
      details: {
        account_id: account.id,
        capability,
        ...(upgrade === null ? {} : { upgrade }),
      },
    });
  }
  if (row.requires_scope !== null) await deps.repo.setRequiresScope(userId, row.id, null);
  const payload = row.payload;
  if (payload.action_type === 'calendar_update' && deps.eventPrecondition !== undefined) {
    const event = await deps.repo.calendarEvent(userId, payload.calendar_event_id);
    const calendar =
      payload.target.kind === 'provider'
        ? await deps.repo.calendar(userId, payload.target.calendar_id)
        : null;
    if (event === null || calendar === null)
      throw new AppError('SOURCE_GONE', { details: { provider: account.provider } });
    const fresh = await deps.eventPrecondition({ userId, account, calendar, event });
    if (fresh === null)
      throw new AppError('SOURCE_GONE', { details: { provider: account.provider } });
    const seen = row.exact_change.card.precondition;
    if (seen !== null && fresh.etag !== null && fresh.etag !== seen) {
      throw new AppError('APPROVAL_STALE', { details: { approval_id: row.id } });
    }
  }
  return account;
}

async function planGate(
  deps: ApprovalServiceDeps,
  userId: string,
  row: ApprovalRow,
): Promise<void> {
  const needs =
    row.action_type === 'commitment_create'
      ? { feature: 'commitments', key: 'follow_up_commitments' }
      : row.origin === 'plan_proposal' || row.origin === 'conflict_resolution'
        ? { feature: 'advanced_planning', key: 'advanced_planning' }
        : null;
  if (needs !== null && !(await deps.repo.planFeature(userId, needs.key))) {
    throw new AppError('ENTITLEMENT_REQUIRED', { details: { feature: needs.feature } });
  }
}

async function onDestination(
  deps: ApprovalServiceDeps,
  userId: string,
  row: ApprovalRow,
  installationId: string | null,
): Promise<boolean> {
  if (row.executor !== 'device' || installationId === null) return false;
  const installation = await deps.repo.installationByClientId(userId, installationId);
  return installation !== null && installation.id === row.device_installation_id;
}

async function result(
  deps: ApprovalServiceDeps,
  row: ApprovalRow,
  account: AccountInfo | null,
  device: { token: string } | null,
  already: boolean,
): Promise<ApproveResult> {
  return {
    approval: toApprovalView(row, { locale: deps.locale, account }),
    job: await jobRef(deps, row),
    execution:
      device === null
        ? { mode: row.executor, device_token: null, instructions: null }
        : { mode: 'device', device_token: device.token, instructions: row.payload },
    ...(already ? { already: true } : {}),
  };
}

async function startOnDevice(
  deps: ApprovalServiceDeps,
  userId: string,
  row: ApprovalRow,
): Promise<{ row: ApprovalRow; token: string }> {
  const { token, hashHex } = await newDeviceToken();
  const started = await deps.repo.startDeviceExecution(
    row.id,
    userId,
    row.device_installation_id ?? '',
    hashHex,
  );
  return { row: started, token };
}

async function audit(
  deps: ApprovalServiceDeps,
  userId: string,
  row: ApprovalRow,
  action: 'user.approval.approved' | 'user.approval.retried',
  via: ApprovalVia,
): Promise<void> {
  await deps.audit.append({
    actorType: 'user',
    actorId: userId,
    action,
    targetType: 'approval_action',
    targetId: row.id,
    targetUserId: userId,
    result: 'success',
    details: { action_type: row.action_type, via },
    correlationId: deps.correlationId,
  });
}

export async function approveApproval(
  deps: ApprovalServiceDeps,
  input: ApproveRequest,
): Promise<ApproveResult> {
  const row = await requireApproval(deps, input.userId, input.approvalId);
  const keyMatches =
    input.idempotencyKey === row.idempotency_key && input.payloadVersion === row.payload_version;

  if (row.status === 'approved' || row.status === 'executing' || row.status === 'executed') {
    if (!keyMatches) throw stateConflict(row);
    if (
      row.executor === 'device' &&
      row.status !== 'executed' &&
      (await onDestination(deps, input.userId, row, input.installationId))
    ) {
      const started = await startOnDevice(deps, input.userId, row);
      return result(deps, started.row, null, { token: started.token }, true);
    }
    return result(deps, row, null, null, true);
  }

  if (row.status === 'pending') {
    if (!keyMatches) throw stateConflict(row, { reason: 'stale_version' });
    if (Date.parse(row.approval_expires_at) <= deps.now().getTime()) {
      const expired = await deps.repo.transition({
        id: row.id,
        to: 'approved',
        actor: 'user',
        actorId: input.userId,
        idempotencyKey: input.idempotencyKey,
        via: input.approvedVia,
      });
      throw stateConflict(expired);
    }
    if (row.exact_change.card.requires_confirmation && input.approvedVia === 'capture_batch') {
      throw new AppError('VALIDATION_FAILED', { details: { reason: 'confirmation_required' } });
    }
    await planGate(deps, input.userId, row);
    const account = await preflight(deps, input.userId, row);
    const approved = await deps.repo.transition({
      id: row.id,
      to: 'approved',
      actor: 'user',
      actorId: input.userId,
      idempotencyKey: input.idempotencyKey,
      via: input.approvedVia,
    });
    if (approved.status === 'expired') throw stateConflict(approved);
    await audit(deps, input.userId, approved, 'user.approval.approved', input.approvedVia);
    if (approved.executor === 'server') {
      await deps.pokeWorker('approval');
      return result(deps, approved, account, null, false);
    }
    if (await onDestination(deps, input.userId, approved, input.installationId)) {
      const started = await startOnDevice(deps, input.userId, approved);
      return result(deps, started.row, account, { token: started.token }, false);
    }
    return result(deps, approved, account, null, false);
  }

  if (row.status === 'failed') {
    if (!keyMatches) throw stateConflict(row);
    const code = row.last_error_code ?? '';
    const retryable = row.result?.retryable;
    const allowed =
      FIXABLE_FAILURES.has(code) ||
      (typeof retryable === 'boolean'
        ? retryable
        : code !== 'APPROVAL_STALE' && code !== 'PROVIDER_REJECTED');
    if (!allowed) throw stateConflict(row, { reason: 'not_retryable', failure_code: code });
    await planGate(deps, input.userId, row);
    const account = await preflight(deps, input.userId, row);
    if (row.executor === 'device') {
      if (!(await onDestination(deps, input.userId, row, input.installationId))) {
        throw stateConflict(row, { reason: 'device_destination_required' });
      }
      const started = await startOnDevice(deps, input.userId, row);
      await audit(deps, input.userId, started.row, 'user.approval.retried', input.approvedVia);
      return result(deps, started.row, account, { token: started.token }, false);
    }
    const retried = await deps.repo.transition({
      id: row.id,
      to: 'executing',
      actor: 'user',
      actorId: input.userId,
      idempotencyKey: input.idempotencyKey,
      reason: 'user_retry',
    });
    await audit(deps, input.userId, retried, 'user.approval.retried', input.approvedVia);
    await deps.pokeWorker('approval_retry');
    return result(deps, retried, account, null, false);
  }

  throw stateConflict(row);
}
