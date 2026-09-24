/**
 * Approval pushes (API_CONTRACTS §6.6, JOB-17):
 * - **Expiring**: scheduled at proposal for 2 h before `approval_expires_at`; sent only while the
 *   approval is still `pending` ("Onay süresi doluyor" / "{işlem} için {n} saat kaldı."), iOS
 *   time-sensitive, stale at expiry.
 * - **Failed**: after a terminal execution failure ("{işlem} yapılamadı."), one per attempt.
 */
import { routes, toDeepLink } from '@da/domain';
import type { EnqueueInput } from '../../../jobs/types.ts';
import { baseSpec, notificationTriggerJob } from '../create.ts';
import { skip, type TriggerContext, type TriggerOutcome } from './types.ts';

export const EXPIRY_WARNING_MS = 2 * 3_600_000;

/** The expiring push for a new approval, or `null` when it expires within the warning window. */
export function approvalExpiringJob(
  approval: { id: string; user_id: string; approval_expires_at: string },
  now: Date,
): EnqueueInput | null {
  const at = Date.parse(approval.approval_expires_at) - EXPIRY_WARNING_MS;
  if (!Number.isFinite(at) || at <= now.getTime()) return null;
  return notificationTriggerJob(
    approval.user_id,
    `approval_expiring:${approval.id}`,
    { trigger: 'approval_expiring', approval_id: approval.id },
    { runAfter: new Date(at), priority: 40 },
  );
}

/** The failure push after a terminal execution failure (one per attempt). */
export function approvalFailedJob(approval: {
  id: string;
  user_id: string;
  attempt_count: number;
}): EnqueueInput {
  return notificationTriggerJob(
    approval.user_id,
    `approval_failed:${approval.id}:${approval.attempt_count}`,
    { trigger: 'approval_result', approval_id: approval.id },
    { priority: 30 },
  );
}

export async function approvalExpiringTrigger(ctx: TriggerContext): Promise<TriggerOutcome> {
  const id = ctx.payload.approval_id;
  if (id === undefined) return skip('missing_approval');
  const approval = await ctx.repo.approval(ctx.userId, id);
  if (approval === null || approval.status !== 'pending') return skip('not_pending');
  const expires = new Date(approval.approval_expires_at);
  const ms = expires.getTime() - ctx.now.getTime();
  if (ms <= 0) return skip('expired');
  return {
    kind: 'spec',
    spec: baseSpec({
      category: 'approval',
      dedupeKey: `approval_expiring:${approval.id}`,
      template: 'approval',
      variant: 'expiring',
      urgency: 'today',
      entityType: 'approval_action',
      entityId: approval.id,
      deeplink: toDeepLink(routes.approval(approval.id)),
      paramsPublic: { hours: Math.max(1, Math.ceil(ms / 3_600_000)) },
      paramsSensitive: { summary: approval.what },
      validUntil: expires,
      approvalExpiringSoon: true,
    }),
  };
}

export async function approvalFailedTrigger(ctx: TriggerContext): Promise<TriggerOutcome> {
  const id = ctx.payload.approval_id;
  if (id === undefined) return skip('missing_approval');
  const approval = await ctx.repo.approval(ctx.userId, id);
  if (approval === null || approval.status !== 'failed') return skip('not_failed');
  return {
    kind: 'spec',
    spec: baseSpec({
      category: 'approval',
      dedupeKey: `approval_failed:${approval.id}:${approval.attempt_count}`,
      template: 'approval',
      variant: 'failed',
      urgency: 'today',
      entityType: 'approval_action',
      entityId: approval.id,
      deeplink: toDeepLink(routes.approval(approval.id)),
      paramsSensitive: { summary: approval.what },
      validUntil: new Date(ctx.now.getTime() + 24 * 3_600_000),
    }),
  };
}
