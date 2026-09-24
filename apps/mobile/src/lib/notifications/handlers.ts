/**
 * Notification routing (T-8.24; SCREEN_AND_FLOW_MAP M-GL-08 and Part 4 §12, INTEGRATION_PLAN
 * §9.8). The payload carries only `{type, entity_id, deeplink}` (plus the server's `v` and `nid`);
 * nothing else from `data` is read, and content never is.
 * - **Route.** `deeplink` goes through the M-GL-07 allow-list (`resolveIncomingLink`); when it is
 *   missing or rejected, the route comes from `type` + `entity_id` (`@da/domain`
 *   `routeForNotification`), and an unknown type opens Today. A route this build has no screen for
 *   opens Today. Opening a notification only navigates; it never performs an action.
 * - **Guards.** While the app guard is closed (signed out, onboarding, session still restoring on a
 *   cold start) the route is stored as the pending link and replayed by the entry resolver.
 * - **Cold / warm start.** Taps arrive through `addNotificationResponseReceivedListener` and, on a
 *   cold start, `getLastNotificationResponse()`; both are deduped by `request.identifier`.
 * - **Foreground.** No system banner (`setNotificationHandler`): an in-app toast shows the
 *   server-rendered title with "Aç", and the related queries are invalidated.
 * - **Open tracking.** `notification_opened {category, app_state}` and the `opened_at` write
 *   (PostgREST, column grant), queued offline.
 * - **Reminder actions.** `da_reminder` "1 saat ertele" moves the device notification one hour
 *   later; "Tamamlandı" dismisses it. Neither opens the app.
 */
import { qk } from '@da/api-client';
import { NOTIFICATION_CATEGORY_VALUES, type NotificationCategory } from '@da/domain';
import { routeForNotification, type PushType } from '@da/domain/deeplinks';
import type { QueryKey } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { translator } from '../../i18n/translate';
import { showToast } from '../../providers/ToastHost';
import {
  defaultLinkOptions,
  isScreenAvailable,
  resolveIncomingLink,
  savePendingLink,
  type ResolveLinkOptions,
} from '../deeplinks';
import { track } from '../events';
import { queueMutation, runOrQueue } from '../offline/mutations';
import { getQueryClient } from '../query/client';
import { accessForPattern, guardSnapshot, TODAY_ROUTE } from '../router-guards';
import { installStorage } from '../storage';
import { REMINDER_ACTIONS, REMINDER_CHANNEL } from './channels';

const PUSH_TYPES: ReadonlySet<string> = new Set([...NOTIFICATION_CATEGORY_VALUES, 'reminder']);

export interface PushPayload {
  readonly type: PushType | null;
  readonly entityId: string | null;
  readonly deeplink: string | null;
}

/** Reads the three routing keys; anything else in `data` is ignored. */
export function parsePushPayload(data: unknown): PushPayload {
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const type = typeof record.type === 'string' && PUSH_TYPES.has(record.type) ? record.type : null;
  const entity = record.entity_id;
  const deeplink = record.deeplink;
  return {
    type: type as PushType | null,
    entityId: typeof entity === 'string' && entity !== '' ? entity : null,
    deeplink: typeof deeplink === 'string' && deeplink !== '' ? deeplink : null,
  };
}

export interface PushRoute {
  readonly href: string;
  readonly pattern: string;
}

/** Where a tap on this payload goes (allow-listed deep link, else the type/entity fallback). */
export function routeForPush(
  payload: PushPayload,
  options: ResolveLinkOptions = defaultLinkOptions(),
): PushRoute {
  const accept = (url: string): PushRoute | null => {
    const link = resolveIncomingLink(url, options);
    if (link.kind !== 'route' || link.href === '/') return null;
    return isScreenAvailable(link.href, options.allowDemo)
      ? { href: link.href, pattern: link.pattern }
      : null;
  };
  const fromLink = payload.deeplink === null ? null : accept(payload.deeplink);
  if (fromLink !== null) return fromLink;
  const fallback =
    payload.type === null ? null : accept(routeForNotification(payload.type, payload.entityId));
  return fallback ?? { href: TODAY_ROUTE, pattern: TODAY_ROUTE };
}

/** Queries refreshed when a push of this type arrives in the foreground. */
export function invalidationFor(type: PushType | null): readonly QueryKey[] {
  switch (type) {
    case 'morning':
    case 'midday':
    case 'evening':
      return [qk.today.all, qk.briefings.all, qk.weekly.all];
    case 'critical_email':
    case 'deadline':
    case 'follow_up':
      return [qk.today.all, qk.flow.all, qk.mail.all, qk.followups.all, qk.waiting.all];
    case 'meeting':
      return [qk.today.all, qk.plan.all, qk.meetings.all];
    case 'life_intel':
      return [qk.today.all, qk.life.all, qk.flow.all];
    case 'approval':
      return [qk.today.all, qk.approvals.all];
    case 'account':
      return [qk.me.bootstrap(), qk.integrations.all];
    case 'reminder':
      return [qk.reminders.all];
    case null:
      return [qk.today.all];
  }
}

function isCategory(type: PushType | null): type is NotificationCategory {
  return type !== null && type !== 'reminder';
}

export type OpenedFrom = 'cold' | 'background' | 'foreground';

/** Navigates to the route, or stores it while the app guard is closed. */
export function openPushRoute(route: PushRoute): void {
  const guarded = accessForPattern(route.pattern) === 'app' && !guardSnapshot().app;
  track('deep_link_opened', {
    route_pattern: route.pattern,
    source: 'notification',
    guarded,
  });
  if (guarded) {
    savePendingLink(route.href);
    return;
  }
  router.push(route.href);
}

function recordOpened(payload: PushPayload, from: OpenedFrom, now: Date): void {
  track('notification_opened', {
    ...(isCategory(payload.type) ? { category: payload.type } : {}),
    app_state: from,
  });
  if (!isCategory(payload.type) || payload.entityId === null) return;
  const stamp = { category: payload.type, entityId: payload.entityId, openedAt: now.toISOString() };
  // On a cold start the session is still being restored: the stamp waits in the queue.
  if (from === 'cold') queueMutation('notification_opened', stamp);
  else void runOrQueue('notification_opened', stamp).catch(() => undefined);
}

/** A tapped notification (or the "Aç" of the foreground toast). */
export function openNotification(payload: PushPayload, from: OpenedFrom, now = new Date()): void {
  recordOpened(payload, from, now);
  openPushRoute(routeForPush(payload));
}

const LAST_HANDLED_KEY = 'notifications.last_handled_id';

function alreadyHandled(identifier: string): boolean {
  const store = installStorage();
  if (store.getString(LAST_HANDLED_KEY) === identifier) return true;
  store.set(LAST_HANDLED_KEY, identifier);
  return false;
}

async function snoozeReminder(request: Notifications.NotificationRequest): Promise<void> {
  const at = new Date(Date.now() + 60 * 60 * 1000);
  await Notifications.scheduleNotificationAsync({
    identifier: request.identifier,
    content: {
      title: request.content.title,
      body: request.content.body,
      data: request.content.data,
      categoryIdentifier: request.content.categoryIdentifier ?? undefined,
      interruptionLevel: 'timeSensitive',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
      ...(Platform.OS === 'android' ? { channelId: REMINDER_CHANNEL } : {}),
    },
  });
}

/** Handles one notification response; returns false for a duplicate delivery. */
export function handleNotificationResponse(
  response: Notifications.NotificationResponse,
  from: Exclude<OpenedFrom, 'foreground'>,
): boolean {
  const request = response.notification.request;
  if (alreadyHandled(request.identifier)) return false;
  if (response.actionIdentifier === REMINDER_ACTIONS.snooze) {
    void snoozeReminder(request).catch(() => undefined);
    return true;
  }
  if (response.actionIdentifier === REMINDER_ACTIONS.done) {
    void Notifications.dismissNotificationAsync(request.identifier).catch(() => undefined);
    return true;
  }
  openNotification(parsePushPayload(request.content.data), from);
  return true;
}

/** Foreground delivery: in-app toast with "Aç" plus the related query refresh. */
export function presentForegroundNotification(notification: Notifications.Notification): void {
  const payload = parsePushPayload(notification.request.content.data);
  const client = getQueryClient();
  for (const queryKey of invalidationFor(payload.type)) void client.invalidateQueries({ queryKey });
  const { title, body } = notification.request.content;
  const message = payload.type === 'reminder' ? (body ?? title) : (title ?? body);
  if (message === null || message === '') return;
  showToast({
    message,
    kind: 'neutral',
    icon: 'notifications',
    action: {
      label: translator()('push.foreground.open'),
      onPress: () => {
        openNotification(payload, 'foreground');
      },
    },
  });
}

/** No system banner in the foreground (M-GL-01); the app shows its own toast instead. */
export function installForegroundBehavior(): void {
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: false,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
  });
}

/** Listeners for taps and foreground deliveries, plus the cold-start response. */
export function bindNotificationHandlers(): () => void {
  installForegroundBehavior();
  const cold = Notifications.getLastNotificationResponse();
  if (cold !== null) handleNotificationResponse(cold, 'cold');
  const responses = Notifications.addNotificationResponseReceivedListener((response) => {
    handleNotificationResponse(response, 'background');
  });
  const received = Notifications.addNotificationReceivedListener(presentForegroundNotification);
  return () => {
    responses.remove();
    received.remove();
  };
}

/** Test seam: forget the last handled notification. */
export function resetNotificationHandlersForTests(): void {
  installStorage().remove(LAST_HANDLED_KEY);
}
