import { describe, expect, it } from 'vitest';
import {
  approvalExpiresAt,
  approvalFailurePolicy,
  isApprovalExpired,
} from '../src/approvals/policy.ts';
import {
  APPROVAL_TRANSITIONS,
  ApprovalTransitionError,
  APPROVED_VIA_VALUES,
  assertApprovalTransition,
  canTransition,
  editPendingApproval,
  isApprovedVia,
  isTerminalApprovalStatus,
  legalApprovalTransitions,
  newApprovalState,
  TERMINAL_APPROVAL_STATUSES,
  transitionApproval,
  type ApprovalState,
} from '../src/approvals/state-machine.ts';
import { APPROVAL_STATUS_VALUES, type ApprovalStatus } from '../src/enums.ts';

const ID = '5b3a1c9e-2f4d-4a8b-9c7e-1d2f3a4b5c6d';
const NOW = '2026-09-23T06:00:00Z';
const EXP = '2026-09-26T06:00:00Z';

/** The spine §5 edges, verbatim. */
const SPINE: [ApprovalStatus, ApprovalStatus][] = [
  ['pending', 'approved'],
  ['pending', 'rejected'],
  ['pending', 'expired'],
  ['approved', 'executing'],
  ['executing', 'executed'],
  ['executing', 'failed'],
  ['failed', 'executing'],
];

describe('transition table = spine §5 exactly (R-06)', () => {
  it('legal edges', () => {
    expect(legalApprovalTransitions()).toEqual(SPINE);
  });

  const all = APPROVAL_STATUS_VALUES.flatMap((f) =>
    APPROVAL_STATUS_VALUES.map((t) => [f, t] as const),
  );
  it.each(all)('%s → %s', (from, to) => {
    const legal = SPINE.some(([f, t]) => f === from && t === to);
    expect(canTransition(from, to)).toBe(legal);
    if (legal) {
      expect(() => {
        assertApprovalTransition(from, to);
      }).not.toThrow();
    } else {
      expect(() => {
        assertApprovalTransition(from, to);
      }).toThrow(`ILLEGAL_TRANSITION:${from}->${to}`);
    }
  });

  it('there is no undo edge and failed is left only by a retry', () => {
    expect(canTransition('approved', 'rejected')).toBe(false);
    expect(canTransition('approved', 'pending')).toBe(false);
    expect(APPROVAL_TRANSITIONS.failed).toEqual(['executing']);
    expect(TERMINAL_APPROVAL_STATUSES).toEqual(['rejected', 'executed', 'expired']);
    expect(isTerminalApprovalStatus('failed')).toBe(false);
  });

  it('approved_via is tap-only (R-03)', () => {
    expect(APPROVED_VIA_VALUES).toEqual([
      'approval_center',
      'inline_sheet',
      'voice_card',
      'capture_batch',
      'in_place',
    ]);
    expect(isApprovedVia('voice_card')).toBe(true);
    expect(isApprovedVia('voice')).toBe(false);
    expect(isApprovedVia('spoken_onayla')).toBe(false);
  });
});

describe('transitionApproval (mirrors private.transition_approval)', () => {
  const s0 = newApprovalState(ID, EXP);

  it('a new approval is pending with key approval:{id}:v1', () => {
    expect(s0).toMatchObject({
      status: 'pending',
      payload_version: 1,
      idempotency_key: `approval:${ID}:v1`,
    });
  });

  it('full happy path writes one event per transition', () => {
    const a = transitionApproval(s0, {
      to: 'approved',
      actor: 'user',
      idempotencyKey: s0.idempotency_key,
      now: NOW,
      via: 'inline_sheet',
    });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.state).toMatchObject({
      status: 'approved',
      approved_via: 'inline_sheet',
      approved_at: '2026-09-23T06:00:00.000Z',
    });
    expect(a.event).toMatchObject({
      from_status: 'pending',
      to_status: 'approved',
      actor: 'user',
      payload_version: 1,
    });
    const x = transitionApproval(a.state, {
      to: 'executing',
      actor: 'worker',
      idempotencyKey: s0.idempotency_key,
      now: NOW,
    });
    expect(x.ok && x.state.attempt_count).toBe(1);
    if (!x.ok) return;
    const d = transitionApproval(x.state, {
      to: 'executed',
      actor: 'worker',
      idempotencyKey: s0.idempotency_key,
      now: NOW,
    });
    expect(d.ok && d.state.status).toBe('executed');
  });

  it('approve requires a tap via', () => {
    const r = transitionApproval(s0, {
      to: 'approved',
      actor: 'user',
      idempotencyKey: s0.idempotency_key,
      now: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('APPROVED_VIA_REQUIRED');
  });

  it('approve binds to the exact payload version (IDEMPOTENCY_MISMATCH)', () => {
    const r = transitionApproval(s0, {
      to: 'approved',
      actor: 'user',
      idempotencyKey: `approval:${ID}:v2`,
      now: NOW,
      via: 'approval_center',
    });
    expect(!r.ok && r.error.code).toBe('IDEMPOTENCY_MISMATCH');
  });

  it('approving after expiry moves the row to expired and raises APPROVAL_EXPIRED', () => {
    const r = transitionApproval(s0, {
      to: 'approved',
      actor: 'user',
      idempotencyKey: s0.idempotency_key,
      now: EXP,
      via: 'approval_center',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(ApprovalTransitionError);
      expect(r.error.code).toBe('APPROVAL_EXPIRED');
      expect(r.state?.status).toBe('expired');
      expect(r.event).toMatchObject({
        from_status: 'pending',
        to_status: 'expired',
        actor: 'system',
      });
    }
  });

  it('a repeated call with the same status and key is an idempotent no-op', () => {
    const a = transitionApproval(s0, {
      to: 'approved',
      actor: 'user',
      idempotencyKey: s0.idempotency_key,
      now: NOW,
      via: 'inline_sheet',
    });
    if (!a.ok) throw new Error('unexpected');
    const again = transitionApproval(a.state, {
      to: 'approved',
      actor: 'user',
      idempotencyKey: s0.idempotency_key,
      now: NOW,
      via: 'inline_sheet',
    });
    expect(again).toEqual({ ok: true, state: a.state, event: null });
  });

  it('illegal edges are rejected with the SQL error text', () => {
    const r = transitionApproval(s0, {
      to: 'executed',
      actor: 'worker',
      idempotencyKey: s0.idempotency_key,
      now: NOW,
    });
    expect(!r.ok && r.error.message).toBe('ILLEGAL_TRANSITION:pending->executed');
    const back = transitionApproval(
      { ...s0, status: 'approved' },
      { to: 'pending', actor: 'user', idempotencyKey: s0.idempotency_key, now: NOW },
    );
    expect(!back.ok && back.error.message).toBe('ILLEGAL_TRANSITION:approved->pending');
  });

  it('failed → executing retries with the same key and increments attempts', () => {
    const failed: ApprovalState = {
      ...s0,
      status: 'failed',
      attempt_count: 1,
      last_error_code: 'PROVIDER_UNAVAILABLE',
    };
    const r = transitionApproval(failed, {
      to: 'executing',
      actor: 'user',
      idempotencyKey: s0.idempotency_key,
      now: NOW,
    });
    expect(r.ok && r.state).toMatchObject({
      status: 'executing',
      attempt_count: 2,
      idempotency_key: s0.idempotency_key,
    });
    const wrongKey = transitionApproval(failed, {
      to: 'executing',
      actor: 'user',
      idempotencyKey: 'approval:other:v1',
      now: NOW,
    });
    expect(!wrongKey.ok && wrongKey.error.code).toBe('IDEMPOTENCY_MISMATCH');
  });

  it('reject and fail record reasons', () => {
    const rej = transitionApproval(s0, {
      to: 'rejected',
      actor: 'user',
      idempotencyKey: s0.idempotency_key,
      now: NOW,
      rejectionReason: 'user_cancel',
    });
    expect(rej.ok && rej.state).toMatchObject({
      status: 'rejected',
      rejection_reason: 'user_cancel',
    });
    const exe: ApprovalState = { ...s0, status: 'executing' };
    const fail = transitionApproval(exe, {
      to: 'failed',
      actor: 'worker',
      idempotencyKey: s0.idempotency_key,
      now: NOW,
      errorCode: 'APPROVAL_STALE',
    });
    expect(fail.ok && fail.state.last_error_code).toBe('APPROVAL_STALE');
    const exp = transitionApproval(s0, {
      to: 'expired',
      actor: 'system',
      idempotencyKey: s0.idempotency_key,
      now: NOW,
    });
    expect(exp.ok && exp.state.status).toBe('expired');
  });
});

describe('edits while pending', () => {
  it('create a new payload version and a new idempotency key', () => {
    const s0 = newApprovalState(ID, EXP);
    const e = editPendingApproval(s0, { now: NOW, actorId: 'u1' });
    expect(e.ok && e.state).toMatchObject({
      payload_version: 2,
      idempotency_key: `approval:${ID}:v2`,
      status: 'pending',
    });
    expect(e.ok && e.event).toMatchObject({
      from_status: 'pending',
      to_status: 'pending',
      reason: 'edited',
      payload_version: 2,
    });
    // the old key can no longer approve
    if (!e.ok) return;
    const stale = transitionApproval(e.state, {
      to: 'approved',
      actor: 'user',
      idempotencyKey: s0.idempotency_key,
      now: NOW,
      via: 'approval_center',
    });
    expect(!stale.ok && stale.error.code).toBe('IDEMPOTENCY_MISMATCH');
  });

  it('are rejected outside pending', () => {
    const r = editPendingApproval(
      { ...newApprovalState(ID, EXP), status: 'approved' },
      { now: NOW },
    );
    expect(!r.ok && r.error.code).toBe('EDIT_NOT_ALLOWED');
  });
});

describe('approval policy (API_CONTRACTS §6.6)', () => {
  const created = '2026-09-23T06:00:00Z';
  it.each([
    ['email_send', {}, '2026-09-26T06:00:00.000Z'],
    ['task_create', {}, '2026-09-30T06:00:00.000Z'],
    ['commitment_create', {}, '2026-09-30T06:00:00.000Z'],
    ['calendar_create', { eventStart: '2026-09-24T11:00:00Z' }, '2026-09-24T11:00:00.000Z'],
    ['calendar_create', { eventStart: '2026-10-24T11:00:00Z' }, '2026-09-30T06:00:00.000Z'],
    ['calendar_update', {}, '2026-09-30T06:00:00.000Z'],
    ['reminder_create', { fireAt: '2026-09-23T14:00:00Z' }, '2026-09-23T14:00:00.000Z'],
  ] as const)('%s %j → %s', (type, extra, iso) => {
    expect(approvalExpiresAt(type, { createdAt: created, ...extra }).toISOString()).toBe(iso);
  });

  it('reminder_create needs a fire time; expiry check', () => {
    expect(() => approvalExpiresAt('reminder_create', { createdAt: created })).toThrow(RangeError);
    expect(isApprovalExpired('2026-09-23T06:00:00Z', '2026-09-23T06:00:00Z')).toBe(true);
    expect(isApprovalExpired('2026-09-23T06:00:01Z', '2026-09-23T06:00:00Z')).toBe(false);
  });

  it('failure policy', () => {
    expect(approvalFailurePolicy('APPROVAL_STALE')).toMatchObject({
      retryable: false,
      action: 'repropose',
    });
    expect(approvalFailurePolicy('PROVIDER_SCOPE_MISSING').action).toBe('upgrade_scope');
    expect(approvalFailurePolicy('DEVICE_RESULT_MISSING').retryable).toBe(true);
    expect(approvalFailurePolicy(null)).toMatchObject({
      retryable: true,
      messageKey: 'approvals.failure.generic',
    });
    expect(approvalFailurePolicy('SOMETHING_NEW').action).toBe('retry');
  });
});
