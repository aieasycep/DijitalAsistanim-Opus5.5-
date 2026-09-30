/**
 * Trial ending (P-03, API_CONTRACTS JOB-24 step 5; TEST_PLAN IT-RC-07): "Pro denemen yarın bitiyor"
 * 24 h before the RevenueCat `expiration_at` of a renewing trial. `billing_sync` enqueues the job
 * with `trialEndingJob`; the trigger re-reads the subscription so a cancelled or converted trial
 * sends nothing. Category `account` (not subject to the daily cap).
 */
import { toDeepLink } from '@da/domain';
import type { EnqueueInput } from '../../../jobs/types.ts';
import { baseSpec, notificationTriggerJob } from '../create.ts';
import { skip, type TriggerContext, type TriggerOutcome } from './types.ts';

export const TRIAL_REMINDER_LEAD_MS = 24 * 3_600_000;

/** The trial-ending push for a trial that expires at `expiresAt`, sent 24 h earlier. */
export function trialEndingJob(userId: string, expiresAt: Date): EnqueueInput {
  const epoch = Math.floor(expiresAt.getTime() / 1000);
  return notificationTriggerJob(
    userId,
    `trial_ending:${userId}:${epoch}`,
    { trigger: 'trial_ending' },
    { runAfter: new Date(expiresAt.getTime() - TRIAL_REMINDER_LEAD_MS), priority: 40 },
  );
}

export async function trialEndingTrigger(ctx: TriggerContext): Promise<TriggerOutcome> {
  const sub = await ctx.repo.subscription(ctx.userId);
  if (sub === null || sub.period_type !== 'trial' || sub.expires_at === null)
    return skip('not_trial');
  if (!sub.will_renew) return skip('not_renewing');
  const expires = new Date(sub.expires_at);
  if (expires.getTime() <= ctx.now.getTime()) return skip('trial_over');
  // Relevant until the trial converts: a trial learned about late still gets its reminder.
  const remindAt = new Date(expires.getTime() - TRIAL_REMINDER_LEAD_MS);
  return {
    kind: 'spec',
    spec: baseSpec({
      category: 'account',
      dedupeKey: `trial_ending:${Math.floor(expires.getTime() / 1000)}`,
      template: 'account',
      variant: 'trial_ending',
      urgency: 'today',
      deeplink: toDeepLink('/settings/subscription'),
      paramsPublic: { plan: 'Pro' },
      scheduledFor: remindAt.getTime() > ctx.now.getTime() ? remindAt : null,
      validUntil: expires,
    }),
  };
}
