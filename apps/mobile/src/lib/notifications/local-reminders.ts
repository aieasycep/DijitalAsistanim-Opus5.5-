/**
 * Device-local notifications for user-created smart reminders (T-8.24; SCREEN_AND_FLOW_MAP Part 4
 * §12.5, INTEGRATION_PLAN §9.7, M-REM-01). `reminders` rows are the source of truth:
 * - the reminder sheet schedules its notification at once (`scheduleLocalReminder`, identifier
 *   `reminder:{client_reminder_id}` = `reminders.idempotency_key`), so it fires even offline;
 * - `reconcileLocalReminders()` (sign-in, cold start, foreground, detail-level change) schedules
 *   every `scheduled` local reminder of the next 7 days with content at the current effective
 *   level (so a level change re-renders them all), and cancels scheduled reminders the server no longer has (cancelled on another device,
 *   undone) — except those still waiting in the offline queue;
 * - cancel and reschedule follow reminder changes; logout cancels them all (`logout.ts`).
 * Content by effective level (`lock_screen_private` caps it at `title_only`): full "Hatırlatıcı" /
 * the reminder text; title_only "Hatırlatıcı" / "Şimdi hatırlatmamı istediğin bir konu var.";
 * generic "Dijital Asistan" / "Yeni bir güncellemen var." Category `da_reminder`, channel
 * `reminders`, interruption level `timeSensitive`; `data` is `{type:'reminder', entity_id,
 * deeplink}` only. Reminders fire in quiet hours by design (R-13 a); quiet hours and DND are
 * otherwise evaluated server-side only.
 */
import type { NotificationDetail } from '@da/domain';
import { routes } from '@da/domain/deeplinks';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import { translator } from '../../i18n/translate';
import { getSupabase } from '../auth/supabase';
import { queuedMutations } from '../offline/mutations';
import { cachedBootstrap } from '../postgrest';
import { REMINDER_CATEGORY, REMINDER_CHANNEL } from './channels';

export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

export async function notificationPermission(): Promise<NotificationPermission> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || current.status === Notifications.PermissionStatus.GRANTED)
    return 'granted';
  return current.status === Notifications.PermissionStatus.UNDETERMINED ? 'undetermined' : 'denied';
}

/** Asks only when undetermined (the CTA is the user action, M-REM-01 permission edge case). */
export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  const current = await notificationPermission();
  if (current !== 'undetermined') return current;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted || asked.status === Notifications.PermissionStatus.GRANTED
    ? 'granted'
    : 'denied';
}

export function openNotificationSettings(): void {
  void Linking.openSettings();
}

export const REMINDER_ID_PREFIX = 'reminder:';

export function localIdentifier(clientReminderId: string): string {
  return `${REMINDER_ID_PREFIX}${clientReminderId}`;
}

/** How many days ahead reminders are scheduled on the device. */
export const LOCAL_REMINDER_WINDOW_DAYS = 7;

const DETAIL_RANK: Readonly<Record<NotificationDetail, number>> = {
  generic: 0,
  title_only: 1,
  full: 2,
};

/** R-05: `lock_screen_private ? min(detail_level, title_only) : detail_level`. */
export function effectiveDetail(
  level: NotificationDetail,
  lockScreenPrivate: boolean,
): NotificationDetail {
  return lockScreenPrivate && DETAIL_RANK[level] > DETAIL_RANK.title_only ? 'title_only' : level;
}

function currentDetail(): NotificationDetail {
  const prefs = cachedBootstrap()?.notification_preferences;
  return effectiveDetail(prefs?.detail_level ?? 'title_only', prefs?.lock_screen_private ?? false);
}

/** The notification text for one reminder at a detail level (§12.5 table). */
export function reminderContent(
  text: string,
  level: NotificationDetail,
): { readonly title: string; readonly body: string } {
  const t = translator();
  switch (level) {
    case 'full':
      return {
        title: t('push.reminder.local.full.title'),
        body: t('push.reminder.local.full.body', { text }),
      };
    case 'title_only':
      return {
        title: t('push.reminder.local.title_only.title'),
        body: t('push.reminder.local.title_only.body'),
      };
    case 'generic':
      return {
        title: t('push.reminder.local.generic.title'),
        body: t('push.reminder.local.generic.body'),
      };
  }
}

export interface LocalReminder {
  readonly clientReminderId: string;
  readonly title: string;
  readonly fireAt: Date;
  /** Kept for callers that show the time in their own UI. */
  readonly timeLabel?: string;
  readonly deeplink: string | null;
  /** The server row id when known (`data.entity_id`). */
  readonly reminderId?: string | null;
}

export async function scheduleLocalReminder(
  reminder: LocalReminder,
  level: NotificationDetail = currentDetail(),
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: localIdentifier(reminder.clientReminderId),
    content: {
      ...reminderContent(reminder.title, level),
      categoryIdentifier: REMINDER_CATEGORY,
      interruptionLevel: 'timeSensitive',
      data: {
        type: 'reminder',
        entity_id: reminder.reminderId ?? null,
        deeplink: reminder.deeplink,
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminder.fireAt,
      ...(Platform.OS === 'android' ? { channelId: REMINDER_CHANNEL } : {}),
    },
  });
}

export async function cancelLocalReminder(clientReminderId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(localIdentifier(clientReminderId));
}

/** A reminder's deep link from its target (`reminders.target_type/target_id`). */
export function reminderDeeplink(
  targetType: string | null,
  targetId: string | null,
): string | null {
  if (targetType === null || targetId === null) return null;
  try {
    switch (targetType) {
      case 'email_message':
        return routes.mailDetail(targetId);
      case 'commitment':
        return routes.commitment(targetId);
      case 'life_event':
        return routes.life(targetId);
      case 'calendar_event':
        return routes.event(targetId);
      case 'capture':
        return routes.captureDetail(targetId);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

interface ReminderRow {
  readonly id: string;
  readonly idempotency_key: string;
  readonly title: string;
  readonly remind_at: string;
  readonly target_type: string | null;
  readonly target_id: string | null;
}

async function scheduledLocalRows(): Promise<readonly ReminderRow[] | null> {
  const { data, error } = (await getSupabase()
    .from('reminders')
    .select('id, idempotency_key, title, remind_at, target_type, target_id')
    .eq('channel', 'local')
    .eq('status', 'scheduled')) as {
    data: ReminderRow[] | null;
    error: { message: string } | null;
  };
  if (error !== null) return null;
  return data ?? [];
}

/** Client ids of reminders still waiting in the offline queue (their rows do not exist yet). */
function queuedClientIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of queuedMutations()) {
    if (entry.kind !== 'reminder_create') continue;
    const body = (entry.args as { body?: { client_reminder_id?: unknown } }).body;
    if (typeof body?.client_reminder_id === 'string') ids.add(body.client_reminder_id);
  }
  return ids;
}

let reconciling: Promise<void> | null = null;

/** Brings the device's scheduled reminders in line with the server rows (see the header). */
export function reconcileLocalReminders(now: Date = new Date()): Promise<void> {
  reconciling ??= (async () => {
    const rows = await scheduledLocalRows();
    if (rows === null) return;
    const level = currentDetail();
    const horizon = now.getTime() + LOCAL_REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const keep = new Set(rows.map((row) => localIdentifier(row.idempotency_key)));
    for (const id of queuedClientIds()) keep.add(localIdentifier(id));
    for (const row of rows) {
      const at = Date.parse(row.remind_at);
      if (!Number.isFinite(at) || at <= now.getTime() || at > horizon) continue;
      await scheduleLocalReminder(
        {
          clientReminderId: row.idempotency_key,
          title: row.title,
          fireAt: new Date(at),
          deeplink: reminderDeeplink(row.target_type, row.target_id),
          reminderId: row.id,
        },
        level,
      ).catch(() => undefined);
    }
    const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
    for (const request of scheduled) {
      const id = request.identifier;
      if (id.startsWith(REMINDER_ID_PREFIX) && !keep.has(id)) {
        await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
      }
    }
  })().finally(() => {
    reconciling = null;
  });
  return reconciling;
}
