/**
 * Briefing item building blocks (IMPLEMENTATION_PLAN T-5.08; JOB-14): section drafts from ranked
 * insights, calendar events and carried items, with provenance copied from the source row. Section
 * membership and order are decided by code; the model (morning only) writes prose around them.
 */
import {
  briefingNotificationDedupeKey,
  type InsightKind,
  routes,
  toDeepLink,
  type Urgency,
} from '@da/domain';
import { clip, copy, type CopyLocale, formatTime } from '../copy.ts';
import type { NotificationBuild } from '../insights/build.ts';
import type {
  BriefingItemInsert,
  BriefingItemRow,
  BriefingRow,
  CalendarEventRow,
  InsightRow,
  ProvenanceColumns,
} from '../intel/types.ts';

export type BriefingSection =
  | 'priorities'
  | 'schedule'
  | 'awaiting_me'
  | 'awaiting_them'
  | 'deadlines'
  | 'life'
  | 'completed'
  | 'carry_over'
  | 'follow_up'
  | 'tomorrow_first'
  | 'midday_delta'
  | 'weekly_highlight'
  | 'weekly_outlook';

export type ItemBadge =
  | 'urgent'
  | 'deadline'
  | 'follow_up'
  | 'meeting'
  | 'today'
  | 'shipment'
  | 'flight'
  | 'reservation'
  | 'payment'
  | 'subscription'
  | 'security'
  | 'personal'
  | 'commitment';

/** One item before its position is assigned. */
export interface ItemDraft extends ProvenanceColumns {
  readonly insightId: string | null;
  readonly entityType: string;
  readonly entityId: string;
  readonly title: string;
  readonly meta: string | null;
  readonly badge: ItemBadge | null;
  readonly kind: InsightKind | 'event' | 'carried';
  readonly urgency: Urgency;
  readonly at: string | null;
}

const LIFE_BADGES: ReadonlySet<string> = new Set(['shipment', 'flight', 'reservation', 'payment', 'subscription']);

export function badgeFor(insight: Pick<InsightRow, 'kind' | 'urgency' | 'flow_card_type'>): ItemBadge | null {
  if (insight.urgency === 'urgent') return 'urgent';
  switch (insight.kind) {
    case 'deadline':
      return 'deadline';
    case 'follow_up':
      return 'follow_up';
    case 'meeting':
    case 'conflict':
    case 'schedule_suggestion':
      return 'meeting';
    case 'commitment':
      return 'commitment';
    case 'security':
      return 'security';
    case 'life_event':
      return insight.flow_card_type !== null && LIFE_BADGES.has(insight.flow_card_type)
        ? (insight.flow_card_type as ItemBadge)
        : 'personal';
    case 'reply_needed':
      return insight.urgency === 'today' ? 'today' : null;
    default:
      return null;
  }
}

export function fromInsight(i: InsightRow, timeZone: string): ItemDraft {
  const at = i.due_at ?? i.event_at;
  return {
    insightId: i.id,
    entityType: i.entity_type,
    entityId: i.entity_id,
    title: clip(i.title, 200),
    meta: i.body === null ? (at === null ? null : formatTime(at, timeZone)) : clip(i.body, 200),
    badge: badgeFor(i),
    kind: i.kind,
    urgency: i.urgency,
    at,
    source_type: i.source_type,
    source_id: i.source_id,
    source_provider: i.source_provider,
    source_timestamp: i.source_timestamp,
    confidence: i.confidence,
    evidence: i.evidence.slice(0, 5),
  };
}

export function fromEvent(
  e: CalendarEventRow,
  timeZone: string,
  locale: CopyLocale,
  meta?: string,
): ItemDraft {
  const place = e.is_online ? copy(locale, 'briefing.generated.online') : (e.location ?? '');
  const time = e.all_day ? '' : `${formatTime(e.start_at, timeZone)}–${formatTime(e.end_at, timeZone)}`;
  return {
    insightId: null,
    entityType: 'calendar_event',
    entityId: e.id,
    title: clip(e.title ?? '', 200) || '—',
    meta: clip(meta ?? [time, place].filter((p) => p !== '').join(' · '), 200) || null,
    badge: 'meeting',
    kind: 'event',
    urgency: 'normal',
    at: e.start_at,
    source_type: e.provider === 'apple_device' || e.provider === 'android_device' ? 'device_calendar_event' : 'calendar_event',
    source_id: e.id,
    source_provider: e.provider,
    source_timestamp: e.updated_at,
    confidence: 1,
    evidence: [],
  };
}

export function fromCarried(item: BriefingItemRow): ItemDraft {
  return {
    insightId: item.insight_id,
    entityType: item.entity_type,
    entityId: item.entity_id,
    title: item.title,
    meta: item.meta,
    badge: (item.badge as ItemBadge | null) ?? null,
    kind: 'carried',
    urgency: 'today',
    at: null,
    source_type: item.source_type,
    source_id: item.source_id,
    source_provider: item.source_provider,
    source_timestamp: item.source_timestamp,
    confidence: item.confidence,
    evidence: item.evidence,
  };
}

/** Assigns positions per section and produces the `briefing_items` rows. */
export function itemRows(
  briefing: Pick<BriefingRow, 'id' | 'user_id'>,
  sections: readonly (readonly [BriefingSection, readonly ItemDraft[]])[],
): BriefingItemInsert[] {
  return sections.flatMap(([section, drafts]) =>
    drafts.map((d, position) => ({
      user_id: briefing.user_id,
      briefing_id: briefing.id,
      section,
      position,
      insight_id: d.insightId,
      entity_type: d.entityType,
      entity_id: d.entityId,
      title: d.title,
      meta: d.meta,
      badge: d.badge,
      source_type: d.source_type,
      source_id: d.source_id,
      source_provider: d.source_provider,
      source_timestamp: d.source_timestamp,
      confidence: d.confidence,
      evidence: d.evidence,
    })),
  );
}

/** Removes drafts whose entity already appears in an earlier section list. */
export function withoutSeen(drafts: readonly ItemDraft[], seen: Set<string>, max: number): ItemDraft[] {
  const out: ItemDraft[] = [];
  for (const d of drafts) {
    const key = `${d.entityType}:${d.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
    if (out.length === max) break;
  }
  return out;
}

/** The briefing push (JOB-18 build); the weekly review uses category `evening` (channel briefings). */
export function briefingNotification(
  briefing: Pick<BriefingRow, 'id' | 'kind'>,
  templateKey: string,
  params: { readonly public: Record<string, string | number>; readonly sensitive: Record<string, string> },
): NotificationBuild {
  const category = briefing.kind === 'weekly' ? 'evening' : briefing.kind;
  return {
    category,
    dedupe_key: briefingNotificationDedupeKey(briefing.id),
    entity: { type: 'briefing', id: briefing.id },
    deeplink: toDeepLink(briefing.kind === 'weekly' ? routes.weekly(briefing.id) : routes.briefing(briefing.id)),
    template_key: templateKey,
    params_public: params.public,
    params_sensitive: params.sensitive,
    urgency: 'normal',
    time_sensitive: false,
    vip: false,
  };
}
