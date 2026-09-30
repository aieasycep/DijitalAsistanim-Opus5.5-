/**
 * Referral lifecycle (plan §16; API-BIZ-01 apply; JOB-25 `referral_evaluate`; BACKOFFICE_PLAN
 * §6.15 review; `private.reward_referral`).
 *
 * Status machine (`referral_status`):
 *   pending → qualified | flagged | rejected
 *   flagged → qualified | rejected          (admin review with reason + audit)
 *   qualified → rewarded                    (credits + grants written idempotently)
 *
 * `evaluateReferral` acts only on `pending` referrals, so a clean referral is qualified exactly
 * once; the reward is keyed `referral:{referral_id}:{side}` (credits and grants), so evaluating or
 * rewarding twice produces the same two keys and the database keeps one row per side.
 */
import { referralCreditKey } from '../ids.ts';
import type { ReferralSide, ReferralStatus } from '../enums.ts';
import { isValidReferralCode, normalizeReferralCode } from './code.ts';
import type { ReferralPolicy } from './policy.ts';
import type { QualificationResult } from './qualify.ts';
import type { ReferralPartySignals, RiskAssessment } from './risk.ts';

/** `referrals.reject_reason` check-constraint values. */
export const REFERRAL_REJECT_REASONS = [
  'self_referral',
  'duplicate_account',
  'loop',
  'cap_reached',
  'velocity',
  'admin_rejected',
  'qualification_timeout',
  'tombstoned',
] as const;
export type ReferralRejectReason = (typeof REFERRAL_REJECT_REASONS)[number];

const TRANSITIONS: Readonly<Record<ReferralStatus, readonly ReferralStatus[]>> = {
  pending: ['qualified', 'flagged', 'rejected'],
  flagged: ['qualified', 'rejected'],
  qualified: ['rewarded'],
  rewarded: [],
  rejected: [],
};

export function canTransitionReferral(from: ReferralStatus, to: ReferralStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface ReferralRewardSide {
  side: ReferralSide;
  /** `referral_credits.idempotency_key` and `entitlement_grants.idempotency_key`. */
  idempotencyKey: string;
  grantSource: 'referral_referrer' | 'referral_referee';
  days: number;
}

export interface ReferralRewardPlan {
  referee: ReferralRewardSide;
  /** Null when the referrer reached the yearly cap: the referee is still rewarded. */
  referrer: ReferralRewardSide | null;
  referrerWithheld: 'cap_reached' | null;
}

export function planReferralReward(
  referralId: string,
  policy: Pick<ReferralPolicy, 'rewardDays'>,
  referrerCapReached: boolean,
): ReferralRewardPlan {
  const side = (s: ReferralSide): ReferralRewardSide => ({
    side: s,
    idempotencyKey: referralCreditKey(referralId, s),
    grantSource: s === 'referrer' ? 'referral_referrer' : 'referral_referee',
    days: policy.rewardDays,
  });
  return {
    referee: side('referee'),
    referrer: referrerCapReached ? null : side('referrer'),
    referrerWithheld: referrerCapReached ? 'cap_reached' : null,
  };
}

export interface ReferralRecord {
  id: string;
  status: ReferralStatus;
  applied_at: string;
}

export type ReferralEvaluation =
  | { action: 'none'; reason: 'not_pending' }
  | { action: 'reject'; status: 'rejected'; rejectReason: ReferralRejectReason }
  | { action: 'wait'; recheckAt: string; qualification: QualificationResult }
  | { action: 'flag'; status: 'flagged'; risk: RiskAssessment }
  | {
      action: 'qualify';
      status: 'qualified';
      qualification: QualificationResult;
      reward: ReferralRewardPlan;
    };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * One evaluation step for JOB-25. Order: hard rejections → qualification (wait, or reject after
 * the qualification window) → flag for review → qualify with the reward plan.
 */
export function evaluateReferral(input: {
  referral: ReferralRecord;
  risk: RiskAssessment;
  qualification: QualificationResult;
  now: Date;
  policy: Pick<ReferralPolicy, 'rewardDays' | 'qualificationWindowDays' | 'recheckAfterHours'>;
}): ReferralEvaluation {
  const { referral, risk, qualification, now, policy } = input;
  if (referral.status !== 'pending') return { action: 'none', reason: 'not_pending' };
  if (risk.decision === 'rejected' && risk.rejectReason !== null) {
    return { action: 'reject', status: 'rejected', rejectReason: risk.rejectReason };
  }
  if (!qualification.qualified) {
    const applied = Date.parse(referral.applied_at);
    if (now.getTime() - applied >= policy.qualificationWindowDays * DAY_MS) {
      return { action: 'reject', status: 'rejected', rejectReason: 'qualification_timeout' };
    }
    const recheck = now.getTime() + policy.recheckAfterHours * HOUR_MS;
    const eligible = Date.parse(qualification.eligible_after);
    const recheckAt =
      qualification.missing.length === 1 && qualification.missing[0] === 'account_age'
        ? Math.max(eligible, now.getTime())
        : recheck;
    return { action: 'wait', recheckAt: new Date(recheckAt).toISOString(), qualification };
  }
  if (risk.decision === 'flagged') return { action: 'flag', status: 'flagged', risk };
  return {
    action: 'qualify',
    status: 'qualified',
    qualification,
    reward: planReferralReward(referral.id, policy, risk.referrerCapReached),
  };
}

export type ReferralReviewResult =
  | { ok: true; status: 'qualified' | 'rejected'; rejectReason: 'admin_rejected' | null }
  | { ok: false; error: 'not_flagged' | 'reason_required' };

/** Admin review of a flagged referral (`referrals.review`); a reason of ≥10 chars is required. */
export function reviewFlaggedReferral(
  referral: Pick<ReferralRecord, 'status'>,
  decision: 'approve' | 'reject',
  reason: string,
): ReferralReviewResult {
  if (referral.status !== 'flagged') return { ok: false, error: 'not_flagged' };
  if (reason.trim().length < 10) return { ok: false, error: 'reason_required' };
  return decision === 'approve'
    ? { ok: true, status: 'qualified', rejectReason: null }
    : { ok: true, status: 'rejected', rejectReason: 'admin_rejected' };
}

// ---------------------------------------------------------------------------------------------
// Apply-time checks (API-BIZ-01 `POST /referrals/apply`)

export type ReferralApplyError =
  'REFERRAL_CODE_INVALID' | 'REFERRAL_SELF' | 'REFERRAL_ALREADY_APPLIED' | 'REFERRAL_WINDOW_CLOSED';

export type ReferralApplyCheck =
  { ok: true; code: string } | { ok: false; error: ReferralApplyError };

/**
 * Validation before a `referrals` row is inserted: a valid, active code; no earlier referral for
 * the caller; the caller's account younger than `applyWindowDays`; and no self-referral by user
 * id, e-mail hash, Apple `sub` hash (relay) or installation hash (→ `REFERRAL_SELF`).
 */
export function checkReferralApply(input: {
  code: string;
  /** Signals of the code owner, or null when the code is unknown or disabled. */
  codeOwner: ReferralPartySignals | null;
  referee: ReferralPartySignals & { account_created_at: string };
  refereeHasReferral: boolean;
  now: Date;
  policy: Pick<ReferralPolicy, 'applyWindowDays'>;
}): ReferralApplyCheck {
  const code = normalizeReferralCode(input.code);
  if (!isValidReferralCode(code) || input.codeOwner === null) {
    return { ok: false, error: 'REFERRAL_CODE_INVALID' };
  }
  const owner = input.codeOwner;
  const referee = input.referee;
  const same = (a: string | null, b: string | null): boolean => a !== null && a === b;
  const sharedInstallation = owner.installation_hashes.some((hash) =>
    referee.installation_hashes.includes(hash),
  );
  if (
    owner.user_id === referee.user_id ||
    same(owner.email_hash, referee.email_hash) ||
    same(owner.apple_sub_hash, referee.apple_sub_hash) ||
    sharedInstallation
  ) {
    return { ok: false, error: 'REFERRAL_SELF' };
  }
  if (input.refereeHasReferral) return { ok: false, error: 'REFERRAL_ALREADY_APPLIED' };
  const age = input.now.getTime() - Date.parse(referee.account_created_at);
  if (!(age <= input.policy.applyWindowDays * DAY_MS)) {
    return { ok: false, error: 'REFERRAL_WINDOW_CLOSED' };
  }
  return { ok: true, code };
}
