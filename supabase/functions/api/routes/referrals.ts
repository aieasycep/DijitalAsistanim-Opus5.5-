/**
 * API-BIZ-01 `POST /referrals/apply` [IK] and API-BIZ-02 `GET /referrals/me`
 * (IMPLEMENTATION_PLAN T-7.03; M§45; plan §16).
 *
 * - apply: rate limited per user (5/h) and per IP hash (20/h); the domain checks reject an unknown
 *   or disabled code (404 `REFERRAL_CODE_INVALID`), a self-referral by user id, e-mail, Apple relay
 *   or installation (422 `REFERRAL_SELF`), a second referral (409 `REFERRAL_ALREADY_APPLIED`) and an
 *   account older than `referral.apply_window_days` (409 `REFERRAL_WINDOW_CLOSED`). A pending
 *   referral with hashed signals is stored and `referral_evaluate` is scheduled for the 48 h
 *   qualification age. Replays answer the original acknowledgement.
 * - me: the caller's code (created lazily with the domain generator), share link
 *   `${PUBLIC_WEB_URL}/r/{code}`, reward days, yearly cap and remaining rewards, earned days, the
 *   caller's referrals with masked initials and the caller's own referral status.
 */
import { ReferralApplyBody, routes } from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import { clientIp, hashIdHex } from '../../_shared/crypto/hash.ts';
import { enforceRateLimit } from '../../_shared/ratelimit.ts';
import { AppError } from '../../_shared/errors.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import { sendCacheable } from '../../_shared/http/respond.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
} from '../../_shared/http/validate.ts';
import { applyReferralCode, referralOverview } from '../../_shared/services/referrals/service.ts';
import type { RouteRegistrar } from '../deps.ts';

export const registerReferralRoutes: RouteRegistrar = (app, kit) => {
  const apply = routes['POST /referrals/apply'];
  mountRoute(
    app,
    apply,
    ...kit.chain({ gate: true, rateLimit: 'referral_apply' }),
    parseJsonBody(apply),
    validateRequest(apply),
    async (c) => {
      const auth = currentUser(c);
      const body = validBody(c, ReferralApplyBody);
      const ip = clientIp(c.req.header('X-Forwarded-For'));
      await enforceRateLimit(
        c,
        { store: kit.deps.rateLimits, scope: 'api', now: () => kit.now().getTime() },
        'referral_apply_ip',
        ip === null ? 'ip:unknown' : `ip:${await hashIdHex(kit.deps.env, `ip:${ip}`)}`,
      );
      return withIdempotency(
        c,
        { repo: kit.deps.idempotency, now: () => kit.now().getTime() },
        {
          status: apply.status,
          async execute() {
            const data = await applyReferralCode(
              { repo: kit.deps.business.referrals, pepper: kit.deps.env, now: kit.now() },
              {
                userId: auth.userId,
                code: body.code,
                installationId: body.installation_id,
                source: body.source,
                ip,
                correlationId: c.get('correlationId'),
              },
            );
            return {
              data,
              ref: {
                type: 'referral',
                id: data.referral_id,
                ack: {
                  status: data.status,
                  reward_days: data.reward_days,
                  onboarding_completed: data.qualification.onboarding_completed,
                  account_connected: data.qualification.account_connected,
                  first_briefing_delivered: data.qualification.first_briefing_delivered,
                  eligible_after: data.qualification.eligible_after,
                },
              },
            };
          },
          replay(ref) {
            const ack = ref.ack;
            if (ref.id === undefined || ack === undefined) {
              throw new AppError('SERVICE_UNAVAILABLE', { details: { reason: 'referral_replay' } });
            }
            return Promise.resolve({
              referral_id: ref.id,
              status: ack.status === 'flagged' ? ('flagged' as const) : ('pending' as const),
              reward_days: Number(ack.reward_days),
              qualification: {
                onboarding_completed: ack.onboarding_completed === true,
                account_connected: ack.account_connected === true,
                first_briefing_delivered: ack.first_briefing_delivered === true,
                eligible_after: String(ack.eligible_after),
              },
            });
          },
        },
      );
    },
  );

  const me = routes['GET /referrals/me'];
  mountRoute(
    app,
    me,
    ...kit.chain({ gate: true, rateLimit: 'api_default' }),
    validateRequest(me),
    async (c) => {
      const auth = currentUser(c);
      const data = await referralOverview(
        {
          repo: kit.deps.business.referrals,
          publicWebUrl: kit.deps.env.PUBLIC_WEB_URL,
          now: kit.now(),
        },
        auth.userId,
      );
      return sendCacheable(c, data, data);
    },
  );
};
