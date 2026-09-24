/**
 * Briefing routes of T-5.08 (API_CONTRACTS §8.13):
 * - API-BRF-02 `POST /briefings/:id/evening-ready` [IK] — "Yarına Hazırım" (Pro): carries the
 *   chosen "Yarına Kalanlar" to tomorrow; a second call returns the first result.
 * - API-BRF-03 `GET /weekly/:id/share-card` — integers and fixed labels only (no names/subjects).
 * - API-BRF-04 `POST /briefings/:id/retry` [IK] — a failed briefing of today back to `scheduled`
 *   with a new job (1 per 10 min per briefing); any other state is `STATE_CONFLICT`.
 */
import {
  BriefingIdParams,
  BriefingRetryBody,
  EveningReadyBody,
  routes,
} from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import { AppError } from '../../_shared/errors.ts';
import { sendData } from '../../_shared/http/respond.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
  validParams,
} from '../../_shared/http/validate.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import { enforceRateLimit } from '../../_shared/ratelimit.ts';
import { shareCard } from '../../_shared/services/briefings/share-card.ts';
import { isOn } from '../../_shared/services/flags.ts';
import type { RouteKit, RouteRegistrar } from '../deps.ts';
import type { IntelApi } from './intel-api.ts';

function intel(kit: RouteKit): IntelApi {
  const deps = kit.deps.intel;
  if (deps === undefined) throw new AppError('SERVICE_UNAVAILABLE', { details: { reason: 'intel_not_configured' } });
  return deps;
}

function conflict(result: Record<string, unknown>): AppError {
  return new AppError('STATE_CONFLICT', {
    details: {
      ...(typeof result.status === 'string' ? { status: result.status } : {}),
      ...(typeof result.kind === 'string' ? { kind: result.kind } : {}),
    },
  });
}

export const registerBriefingRoutes: RouteRegistrar = (app, kit) => {
  const evening = routes['POST /briefings/:id/evening-ready'];
  mountRoute(
    app,
    evening,
    ...kit.chain({ gate: true, rateLimit: 'api_default' }),
    parseJsonBody(evening),
    validateRequest(evening),
    async (c) => {
      const auth = currentUser(c);
      const params = validParams(c, BriefingIdParams);
      const body = validBody(c, EveningReadyBody);
      const api = intel(kit);
      const user = await api.ai.users.load(auth.userId);
      if (!user.isPro) throw new AppError('ENTITLEMENT_REQUIRED', { details: { feature: 'evening_briefing' } });
      const repo = api.briefings(auth);
      const run = async () => {
        const result = await repo.eveningReady(params.id, body.carry_over_item_ids ?? null);
        if (result.ok !== true) throw conflict(result);
        return {
          carried: Number(result.carried ?? 0),
          next_morning_at: new Date(String(result.next_morning_at)).toISOString(),
          closed_at: new Date(String(result.closed_at)).toISOString(),
        };
      };
      return await withIdempotency(
        c,
        { repo: kit.deps.idempotency, now: () => kit.now().getTime() },
        {
          status: evening.status,
          async execute() {
            const data = await run();
            c.get('log').info('evening_closed', { carried: data.carried });
            return { data, ref: { type: 'briefing', id: params.id, ack: data } };
          },
          replay: () => run(),
        },
      );
    },
  );

  const share = routes['GET /weekly/:id/share-card'];
  mountRoute(
    app,
    share,
    ...kit.chain({ gate: true, rateLimit: 'api_default' }),
    validateRequest(share),
    async (c) => {
      const auth = currentUser(c);
      const params = validParams(c, BriefingIdParams);
      const api = intel(kit);
      const user = await api.ai.users.load(auth.userId);
      if (!isOn(user.flags, 'feature.weekly_review')) {
        throw new AppError('FEATURE_DISABLED', { details: { feature: 'weekly_review' } });
      }
      const briefing = await api.briefings(auth).byId(params.id);
      if (briefing === null || briefing.kind !== 'weekly') throw new AppError('NOT_FOUND');
      const card = shareCard(briefing.weekly_stats, user.locale);
      if (card === null) throw new AppError('NOT_FOUND', { details: { reason: 'weekly_stats_missing' } });
      c.get('log').info('weekly_share_card_served');
      return sendData(c, card);
    },
  );

  const retry = routes['POST /briefings/:id/retry'];
  mountRoute(
    app,
    retry,
    ...kit.chain({ gate: true, rateLimit: 'api_default' }),
    parseJsonBody(retry),
    validateRequest(retry),
    async (c) => {
      const auth = currentUser(c);
      const params = validParams(c, BriefingIdParams);
      validBody(c, BriefingRetryBody);
      const api = intel(kit);
      const repo = api.briefings(auth);
      const briefing = await repo.byId(params.id);
      if (briefing === null) throw new AppError('NOT_FOUND');
      if (briefing.kind === 'midday' || briefing.kind === 'evening') {
        const user = await api.ai.users.load(auth.userId);
        if (!user.isPro) {
          throw new AppError('ENTITLEMENT_REQUIRED', {
            details: { feature: briefing.kind === 'midday' ? 'midday_briefing' : 'evening_briefing' },
          });
        }
      }
      const run = async () => {
        const result = await repo.retry(params.id);
        if (result.ok !== true) throw conflict(result);
        return {
          briefing_id: String(result.briefing_id),
          status: String(result.status) as 'scheduled',
          job: {
            job_id: String(result.job_id),
            status: String(result.job_status ?? 'queued') as 'queued',
            poll_after_ms: 2000,
          },
        };
      };
      return await withIdempotency(
        c,
        { repo: kit.deps.idempotency, now: () => kit.now().getTime() },
        {
          status: retry.status,
          async execute() {
            await enforceRateLimit(
              c,
              { store: kit.deps.rateLimits, scope: 'api', now: () => kit.now().getTime() },
              'briefing_retry',
              `b:${params.id}`,
            );
            const data = await run();
            return { data, ref: { type: 'briefing', id: params.id } };
          },
          replay: () => run(),
        },
      );
    },
  );
};
