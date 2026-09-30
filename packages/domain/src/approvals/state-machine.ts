/**
 * Approval state machine. Mirrors `private.transition_approval` (DATABASE_AND_RLS_PLAN §6.6) and is
 * exactly the spine §5 machine:
 *
 *   pending → approved → executing → executed | failed
 *   pending → rejected | expired
 *   failed  → executing            (retry with the same idempotency key)
 *
 * There is no undo status and no extra edge (R-06): "Geri al" is a client-side 5 s delay before the
 * approve request is sent. Edits are allowed only while `pending` and create a new payload version
 * with a new idempotency key. Approval is tap-only (R-03): `approved_via` is required.
 */
import type { ApprovalStatus, ApprovalVia } from '../enums.ts';
import { APPROVAL_STATUS_VALUES, APPROVAL_VIA_VALUES } from '../enums.ts';
import type {
  ApprovalActor,
  ApprovalEvent,
  ApprovalRejectionReason,
} from '../entities/approval.ts';
import { approvalIdempotencyKey } from '../ids.ts';
import { type Instant, toDate } from '../time/zone.ts';

/** Legal edges, exactly plan §5. */
export const APPROVAL_TRANSITIONS: Readonly<Record<ApprovalStatus, readonly ApprovalStatus[]>> = {
  pending: ['approved', 'rejected', 'expired'],
  approved: ['executing'],
  executing: ['executed', 'failed'],
  failed: ['executing'],
  rejected: [],
  expired: [],
  executed: [],
};

/** Statuses with no outgoing edge. `failed` is not terminal (retry). */
export const TERMINAL_APPROVAL_STATUSES: readonly ApprovalStatus[] = APPROVAL_STATUS_VALUES.filter(
  (s) => APPROVAL_TRANSITIONS[s].length === 0,
);

/** R-03: every `approved_via` value is a tap. */
export const APPROVED_VIA_VALUES: readonly ApprovalVia[] = APPROVAL_VIA_VALUES;

export function isApprovedVia(value: unknown): value is ApprovalVia {
  return typeof value === 'string' && (APPROVAL_VIA_VALUES as readonly string[]).includes(value);
}

export function canTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return APPROVAL_TRANSITIONS[from].includes(to);
}

/** All legal `[from, to]` pairs. */
export function legalApprovalTransitions(): [ApprovalStatus, ApprovalStatus][] {
  return APPROVAL_STATUS_VALUES.flatMap((from) =>
    APPROVAL_TRANSITIONS[from].map((to): [ApprovalStatus, ApprovalStatus] => [from, to]),
  );
}

export function isTerminalApprovalStatus(status: ApprovalStatus): boolean {
  return TERMINAL_APPROVAL_STATUSES.includes(status);
}

export type ApprovalErrorCode =
  | 'ILLEGAL_TRANSITION'
  | 'IDEMPOTENCY_MISMATCH'
  | 'APPROVAL_EXPIRED'
  | 'APPROVED_VIA_REQUIRED'
  | 'EDIT_NOT_ALLOWED';

export class ApprovalTransitionError extends Error {
  readonly code: ApprovalErrorCode;
  constructor(code: ApprovalErrorCode, detail: string) {
    super(`${code}:${detail}`);
    this.name = 'ApprovalTransitionError';
    this.code = code;
  }
}

/** Throws `ILLEGAL_TRANSITION:<from>-><to>` for an illegal edge (same text as the SQL function). */
export function assertApprovalTransition(from: ApprovalStatus, to: ApprovalStatus): void {
  if (!canTransition(from, to)) {
    throw new ApprovalTransitionError('ILLEGAL_TRANSITION', `${from}->${to}`);
  }
}

/** The state-machine-relevant columns of `approval_actions`. */
export interface ApprovalState {
  readonly id: string;
  readonly status: ApprovalStatus;
  readonly payload_version: number;
  readonly idempotency_key: string;
  readonly approval_expires_at: string;
  readonly approved_via: ApprovalVia | null;
  readonly attempt_count: number;
  readonly approved_at: string | null;
  readonly rejected_at: string | null;
  readonly rejection_reason: ApprovalRejectionReason | null;
  readonly executing_at: string | null;
  readonly executed_at: string | null;
  readonly failed_at: string | null;
  readonly last_error_code: string | null;
}

/** A fresh `pending` approval (payload version 1, key `approval:{id}:v1`). */
export function newApprovalState(id: string, approvalExpiresAt: Instant): ApprovalState {
  return {
    id,
    status: 'pending',
    payload_version: 1,
    idempotency_key: approvalIdempotencyKey(id, 1),
    approval_expires_at: toDate(approvalExpiresAt).toISOString(),
    approved_via: null,
    attempt_count: 0,
    approved_at: null,
    rejected_at: null,
    rejection_reason: null,
    executing_at: null,
    executed_at: null,
    failed_at: null,
    last_error_code: null,
  };
}

export interface TransitionRequest {
  readonly to: ApprovalStatus;
  readonly actor: ApprovalActor;
  readonly actorId?: string | null;
  /** The key the caller saw; must equal the row's key for `approved` and for retries. */
  readonly idempotencyKey: string;
  readonly now: Instant;
  readonly via?: ApprovalVia;
  readonly reason?: string | null;
  readonly rejectionReason?: ApprovalRejectionReason;
  readonly errorCode?: string | null;
}

export type TransitionResult =
  | {
      readonly ok: true;
      readonly state: ApprovalState;
      /** Null when the call was an idempotent repeat (same status, same key). */
      readonly event: ApprovalEvent | null;
    }
  | {
      readonly ok: false;
      readonly error: ApprovalTransitionError;
      /** Set when the failure itself moved the row (approve after expiry → `expired`). */
      readonly state?: ApprovalState;
      readonly event?: ApprovalEvent;
    };

function eventFor(
  state: ApprovalState,
  from: ApprovalStatus | null,
  to: ApprovalStatus,
  req: Pick<TransitionRequest, 'actor' | 'actorId' | 'reason'>,
  at: Date,
): ApprovalEvent {
  return {
    approval_action_id: state.id,
    from_status: from,
    to_status: to,
    actor: req.actor,
    actor_id: req.actorId ?? null,
    payload_version: state.payload_version,
    idempotency_key: state.idempotency_key,
    reason: req.reason ?? null,
    created_at: at.toISOString(),
  };
}

/**
 * Applies one transition. Pure: returns the new state and the `approval_events` row to append.
 * Rules (same as the SQL function): legal edge only; idempotent repeat of the same status with
 * the same key is a no-op; `approved` requires the caller's key to match, a tap `via`, and an
 * unexpired approval (an expired one moves to `expired`); `failed → executing` keeps the key.
 */
export function transitionApproval(state: ApprovalState, req: TransitionRequest): TransitionResult {
  const now = toDate(req.now);
  const iso = now.toISOString();
  if (state.status === req.to && req.idempotencyKey === state.idempotency_key) {
    return { ok: true, state, event: null };
  }
  if (!canTransition(state.status, req.to)) {
    return {
      ok: false,
      error: new ApprovalTransitionError('ILLEGAL_TRANSITION', `${state.status}->${req.to}`),
    };
  }
  const keyBound = req.to === 'approved' || (state.status === 'failed' && req.to === 'executing');
  if (keyBound && req.idempotencyKey !== state.idempotency_key) {
    return {
      ok: false,
      error: new ApprovalTransitionError('IDEMPOTENCY_MISMATCH', state.idempotency_key),
    };
  }

  switch (req.to) {
    case 'approved': {
      if (!req.via || !isApprovedVia(req.via)) {
        return { ok: false, error: new ApprovalTransitionError('APPROVED_VIA_REQUIRED', 'tap') };
      }
      if (now.getTime() >= toDate(state.approval_expires_at).getTime()) {
        const expired: ApprovalState = { ...state, status: 'expired' };
        return {
          ok: false,
          error: new ApprovalTransitionError('APPROVAL_EXPIRED', state.approval_expires_at),
          state: expired,
          event: eventFor(
            expired,
            'pending',
            'expired',
            { actor: 'system', reason: 'expired' },
            now,
          ),
        };
      }
      const next: ApprovalState = {
        ...state,
        status: 'approved',
        approved_via: req.via,
        approved_at: iso,
      };
      return { ok: true, state: next, event: eventFor(next, state.status, 'approved', req, now) };
    }
    case 'rejected': {
      const next: ApprovalState = {
        ...state,
        status: 'rejected',
        rejected_at: iso,
        rejection_reason: req.rejectionReason ?? 'user_reject',
      };
      return { ok: true, state: next, event: eventFor(next, state.status, 'rejected', req, now) };
    }
    case 'expired': {
      const next: ApprovalState = { ...state, status: 'expired' };
      return { ok: true, state: next, event: eventFor(next, state.status, 'expired', req, now) };
    }
    case 'executing': {
      const next: ApprovalState = {
        ...state,
        status: 'executing',
        executing_at: iso,
        attempt_count: state.attempt_count + 1,
      };
      return { ok: true, state: next, event: eventFor(next, state.status, 'executing', req, now) };
    }
    case 'executed': {
      const next: ApprovalState = {
        ...state,
        status: 'executed',
        executed_at: iso,
        last_error_code: null,
      };
      return { ok: true, state: next, event: eventFor(next, state.status, 'executed', req, now) };
    }
    case 'failed': {
      const next: ApprovalState = {
        ...state,
        status: 'failed',
        failed_at: iso,
        last_error_code: req.errorCode ?? null,
      };
      return { ok: true, state: next, event: eventFor(next, state.status, 'failed', req, now) };
    }
    case 'pending':
      return {
        ok: false,
        error: new ApprovalTransitionError('ILLEGAL_TRANSITION', `${state.status}->pending`),
      };
  }
}

export type EditResult =
  | { readonly ok: true; readonly state: ApprovalState; readonly event: ApprovalEvent }
  | { readonly ok: false; readonly error: ApprovalTransitionError };

/**
 * Edit while `pending` (`private.edit_approval_payload`): `payload_version + 1` and a new key
 * `approval:{id}:v{payload_version}`; the event is `pending → pending` with reason `edited`.
 */
export function editPendingApproval(
  state: ApprovalState,
  input: { readonly now: Instant; readonly actorId?: string | null },
): EditResult {
  if (state.status !== 'pending') {
    return { ok: false, error: new ApprovalTransitionError('EDIT_NOT_ALLOWED', state.status) };
  }
  const version = state.payload_version + 1;
  const next: ApprovalState = {
    ...state,
    payload_version: version,
    idempotency_key: approvalIdempotencyKey(state.id, version),
  };
  return {
    ok: true,
    state: next,
    event: eventFor(
      next,
      'pending',
      'pending',
      { actor: 'user', actorId: input.actorId ?? null, reason: 'edited' },
      toDate(input.now),
    ),
  };
}
