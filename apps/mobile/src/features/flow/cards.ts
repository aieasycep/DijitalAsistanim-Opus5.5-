/**
 * The Flow card table (M-FLOW-01 "Primary CTA"): per `card_type` the icon, badge, source label,
 * the one primary action and the card tap target. Actions are derived deterministically from the
 * row (kind, card type, source, dates) and the plan — never from free text.
 */
import type { FlowCardType } from '@da/domain';
import type { BadgeCategory, IconName } from '@da/ui';

import type { FlowItemRow } from './data';

export type PrimaryAction =
  | 'reply'
  | 'calendar'
  | 'open'
  | 'prepare'
  | 'open_event'
  | 'remind'
  | 'followup_draft'
  | 'plan'
  | 'review'
  | 'check';

export type CardTap = 'mail' | 'event' | 'prep' | 'followups' | 'commitment' | 'life' | 'source';

export type BadgeKey =
  | 'urgent'
  | 'today'
  | 'meeting'
  | 'deadline'
  | 'followUp'
  | 'commitment'
  | 'shipment'
  | 'flight'
  | 'reservation'
  | 'payment'
  | 'subscription'
  | 'security';

export type SourceLabelKey =
  | 'gmail'
  | 'outlook'
  | 'googleCalendar'
  | 'outlookCalendar'
  | 'appleCalendar'
  | 'deviceCalendar'
  | 'demo'
  | null;

export interface CardModel {
  readonly icon: IconName;
  readonly badge: { readonly key: BadgeKey; readonly category: BadgeCategory } | null;
  readonly source: SourceLabelKey;
  readonly primary: PrimaryAction;
  readonly tap: CardTap;
  readonly security: boolean;
  /** Instant shown on the card (event start, due time or the source time). */
  readonly at: string;
}

export const LIFE_CARD_TYPES: readonly FlowCardType[] = [
  'shipment',
  'flight',
  'reservation',
  'payment',
  'subscription',
  'security',
];

const LIFE_ICON: Readonly<Record<string, IconName>> = {
  shipment: 'package_2',
  flight: 'flight',
  reservation: 'restaurant',
  payment: 'receipt_long',
  subscription: 'autorenew',
  security: 'shield',
};

function isCalendarSource(sourceType: string): boolean {
  return sourceType === 'calendar_event' || sourceType === 'device_calendar_event';
}

function isEmailSource(sourceType: string): boolean {
  return sourceType === 'email_message' || sourceType === 'email_thread';
}

/** "Gmail" / "Outlook" / "Google Takvim" / … for the card source line. */
export function sourceLabel(item: Pick<FlowItemRow, 'source'>): SourceLabelKey {
  const { provider, source_type: type } = item.source;
  if (isEmailSource(type)) {
    if (provider === 'google') return 'gmail';
    if (provider === 'microsoft') return 'outlook';
    return provider === 'demo' ? 'demo' : null;
  }
  if (isCalendarSource(type)) {
    if (provider === 'google') return 'googleCalendar';
    if (provider === 'microsoft') return 'outlookCalendar';
    if (provider === 'apple_device') return 'appleCalendar';
    if (provider === 'android_device') return 'deviceCalendar';
    return provider === 'demo' ? 'demo' : null;
  }
  return null;
}

export function cardModel(
  item: FlowItemRow,
  isPro: boolean,
  isToday: (at: string) => boolean,
): CardModel {
  const at = item.event_at ?? item.due_at ?? item.source.source_timestamp ?? item.created_at;
  const source = sourceLabel(item);
  switch (item.card_type) {
    case 'email': {
      const badge =
        item.urgency === 'urgent'
          ? ({ key: 'urgent', category: 'urgent' } as const)
          : item.urgency === 'today'
            ? ({ key: 'today', category: 'neutral' } as const)
            : null;
      const primary: PrimaryAction =
        item.kind === 'reply_needed' ? 'reply' : item.due_at !== null ? 'calendar' : 'open';
      return { icon: 'mail', badge, source, primary, tap: 'mail', security: false, at };
    }
    case 'meeting':
      return {
        icon: 'event',
        badge: isToday(at)
          ? { key: 'today', category: 'neutral' }
          : { key: 'meeting', category: 'neutral' },
        source,
        primary: isPro ? 'prepare' : 'open_event',
        tap: isPro ? 'prep' : 'event',
        security: false,
        at,
      };
    case 'deadline': {
      const type = item.source.source_type;
      return {
        icon: isEmailSource(type) ? 'mail' : isCalendarSource(type) ? 'event' : 'description',
        badge: { key: 'deadline', category: 'deadline' },
        source,
        primary: isCalendarSource(type) || item.due_at === null ? 'remind' : 'calendar',
        tap: isEmailSource(type) ? 'mail' : isCalendarSource(type) ? 'event' : 'source',
        security: false,
        at,
      };
    }
    case 'follow_up':
      return {
        icon: 'schedule_send',
        badge: { key: 'followUp', category: 'neutral' },
        source,
        primary: 'followup_draft',
        tap: 'followups',
        security: false,
        at,
      };
    case 'commitment':
      return {
        icon: 'handshake',
        badge: { key: 'commitment', category: 'neutral' },
        source,
        primary: 'plan',
        tap: 'commitment',
        security: false,
        at,
      };
    case 'security':
      return {
        icon: 'shield',
        badge: { key: 'security', category: 'security' },
        source,
        primary: 'check',
        tap: 'life',
        security: true,
        at,
      };
    case 'payment':
      return {
        icon: 'receipt_long',
        badge: { key: 'payment', category: 'neutral' },
        source,
        primary: item.due_at === null ? 'review' : 'remind',
        tap: 'life',
        security: false,
        at,
      };
    case 'shipment':
    case 'flight':
    case 'reservation':
    case 'subscription':
      return {
        icon: LIFE_ICON[item.card_type] ?? 'description',
        badge: { key: item.card_type, category: 'neutral' },
        source,
        primary: 'review',
        tap: 'life',
        security: false,
        at,
      };
  }
}

/** The id of the entity a card opens (life event, commitment, event, thread). */
export function entityId(item: FlowItemRow, type: string): string | null {
  if (item.entity_type === type && item.entity_id !== null) return item.entity_id;
  if (item.source.source_type === type && item.source.source_id !== null) {
    return item.source.source_id;
  }
  return null;
}
