/**
 * JOB-25 `referral_evaluate` (API_CONTRACTS §11.4; IMPLEMENTATION_PLAN T-7.03): qualification,
 * anti-abuse risk and the idempotent reward of one referral (`evaluateReferralJob`).
 * Payload `{referral_id}`; key `referral_evaluate:{referral_id}:{attempt_window}`; 20 s timeout.
 */
import { z } from 'zod';
import type { Pepper } from '../../_shared/crypto/hash.ts';
import { defineJob } from '../../_shared/jobs/registry.ts';
import type { JobDefinition } from '../../_shared/jobs/types.ts';
import { evaluateReferralJob } from '../../_shared/services/referrals/evaluate.ts';
import type { ReferralRepo } from '../../_shared/services/referrals/repo.ts';

export const ReferralEvaluatePayload = z.object({ referral_id: z.uuid() });
export type ReferralEvaluatePayload = z.infer<typeof ReferralEvaluatePayload>;

export interface ReferralEvaluateJobDeps {
  readonly repo: ReferralRepo;
  readonly pepper: Pepper;
  readonly now?: () => Date;
}

export function referralEvaluateJob(
  deps: ReferralEvaluateJobDeps,
): JobDefinition<ReferralEvaluatePayload> {
  return defineJob({
    type: 'referral_evaluate',
    payload: ReferralEvaluatePayload,
    timeoutMs: 20_000,
    handler: (ctx) =>
      evaluateReferralJob(
        {
          repo: deps.repo,
          pepper: deps.pepper,
          now: deps.now ?? (() => ctx.now()),
          log: ctx.log,
        },
        ctx.payload.referral_id,
        ctx.correlationId,
      ),
  });
}
