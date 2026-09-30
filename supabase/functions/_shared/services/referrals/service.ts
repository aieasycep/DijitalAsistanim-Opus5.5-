/**
 * API-BIZ-01 `POST /referrals/apply` and API-BIZ-02 `GET /referrals/me` (IMPLEMENTATION_PLAN T-7.03;
 * plan §16). The rules come from `@da/domain`: `checkReferralApply` (code, self-referral by user
 * id / e-mail / Apple relay / installation, one referral per referee, apply window), `qualify`
 * (eligible_after) and the 7-character code with its check character (`generateReferralCode`).
 */
import {
  checkReferralApply,
  generateReferralCode,
  isApplePrivateRelayEmail,
  isValidReferralCode,
  normalizeReferralCode,
  qualify,
  randomIndexFromBytes,
  referralPolicyFromSettings,
  type ReferralPartySignals,
  referralShareUrl,
} from '@da/domain';
import type { Pepper } from '../../crypto/hash.ts';
import { AppError } from '../../errors.ts';
import type { ReferralRepo, ReferralStatusValue } from './repo.ts';
import { installationDeviceHash, networkDayHash, signalHash } from './signals.ts';

const HOUR_MS = 60 * 60 * 1000;

function cryptoByte(): number {
  return crypto.getRandomValues(new Uint8Array(1))[0] ?? 0;
}

/** Lazy code creation (API-BIZ-02): a fresh domain code per attempt, up to 8 collisions. */
export async function ensureReferralCode(
  repo: ReferralRepo,
  userId: string,
  nextByte: () => number = cryptoByte,
): Promise<string> {
  const random = randomIndexFromBytes(nextByte);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = await repo.ensureCode(userId, generateReferralCode(random));
    if (code !== null) return code;
  }
  throw new AppError('SERVICE_UNAVAILABLE', { details: { reason: 'referral_code_collision' } });
}

export interface ReferralMeData {
  code: string;
  share_url: string;
  reward_days: number;
  cap_per_year: number;
  remaining_this_year: number;
  earned_days_total: number;
  referrals: { id: string; label: string; status: ReferralStatusValue; created_at: string }[];
  referred_by: { status: string } | null;
}

/** "A***": the referee's initial only; never a name or e-mail. */
export function maskedLabel(initial: string | null): string {
  const letter = initial?.trim().charAt(0) ?? '';
  return `${/^\p{L}$/u.test(letter) ? letter.toLocaleUpperCase('tr-TR') : 'X'}***`;
}

function iso(value: string): string {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString();
}

export async function referralOverview(
  deps: {
    repo: ReferralRepo;
    publicWebUrl: string | undefined;
    now: Date;
    nextByte?: () => number;
  },
  userId: string,
): Promise<ReferralMeData> {
  if (deps.publicWebUrl === undefined || deps.publicWebUrl.trim() === '') {
    throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
      details: { feature: 'referral_link', credential_keys: ['PUBLIC_WEB_URL'] },
    });
  }
  const overview = await deps.repo.overview(userId, deps.now);
  const code = overview.code ?? (await ensureReferralCode(deps.repo, userId, deps.nextByte));
  return {
    code,
    share_url: referralShareUrl(deps.publicWebUrl, code),
    reward_days: overview.reward_days,
    cap_per_year: overview.cap_per_year,
    remaining_this_year: Math.max(0, overview.cap_per_year - overview.rewarded_this_year),
    earned_days_total: overview.earned_days_total,
    referrals: overview.referrals.slice(0, 50).map((r) => ({
      id: r.id,
      label: maskedLabel(r.initial),
      status: r.status,
      created_at: iso(r.created_at),
    })),
    referred_by: overview.referred_by,
  };
}

export interface ApplyReferralInput {
  readonly userId: string;
  readonly code: string;
  readonly installationId: string;
  readonly source: 'deep_link' | 'manual' | 'install_referrer';
  /** First hop of `X-Forwarded-For` (hashed into the network-day signal, never stored raw). */
  readonly ip: string | null;
  readonly correlationId: string | null;
}

export interface ApplyReferralData {
  referral_id: string;
  status: 'pending';
  reward_days: number;
  qualification: {
    onboarding_completed: boolean;
    account_connected: boolean;
    first_briefing_delivered: boolean;
    eligible_after: string;
  };
}

export async function applyReferralCode(
  deps: { repo: ReferralRepo; pepper: Pepper; now: Date },
  input: ApplyReferralInput,
): Promise<ApplyReferralData> {
  const code = normalizeReferralCode(input.code);
  if (!isValidReferralCode(code)) throw new AppError('REFERRAL_CODE_INVALID');
  const context = await deps.repo.applyContext(input.userId, code, input.installationId);
  const referee = context.referee;
  if (referee === null) throw new AppError('FORBIDDEN', { details: { reason: 'profile_missing' } });
  const policy = referralPolicyFromSettings(context.settings, 6);

  const installationHash =
    referee.installation_device_hash ??
    (await installationDeviceHash(deps.pepper, input.installationId));
  const refereeSignals: ReferralPartySignals & { account_created_at: string } = {
    user_id: referee.user_id,
    email_hash: await signalHash(deps.pepper, 'email', referee.email),
    apple_sub_hash: await signalHash(deps.pepper, 'apple_sub', referee.apple_sub),
    installation_hashes: [...new Set([...referee.device_hashes, installationHash])],
    account_created_at: referee.created_at,
  };
  const owner = context.owner;
  const ownerSignals: ReferralPartySignals | null =
    context.code_owner === null || owner === null
      ? null
      : {
          user_id: owner.user_id,
          email_hash: await signalHash(deps.pepper, 'email', owner.email),
          apple_sub_hash: await signalHash(deps.pepper, 'apple_sub', owner.apple_sub),
          installation_hashes: owner.device_hashes,
        };
  const check = checkReferralApply({
    code,
    codeOwner: ownerSignals,
    referee: refereeSignals,
    refereeHasReferral: referee.has_referral,
    now: deps.now,
    policy,
  });
  if (!check.ok) throw new AppError(check.error);
  if (ownerSignals === null) throw new AppError('REFERRAL_CODE_INVALID');

  const network = await networkDayHash(deps.pepper, input.ip, deps.now);
  const applied = await deps.repo.apply({
    refereeId: input.userId,
    referrerId: ownerSignals.user_id,
    code: check.code,
    source: input.source,
    deviceHash: installationHash,
    emailHash: refereeSignals.email_hash,
    signals: {
      ...(refereeSignals.apple_sub_hash === null
        ? {}
        : { apple_sub_hash: refereeSignals.apple_sub_hash }),
      ...(network === null ? {} : { network_day_hash: network }),
      private_relay_email: referee.email !== null && isApplePrivateRelayEmail(referee.email),
    },
    runAfter: new Date(Date.parse(referee.created_at) + policy.minAccountAgeHours * HOUR_MS),
    correlationId: input.correlationId,
  });
  const qualification = qualify(
    {
      account_created_at: referee.created_at,
      onboarding_completed_at: referee.onboarding_completed_at,
      account_connected_at: referee.account_connected_at,
      first_briefing_delivered_at: referee.first_briefing_at,
    },
    deps.now,
    policy,
  );
  return {
    referral_id: applied.referral_id,
    status: 'pending',
    reward_days: policy.rewardDays,
    qualification: {
      onboarding_completed: qualification.qualification.onboarding_completed_at !== null,
      account_connected: qualification.qualification.account_connected_at !== null,
      first_briefing_delivered: qualification.qualification.first_briefing_at !== null,
      eligible_after: qualification.eligible_after,
    },
  };
}
