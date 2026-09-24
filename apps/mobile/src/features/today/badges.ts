/**
 * Card badges by insight kind (SCREEN_AND_FLOW_MAP Annex M-TD-01-B/C, Kural 1): only "ACİL",
 * "SON TARİH" and "GÜVENLİK" carry colour; every other badge is neutral. The same mapping is used on
 * Today, the Aha findings and briefing rows.
 */
import type { InsightKind, Urgency } from '@da/domain/enums';
import type { BadgeCategory } from '@da/ui';

export type BadgeKey =
  | 'urgent'
  | 'today'
  | 'meeting'
  | 'deadline'
  | 'followUp'
  | 'commitment'
  | 'personal'
  | 'security'
  | 'calendar'
  | 'pending';

export interface BadgeSpec {
  readonly key: BadgeKey;
  readonly category: BadgeCategory;
}

export function badgeOf(kind: InsightKind, urgency: Urgency | null = null): BadgeSpec {
  switch (kind) {
    case 'reply_needed':
      return urgency === 'urgent'
        ? { key: 'urgent', category: 'urgent' }
        : { key: 'today', category: 'neutral' };
    case 'meeting':
      return { key: 'meeting', category: 'neutral' };
    case 'deadline':
      return { key: 'deadline', category: 'deadline' };
    case 'follow_up':
      return { key: 'followUp', category: 'neutral' };
    case 'commitment':
      return { key: 'commitment', category: 'neutral' };
    case 'life_event':
      return { key: 'personal', category: 'neutral' };
    case 'security':
      return { key: 'security', category: 'security' };
    case 'conflict':
    case 'schedule_suggestion':
      return { key: 'calendar', category: 'neutral' };
    case 'approval_pending':
      return { key: 'pending', category: 'neutral' };
    case 'digest':
      return { key: 'today', category: 'neutral' };
  }
}
