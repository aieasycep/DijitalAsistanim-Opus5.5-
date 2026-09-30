/**
 * JOB-25 `referral_evaluate` logic (API_CONTRACTS §11.4; IMPLEMENTATION_PLAN T-7.03; plan §16).
 *
 * 1. Load the evaluation context (both parties, siblings, the referral graph, velocity and yearly
 *    reward history, accounts sharing a device or mailbox, `referral.*` settings).
 * 2. Hash every identity signal with HASH_PEPPER and check `privacy_tombstones`.
 * 3. `assessReferralRisk` + `qualify` + `evaluateReferral` from `@da/domain` decide: reject
 *    (self-referral, loop, tombstoned, qualification timeout), wait (re-enqueued at the recheck
 *    time), flag (risk score ≥ `referral.risk_threshold` → admin review) or qualify.
 * 4. `public.referral_decide` applies the decision under the row lock; qualifying rewards in the
 *    same transaction (+`referral.reward_days` Pro per side as stacked `entitlement_grants` keyed
 *    `referral:{id}:{side}`; at the referrer's yearly cap only the referee is rewarded).
 * 5. Each rewarded side gets an `account.referral_reward` push (dedupe `referral:{id}:{side}`).
 * Re-running the job is harmless: only a pending referral changes and every reward is keyed.
 */
import {
  assessReferralRisk,
  evaluateReferral,
  qualify,
  referralCreditKey,
  referralPolicyFromSettings,
  type ReferralPartySignals,
  type ReferralSide,
} from '@da/domain';
import type { Pepper } from '../../crypto/hash.ts';
import type { Json } from '../../jobs/types.ts';
import type { Logger } from '../../logging/logger.ts';
import { accountNotificationJob } from '../business/notify.ts';
import type { DecideResult, EvaluationContextRow, ReferralRepo } from './repo.ts';
import { signalHash, signalHashes } from './signals.ts';

export interface ReferralEvaluateDeps {
  readonly repo: ReferralRepo;
  readonly pepper: Pepper;
  readonly now: () => Date;
  readonly log: Logger;
}

export type ReferralEvaluateResult = Record<string, Json>;

function hex(value: string | null | undefined): string[] {
  return value === null || value === undefined || value === '' ? [] : [value];
}

async function notifySides(
  deps: ReferralEvaluateDeps,
  referralId: string,
  result: DecideResult,
  correlationId: string | null,
): Promise<string[]> {
  const notified: string[] = [];
  for (const side of result.sides ?? []) {
    const userId = side === 'referrer' ? result.referrer_id : result.referee_id;
    if (userId === null || userId === undefined) continue;
    await deps.repo.enqueue(
      accountNotificationJob({
        userId,
        template: 'account.referral_reward',
        dedupeKey: referralCreditKey(referralId, side as ReferralSide),
        path: '/settings/referral',
        params: { side, days: result.days ?? 0 },
        correlationId,
      }),
    );
    notified.push(side);
  }
  return notified;
}

async function reward(
  deps: ReferralEvaluateDeps,
  referralId: string,
  correlationId: string | null,
  extra: {
    riskScore?: number;
    assessment?: Record<string, Json>;
    qualification?: Record<string, Json>;
  },
): Promise<ReferralEvaluateResult> {
  const result = await deps.repo.decide({
    referralId,
    decision: 'qualify',
    ...(extra.riskScore === undefined ? {} : { riskScore: extra.riskScore }),
    ...(extra.assessment === undefined ? {} : { assessment: extra.assessment }),
    ...(extra.qualification === undefined ? {} : { qualification: extra.qualification }),
    correlationId,
  });
  if (result.status !== 'rewarded') return { action: 'qualify', status: result.status };
  const notified = await notifySides(deps, referralId, result, correlationId);
  return {
    action: 'reward',
    status: 'rewarded',
    sides: [...(result.sides ?? [])],
    notified,
    replayed: result.replayed === true,
    referrer_withheld: result.referrer_withheld ?? null,
  };
}

async function partySignals(
  pepper: Pepper,
  context: EvaluationContextRow,
): Promise<{
  referee: ReferralPartySignals;
  referrer: ReferralPartySignals | null;
  tombstones: { kind: string; hash: string }[];
}> {
  const r = context.referral;
  const referee = context.referee;
  const refereeEmail = await signalHash(pepper, 'email', referee?.email);
  const refereeApple = await signalHash(pepper, 'apple_sub', referee?.apple_sub);
  const riskSignals = r.risk_signals as {
    network_day_hash?: unknown;
    private_relay_email?: unknown;
  };
  const refereeSignals: ReferralPartySignals = {
    user_id: r.referee_id ?? '',
    email_hash: refereeEmail ?? r.referee_email_hash,
    apple_sub_hash: refereeApple,
    installation_hashes: [
      ...new Set([...(referee?.device_hashes ?? []), ...hex(r.referee_device_hash)]),
    ],
    provider_email_hashes: await signalHashes(
      pepper,
      'provider_email',
      referee?.provider_emails ?? [],
    ),
    network_day_hashes:
      typeof riskSignals.network_day_hash === 'string' ? [riskSignals.network_day_hash] : [],
    email_is_private_relay: riskSignals.private_relay_email === true,
  };
  const referrer = context.referrer;
  const referrerSignals: ReferralPartySignals | null =
    referrer === null
      ? null
      : {
          user_id: referrer.user_id,
          email_hash: await signalHash(pepper, 'email', referrer.email),
          apple_sub_hash: await signalHash(pepper, 'apple_sub', referrer.apple_sub),
          installation_hashes: referrer.device_hashes,
          provider_email_hashes: await signalHashes(
            pepper,
            'provider_email',
            referrer.provider_emails,
          ),
        };
  const tombstones: { kind: string; hash: string }[] = [];
  for (const hash of hex(refereeSignals.email_hash)) tombstones.push({ kind: 'email', hash });
  for (const hash of hex(refereeApple)) tombstones.push({ kind: 'apple_sub', hash });
  for (const hash of await signalHashes(pepper, 'installation', referee?.installation_ids ?? [])) {
    tombstones.push({ kind: 'installation', hash });
  }
  return { referee: refereeSignals, referrer: referrerSignals, tombstones };
}

/**
 * Velocity is "more than `velocity_max_per_hour` codes applied for the referrer within 60 minutes,
 * this one included" (UT-REF-06), i.e. measured at the referral's `applied_at`, while the job runs
 * 48 h later. The domain counts the hour before `now`, so the timestamps are shifted by
 * `now − applied_at`: the hour before the application maps onto the hour before `now`, and later
 * applications fall after `now` and are not counted. The yearly cap keeps using the real `now`.
 */
export function velocityTimestamps(
  appliedAt: string,
  now: Date,
  timestamps: readonly string[],
): string[] {
  const shift = now.getTime() - Date.parse(appliedAt);
  return timestamps
    .map((iso) => Date.parse(iso))
    .filter((ms) => Number.isFinite(ms))
    .map((ms) => new Date(ms + shift).toISOString());
}

export async function evaluateReferralJob(
  deps: ReferralEvaluateDeps,
  referralId: string,
  correlationId: string | null,
): Promise<ReferralEvaluateResult> {
  const now = deps.now();
  const context = await deps.repo.evaluationContext(referralId, now);
  const referral = context.referral;
  if (referral.status === 'qualified' || referral.status === 'rewarded') {
    return reward(deps, referralId, correlationId, {});
  }
  if (referral.status !== 'pending') return { action: 'none', status: referral.status };

  const policy = referralPolicyFromSettings(context.settings, context.rewards_per_year);
  if (context.referee === null || referral.referee_id === null || context.referrer === null) {
    const decided = await deps.repo.decide({
      referralId,
      decision: 'reject',
      rejectReason: 'qualification_timeout',
      correlationId,
    });
    return { action: 'reject', status: decided.status, reason: 'party_deleted' };
  }

  const signals = await partySignals(deps.pepper, context);
  const tombstoneMatch =
    signals.tombstones.length > 0 && (await deps.repo.tombstoneMatch(signals.tombstones));
  const risk = assessReferralRisk({
    referrer: signals.referrer ?? {
      user_id: '',
      email_hash: null,
      apple_sub_hash: null,
      installation_hashes: [],
    },
    referee: signals.referee,
    siblingReferees: context.siblings.map((s) => ({
      user_id: s.user_id,
      email_hash: s.email_hash,
      apple_sub_hash: null,
      installation_hashes: hex(s.device_hash),
    })),
    otherAccountsSharingSignals: context.other_accounts_sharing,
    edges: context.edges,
    referrerAppliedAt: velocityTimestamps(referral.applied_at, now, context.referrer_applied_at),
    referrerRewardedAt: context.referrer_rewarded_at,
    tombstoneMatch,
    now,
    policy,
  });
  const qualification = qualify(
    {
      account_created_at: context.referee.created_at,
      onboarding_completed_at: context.referee.onboarding_completed_at,
      account_connected_at: context.referee.account_connected_at,
      first_briefing_delivered_at: context.referee.first_briefing_at,
    },
    now,
    policy,
  );
  const evaluation = evaluateReferral({
    referral: { id: referral.id, status: referral.status, applied_at: referral.applied_at },
    risk,
    qualification,
    now,
    policy,
  });
  const assessment: Record<string, Json> = {
    score: risk.score,
    decision: risk.decision,
    signals: [...risk.signals],
    flag_reasons: [...risk.flagReasons],
    referrer_cap_reached: risk.referrerCapReached,
    evaluated_at: now.toISOString(),
  };
  const qualificationRecord = { ...qualification.qualification } as Record<string, Json>;
  deps.log.info('referral_evaluated', {
    action: evaluation.action,
    risk_score: risk.score,
    signals: risk.signals.join(','),
  });

  switch (evaluation.action) {
    case 'none':
      return { action: 'none', status: referral.status };
    case 'reject': {
      const decided = await deps.repo.decide({
        referralId,
        decision: 'reject',
        rejectReason: evaluation.rejectReason,
        riskScore: risk.score,
        assessment,
        qualification: qualificationRecord,
        correlationId,
      });
      return { action: 'reject', status: decided.status, reason: evaluation.rejectReason };
    }
    case 'wait': {
      await deps.repo.decide({
        referralId,
        decision: 'wait',
        riskScore: risk.score,
        assessment,
        qualification: qualificationRecord,
        correlationId,
      });
      const recheck = new Date(evaluation.recheckAt);
      await deps.repo.enqueue({
        type: 'referral_evaluate',
        idempotencyKey: `referral_evaluate:${referralId}:${evaluation.recheckAt.slice(0, 13)}`,
        userId: referral.referee_id,
        payload: { referral_id: referralId },
        runAfter: recheck,
        priority: 200,
        maxAttempts: 5,
        correlationId,
      });
      return {
        action: 'wait',
        status: 'pending',
        recheck_at: evaluation.recheckAt,
        missing: [...evaluation.qualification.missing],
      };
    }
    case 'flag': {
      const decided = await deps.repo.decide({
        referralId,
        decision: 'flag',
        riskScore: risk.score,
        assessment,
        qualification: qualificationRecord,
        correlationId,
      });
      return { action: 'flag', status: decided.status, flag_reasons: [...risk.flagReasons] };
    }
    case 'qualify':
      return reward(deps, referralId, correlationId, {
        riskScore: risk.score,
        assessment,
        qualification: qualificationRecord,
      });
  }
}
