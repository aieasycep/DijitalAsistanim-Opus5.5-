/**
 * Referral anti-abuse risk (plan §16 step 4; JOB-25 step 2; SECURITY_AND_PRIVACY_PLAN THR-15;
 * TEST_PLAN UT-REF-01..06, UT-REF-08). All identity signals are hashes (see signals.ts).
 *
 * Hard rejections (status `rejected`, `reject_reason`):
 * - `self_referral`: same user id, or same normalised e-mail hash (UT-REF-01/02).
 * - `loop`: the referee already referred the referrer, directly or through a chain (A→B→A).
 * - `tombstoned`: a referee signal hash is in `privacy_tombstones` (delete-and-recreate, UT-REF-08).
 *
 * Scored signals (weights below; score capped at 100; `flagged` when score ≥ `riskThreshold`):
 * - `self_apple_relay` 60: same Apple `sub` hash — the same Apple ID behind relay addresses.
 * - `self_installation` 60: an installation hash shared by referrer and referee.
 *   Both report the flag reason `shared_device` (UT-REF-03).
 * - `duplicate_account` 50: a referee hash (installation, e-mail, provider mailbox) shared with
 *   another referee of the same referrer or with other accounts, or a provider mailbox connected
 *   by both referrer and referee.
 * - `velocity` 50: more than `velocityMaxPerHour` codes applied for this referrer within the last
 *   60 minutes, this one included (UT-REF-06).
 * - `shared_network` 20: same network (/24) on the same day as the referrer.
 * - `private_relay_email` 10: the referee uses an Apple relay address, so e-mail dedupe is blind.
 * - `cap_reached` 0: the referrer already has `rewardsPerYear` rewards in the last 365 days. The
 *   cap never flags; it withholds the referrer's credit only (UT-REF-05).
 */
import type { ReferralPolicy } from './policy.ts';

export interface ReferralPartySignals {
  user_id: string;
  email_hash: string | null;
  apple_sub_hash: string | null;
  installation_hashes: readonly string[];
  /** Hashes of connected provider mailboxes (`provider_email`). */
  provider_email_hashes?: readonly string[];
  /** Same-network-same-day hashes (`networkDaySignalMaterial`). */
  network_day_hashes?: readonly string[];
  email_is_private_relay?: boolean;
}

export interface ReferralEdge {
  referrer_id: string;
  referee_id: string;
}

export interface RiskInput {
  referrer: ReferralPartySignals;
  referee: ReferralPartySignals;
  /** Other referees of the same referrer (not rejected). */
  siblingReferees?: readonly ReferralPartySignals[];
  /** Accounts other than referrer, referee and siblings sharing a referee hash (DB count). */
  otherAccountsSharingSignals?: number;
  /** Existing referrals (not rejected), for loop detection. */
  edges: readonly ReferralEdge[];
  /** `applied_at` of the referrer's referrals, this one included. */
  referrerAppliedAt: readonly string[];
  /** `created_at` of the referrer's `referrer`-side credits. */
  referrerRewardedAt: readonly string[];
  tombstoneMatch: boolean;
  now: Date;
  policy: Pick<ReferralPolicy, 'velocityMaxPerHour' | 'rewardsPerYear' | 'riskThreshold'>;
}

export type RiskSignal =
  | 'self_user_id'
  | 'self_email'
  | 'loop'
  | 'tombstoned'
  | 'self_apple_relay'
  | 'self_installation'
  | 'duplicate_account'
  | 'velocity'
  | 'shared_network'
  | 'private_relay_email'
  | 'cap_reached';

export const RISK_WEIGHTS: Readonly<Record<RiskSignal, number>> = {
  self_user_id: 100,
  self_email: 100,
  loop: 100,
  tombstoned: 100,
  self_apple_relay: 60,
  self_installation: 60,
  duplicate_account: 50,
  velocity: 50,
  shared_network: 20,
  private_relay_email: 10,
  cap_reached: 0,
};

/** `referrals.reject_reason` values produced by risk. */
export type RiskRejectReason = 'self_referral' | 'loop' | 'tombstoned';
export type RiskFlagReason = 'shared_device' | 'duplicate_account' | 'velocity' | 'risk_score';

export interface RiskAssessment {
  score: number;
  signals: RiskSignal[];
  decision: 'clean' | 'flagged' | 'rejected';
  rejectReason: RiskRejectReason | null;
  flagReasons: RiskFlagReason[];
  referrerCapReached: boolean;
}

const HOUR_MS = 60 * 60 * 1000;
const YEAR_MS = 365 * 24 * HOUR_MS;

function intersects(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined || a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((value) => set.has(value));
}

function sameHash(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b;
}

function allHashes(party: ReferralPartySignals): string[] {
  return [
    ...(party.email_hash === null ? [] : [party.email_hash]),
    ...party.installation_hashes,
    ...(party.provider_email_hashes ?? []),
  ];
}

/** True when `to` is reachable from `from` by following referral edges (referrer → referee). */
function reachable(edges: readonly ReferralEdge[], from: string, to: string): boolean {
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const list = next.get(edge.referrer_id) ?? [];
    list.push(edge.referee_id);
    next.set(edge.referrer_id, list);
  }
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift() ?? '';
    for (const child of next.get(current) ?? []) {
      if (child === to) return true;
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return false;
}

function countWithin(timestamps: readonly string[], now: number, windowMs: number): number {
  return timestamps.filter((iso) => {
    const ms = Date.parse(iso);
    return !Number.isNaN(ms) && ms <= now && now - ms < windowMs;
  }).length;
}

export function assessReferralRisk(input: RiskInput): RiskAssessment {
  const { referrer, referee } = input;
  const now = input.now.getTime();
  const signals: RiskSignal[] = [];

  if (referrer.user_id === referee.user_id) signals.push('self_user_id');
  if (sameHash(referrer.email_hash, referee.email_hash)) signals.push('self_email');
  if (
    referrer.user_id !== referee.user_id &&
    reachable(input.edges, referee.user_id, referrer.user_id)
  ) {
    signals.push('loop');
  }
  if (input.tombstoneMatch) signals.push('tombstoned');
  if (sameHash(referrer.apple_sub_hash, referee.apple_sub_hash)) signals.push('self_apple_relay');
  if (intersects(referrer.installation_hashes, referee.installation_hashes)) {
    signals.push('self_installation');
  }
  const refereeHashes = allHashes(referee);
  const siblingShares = (input.siblingReferees ?? []).some(
    (sibling) =>
      sibling.user_id !== referee.user_id && intersects(allHashes(sibling), refereeHashes),
  );
  if (
    siblingShares ||
    (input.otherAccountsSharingSignals ?? 0) > 0 ||
    intersects(referrer.provider_email_hashes, referee.provider_email_hashes)
  ) {
    signals.push('duplicate_account');
  }
  if (countWithin(input.referrerAppliedAt, now, HOUR_MS) > input.policy.velocityMaxPerHour) {
    signals.push('velocity');
  }
  if (intersects(referrer.network_day_hashes, referee.network_day_hashes)) {
    signals.push('shared_network');
  }
  if (referee.email_is_private_relay === true) signals.push('private_relay_email');
  const referrerCapReached =
    countWithin(input.referrerRewardedAt, now, YEAR_MS) >= input.policy.rewardsPerYear;
  if (referrerCapReached) signals.push('cap_reached');

  const score = Math.min(
    100,
    signals.reduce((sum, signal) => sum + RISK_WEIGHTS[signal], 0),
  );

  let rejectReason: RiskRejectReason | null = null;
  if (signals.includes('self_user_id') || signals.includes('self_email')) {
    rejectReason = 'self_referral';
  } else if (signals.includes('loop')) {
    rejectReason = 'loop';
  } else if (signals.includes('tombstoned')) {
    rejectReason = 'tombstoned';
  }

  const flagReasons: RiskFlagReason[] = [];
  if (signals.includes('self_apple_relay') || signals.includes('self_installation')) {
    flagReasons.push('shared_device');
  }
  if (signals.includes('duplicate_account')) flagReasons.push('duplicate_account');
  if (signals.includes('velocity')) flagReasons.push('velocity');
  const flagged = rejectReason === null && score >= input.policy.riskThreshold;
  if (flagged && flagReasons.length === 0) flagReasons.push('risk_score');

  return {
    score,
    signals,
    decision: rejectReason !== null ? 'rejected' : flagged ? 'flagged' : 'clean',
    rejectReason,
    flagReasons: flagged ? flagReasons : [],
    referrerCapReached,
  };
}

/** The T-1.10 name of `assessReferralRisk`. */
export const risk = assessReferralRisk;
