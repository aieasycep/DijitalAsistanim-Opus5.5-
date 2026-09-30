/**
 * API-ANL-01 `POST /analytics/events` (M§42, ADR-13, R-21, SECURITY_AND_PRIVACY_PLAN §4.9).
 *
 * The batch envelope is validated by the route schema; every event is then checked against the
 * `@da/domain` catalogue (`validateAnalyticsEvent`): unknown names, invalid timestamps and oversized
 * props drop the event; unknown or non-conforming props (including e-mail- or URL-like strings) are
 * removed. `user_preferences.analytics_opt_out` stores nothing. Rows carry no content.
 */
import { validateAnalyticsEvent } from '@da/domain';
import { AnalyticsBody, routes } from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import type { DbClient } from '../../_shared/db/clients.ts';
import { mapDbError } from '../../_shared/errors.ts';
import { sendData } from '../../_shared/http/respond.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
} from '../../_shared/http/validate.ts';
import type { RouteRegistrar } from '../deps.ts';

export interface AnalyticsRow {
  readonly user_id: string;
  readonly installation_id: string | null;
  readonly session_id: string;
  readonly event_name: string;
  readonly props: Record<string, string | number | boolean>;
  readonly platform: 'ios' | 'android' | null;
  readonly app_version: string | null;
  readonly occurred_at: string;
}

export interface AnalyticsRepo {
  optedOut(userId: string): Promise<boolean>;
  insert(rows: readonly AnalyticsRow[]): Promise<void>;
}

/** Events older than this or further in the future than the skew are dropped. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SKEW_MS = 5 * 60 * 1000;
/** The contact-like patterns of the domain allow-list (SECURITY_AND_PRIVACY_PLAN §4.9). */
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_LIKE = /(?:https?:|www\.|:\/\/)/i;

export function acceptEvents(
  body: {
    session_id: string;
    events: readonly { name: string; ts: string; screen?: string | undefined; props?: unknown }[];
  },
  meta: {
    userId: string;
    installationId: string | null;
    platform: 'ios' | 'android' | null;
    appVersion: string | null;
    now: Date;
  },
): { rows: AnalyticsRow[]; dropped: number } {
  const rows: AnalyticsRow[] = [];
  let dropped = 0;
  const now = meta.now.getTime();
  for (const event of body.events) {
    const at = Date.parse(event.ts);
    if (Number.isNaN(at) || at > now + MAX_SKEW_MS || at < now - MAX_AGE_MS) {
      dropped++;
      continue;
    }
    const rawProps =
      typeof event.props === 'object' && event.props !== null && !Array.isArray(event.props)
        ? { ...(event.props as Record<string, unknown>) }
        : {};
    if (event.screen !== undefined && rawProps.screen === undefined) rawProps.screen = event.screen;
    // API-ANL-01: an event carrying an e-mail- or URL-like string is dropped as a whole.
    if (
      Object.values(rawProps).some(
        (v) => typeof v === 'string' && (EMAIL_LIKE.test(v) || URL_LIKE.test(v)),
      )
    ) {
      dropped++;
      continue;
    }
    const result = validateAnalyticsEvent(event.name, rawProps);
    if (!result.ok) {
      dropped++;
      continue;
    }
    rows.push({
      user_id: meta.userId,
      installation_id: meta.installationId,
      session_id: body.session_id,
      event_name: result.event,
      props: { ...result.props },
      platform: meta.platform,
      app_version: meta.appVersion,
      occurred_at: new Date(at).toISOString(),
    });
  }
  return { rows, dropped };
}

export const registerAnalyticsRoutes: RouteRegistrar = (app, kit) => {
  const route = routes['POST /analytics/events'];
  mountRoute(
    app,
    route,
    ...kit.chain({ gate: true, rateLimit: 'analytics' }),
    parseJsonBody(route),
    validateRequest(route),
    async (c) => {
      const auth = currentUser(c);
      const body = validBody(c, AnalyticsBody);
      const repos = kit.deps.repos(auth);
      if (await repos.analytics.optedOut(auth.userId)) {
        return sendData(c, { accepted: 0, dropped: body.events.length }, route.status);
      }
      const client = c.get('client');
      const { rows, dropped } = acceptEvents(body, {
        userId: auth.userId,
        installationId: c.get('installationId'),
        platform: client.platform,
        appVersion: client.version,
        now: kit.now(),
      });
      if (rows.length > 0) await repos.analytics.insert(rows);
      return sendData(c, { accepted: rows.length, dropped }, route.status);
    },
  );
};

/** `analytics_events` is a system table (service client); the opt-out is read under RLS. */
export function supabaseAnalyticsRepo(clients: {
  system: DbClient;
  user: DbClient;
}): AnalyticsRepo {
  return {
    async optedOut(userId) {
      const { data, error } = await clients.user
        .from('user_preferences')
        .select('analytics_opt_out')
        .eq('user_id', userId)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      return (data as { analytics_opt_out?: boolean } | null)?.analytics_opt_out === true;
    },
    async insert(rows) {
      const { error } = await clients.system.from('analytics_events').insert([...rows]);
      if (error !== null) throw mapDbError(error);
    },
  };
}
