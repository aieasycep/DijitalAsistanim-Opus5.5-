/**
 * Database side of referrals (migration 20260924002210), through service-role `public.*` wrappers.
 * The user ids passed in always come from verified claims (`api`) or the job row (`worker`).
 */
import type { DbClient } from '../../db/clients.ts';
import { DB_FN, rpc, rpcRaw } from '../../db/functions.ts';
import { AppError, mapDbError } from '../../errors.ts';
import { enqueueJob } from '../../jobs/client.ts';
import type { EnqueueInput, Json } from '../../jobs/types.ts';

export type ReferralStatusValue = 'pending' | 'qualified' | 'rewarded' | 'rejected' | 'flagged';

export interface ReferralOverviewRow {
  readonly code: string | null;
  readonly reward_days: number;
  readonly cap_per_year: number;
  readonly rewarded_this_year: number;
  readonly earned_days_total: number;
  readonly referrals: readonly {
    readonly id: string;
    readonly status: ReferralStatusValue;
    readonly created_at: string;
    readonly initial: string | null;
  }[];
  readonly referred_by: { readonly status: string } | null;
}

export interface RefereeProgressRow {
  readonly onboarding_completed_at: string | null;
  readonly account_connected_at: string | null;
  readonly first_briefing_at: string | null;
}

export interface ApplyContextRow {
  readonly code_owner: string | null;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly referee:
    | (RefereeProgressRow & {
        readonly user_id: string;
        readonly created_at: string;
        readonly email: string | null;
        readonly apple_sub: string | null;
        readonly has_referral: boolean;
        readonly device_hashes: readonly string[];
        readonly installation_device_hash: string | null;
      })
    | null;
  readonly owner: {
    readonly user_id: string;
    readonly email: string | null;
    readonly apple_sub: string | null;
    readonly device_hashes: readonly string[];
  } | null;
}

export interface ApplyInput {
  readonly refereeId: string;
  readonly referrerId: string;
  readonly code: string;
  readonly source: 'deep_link' | 'manual' | 'install_referrer';
  /** Hex hashes (stored as bytea). */
  readonly deviceHash: string | null;
  readonly emailHash: string | null;
  readonly signals: Record<string, Json>;
  readonly runAfter: Date;
  readonly correlationId: string | null;
}

export interface EvaluationContextRow {
  readonly referral: {
    readonly id: string;
    readonly status: ReferralStatusValue;
    readonly applied_at: string;
    readonly referrer_id: string | null;
    readonly referee_id: string | null;
    readonly referee_email_hash: string | null;
    readonly referee_device_hash: string | null;
    readonly risk_signals: Readonly<Record<string, unknown>>;
  };
  readonly referee:
    | (RefereeProgressRow & {
        readonly user_id: string;
        readonly created_at: string;
        readonly email: string | null;
        readonly apple_sub: string | null;
        readonly installation_ids: readonly string[];
        readonly device_hashes: readonly string[];
        readonly provider_emails: readonly string[];
      })
    | null;
  readonly referrer: {
    readonly user_id: string;
    readonly email: string | null;
    readonly apple_sub: string | null;
    readonly device_hashes: readonly string[];
    readonly provider_emails: readonly string[];
  } | null;
  readonly siblings: readonly {
    readonly user_id: string;
    readonly email_hash: string | null;
    readonly device_hash: string | null;
  }[];
  readonly edges: readonly { readonly referrer_id: string; readonly referee_id: string }[];
  readonly referrer_applied_at: readonly string[];
  readonly referrer_rewarded_at: readonly string[];
  readonly other_accounts_sharing: number;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly rewards_per_year: number;
}

export type Decision = 'wait' | 'reject' | 'flag' | 'qualify';

export interface DecideInput {
  readonly referralId: string;
  readonly decision: Decision;
  readonly rejectReason?: string | null;
  readonly riskScore?: number;
  readonly assessment?: Record<string, Json>;
  readonly qualification?: Record<string, Json> | null;
  readonly correlationId: string | null;
}

export interface DecideResult {
  readonly status: ReferralStatusValue;
  readonly changed?: boolean;
  readonly replayed?: boolean;
  readonly days?: number;
  readonly sides?: readonly ('referrer' | 'referee')[];
  readonly referrer_id?: string | null;
  readonly referee_id?: string | null;
  readonly referrer_withheld?: string | null;
  readonly reject_reason?: string | null;
}

export interface ReferralRepo {
  ensureCode(userId: string, candidate: string): Promise<string | null>;
  overview(userId: string, now: Date): Promise<ReferralOverviewRow>;
  applyContext(
    refereeId: string,
    code: string,
    installationId: string | null,
  ): Promise<ApplyContextRow>;
  apply(input: ApplyInput): Promise<{ referral_id: string; status: 'pending'; applied_at: string }>;
  evaluationContext(referralId: string, now: Date): Promise<EvaluationContextRow>;
  tombstoneMatch(signals: readonly { kind: string; hash: string }[]): Promise<boolean>;
  decide(input: DecideInput): Promise<DecideResult>;
  enqueue(input: EnqueueInput): Promise<string>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (value: string | null): string | null =>
  value !== null && UUID_RE.test(value) ? value : null;
const bytea = (hex: string | null): string | null => (hex === null ? null : `\\x${hex}`);

export function supabaseReferralRepo(system: DbClient): ReferralRepo {
  return {
    ensureCode: (userId, candidate) =>
      rpc<string | null>(system, DB_FN.ensureReferralCode, {
        p_user: userId,
        p_candidate: candidate,
      }),
    overview: (userId, now) =>
      rpc<ReferralOverviewRow>(system, DB_FN.referralOverview, {
        p_user: userId,
        p_now: now.toISOString(),
      }),
    applyContext: (refereeId, code, installationId) =>
      rpc<ApplyContextRow>(system, DB_FN.referralApplyContext, {
        p_referee: refereeId,
        p_code: code,
        p_installation: installationId,
      }),
    async apply(input) {
      const { data, error } = await rpcRaw<{
        referral_id: string;
        status: 'pending';
        applied_at: string;
      }>(system, DB_FN.applyReferral, {
        p_referee: input.refereeId,
        p_referrer: input.referrerId,
        p_code: input.code,
        p_source: input.source,
        p_device_hash: bytea(input.deviceHash),
        p_email_hash: bytea(input.emailHash),
        p_signals: input.signals,
        p_run_after: input.runAfter.toISOString(),
        p_correlation_id: uuidOrNull(input.correlationId),
      });
      if (error !== null) {
        const message = error.message ?? '';
        if (message.includes('REFERRAL_ALREADY_APPLIED'))
          throw new AppError('REFERRAL_ALREADY_APPLIED');
        if (message.includes('REFERRAL_CODE_INVALID')) throw new AppError('REFERRAL_CODE_INVALID');
        throw mapDbError(error);
      }
      if (data === null)
        throw new AppError('SERVICE_UNAVAILABLE', { details: { reason: 'referral_apply' } });
      return data;
    },
    evaluationContext: (referralId, now) =>
      rpc<EvaluationContextRow>(system, DB_FN.referralEvaluationContext, {
        p_referral_id: referralId,
        p_now: now.toISOString(),
      }),
    tombstoneMatch: async (signals) =>
      (await rpc<boolean>(system, DB_FN.referralTombstoneMatch, { p_signals: signals })) === true,
    decide: (input) =>
      rpc<DecideResult>(system, DB_FN.referralDecide, {
        p_referral_id: input.referralId,
        p_decision: input.decision,
        p_reject_reason: input.rejectReason ?? null,
        p_risk_score: input.riskScore ?? 0,
        p_assessment: input.assessment ?? {},
        p_qualification: input.qualification ?? null,
        p_correlation_id: uuidOrNull(input.correlationId),
      }),
    enqueue: (input) => enqueueJob(system, input),
  };
}
