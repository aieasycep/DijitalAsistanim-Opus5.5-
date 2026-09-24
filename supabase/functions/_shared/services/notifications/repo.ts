/**
 * Supabase implementations of `NotificationsRepo` and `TriggerRepo` (service role; every query is
 * scoped by the verified user id). The ledger keeps `(user_id, dedupe_key)` unique: an insert that
 * hits it returns `null` so the caller records a dedupe instead of a second push.
 */
import {
  DEFAULT_CATEGORY_CAPS,
  type NotificationCategory,
  type NotificationPreferences,
} from '@da/domain';
import type { DbClient } from '../../db/clients.ts';
import { mapDbError } from '../../errors.ts';
import type { NotificationRow, NotificationsRepo, PendingTicket, PushTarget } from './model.ts';
import type { TriggerRepo } from './triggers/types.ts';

type DbError = { code?: string; message?: string };
type Result<T> = PromiseLike<{ data: T | null; error: DbError | null }>;

async function one<T>(query: Result<unknown>): Promise<T | null> {
  const { data, error } = await query;
  if (error !== null) throw mapDbError(error);
  return (data ?? null) as T | null;
}

async function exec(query: PromiseLike<{ error: DbError | null }>): Promise<void> {
  const { error } = await query;
  if (error !== null) throw mapDbError(error);
}

const ROW_COLUMNS =
  'id,user_id,category,decision,suppression_reason,dedupe_key,scheduled_for,sent_at,job_id,is_test';

function hhmm(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : fallback;
}

const PREF_DEFAULTS: Omit<NotificationPreferences, 'user_id'> = {
  smart_filter: true,
  morning: true,
  midday: true,
  evening: true,
  critical_email: true,
  meeting: true,
  deadline: true,
  follow_up: true,
  life_intel: false,
  approval: true,
  account: true,
  quiet_hours_enabled: true,
  quiet_start: '22:30',
  quiet_end: '07:30',
  quiet_days: [1, 2, 3, 4, 5, 6, 7],
  vip_bypass_quiet: true,
  detail_level: 'title_only',
  lock_screen_private: true,
  daily_cap: 5,
  snooze_until: null,
  meeting_prep_lead_min: 30,
} as unknown as Omit<NotificationPreferences, 'user_id'>;

export function notificationPrefsFrom(
  row: Record<string, unknown> | null,
): Omit<NotificationPreferences, 'user_id'> {
  if (row === null) return PREF_DEFAULTS;
  return {
    ...PREF_DEFAULTS,
    ...(row as Partial<NotificationPreferences>),
    quiet_start: hhmm(row.quiet_start, '22:30'),
    quiet_end: hhmm(row.quiet_end, '07:30'),
  } as Omit<NotificationPreferences, 'user_id'>;
}

const CAP_KEYS: Readonly<Record<string, NotificationCategory>> = {
  'notifications.cap.follow_up': 'follow_up',
  'notifications.cap.life_intel': 'life_intel',
  'notifications.cap.deadline': 'deadline',
};

export function supabaseNotificationsRepo(system: DbClient): NotificationsRepo {
  return {
    getNotification(userId, id) {
      return one<NotificationRow>(
        system
          .from('notifications')
          .select(ROW_COLUMNS)
          .eq('id', id)
          .eq('user_id', userId)
          .maybeSingle(),
      );
    },
    findByDedupe(userId, dedupeKey) {
      return one<NotificationRow>(
        system
          .from('notifications')
          .select(ROW_COLUMNS)
          .eq('user_id', userId)
          .eq('dedupe_key', dedupeKey)
          .maybeSingle(),
      );
    },
    async insertNotification(row) {
      const { data, error } = await system
        .from('notifications')
        .insert(row)
        .select(ROW_COLUMNS)
        .maybeSingle();
      if (error !== null) {
        if (error.code === '23505') return null;
        throw mapDbError(error);
      }
      return (data ?? null) as NotificationRow | null;
    },
    updateNotification(id, patch) {
      return exec(system.from('notifications').update(patch).eq('id', id));
    },
    async userState(userId) {
      const [prefs, notif, profile, entitlement] = await Promise.all([
        one<{ timezone: string }>(
          system.from('user_preferences').select('timezone').eq('user_id', userId).maybeSingle(),
        ),
        one<Record<string, unknown>>(
          system.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle(),
        ),
        one<{ locale: string | null }>(
          system.from('profiles').select('locale').eq('user_id', userId).maybeSingle(),
        ),
        one<{ is_active: boolean }[]>(system.rpc('effective_entitlement', { p_user_id: userId })),
      ]);
      const permission = notif?.os_permission;
      return {
        prefs: notificationPrefsFrom(notif),
        timeZone: prefs?.timezone ?? 'Europe/Istanbul',
        locale: profile?.locale?.toLowerCase().startsWith('en') ? 'en' : 'tr',
        isPro: Array.isArray(entitlement) && entitlement[0]?.is_active === true,
        osPermission:
          permission === 'granted' || permission === 'denied' || permission === 'provisional'
            ? permission
            : 'undetermined',
      };
    },
    async activeTargets(userId, installationRowId, now) {
      let query = system
        .from('push_tokens')
        .select(
          'id,expo_push_token,installation_id,app_installations!inner(id,platform,signed_out_at)',
        )
        .eq('user_id', userId)
        .eq('status', 'active');
      if (installationRowId !== null) query = query.eq('installation_id', installationRowId);
      const rows =
        (await one<
          {
            id: string;
            expo_push_token: string;
            installation_id: string;
            app_installations: {
              id: string;
              platform: 'ios' | 'android';
              signed_out_at: string | null;
            };
          }[]
        >(query)) ?? [];
      const live = rows.filter((r) => r.app_installations.signed_out_at === null);
      if (live.length === 0) return [];
      const backoff =
        (await one<{ key: string }[]>(
          system
            .from('rate_limits')
            .select('key')
            .in(
              'key',
              live.map((r) => `push_backoff:${r.id}`),
            )
            .gt('window_start', now.toISOString()),
        )) ?? [];
      const blocked = new Set(backoff.map((b) => b.key));
      return live
        .filter((r) => !blocked.has(`push_backoff:${r.id}`))
        .map((r): PushTarget => ({
          tokenId: r.id,
          token: r.expo_push_token,
          platform: r.app_installations.platform,
          installationRowId: r.installation_id,
        }));
    },
    async recentSent(userId, since) {
      return (
        (await one<
          {
            category: NotificationCategory;
            sent_at: string;
            dedupe_key: string;
            is_test: boolean;
          }[]
        >(
          system
            .from('notifications')
            .select('category,sent_at,dedupe_key,is_test')
            .eq('user_id', userId)
            .eq('decision', 'sent')
            .gt('sent_at', since.toISOString())
            .order('sent_at', { ascending: false })
            .limit(500),
        )) ?? []
      );
    },
    async categoryCaps() {
      const rows =
        (await one<{ key: string; value: unknown }[]>(
          system.from('app_settings').select('key,value').in('key', Object.keys(CAP_KEYS)),
        )) ?? [];
      const caps: Partial<Record<NotificationCategory, number>> = { ...DEFAULT_CATEGORY_CAPS };
      for (const row of rows) {
        const category = CAP_KEYS[row.key];
        const value = Number(row.value);
        if (category !== undefined && Number.isInteger(value) && value >= 0) caps[category] = value;
      }
      return caps;
    },
    async ticketCount(notificationId) {
      const { count, error } = await system
        .from('push_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('notification_id', notificationId);
      if (error !== null) throw mapDbError(error);
      return count ?? 0;
    },
    async insertTickets(rows) {
      if (rows.length === 0) return;
      await exec(system.from('push_tickets').insert(rows.map((r) => ({ ...r }))));
    },
    disableToken(tokenId, reason) {
      return exec(
        system
          .from('push_tokens')
          .update({ status: 'disabled', disabled_reason: reason })
          .eq('id', tokenId),
      );
    },
    backoffToken(tokenId, until) {
      return exec(
        system.from('rate_limits').upsert(
          { key: `push_backoff:${tokenId}`, window_start: until.toISOString(), count: 1 },
          {
            onConflict: 'key,window_start',
            ignoreDuplicates: true,
          },
        ),
      );
    },
    async pendingTickets(sentBefore, limit, ids) {
      let query = system
        .from('push_tickets')
        .select('id,expo_ticket_id,push_token_id,sent_at')
        .eq('status', 'pending_receipt')
        .not('expo_ticket_id', 'is', null)
        .lt('sent_at', sentBefore.toISOString())
        .order('sent_at')
        .limit(limit);
      if (ids !== undefined && ids.length > 0) query = query.in('expo_ticket_id', [...ids]);
      return (await one<PendingTicket[]>(query)) ?? [];
    },
    resolveTicket(id, status, errorCode, checkedAt) {
      return exec(
        system
          .from('push_tickets')
          .update({ status, error_code: errorCode, receipt_checked_at: checkedAt.toISOString() })
          .eq('id', id),
      );
    },
    recordPushHealth(status, detail) {
      return exec(
        system
          .from('system_health_checks')
          .insert({ component: 'push', status, detail, checked_by: 'cron' }),
      );
    },
  };
}

export function supabaseTriggerRepo(system: DbClient): TriggerRepo {
  return {
    event(userId, id) {
      return one(
        system
          .from('calendar_events')
          .select('id,title,start_at,end_at,status,all_day,attendee_count,provider_deleted_at')
          .eq('id', id)
          .eq('user_id', userId)
          .maybeSingle(),
      );
    },
    async meetingPrep(userId, eventId) {
      const row = await one<{ status: string; talking_points: unknown[] }>(
        system
          .from('meeting_preps')
          .select('status,talking_points')
          .eq('calendar_event_id', eventId)
          .eq('user_id', userId)
          .maybeSingle(),
      );
      return row === null
        ? null
        : {
            status: row.status,
            topics: Array.isArray(row.talking_points) ? row.talking_points.length : 0,
          };
    },
    async reminder(userId, id) {
      const row = await one<{
        id: string;
        title: string;
        remind_at: string;
        channel: 'push' | 'local' | 'provider_task' | 'apple_reminders';
        status: 'scheduled' | 'delivered' | 'done' | 'cancelled' | 'failed';
        notification_id: string | null;
      }>(
        system
          .from('reminders')
          .select('id,title,remind_at,channel,status,notification_id')
          .eq('id', id)
          .eq('user_id', userId)
          .maybeSingle(),
      );
      if (row === null) return null;
      const notification =
        row.notification_id === null
          ? null
          : await one<{ category: NotificationCategory }>(
              system
                .from('notifications')
                .select('category')
                .eq('id', row.notification_id)
                .maybeSingle(),
            );
      return { ...row, notification_category: notification?.category ?? null };
    },
    setReminderStatus(userId, id, status, at) {
      return exec(
        system
          .from('reminders')
          .update(status === 'delivered' ? { status, delivered_at: at.toISOString() } : { status })
          .eq('id', id)
          .eq('user_id', userId)
          .eq('status', 'scheduled'),
      );
    },
    async insight(userId, id) {
      const row = await one<Record<string, unknown>>(
        system
          .from('insights')
          .select(
            'id,kind,status,title,urgency,entity_type,entity_id,due_at,event_at,created_at,user_overrides',
          )
          .eq('id', id)
          .eq('user_id', userId)
          .maybeSingle(),
      );
      if (row === null) return null;
      const overrides = (row.user_overrides ?? {}) as Record<string, { value?: unknown }>;
      let person: string | null = null;
      if (row.entity_type === 'email_thread') {
        const thread = await one<{
          participants: { name?: string; email?: string; is_self?: boolean }[];
        }>(
          system
            .from('email_threads')
            .select('participants')
            .eq('id', row.entity_id as string)
            .eq('user_id', userId)
            .maybeSingle(),
        );
        const other = (thread?.participants ?? []).find(
          (p) => p.is_self !== true && typeof p.name === 'string',
        );
        person = other?.name ?? null;
      }
      return {
        id: row.id as string,
        kind: row.kind as never,
        status: row.status as string,
        title:
          typeof overrides.title?.value === 'string'
            ? overrides.title.value
            : (row.title as string),
        urgency: row.urgency as 'urgent' | 'today' | 'normal' | 'low',
        entity_type: row.entity_type as string,
        entity_id: row.entity_id as string,
        due_at:
          typeof overrides.due_at?.value === 'string'
            ? overrides.due_at.value
            : (row.due_at as string | null),
        event_at: row.event_at as string | null,
        created_at: row.created_at as string,
        person,
      };
    },
    approval(userId, id) {
      return one(
        system
          .from('approval_actions')
          .select('id,status,what,action_type,approval_expires_at,attempt_count,payload_version')
          .eq('id', id)
          .eq('user_id', userId)
          .maybeSingle(),
      );
    },
    briefing(userId, id) {
      return one(
        system
          .from('briefings')
          .select('id,kind,status,scheduled_for,headline,counts,weekly_stats')
          .eq('id', id)
          .eq('user_id', userId)
          .maybeSingle(),
      );
    },
    markBriefingDelivered(userId, id, at) {
      return exec(
        system
          .from('briefings')
          .update({ status: 'delivered', delivered_at: at.toISOString() })
          .eq('id', id)
          .eq('user_id', userId)
          .eq('status', 'ready'),
      );
    },
    subscription(userId) {
      return one(
        system
          .from('subscriptions')
          .select('status,period_type,expires_at,will_renew,product_id')
          .eq('user_id', userId)
          .maybeSingle(),
      );
    },
  };
}
