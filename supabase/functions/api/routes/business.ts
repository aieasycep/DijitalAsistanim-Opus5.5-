/**
 * API-BIZ-03 `POST /purchases/sync` [IK] (IMPLEMENTATION_PLAN T-7.02; ADR-11, F-07).
 *
 * After a purchase or restore the app asks for an immediate mirror refresh. `rc_app_user_id` must be
 * the caller (RevenueCat `appUserID = user id`), otherwise `VALIDATION_FAILED`. The JOB-24 logic runs
 * inline with a 10 s budget; when RevenueCat is rate limited, unavailable or slow the current mirror
 * is returned with `stale:true` and `billing_sync` is enqueued. Without the RevenueCat credential
 * the mirror is returned as `stale` when one exists, else `EXTERNAL_CREDENTIAL_REQUIRED`. The answer
 * is the same entitlement state as `GET /me/entitlements`.
 */
import { PurchasesSyncBody, routes } from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import { AppError, fieldError, isAppError } from '../../_shared/errors.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import { pokeWorker } from '../../_shared/jobs/client.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
} from '../../_shared/http/validate.ts';
import { buildEntitlementState } from '../../_shared/services/entitlements.ts';
import { syncBillingCustomer } from '../../_shared/services/billing/sync.ts';
import type { RequestRepos, RouteKit, RouteRegistrar } from '../deps.ts';

/** Inline sync budget (API-BIZ-03: "runs the JOB-24 logic inline (≤ 10 s)"). */
export const PURCHASE_SYNC_BUDGET_MS = 10_000;

async function entitlementState(repos: RequestRepos, userId: string, now: Date) {
  const [effective, subscription, grants] = await Promise.all([
    repos.entitlements.effective(userId),
    repos.entitlements.subscription(userId),
    repos.entitlements.grants(userId),
  ]);
  return buildEntitlementState(effective, subscription, grants, now);
}

function upstreamFailure(error: unknown): boolean {
  return (
    isAppError(error) &&
    (error.code === 'PROVIDER_RATE_LIMITED' ||
      error.code === 'PROVIDER_UNAVAILABLE' ||
      error.code === 'UPSTREAM_TIMEOUT' ||
      error.code === 'SERVICE_UNAVAILABLE')
  );
}

async function syncNow(kit: RouteKit, userId: string, correlationId: string): Promise<boolean> {
  const { business, env, log } = kit.deps;
  try {
    await syncBillingCustomer(
      {
        repo: business.billing,
        revenueCat: business.revenueCat,
        production: env.APP_ENV === 'production',
        now: kit.now,
        log,
      },
      {
        appUserId: userId,
        eventId: null,
        reason: 'purchase_sync',
        correlationId,
        signal: AbortSignal.timeout(PURCHASE_SYNC_BUDGET_MS),
      },
    );
    return false;
  } catch (error) {
    if (!upstreamFailure(error)) throw error;
    const now = kit.now();
    await business.billing.enqueue({
      type: 'billing_sync',
      idempotencyKey: `billing_sync:${userId}:purchase_sync:${now.toISOString().slice(0, 16)}`,
      userId,
      payload: { app_user_id: userId, event_id: null, reason: 'purchase_sync' },
      priority: 20,
      maxAttempts: 6,
      correlationId,
    });
    await pokeWorker({
      baseUrl: env.SUPABASE_URL,
      secret: env.CRON_SECRET,
      reason: 'purchases_sync',
      log,
      ...(kit.deps.fetch === undefined ? {} : { fetch: kit.deps.fetch }),
    });
    return true;
  }
}

export const registerBusinessRoutes: RouteRegistrar = (app, kit) => {
  const sync = routes['POST /purchases/sync'];
  mountRoute(
    app,
    sync,
    ...kit.chain({ gate: true, rateLimit: 'purchases_sync' }),
    parseJsonBody(sync),
    validateRequest(sync),
    (c) => {
      const auth = currentUser(c);
      const body = validBody(c, PurchasesSyncBody);
      if (body.rc_app_user_id.toLowerCase() !== auth.userId) {
        throw fieldError('rc_app_user_id', 'app_user_mismatch');
      }
      const repos = kit.deps.repos(auth);
      return withIdempotency(
        c,
        { repo: kit.deps.idempotency, now: () => kit.now().getTime() },
        {
          status: sync.status,
          async execute() {
            let stale: boolean;
            try {
              stale = await syncNow(kit, auth.userId, c.get('correlationId'));
            } catch (error) {
              if (!isAppError(error) || error.code !== 'EXTERNAL_CREDENTIAL_REQUIRED') throw error;
              if ((await repos.entitlements.subscription(auth.userId)) === null) throw error;
              stale = true;
            }
            const entitlement = await entitlementState(repos, auth.userId, kit.now());
            return {
              data: { entitlement, stale },
              ref: { type: 'entitlement', id: auth.userId, ack: { stale, reason: body.reason } },
            };
          },
          async replay(ref) {
            const entitlement = await entitlementState(repos, auth.userId, kit.now());
            if (ref.id !== auth.userId) throw new AppError('NOT_FOUND');
            return { entitlement, stale: ref.ack?.stale === true };
          },
        },
      );
    },
  );
};
