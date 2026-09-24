/**
 * `WidgetSources` over the caller's RLS client (reads only): the RPC-04 `today_overview`
 * projection, today's briefing, the next calendar events of selected calendars, meeting preps,
 * preferences and the entitlement (API-WDG-01 DB effects).
 */
import type { InsightKind, NotificationDetail, Provider, SourceType, Urgency } from '@da/domain';
import type { DbClient } from '../../db/clients.ts';
import { mapDbError } from '../../errors.ts';
import type { WidgetBriefingRow, WidgetEvent, WidgetSources } from './snapshot.ts';

type DbError = { code?: string; message?: string };
type Query = PromiseLike<{ data: unknown; error: DbError | null }>;

async function read<T>(query: Query): Promise<T | null> {
  const { data, error } = await query;
  if (error !== null) throw mapDbError(error);
  return (data ?? null) as T | null;
}

export function supabaseWidgetSources(user: DbClient, userId: string): WidgetSources {
  return {
    async installationBelongsToUser(installationId) {
      const row = await read<{ id: string }>(
        user
          .from('app_installations')
          .select('id')
          .eq('user_id', userId)
          .eq('installation_id', installationId)
          .maybeSingle(),
      );
      return row !== null;
    },
    async preferences() {
      const [notif, prefs, profile] = await Promise.all([
        read<{ detail_level: NotificationDetail; lock_screen_private: boolean }>(
          user
            .from('notification_preferences')
            .select('detail_level,lock_screen_private')
            .eq('user_id', userId)
            .maybeSingle(),
        ),
        read<{ timezone: string }>(
          user.from('user_preferences').select('timezone').eq('user_id', userId).maybeSingle(),
        ),
        read<{ locale: string | null }>(
          user.from('profiles').select('locale').eq('user_id', userId).maybeSingle(),
        ),
      ]);
      return {
        detail_level: notif?.detail_level ?? 'title_only',
        lock_screen_private: notif?.lock_screen_private ?? true,
        timezone: prefs?.timezone ?? 'Europe/Istanbul',
        locale: profile?.locale ?? 'tr-TR',
      };
    },
    async isPro() {
      const rows = await read<{ is_active: boolean }[]>(
        user.rpc('effective_entitlement', { p_user_id: userId }),
      );
      return Array.isArray(rows) && rows[0]?.is_active === true;
    },
    async overview() {
      const data = (await read<Record<string, unknown>>(user.rpc('today_overview', {}))) ?? {};
      const priorities = (Array.isArray(data.priorities) ? data.priorities : []) as Record<
        string,
        unknown
      >[];
      return {
        priorities: priorities.map((p) => {
          const source = (p.source ?? null) as Record<string, unknown> | null;
          return {
            id: String(p.id),
            kind: p.kind as InsightKind,
            urgency: p.urgency as Urgency,
            title: String(p.title ?? ''),
            entity_type: String(p.entity_type ?? ''),
            entity_id: String(p.entity_id ?? ''),
            due_at: typeof p.due_at === 'string' ? p.due_at : null,
            event_at: typeof p.event_at === 'string' ? p.event_at : null,
            source:
              source === null || typeof source.source_type !== 'string'
                ? null
                : {
                    source_type: source.source_type as SourceType,
                    provider: (source.provider ?? null) as Provider | null,
                    source_timestamp: String(source.source_timestamp ?? ''),
                  },
          };
        }),
        follow_ups: (Array.isArray(data.follow_ups) ? data.follow_ups : []) as {
          insight_id: string;
          entity_id: string;
          title: string;
          due_at: string | null;
        }[],
        deadlines: Array.isArray(data.deadlines) ? data.deadlines : [],
      };
    },
    async eventsBetween(from, to) {
      return (
        (await read<WidgetEvent[]>(
          user
            .from('calendar_events')
            .select('id,title,start_at,end_at,calendars!inner(selected)')
            .eq('user_id', userId)
            .eq('calendars.selected', true)
            .eq('all_day', false)
            .neq('status', 'cancelled')
            .is('provider_deleted_at', null)
            .gt('end_at', from.toISOString())
            .lt('start_at', to.toISOString())
            .order('start_at')
            .limit(10),
        )) ?? []
      );
    },
    async preps(eventIds) {
      const rows =
        (await read<{ calendar_event_id: string; status: string; talking_points: unknown[] }[]>(
          user
            .from('meeting_preps')
            .select('calendar_event_id,status,talking_points')
            .in('calendar_event_id', [...eventIds]),
        )) ?? [];
      return Object.fromEntries(
        rows.map((r) => [
          r.calendar_event_id,
          {
            ready: r.status === 'ready',
            topics: Array.isArray(r.talking_points) ? r.talking_points.length : 0,
          },
        ]),
      );
    },
    async briefing(day) {
      const rows =
        (await read<WidgetBriefingRow[]>(
          user
            .from('briefings')
            .select('id,kind,status,generated_at,scheduled_for,counts,audio_duration_s')
            .eq('user_id', userId)
            .eq('local_date', day)
            .neq('kind', 'weekly')
            .order('scheduled_for', { ascending: false })
            .limit(3),
        )) ?? [];
      return rows.find((r) => r.status === 'ready' || r.status === 'delivered') ?? rows[0] ?? null;
    },
    async sources() {
      const rows =
        (await read<{ last_successful_sync_at: string | null }[]>(
          user
            .from('connected_accounts')
            .select('last_successful_sync_at')
            .eq('user_id', userId)
            .neq('status', 'disconnected'),
        )) ?? [];
      const devices =
        (await read<{ id: string }[]>(
          user
            .from('calendar_events')
            .select('id')
            .eq('user_id', userId)
            .eq('origin', 'device_snapshot')
            .limit(1),
        )) ?? [];
      const last =
        rows
          .map((r) => r.last_successful_sync_at)
          .filter((v): v is string => v !== null)
          .sort()
          .at(-1) ?? null;
      return { connected: rows.length + (devices.length > 0 ? 1 : 0), lastAnalysisAt: last };
    },
  };
}
