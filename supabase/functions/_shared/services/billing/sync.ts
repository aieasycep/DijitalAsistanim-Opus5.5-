/**
 * The RevenueCat mirror sync shared by `billing_sync` (JOB-24) and `POST /purchases/sync`
 * (API-BIZ-03) (IMPLEMENTATION_PLAN T-7.01).
 *
 * 1. Resolve the app user id (anonymous `$RCAnonymousID` ids and unknown ids are skipped).
 * 2. In production a SANDBOX event is ignored unless the user is on the allow-list
 *    (app_settings['billing.sandbox_allowed_app_user_ids']; owner decision).
 * 3. Re-fetch the customer from REST v2 and overwrite the `subscriptions` mirror
 *    (`public.billing_apply_mirror`, which discards snapshots older than the stored one).
 * 4. Follow-ups: the P-03 trial reminder 24 h before a renewing trial ends (scheduled when the trial
 *    ends within 48 h, otherwise a re-check sync is scheduled 36 h before the end), the billing issue
 *    and "Pro ended" pushes, the `subscription_*` server analytics and the
 *    `system.subscription.synced` audit row.
 */
import { validateAnalyticsEvent } from '@da/domain';
import { AppError } from '../../errors.ts';
import type { EnqueueInput } from '../../jobs/types.ts';
import type { Logger } from '../../logging/logger.ts';
import type { AuditEntry } from '../audit.ts';
import { accountNotificationJob, planLabel, storeLabel } from '../business/notify.ts';
import {
  type MirrorSnapshot,
  missingRevenueCatCredential,
  type RevenueCatClient,
  toMirrorSnapshot,
} from './revenuecat.ts';

export type BillingSyncReason = 'webhook' | 'purchase_sync' | 'reconcile' | 'admin';

export interface BillingSyncContext {
  readonly user_id: string | null;
  readonly sandbox_allowed: boolean;
  readonly locale: string | null;
  readonly event: {
    readonly event_id: string;
    readonly event_type: string;
    readonly environment: string | null;
    readonly process_status: string;
  } | null;
  readonly mirror: {
    readonly is_active: boolean;
    readonly status: string;
    readonly synced_at: string;
  } | null;
}

export interface MirrorState {
  readonly is_active: boolean;
  readonly status: string;
  readonly will_renew: boolean;
  readonly period_type: string | null;
  readonly expires_at: string | null;
  readonly product_id: string | null;
  readonly store: string | null;
  readonly original_purchased_at?: string | null;
}

export interface ApplyMirrorResult {
  readonly skipped: string | null;
  readonly previous: MirrorState | null;
  readonly current: MirrorState | null;
  readonly event_type: string | null;
  readonly effective_before: {
    readonly is_active: boolean;
    readonly active_until: string | null;
  } | null;
  readonly effective_after: {
    readonly is_active: boolean;
    readonly active_until: string | null;
  } | null;
}

export interface AnalyticsRow {
  readonly user_id: string;
  readonly event_name: string;
  readonly props: Readonly<Record<string, string | number | boolean>>;
  readonly occurred_at: string;
}

/** Database side of the sync (service client; see `supabaseBillingRepo`). */
export interface BillingRepo {
  context(appUserId: string, eventId: string | null): Promise<BillingSyncContext>;
  markEvent(eventId: string, status: 'processed' | 'ignored_sandbox' | 'failed'): Promise<void>;
  applyMirror(
    userId: string,
    rcAppUserId: string,
    snapshot: MirrorSnapshot,
    eventId: string | null,
  ): Promise<ApplyMirrorResult>;
  enqueue(input: EnqueueInput): Promise<string>;
  analytics(row: AnalyticsRow): Promise<void>;
  audit(entry: AuditEntry): Promise<void>;
}

export interface BillingSyncDeps {
  readonly repo: BillingRepo;
  /** Null while `REVENUECAT_PROJECT_ID` / `REVENUECAT_API_V2_SECRET_KEY` are missing. */
  readonly revenueCat: RevenueCatClient | null;
  /** `APP_ENV === 'production'`. */
  readonly production: boolean;
  readonly now: () => Date;
  readonly log: Logger;
}

export interface BillingSyncInput {
  readonly appUserId: string;
  readonly eventId: string | null;
  readonly reason: BillingSyncReason;
  readonly correlationId: string | null;
  readonly signal?: AbortSignal;
}

export type BillingSyncOutcome =
  | {
      status: 'skipped';
      reason: 'anonymous' | 'sandbox' | 'stale_snapshot';
      user_id: string | null;
    }
  | {
      status: 'synced';
      user_id: string;
      is_active: boolean;
      subscription_status: string;
      effective_active: boolean;
      follow_ups: string[];
    };

const HOUR_MS = 60 * 60 * 1000;

const EVENT_ANALYTICS: Readonly<Record<string, string>> = {
  INITIAL_PURCHASE: 'subscription_started',
  RENEWAL: 'subscription_renewed',
  CANCELLATION: 'subscription_cancelled',
  EXPIRATION: 'subscription_expired',
  BILLING_ISSUE: 'subscription_billing_issue',
};

function analyticsProduct(productId: string | null): string | null {
  if (productId === null) return null;
  if (productId.startsWith('da_pro_monthly')) return 'da_pro_monthly';
  if (productId.startsWith('da_pro_annual')) return 'da_pro_annual';
  return null;
}

function epochSeconds(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Runs one sync. Throws `AppError` for missing credentials and provider failures. */
export async function syncBillingCustomer(
  deps: BillingSyncDeps,
  input: BillingSyncInput,
): Promise<BillingSyncOutcome> {
  const context = await deps.repo.context(input.appUserId, input.eventId);
  if (context.user_id === null) {
    if (input.eventId !== null) await deps.repo.markEvent(input.eventId, 'processed');
    deps.log.info('billing_sync_skipped', { reason: 'anonymous' });
    return { status: 'skipped', reason: 'anonymous', user_id: null };
  }
  const userId = context.user_id;
  if (deps.production && context.event?.environment === 'SANDBOX' && !context.sandbox_allowed) {
    if (input.eventId !== null) await deps.repo.markEvent(input.eventId, 'ignored_sandbox');
    deps.log.info('billing_sync_skipped', { reason: 'sandbox' });
    return { status: 'skipped', reason: 'sandbox', user_id: userId };
  }
  if (deps.revenueCat === null) throw missingRevenueCatCredential();

  const fetchedAt = deps.now();
  const data = await deps.revenueCat.fetchCustomer(input.appUserId, input.signal);
  const snapshot = toMirrorSnapshot(data, {
    fetchedAt,
    allowSandbox: !deps.production || context.sandbox_allowed,
  });
  const applied = await deps.repo.applyMirror(userId, input.appUserId, snapshot, input.eventId);
  if (applied.skipped !== null) {
    return { status: 'skipped', reason: 'stale_snapshot', user_id: userId };
  }

  const followUps = await scheduleFollowUps(deps, {
    userId,
    appUserId: input.appUserId,
    eventId: input.eventId,
    locale: context.locale,
    applied,
    correlationId: input.correlationId,
  });
  await recordAnalytics(deps, userId, applied);
  await deps.repo.audit({
    actorType: input.reason === 'purchase_sync' ? 'user' : 'system',
    actorId: input.reason === 'purchase_sync' ? userId : null,
    action: 'system.subscription.synced',
    targetType: 'subscription',
    targetId: userId,
    targetUserId: userId,
    result: 'success',
    details: {
      reason: input.reason,
      status: applied.current?.status ?? snapshot.status,
      is_active: snapshot.is_active,
    },
    correlationId: input.correlationId,
  });
  return {
    status: 'synced',
    user_id: userId,
    is_active: snapshot.is_active,
    subscription_status: applied.current?.status ?? snapshot.status,
    effective_active: applied.effective_after?.is_active === true,
    follow_ups: followUps,
  };
}

async function scheduleFollowUps(
  deps: BillingSyncDeps,
  input: {
    userId: string;
    appUserId: string;
    eventId: string | null;
    locale: string | null;
    applied: ApplyMirrorResult;
    correlationId: string | null;
  },
): Promise<string[]> {
  const done: string[] = [];
  const now = deps.now().getTime();
  const current = input.applied.current;

  // P-03 trial reminder (JOB-24 step 5).
  if (
    current !== null &&
    current.is_active &&
    current.will_renew &&
    current.period_type === 'trial' &&
    current.expires_at !== null
  ) {
    const expires = Date.parse(current.expires_at);
    const reminderAt = expires - 24 * HOUR_MS;
    if (reminderAt > now && expires - now <= 48 * HOUR_MS) {
      const anchor = epochSeconds(current.original_purchased_at ?? current.expires_at);
      await deps.repo.enqueue(
        accountNotificationJob({
          userId: input.userId,
          template: 'account.trial_ending',
          dedupeKey: `trial_ending:${anchor ?? epochSeconds(current.expires_at)}`,
          path: '/settings/subscription',
          params: { plan: planLabel(current.product_id, input.locale) },
          runAfter: new Date(reminderAt),
          correlationId: input.correlationId,
        }),
      );
      done.push('trial_reminder');
    } else if (reminderAt > now) {
      await deps.repo.enqueue({
        type: 'billing_sync',
        idempotencyKey: `billing_sync:${input.appUserId}:trial_check:${epochSeconds(current.expires_at)}`,
        userId: input.userId,
        payload: { app_user_id: input.appUserId, event_id: null, reason: 'reconcile' },
        runAfter: new Date(expires - 36 * HOUR_MS),
        priority: 150,
        maxAttempts: 6,
        correlationId: input.correlationId,
      });
      done.push('trial_check');
    }
  }

  // Billing issue push (account.billing_issue, dedupe billing_issue:{event_id}).
  if (
    input.applied.event_type === 'BILLING_ISSUE' &&
    input.eventId !== null &&
    current !== null &&
    (current.status === 'billing_issue' || current.status === 'grace_period')
  ) {
    await deps.repo.enqueue(
      accountNotificationJob({
        userId: input.userId,
        template: 'account.billing_issue',
        dedupeKey: `billing_issue:${input.eventId}`,
        path: '/settings/subscription',
        params: { store: storeLabel(current.store, input.locale) },
        correlationId: input.correlationId,
      }),
    );
    done.push('billing_issue');
  }

  // Effective entitlement true → false (account.pro_ended, dedupe pro_ended:{effective_until}).
  if (
    input.applied.effective_before?.is_active === true &&
    input.applied.effective_after?.is_active === false
  ) {
    const until = input.applied.effective_before.active_until;
    await deps.repo.enqueue(
      accountNotificationJob({
        userId: input.userId,
        template: 'account.pro_ended',
        dedupeKey: `pro_ended:${epochSeconds(until) ?? 'open'}`,
        path: '/settings/subscription',
        correlationId: input.correlationId,
      }),
    );
    done.push('pro_ended');
  }
  return done;
}

async function recordAnalytics(
  deps: BillingSyncDeps,
  userId: string,
  applied: ApplyMirrorResult,
): Promise<void> {
  const name = applied.event_type === null ? undefined : EVENT_ANALYTICS[applied.event_type];
  const current = applied.current;
  if (name === undefined || current === null) return;
  const product = analyticsProduct(current.product_id);
  if (product === null || current.store === null) return;
  const checked = validateAnalyticsEvent(name, {
    product,
    store: current.store,
    period_type: current.period_type ?? 'normal',
  });
  if (!checked.ok || checked.dropped.length > 0) return;
  try {
    await deps.repo.analytics({
      user_id: userId,
      event_name: checked.event,
      props: checked.props,
      occurred_at: deps.now().toISOString(),
    });
  } catch (error) {
    deps.log.warn('billing_analytics_failed', {
      error_code: error instanceof AppError ? error.code : 'unknown',
    });
  }
}
