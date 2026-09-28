/**
 * Server-emitted product analytics (API_CONTRACTS §17.1; SECURITY_AND_PRIVACY_PLAN §4.9; R-21).
 *
 * The one path the Edge Functions use to write backend events into `analytics_events`:
 * - only the §17.1 events (the catalogue entries whose source is `server` or `both`);
 * - props are typed per event and checked by the `@da/domain` validator (closed enums, booleans,
 *   bounded integers; e-mail- or URL-like strings refused); an event with any refused prop is
 *   dropped whole, so the server never stores a partial or content-bearing event;
 * - `user_preferences.analytics_opt_out` stops collection for that user;
 * - rows carry no content and no session id (server rows are the ones with `session_id` null);
 * - emitting never fails the caller: a storage error is logged by code and swallowed.
 *
 * PUB-04 `referral_link_opened` is the one aggregate event written inside the database
 * (`private.public_referral_resolve`, no user, no props) because the resolve RPC is the only place
 * that knows the code is valid.
 */
import {
  ANALYTICS_EVENTS,
  type AnalyticsEventName,
  type AnalyticsProps,
  validateAnalyticsEvent,
} from '@da/domain';
import type { DbClient } from '../../db/clients.ts';
import { mapDbError } from '../../errors.ts';
import type { Logger } from '../../logging/logger.ts';

/** The backend events of API_CONTRACTS §17.1 (the edge-emitted subset of the catalogue). */
export const SERVER_ANALYTICS_EVENTS = [
  'device_registered',
  'push_permission_changed',
  'onboarding_first_analysis_started',
  'onboarding_first_analysis_completed',
  'reply_draft_generated',
  'followup_draft_generated',
  'reminder_created',
  'search_performed',
  'capture_analyzed',
  'briefing_audio_requested',
  'evening_closed',
  'weekly_share_card_served',
  'subscription_started',
  'subscription_renewed',
  'subscription_cancelled',
  'subscription_expired',
  'subscription_billing_issue',
  'referral_link_opened',
] as const satisfies readonly AnalyticsEventName[];

export type ServerAnalyticsEvent = (typeof SERVER_ANALYTICS_EVENTS)[number];

/** Who the event is about; the request context adds the installation, platform and app version. */
export interface ServerEventContext {
  readonly userId: string | null;
  readonly installationId?: string | null;
  readonly platform?: 'ios' | 'android' | null;
  readonly appVersion?: string | null;
}

export interface ServerAnalyticsRow {
  readonly user_id: string | null;
  readonly installation_id: string | null;
  readonly session_id: null;
  readonly event_name: ServerAnalyticsEvent;
  readonly props: Readonly<Record<string, string | number | boolean>>;
  readonly platform: 'ios' | 'android' | null;
  readonly app_version: string | null;
  readonly occurred_at: string;
}

export interface ServerAnalyticsSink {
  optedOut(userId: string): Promise<boolean>;
  insert(row: ServerAnalyticsRow): Promise<void>;
}

export type EmitOutcome = 'stored' | 'opted_out' | 'rejected' | 'failed';

export interface ServerAnalytics {
  emit<N extends ServerAnalyticsEvent>(
    name: N,
    props: AnalyticsProps<N>,
    context: ServerEventContext,
  ): Promise<EmitOutcome>;
}

const SERVER_SOURCES: ReadonlySet<string> = new Set(['server', 'both']);

function isServerEvent(name: string): name is ServerAnalyticsEvent {
  return (
    (SERVER_ANALYTICS_EVENTS as readonly string[]).includes(name) &&
    SERVER_SOURCES.has(ANALYTICS_EVENTS[name as ServerAnalyticsEvent].source)
  );
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'unknown';
}

export function createServerAnalytics(
  sink: ServerAnalyticsSink,
  options: { readonly log: Logger; readonly now?: () => Date },
): ServerAnalytics {
  const now = options.now ?? (() => new Date());
  return {
    async emit(name, props, context) {
      // Runtime guard as well as the type: a client-only name never reaches the table from here.
      if (!isServerEvent(name)) {
        options.log.warn('analytics_event_rejected', { event: String(name), reason: 'not_server' });
        return 'rejected';
      }
      const checked = validateAnalyticsEvent(name, props as Readonly<Record<string, unknown>>);
      if (!checked.ok || checked.dropped.length > 0) {
        options.log.warn('analytics_event_rejected', {
          event: name,
          reason: checked.ok ? 'invalid_props' : checked.reason,
          dropped: checked.ok ? checked.dropped.length : 0,
        });
        return 'rejected';
      }
      try {
        if (context.userId !== null && (await sink.optedOut(context.userId))) return 'opted_out';
        await sink.insert({
          user_id: context.userId,
          installation_id: context.installationId ?? null,
          session_id: null,
          event_name: name,
          props: { ...checked.props },
          platform: context.platform ?? null,
          app_version: context.appVersion ?? null,
          occurred_at: now().toISOString(),
        });
        return 'stored';
      } catch (error) {
        options.log.warn('analytics_emit_failed', { event: name, error_code: errorCode(error) });
        return 'failed';
      }
    },
  };
}

/** `analytics_events` is a system table; the opt-out is read with the same service client. */
export function supabaseServerAnalyticsSink(system: DbClient): ServerAnalyticsSink {
  return {
    async optedOut(userId) {
      const { data, error } = await system
        .from('user_preferences')
        .select('analytics_opt_out')
        .eq('user_id', userId)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      return (data as { analytics_opt_out?: boolean } | null)?.analytics_opt_out === true;
    },
    async insert(row) {
      const { error } = await system.from('analytics_events').insert(row);
      if (error !== null) throw mapDbError(error);
    },
  };
}

export function supabaseServerAnalytics(system: DbClient, log: Logger): ServerAnalytics {
  return createServerAnalytics(supabaseServerAnalyticsSink(system), { log });
}
