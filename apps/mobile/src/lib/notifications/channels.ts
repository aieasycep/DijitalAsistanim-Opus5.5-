/**
 * Notification channels and categories (T-8.24; SCREEN_AND_FLOW_MAP Part 4 §12.1–§12.2, R-12,
 * INTEGRATION_PLAN §9.3–§9.4), set up at first launch — before any permission prompt and before
 * `getExpoPushTokenAsync` (Android 13+ shows the prompt only once a channel exists):
 * - Android: exactly the R-12 channels from `@da/domain`, localised names and descriptions (set
 *   again on a language change), every one with `lockscreenVisibility = PRIVATE`, including
 *   `account`. Importance is fixed at creation.
 * - iOS: one category per `notification_category` plus `da_reminder`, each with the hidden-preview
 *   text "Dijital Asistan güncellemesi". Push categories only open the app; `da_reminder` offers
 *   "1 saat ertele" and "Tamamlandı", handled on the device (`handlers.ts`).
 * Interruption levels are chosen server-side per push (`@da/domain` `interruptionLevelFor`); local
 * reminders are `timeSensitive`. `critical` is never used and the badge is never set.
 */
import { NOTIFICATION_CATEGORY_VALUES } from '@da/domain';
import { ANDROID_CHANNELS, type AndroidChannelSpec } from '@da/domain/notifications/channels';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { translator } from '../../i18n/translate';

export const REMINDER_CATEGORY = 'da_reminder';
export const REMINDER_CHANNEL = 'reminders';
export const REMINDER_ACTIONS = {
  snooze: 'da_reminder.snooze_1h',
  done: 'da_reminder.done',
} as const;

const IMPORTANCE = {
  high: Notifications.AndroidImportance.HIGH,
  default: Notifications.AndroidImportance.DEFAULT,
  low: Notifications.AndroidImportance.LOW,
} as const;

export interface ChannelInput {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly importance: number;
  readonly lockscreenVisibility: number;
}

/** The channel inputs for the current language (pure; the map test asserts R-12 and PRIVATE). */
export function androidChannelInputs(
  t: (key: string) => string = translator() as unknown as (key: string) => string,
): readonly ChannelInput[] {
  return ANDROID_CHANNELS.map((channel: AndroidChannelSpec) => ({
    id: channel.id,
    name: t(`push.channels.${channel.id}.name`),
    description: t(`push.channels.${channel.id}.description`),
    importance: IMPORTANCE[channel.importance],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  }));
}

/** Creates (or renames) the R-12 channels; Android only, idempotent. */
export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  for (const { id, ...input } of androidChannelInputs()) {
    await Notifications.setNotificationChannelAsync(id, input).catch(() => undefined);
  }
}

/** Registers the iOS categories with the hidden-preview text; iOS only, idempotent. */
export async function ensureIosCategories(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const t = translator();
  const options = { previewPlaceholder: t('push.ios.hiddenPreview') };
  for (const category of NOTIFICATION_CATEGORY_VALUES) {
    await Notifications.setNotificationCategoryAsync(category, [], options).catch(() => undefined);
  }
  await Notifications.setNotificationCategoryAsync(
    REMINDER_CATEGORY,
    [
      {
        identifier: REMINDER_ACTIONS.snooze,
        buttonTitle: t('reminder.notificationActions.snooze'),
        options: { opensAppToForeground: false },
      },
      {
        identifier: REMINDER_ACTIONS.done,
        buttonTitle: t('reminder.notificationActions.done'),
        options: { opensAppToForeground: false },
      },
    ],
    options,
  ).catch(() => undefined);
}

let setUp: Promise<void> | null = null;

/** First-launch setup (and again on a language change with `force`). */
export function setupNotificationChannels(force = false): Promise<void> {
  if (setUp === null || force) {
    setUp = Promise.all([ensureAndroidChannels(), ensureIosCategories()]).then(() => undefined);
  }
  return setUp;
}
