/** Intelligence entities (DATABASE_AND_RLS_PLAN §4.4–4.5). */
import type {
  BriefingKind,
  BriefingStatus,
  DecisionTier,
  FlowCardType,
  InsightKind,
  ItemStatus,
  NotificationCategory,
  NotificationDecision,
  NotificationDetail,
  RuleCondition,
  RuleOutcome,
  Urgency,
} from '../enums.ts';
import type { InsightEntityType } from '../ids.ts';
import type { Provenance } from '../provenance.ts';
import type { IsoDate, IsoDateTime, Owned, Timestamps, Uuid } from './common.ts';

export interface InsightAction {
  readonly action_type: string;
  readonly target_id: Uuid | null;
  readonly requires_approval: boolean;
}

export interface Insight extends Owned, Timestamps, Provenance {
  readonly kind: InsightKind;
  readonly urgency: Urgency;
  readonly status: ItemStatus;
  readonly title: string;
  readonly body: string | null;
  readonly why_important: string | null;
  readonly decision_tier: DecisionTier;
  readonly reason_code: string;
  readonly rule_id: Uuid | null;
  readonly learned_preference_id: Uuid | null;
  readonly entity_type: InsightEntityType;
  readonly entity_id: Uuid;
  readonly flow_card_type: FlowCardType | null;
  /** At most two actions (SREQ-89). */
  readonly actions: readonly InsightAction[];
  readonly due_at: IsoDateTime | null;
  readonly event_at: IsoDateTime | null;
  readonly rank_score: number;
  readonly snoozed_until: IsoDateTime | null;
  readonly dedupe_key: string;
  readonly expires_at: IsoDateTime | null;
}

export type BriefingSkipReason =
  'no_meaningful_delta' | 'disabled' | 'not_entitled' | 'no_sources' | 'weekday_off' | 'flag_off';

export interface Briefing extends Owned, Timestamps {
  readonly kind: BriefingKind;
  readonly local_date: IsoDate;
  readonly time_zone: string;
  readonly scheduled_for: IsoDateTime;
  readonly status: BriefingStatus;
  readonly skipped_reason: BriefingSkipReason | null;
  readonly headline: string | null;
  readonly hero_line: string | null;
  readonly narrative: string | null;
  readonly sections: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
  readonly audio_status: 'none' | 'queued' | 'generating' | 'ready' | 'failed';
  readonly version: number;
  readonly idempotency_key: string;
}

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

export type BriefingBadge =
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

export interface BriefingItem extends Provenance {
  readonly id: Uuid;
  readonly user_id: Uuid;
  readonly briefing_id: Uuid;
  readonly section: BriefingSection;
  readonly position: number;
  readonly insight_id: Uuid | null;
  readonly entity_type: string;
  readonly entity_id: Uuid;
  readonly title: string;
  readonly meta: string | null;
  readonly badge: BriefingBadge | null;
}

/** Condition value per `rule_condition` (`private.valid_rule_condition`). */
export interface RuleConditionValues {
  readonly person: { readonly contact_id: Uuid };
  readonly domain: { readonly domain: string };
  readonly keyword: { readonly keywords: readonly string[] };
  readonly category: { readonly category: string };
  readonly sender: { readonly address: string };
  readonly android_app: { readonly package: string };
}

export interface RuleException {
  readonly condition_type: RuleCondition;
  readonly condition_value: RuleConditionValues[RuleCondition];
}

export interface PriorityRule<C extends RuleCondition = RuleCondition> extends Owned, Timestamps {
  readonly condition_type: C;
  readonly condition_value: RuleConditionValues[C];
  readonly outcome: RuleOutcome;
  readonly search_body: boolean;
  readonly exceptions: readonly RuleException[];
  readonly applies_to: 'mail' | 'android_notification' | 'all';
  readonly enabled: boolean;
  readonly sort_order: number;
  readonly deleted_at: IsoDateTime | null;
}

export type LearnedPriority = 'high' | 'normal' | 'low';

export interface LearnedPreference extends Owned, Timestamps {
  readonly group_key: 'people' | 'topics' | 'timing' | 'tone' | 'categories';
  readonly statement: string;
  readonly target_type: 'contact' | 'sender' | 'domain' | 'category' | 'topic' | 'setting';
  readonly target_ref: string;
  readonly effect: {
    readonly priority?: LearnedPriority;
    readonly reminder_offset_min?: number;
    readonly tone?: string;
    readonly follow_up?: 'mute';
  };
  readonly priority_override: LearnedPriority | null;
  readonly evidence_count: number;
  readonly evidence_summary: string | null;
  readonly enabled: boolean;
  readonly deleted_at: IsoDateTime | null;
}

export type NotificationSuppressionReason =
  | 'quiet_hours'
  | 'category_disabled'
  | 'frequency_cap'
  | 'low_relevance'
  | 'deduplicated'
  | 'no_device'
  | 'not_entitled'
  | 'os_permission_denied'
  | 'smart_filter'
  | 'snoozed'
  | 'late_delivery';

export type AndroidChannelId =
  | 'briefings'
  | 'critical_email'
  | 'meetings'
  | 'deadlines'
  | 'follow_up'
  | 'life_intel'
  | 'approvals'
  | 'reminders'
  | 'account'
  | 'phone_digest';

export type InterruptionLevel = 'passive' | 'active' | 'time_sensitive';

/** Push `data`: exactly `{type, entity_id, deeplink}` (plan §12, M-GL-08). */
export interface PushData {
  readonly type: NotificationCategory | 'reminder';
  readonly entity_id: Uuid | null;
  readonly deeplink: string;
}

export interface NotificationRecord {
  readonly id: Uuid;
  readonly user_id: Uuid;
  readonly category: NotificationCategory;
  readonly decision: NotificationDecision;
  readonly suppression_reason: NotificationSuppressionReason | null;
  readonly dedupe_key: string;
  readonly priority: number;
  readonly detail_mode: NotificationDetail;
  readonly title_rendered: string | null;
  readonly body_rendered: string | null;
  readonly data: PushData;
  readonly entity_type: string | null;
  readonly entity_id: Uuid | null;
  readonly interruption_level: InterruptionLevel;
  readonly android_channel: AndroidChannelId;
  readonly scheduled_for: IsoDateTime;
  readonly sent_at: IsoDateTime | null;
  readonly created_at: IsoDateTime;
}
