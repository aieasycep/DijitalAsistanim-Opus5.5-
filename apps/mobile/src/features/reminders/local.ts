/**
 * Device-local reminder notifications (M-REM-01 state dependencies, Part 4 §12.5). T-8.24 owns
 * the general notification layer (channels, tap routing, reconciliation on bootstrap); until it
 * lands, the reminder sheet schedules its own notification here with `expo-notifications`:
 * identifier `reminder:{client_reminder_id}`, a date trigger, the Android `reminders` channel and
 * content by `notification_preferences.detail_level` (full → title + time; title_only → title;
 * generic → "Hatırlatıcın var."). `data.deeplink` carries the target route only.
 */
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import { translator } from '../../i18n/translate';
import { cachedBootstrap } from '../../lib/postgrest';

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

export function localIdentifier(clientReminderId: string): string {
  return `reminder:${clientReminderId}`;
}

export interface LocalReminder {
  readonly clientReminderId: string;
  readonly title: string;
  readonly fireAt: Date;
  /** "Yarın 08:00" (full detail only). */
  readonly timeLabel: string;
  readonly deeplink: string | null;
}

export async function scheduleLocalReminder(reminder: LocalReminder): Promise<void> {
  const t = translator();
  const level = cachedBootstrap()?.notification_preferences.detail_level ?? 'title_only';
  const content =
    level === 'generic'
      ? { title: t('common.app.name'), body: t('reminder.local.generic') }
      : level === 'title_only'
        ? { title: reminder.title, body: t('reminder.local.titleOnly') }
        : { title: reminder.title, body: t('reminder.local.full', { time: reminder.timeLabel }) };
  await Notifications.scheduleNotificationAsync({
    identifier: localIdentifier(reminder.clientReminderId),
    content: {
      ...content,
      data: reminder.deeplink === null ? {} : { deeplink: reminder.deeplink },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminder.fireAt,
      ...(Platform.OS === 'android' ? { channelId: 'reminders' } : {}),
    },
  });
}

export async function cancelLocalReminder(clientReminderId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(localIdentifier(clientReminderId));
}
