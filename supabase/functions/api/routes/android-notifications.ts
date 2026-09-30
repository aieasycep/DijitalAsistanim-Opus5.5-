/**
 * API-ANI-01 `POST /android-notifications/signals` [IK] (M§36, ADR-12, C-11, C-12, SREQ-62).
 *
 * Chain: user auth → account gate → rate limit (`android_ni_signals`, per installation) → Pro gate
 * `android_ni` (`PRO_ROUTE_FEATURES`, 402) → Android client only (`X-DA-Client`, else 403) → flag
 * `feature.android_ni` (503 `FEATURE_DISABLED`) → JSON body (≤128 KiB) → the strict registry schema
 * (every string bounded, no free-text field) → handler under the HTTP idempotency key.
 *
 * The handler checks that the installation is the caller's Android device with the listener grant
 * (INTEGRATION_PLAN: 403 `ni_not_granted` otherwise), rejects and counts denylisted packages and
 * signals outside the 7-day window, stores the rest deduplicated on `(user_id, signal_hash)`, stamps
 * `ni_last_signal_at` and enqueues the coalesced `insight_refresh {scope:'life'}` that turns new
 * signals into `life_events` (`_shared/services/life/android.ts`). No analytics event is written and
 * nothing but counts is logged.
 */
import { AniSignalsBody, routes } from '@da/validation';
import type { MiddlewareHandler } from 'hono';
import { currentUser } from '../../_shared/auth/user.ts';
import { AppError } from '../../_shared/errors.ts';
import type { AppEnv } from '../../_shared/http/context.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
} from '../../_shared/http/validate.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import { type AniSignalsRepo, partitionSignals } from '../../_shared/services/android-ni/ingest.ts';
import { isOn } from '../../_shared/services/flags.ts';
import type { RouteKit, RouteRegistrar } from '../deps.ts';

export const ANI_FLAG = 'feature.android_ni';

export interface AniResult {
  readonly accepted: number;
  readonly duplicates: number;
  readonly rejected: number;
}

/** `X-DA-Client` must name the Android app (API-ANI-01). */
const androidOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('client').platform !== 'android') {
    throw new AppError('FORBIDDEN', { details: { reason: 'android_only' } });
  }
  await next();
};

function flagGate(kit: RouteKit): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = currentUser(c);
    const client = c.get('client');
    const flags = await kit.deps
      .repos(auth)
      .bootstrap.flags(auth.userId, client.platform, client.version);
    if (!isOn(flags, ANI_FLAG)) {
      throw new AppError('FEATURE_DISABLED', { details: { feature: 'android_ni' } });
    }
    await next();
  };
}

export function androidNotificationRoutes(repo: AniSignalsRepo): RouteRegistrar {
  return (app, kit) => {
    const route = routes['POST /android-notifications/signals'];
    mountRoute(
      app,
      route,
      ...kit.chain({ gate: true, rateLimit: 'android_ni_signals' }),
      androidOnly,
      flagGate(kit),
      parseJsonBody(route),
      validateRequest(route),
      (c) => {
        const auth = currentUser(c);
        const body = validBody(c, AniSignalsBody);
        return withIdempotency(
          c,
          { repo: kit.deps.idempotency, now: () => kit.now().getTime() },
          {
            status: route.status,
            async execute() {
              const installation = await repo.installation(body.installation_id);
              if (
                installation === null ||
                installation.user_id !== auth.userId ||
                installation.platform !== 'android'
              ) {
                throw new AppError('FORBIDDEN', { details: { reason: 'installation' } });
              }
              if (installation.ni_listener_granted !== true) {
                throw new AppError('FORBIDDEN', { details: { reason: 'ni_not_granted' } });
              }
              const now = kit.now();
              const { rows, rejected } = partitionSignals(body.signals, {
                userId: auth.userId,
                installationRowId: installation.id,
                now,
                denylist: await repo.flagDenylist(),
              });
              const accepted = await repo.insertSignals(rows);
              if (rows.length > 0) await repo.touchInstallation(installation.id, now.toISOString());
              if (accepted > 0) {
                await kit.deps.repos(auth).jobs.enqueue({
                  type: 'insight_refresh',
                  idempotencyKey: `insight_refresh:${auth.userId}:pending`,
                  payload: { user_id: auth.userId, scope: 'life', reason: 'android_signals' },
                  userId: auth.userId,
                });
              }
              const data: AniResult = { accepted, duplicates: rows.length - accepted, rejected };
              c.get('log').info('ani_signals_ingested', { ...data });
              return { data, ref: { type: 'android_notification_signals', ack: { ...data } } };
            },
            replay: (ref) =>
              Promise.resolve({
                accepted: Number(ref.ack?.accepted ?? 0),
                duplicates: Number(ref.ack?.duplicates ?? 0),
                rejected: Number(ref.ack?.rejected ?? 0),
              }),
          },
        );
      },
    );
  };
}
