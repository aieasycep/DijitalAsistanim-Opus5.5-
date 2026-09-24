/**
 * PUB-05 `GET /plans` and PUB-06 `POST /web-events` (API_CONTRACTS §13; M§73, M§42).
 *
 * - plans: the Free limits come from `plan_limits` (`max_mail_accounts`, `max_calendars`,
 *   `ai_daily_budget_units`), Pro is "multiple" / fair use (never "Sınırsız"), and the store price
 *   display from app_settings['web.pricing_display'] only when `verified` and at most 90 days old.
 *   `Cache-Control: public, max-age=300`; IP-hash 120/min.
 * - web-events: cookieless counters. The event must be a `web` event of the R-21 catalogue and its
 *   props pass the allow-list (unknown props, e-mail / URL / referral-code-like strings are
 *   dropped); an unknown event is dropped silently. Only `web_analytics_daily` counters are written:
 *   no IP, user agent or identifier. `204`; IP-hash 120/min.
 */
import type { Hono } from 'hono';
import { ANALYTICS_EVENTS, validateAnalyticsEvent } from '@da/domain';
import { publicApi, publicRoutes } from '@da/validation';
import type { AppEnv } from '../../_shared/http/context.ts';
import { sendData } from '../../_shared/http/respond.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
} from '../../_shared/http/validate.ts';
import type { PublicApiServices } from '../deps.ts';
import { enforcePublicLimit, ipSubject } from '../limits.ts';

const REFERRAL_CODE_LIKE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6,10}$/;

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function registerSiteRoutes(app: Hono<AppEnv>, services: PublicApiServices): void {
  const plans = publicRoutes['GET /plans'];
  mountRoute(app, plans, async (c) => {
    await enforcePublicLimit(c, services, 'plans_ip', await ipSubject(c, services.pepper));
    const row = await services.repo.plans();
    const pricing = publicApi.PricingDisplay.safeParse(row.pricing);
    const now = services.now();
    const data = publicApi.PublicPlans.parse({
      free: {
        mail_accounts: count(row.free.max_mail_accounts),
        calendars: count(row.free.max_calendars),
        ai_analyses_per_day: count(row.free.ai_daily_budget_units),
      },
      pro: { mail_accounts: 'multiple', calendars: 'multiple', ai_policy: 'fair_use' },
      pricing:
        pricing.success && publicApi.pricingDisplayUsable(pricing.data, now) ? pricing.data : null,
      updated_at: new Date(row.updated_at ?? now.toISOString()).toISOString(),
    });
    c.header('Cache-Control', 'public, max-age=300');
    return sendData(c, data);
  });

  const events = publicRoutes['POST /web-events'];
  mountRoute(app, events, parseJsonBody(events), validateRequest(events), async (c) => {
    await enforcePublicLimit(c, services, 'web_events_ip', await ipSubject(c, services.pepper));
    const body = validBody(c, publicApi.WebEventInput);
    const props = Object.fromEntries(
      Object.entries(body.props ?? {}).filter(
        ([, value]) => !(typeof value === 'string' && REFERRAL_CODE_LIKE.test(value)),
      ),
    );
    const checked = validateAnalyticsEvent(body.event, props);
    if (checked.ok && ANALYTICS_EVENTS[checked.event].source === 'web') {
      await services.repo.webAnalyticsIncrement(
        services.now().toISOString().slice(0, 10),
        checked.event,
        {
          page: body.page,
          locale: body.locale,
          device_class: body.device_class,
          theme: body.theme,
          ...checked.props,
        },
      );
    } else {
      c.get('log').info('web_event_dropped', { reason: checked.ok ? 'not_web' : checked.reason });
    }
    return c.body(null, 204);
  });
}
