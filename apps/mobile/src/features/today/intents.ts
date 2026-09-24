/**
 * Card intent actions on Today (Annex M-TD-01-B), added with the screens they open: "Yanıtla" →
 * `mail/{messageId}/reply` (T-8.11, shown once that screen exists), "Hatırlat" / "Yarın Hatırlat"
 * → the Smart Reminder sheet (`reminders/new`, T-8.18) and "Hazırlan" → `meeting/{eventId}/prep`
 * (T-8.14, Pro). A control is rendered only when its screen exists in this build (R-24).
 */
import type { CardAction } from '@da/ui';

import { isScreenAvailable } from '../../lib/deeplinks';
import type { TodayPriority } from './data';

export interface IntentLabels {
  readonly reply: string;
  readonly remind: string;
  readonly remindTomorrow: string;
  readonly prepare: string;
  readonly push: (href: string, action: 'reply' | 'remind' | 'remind_tomorrow' | 'prepare') => void;
}

function messageIdOf(item: TodayPriority): string | null {
  if (item.entity_type === 'email_message' && item.entity_id !== null) return item.entity_id;
  if (item.source?.source_type === 'email_message' && item.source.source_id !== null) {
    return item.source.source_id;
  }
  return null;
}

function eventIdOf(item: TodayPriority): string | null {
  if (item.entity_type === 'calendar_event' && item.entity_id !== null) return item.entity_id;
  return null;
}

/** The reminder sheet route for a Today card (`targetType=insight`). */
export function reminderHref(item: TodayPriority, preset?: 'tomorrow_morning'): string {
  const query = new URLSearchParams({
    targetType: 'insight',
    targetId: item.id,
    title: item.title,
    origin:
      item.kind === 'follow_up' ? 'followup' : item.kind === 'deadline' ? 'deadline' : 'today',
  });
  const anchor = item.due_at ?? item.event_at;
  if (anchor !== null) query.set('anchorAt', anchor);
  if (preset !== undefined) query.set('preset', preset);
  return `/reminders/new?${query.toString()}`;
}

export function cardIntentActions(item: TodayPriority, labels: IntentLabels): CardAction[] {
  const actions: CardAction[] = [];
  const messageId = messageIdOf(item);
  const replyRoute = messageId === null ? null : `/mail/${messageId}/reply`;
  const eventId = eventIdOf(item);
  const prepRoute = eventId === null ? null : `/meeting/${eventId}/prep`;
  const remindAvailable = isScreenAvailable('/reminders/new');
  switch (item.kind) {
    case 'reply_needed':
      if (replyRoute !== null && isScreenAvailable(replyRoute)) {
        actions.push({
          key: 'reply',
          label: labels.reply,
          emphasis: 'primary',
          onPress: () => {
            labels.push(replyRoute, 'reply');
          },
        });
      }
      if (remindAvailable) {
        actions.push({
          key: 'remind',
          label: labels.remind,
          emphasis: 'secondary',
          onPress: () => {
            labels.push(reminderHref(item), 'remind');
          },
        });
      }
      break;
    case 'follow_up':
      if (remindAvailable) {
        actions.push({
          key: 'remind_tomorrow',
          label: labels.remindTomorrow,
          emphasis: 'secondary',
          onPress: () => {
            labels.push(reminderHref(item, 'tomorrow_morning'), 'remind_tomorrow');
          },
        });
      }
      break;
    case 'meeting':
      if (prepRoute !== null && isScreenAvailable(prepRoute)) {
        actions.push({
          key: 'prepare',
          label: labels.prepare,
          emphasis: 'primary',
          onPress: () => {
            labels.push(prepRoute, 'prepare');
          },
        });
      }
      break;
    case 'deadline':
    case 'life_event':
    case 'commitment':
      if (remindAvailable) {
        actions.push({
          key: 'remind',
          label: labels.remind,
          emphasis: 'secondary',
          onPress: () => {
            labels.push(reminderHref(item), 'remind');
          },
        });
      }
      break;
    default:
      break;
  }
  return actions;
}
