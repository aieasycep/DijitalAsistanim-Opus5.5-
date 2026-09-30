/**
 * JOB-24 `billing_sync` (API_CONTRACTS §11.4; IMPLEMENTATION_PLAN T-7.01): overwrite the
 * `subscriptions` mirror from the RevenueCat REST v2 customer record (`syncBillingCustomer`).
 *
 * Payload `{app_user_id, event_id, reason}` (`billing_sync:{app_user_id}:{event_id|reason:date}`).
 * The admin resync (ADM-11) and the daily reconcile enqueue `{user_id, reason}`, which is accepted
 * as the same app user id (RevenueCat is configured with `appUserID = user id`).
 * Failures: a missing key → `failed` with `EXTERNAL_CREDENTIAL_REQUIRED`; RevenueCat 429 retries
 * after `Retry-After`; 5xx / network / timeout retry with back-off (max_attempts 6).
 */
import { z } from 'zod';
import { defineJob } from '../../_shared/jobs/registry.ts';
import type { JobDefinition, JobResult } from '../../_shared/jobs/types.ts';
import type { RevenueCatClient } from '../../_shared/services/billing/revenuecat.ts';
import { type BillingRepo, syncBillingCustomer } from '../../_shared/services/billing/sync.ts';

export const BillingSyncPayload = z
  .object({
    app_user_id: z.string().min(1).max(128).optional(),
    user_id: z.uuid().optional(),
    event_id: z.string().min(1).max(128).nullable().optional(),
    reason: z.enum(['webhook', 'purchase_sync', 'reconcile', 'admin']),
  })
  .refine((p) => p.app_user_id !== undefined || p.user_id !== undefined, {
    message: 'app_user_id_required',
    path: ['app_user_id'],
  });
export type BillingSyncPayload = z.infer<typeof BillingSyncPayload>;

export interface BillingSyncJobDeps {
  readonly repo: BillingRepo;
  readonly revenueCat: RevenueCatClient | null;
  readonly production: boolean;
  readonly now?: () => Date;
}

export function billingSyncJob(deps: BillingSyncJobDeps): JobDefinition<BillingSyncPayload> {
  return defineJob({
    type: 'billing_sync',
    payload: BillingSyncPayload,
    timeoutMs: 20_000,
    async handler(ctx): Promise<JobResult> {
      const outcome = await syncBillingCustomer(
        {
          repo: deps.repo,
          revenueCat: deps.revenueCat,
          production: deps.production,
          now: deps.now ?? (() => ctx.now()),
          log: ctx.log,
        },
        {
          appUserId: ctx.payload.app_user_id ?? ctx.payload.user_id ?? '',
          eventId: ctx.payload.event_id ?? null,
          reason: ctx.payload.reason,
          correlationId: ctx.correlationId,
          signal: ctx.signal,
        },
      );
      if (outcome.status === 'skipped') return { skipped: outcome.reason };
      return {
        synced: true,
        is_active: outcome.is_active,
        subscription_status: outcome.subscription_status,
        effective_active: outcome.effective_active,
        follow_ups: outcome.follow_ups,
      };
    },
  });
}
