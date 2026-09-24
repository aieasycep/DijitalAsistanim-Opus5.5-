/**
 * Android channels (R-12) and iOS interruption levels (ADR-10, INTEGRATION_PLAN §9.3–9.4).
 * Channel IDs are permanent once shipped; every channel uses `lockscreenVisibility = PRIVATE`,
 * including `account`, and is created at first launch before the permission prompt.
 */
import type { NotificationCategory, Urgency } from '../enums.ts';
import type { AndroidChannelId, InterruptionLevel } from '../entities/intelligence.ts';

export type ChannelImportance = 'high' | 'default' | 'low';

export interface AndroidChannelSpec {
  readonly id: AndroidChannelId;
  readonly importance: ChannelImportance;
  /** i18n key of the localised channel name (`notifications.channel.<id>`). */
  readonly nameKey: string;
  readonly lockscreenVisibility: 'private';
}

const spec = (id: AndroidChannelId, importance: ChannelImportance): AndroidChannelSpec => ({
  id,
  importance,
  nameKey: `notifications.channel.${id}`,
  lockscreenVisibility: 'private',
});

/** Exactly the R-12 set, in creation order. */
export const ANDROID_CHANNELS: readonly AndroidChannelSpec[] = [
  spec('briefings', 'default'),
  spec('critical_email', 'high'),
  spec('meetings', 'high'),
  spec('deadlines', 'high'),
  spec('follow_up', 'default'),
  spec('life_intel', 'default'),
  spec('approvals', 'default'),
  spec('reminders', 'high'),
  spec('account', 'low'),
  spec('phone_digest', 'low'),
];

/** Push kinds: the notification categories plus device-local smart reminders. */
export type PushKind = NotificationCategory | 'reminder';

const CATEGORY_CHANNEL: Readonly<Record<NotificationCategory, AndroidChannelId>> = {
  morning: 'briefings',
  midday: 'briefings',
  evening: 'briefings',
  critical_email: 'critical_email',
  meeting: 'meetings',
  deadline: 'deadlines',
  follow_up: 'follow_up',
  life_intel: 'life_intel',
  approval: 'approvals',
  account: 'account',
};

/**
 * Channel of a push. The weekly review uses category `evening` → `briefings`; smart reminders use
 * `reminders`; `life_intel` digests sourced from Android NI signals use `phone_digest`.
 */
export function androidChannelFor(
  kind: PushKind,
  opts: { readonly fromAndroidNotificationSignal?: boolean } = {},
): AndroidChannelId {
  if (kind === 'reminder') return 'reminders';
  if (kind === 'life_intel' && opts.fromAndroidNotificationSignal) return 'phone_digest';
  return CATEGORY_CHANNEL[kind];
}

export interface InterruptionInput {
  readonly kind: PushKind;
  /** Minutes until the meeting starts (meeting pushes). */
  readonly minutesToStart?: number | null;
  /** The approval expires within 2 h (approval pushes). */
  readonly approvalExpiringSoon?: boolean;
  /** Flight gate change or delay (life_intel). */
  readonly flightChange?: boolean;
}

/**
 * iOS interruption level. `time_sensitive` only for a meeting ≤10 min away, an expiring approval
 * and a user smart reminder (UT-NTF-14); `critical` is never used.
 */
export function interruptionLevelFor(input: InterruptionInput): InterruptionLevel {
  switch (input.kind) {
    case 'reminder':
      return 'time_sensitive';
    case 'meeting':
      return input.minutesToStart !== undefined &&
        input.minutesToStart !== null &&
        input.minutesToStart <= 10
        ? 'time_sensitive'
        : 'active';
    case 'approval':
      return input.approvalExpiringSoon ? 'time_sensitive' : 'active';
    case 'morning':
    case 'critical_email':
    case 'deadline':
    case 'account':
      return 'active';
    case 'life_intel':
      return input.flightChange ? 'active' : 'passive';
    case 'midday':
    case 'evening':
    case 'follow_up':
      return 'passive';
  }
}

/** iOS `relevanceScore` (summary ordering). */
export function relevanceScoreFor(kind: PushKind, urgency: Urgency): number {
  switch (kind) {
    case 'critical_email':
      return urgency === 'urgent' ? 0.9 : 0.7;
    case 'meeting':
    case 'reminder':
      return 0.8;
    case 'deadline':
      return urgency === 'urgent' ? 0.8 : 0.6;
    case 'morning':
    case 'approval':
      return 0.6;
    case 'account':
      return 0.5;
    case 'follow_up':
    case 'life_intel':
      return 0.4;
    case 'midday':
    case 'evening':
      return 0.3;
  }
}

/** Expo message priority: `high` for time-sensitive, meeting and critical mail. */
export function expoPriorityFor(kind: PushKind, level: InterruptionLevel): 'high' | 'normal' {
  return level === 'time_sensitive' || kind === 'meeting' || kind === 'critical_email'
    ? 'high'
    : 'normal';
}

/** Expo `ttl` in seconds: meeting 1,800; briefings 21,600; others 86,400. */
export function ttlSecondsFor(kind: PushKind): number {
  if (kind === 'meeting') return 1800;
  if (kind === 'morning' || kind === 'midday' || kind === 'evening') return 21600;
  return 86400;
}
