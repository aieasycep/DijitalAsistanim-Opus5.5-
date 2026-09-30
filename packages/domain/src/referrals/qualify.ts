/**
 * Referral qualification (plan §16; JOB-25 step 1; TEST_PLAN UT-REF-07). The referee qualifies
 * when all four hold at `now`:
 *
 * 1. onboarding completed;
 * 2. at least one connected account reached `healthy`;
 * 3. a first briefing was delivered;
 * 4. the account is at least `minAccountAgeHours` (48 h) old — 47 h 59 m is not enough.
 *
 * Timestamps after `now` do not count. The result also carries the `referrals.qualification`
 * jsonb and `eligible_after` (API-BIZ-01).
 */
import type { ReferralPolicy } from './policy.ts';

export interface RefereeProgress {
  account_created_at: string;
  onboarding_completed_at: string | null;
  /** First time one of the referee's connected accounts was `healthy`. */
  account_connected_at: string | null;
  first_briefing_delivered_at: string | null;
}

export type QualificationRequirement =
  'onboarding' | 'account_connected' | 'first_briefing' | 'account_age';

/** `referrals.qualification` jsonb. */
export interface QualificationRecord {
  onboarding_completed_at: string | null;
  account_connected_at: string | null;
  first_briefing_at: string | null;
  account_age_ok: boolean;
}

export interface QualificationResult {
  qualified: boolean;
  missing: QualificationRequirement[];
  /** The earliest instant the account-age requirement is met. */
  eligible_after: string;
  qualification: QualificationRecord;
}

const HOUR_MS = 60 * 60 * 1000;

function doneBy(iso: string | null, now: number): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return !Number.isNaN(ms) && ms <= now ? iso : null;
}

export function qualify(
  progress: RefereeProgress,
  now: Date,
  policy: Pick<ReferralPolicy, 'minAccountAgeHours'>,
): QualificationResult {
  const nowMs = now.getTime();
  const created = Date.parse(progress.account_created_at);
  if (Number.isNaN(created)) throw new RangeError('account_created_at is not a valid timestamp');
  const eligibleAfter = created + policy.minAccountAgeHours * HOUR_MS;
  const qualification: QualificationRecord = {
    onboarding_completed_at: doneBy(progress.onboarding_completed_at, nowMs),
    account_connected_at: doneBy(progress.account_connected_at, nowMs),
    first_briefing_at: doneBy(progress.first_briefing_delivered_at, nowMs),
    account_age_ok: nowMs >= eligibleAfter,
  };
  const missing: QualificationRequirement[] = [];
  if (qualification.onboarding_completed_at === null) missing.push('onboarding');
  if (qualification.account_connected_at === null) missing.push('account_connected');
  if (qualification.first_briefing_at === null) missing.push('first_briefing');
  if (!qualification.account_age_ok) missing.push('account_age');
  return {
    qualified: missing.length === 0,
    missing,
    eligible_after: new Date(eligibleAfter).toISOString(),
    qualification,
  };
}
