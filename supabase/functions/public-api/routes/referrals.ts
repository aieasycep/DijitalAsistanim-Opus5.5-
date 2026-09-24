/**
 * PUB-04 `GET /referrals/:code` (API_CONTRACTS §13; IMPLEMENTATION_PLAN T-7.03 / T-9.05; plan §16).
 *
 * Resolves a referral link for the web `/r/[code]` page: whether the code is active, the reward and
 * apply-window days, the store links (the Play link carries the Install Referrer `code=…`) and the
 * app deep link. The referrer is never exposed. Unknown and malformed codes answer the same
 * `200 {valid:false}` shape (no probing signal); a malformed code never reaches the database.
 * IP-hash 60/min; cacheable for 5 minutes. A valid open is counted as `referral_link_opened`.
 */
import type { Hono } from 'hono';
import { isValidReferralCode, normalizeReferralCode } from '@da/domain';
import { publicApi, publicRoutes } from '@da/validation';
import { AppError } from '../../_shared/errors.ts';
import type { AppEnv } from '../../_shared/http/context.ts';
import { sendData } from '../../_shared/http/respond.ts';
import { mountRoute } from '../../_shared/http/validate.ts';
import type { PublicApiServices } from '../deps.ts';
import { enforcePublicLimit, ipSubject } from '../limits.ts';

/** Store links for the landing (SCREEN_AND_FLOW_MAP web §0.7). */
export function referralStoreUrls(
  services: Pick<PublicApiServices, 'iosAppStoreId' | 'androidPackage' | 'publicWebUrl'>,
  code: string | null,
): { ios: string; android: string } {
  const referrer = code === null ? '' : `&referrer=${encodeURIComponent(`code=${code}`)}`;
  const android = `https://play.google.com/store/apps/details?id=${encodeURIComponent(services.androidPackage)}${referrer}`;
  const appId = services.iosAppStoreId?.trim() ?? '';
  if (/^\d{6,12}$/.test(appId)) {
    return { ios: `https://apps.apple.com/app/id${appId}?ct=referral&mt=8`, android };
  }
  const web = services.publicWebUrl?.trim() ?? '';
  if (web === '') {
    throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
      details: {
        feature: 'referral_landing',
        credential_keys: ['IOS_APP_STORE_ID', 'PUBLIC_WEB_URL'],
      },
    });
  }
  return { ios: `${web.replace(/\/+$/, '')}/get?src=referral`, android };
}

export function registerReferralRoutes(app: Hono<AppEnv>, services: PublicApiServices): void {
  const resolve = publicRoutes['GET /referrals/:code'];
  mountRoute(app, resolve, async (c) => {
    await enforcePublicLimit(c, services, 'referral_ip', await ipSubject(c, services.pepper));
    const code = normalizeReferralCode(c.req.param('code') ?? '');
    const wellFormed = isValidReferralCode(code);
    const resolved = await services.repo.referralResolve(wellFormed ? code : '');
    const valid = wellFormed && resolved.valid;
    const data = publicApi.PublicReferralResolve.parse({
      valid,
      reward_days: resolved.reward_days,
      apply_window_days: resolved.apply_window_days,
      store_urls: referralStoreUrls(services, valid ? code : null),
      deep_link: `dijitalasistan://settings/referral?code=${valid ? code : ''}`,
      message_key: 'referral.landing',
    });
    c.header('Cache-Control', 'public, max-age=300');
    return sendData(c, data);
  });
}
