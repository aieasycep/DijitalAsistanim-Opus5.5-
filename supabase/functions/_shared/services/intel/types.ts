/**
 * Row shapes the AI pipeline reads and writes (DATABASE_AND_RLS_PLAN §4.3–§4.5). Only the columns
 * the pipeline uses are listed; there is no body column anywhere (ADR-05).
 */
import type {
  BriefingKind,
  BriefingStatus,
  CommitmentDirection,
  CommitmentStatus,
  DecisionTier,
  FlowCardType,
  InsightAction,
  InsightKind,
  ItemStatus,
  LifeEventType,
  MailCategory,
  Provider,
  SourceType,
  StoredEvidence,
  Urgency,
} from '@da/domain';

export interface Participant {
  readonly email: string;
  readonly name?: string | null;
  readonly contact_id?: string | null;
  readonly role?: string | null;
}

export interface AccountRow {
  readonly id: string;
  readonly user_id: string;
  readonly provider: Provider;
  readonly account_email: string | null;
  readonly status: string;
  readonly data_source_toggles: Readonly<Record<string, boolean>>;
}

export interface MailMessageRow {
  readonly id: string;
  readonly user_id: string;
  readonly connected_account_id: string;
  readonly thread_id: string;
  readonly provider: Provider;
  readonly provider_message_id: string;
  readonly direction: 'inbound' | 'outbound';
  readonly from_email: string;
  readonly from_name: string | null;
  readonly to_emails: readonly string[];
  readonly cc_emails: readonly string[];
  readonly subject: string | null;
  readonly snippet: string | null;
  readonly sent_at: string | null;
  readonly received_at: string;
  readonly labels: readonly string[];
  readonly list_unsubscribe: boolean;
  readonly auto_submitted: boolean;
  readonly precedence_bulk: boolean;
  readonly dkim_pass: boolean | null;
  readonly spf_pass: boolean | null;
  readonly ai_status: string;
  readonly classification: MailCategory | null;
  readonly classification_tier: DecisionTier | null;
  readonly classification_reason: string | null;
  readonly classification_rule_id: string | null;
  readonly classification_confidence: number | null;
  readonly key_points: readonly unknown[];
  readonly ai_summary: string | null;
  readonly analyzed_at: string | null;
  readonly has_attachments: boolean;
  readonly injection_suspected: boolean;
  readonly life_signal: string;
  /** `bytea` content hash in PostgREST hex form (`\x…`): content-hash dedupe. */
  readonly content_hash: string;
  readonly expires_at: string | null;
}

export interface MailThreadRow {
  readonly id: string;
  readonly user_id: string;
  readonly connected_account_id: string;
  readonly provider: Provider;
  readonly subject: string | null;
  readonly participants: readonly Participant[];
  readonly message_count: number;
  readonly last_message_at: string;
  readonly category: MailCategory | null;
  readonly category_tier: DecisionTier | null;
  readonly category_reason: string | null;
  readonly category_rule_id: string | null;
  readonly category_confidence: number | null;
  readonly urgency: Urgency | null;
  readonly reply_state: 'none' | 'awaiting_my_reply' | 'awaiting_their_reply';
  readonly ai_summary: string | null;
  readonly key_points: readonly unknown[];
  readonly deadline_at: string | null;
  readonly deadline_evidence: readonly StoredEvidence[] | null;
  readonly rolling_summary: string | null;
  readonly last_processed_message_id: string | null;
  readonly follow_up_state: string;
  readonly awaiting_since: string | null;
  readonly expects_reply_message_id: string | null;
  readonly is_muted: boolean;
  /** `bytea` in PostgREST hex form (`\x…`) or null. */
  readonly analysis_hash: string | null;
  readonly analyzed_at: string | null;
  readonly prompt_version_id: string | null;
  readonly topic_label: string | null;
  readonly expires_at: string | null;
}

export type MessagePatch = Partial<{
  ai_status: string;
  classification: MailCategory;
  classification_tier: DecisionTier;
  classification_reason: string;
  classification_rule_id: string | null;
  classification_confidence: number;
  ai_summary: string | null;
  key_points: unknown[];
  analyzed_at: string;
  prompt_version_id: string | null;
  injection_suspected: boolean;
  dropped_fields: string[];
  life_signal: string;
}>;

export type ThreadPatch = Partial<{
  category: MailCategory;
  category_tier: DecisionTier;
  category_reason: string;
  category_rule_id: string | null;
  category_learned_preference_id: string | null;
  category_confidence: number;
  urgency: Urgency;
  reply_state: 'none' | 'awaiting_my_reply' | 'awaiting_their_reply';
  ai_summary: string | null;
  key_points: unknown[];
  deadline_at: string | null;
  deadline_evidence: StoredEvidence[] | null;
  analysis_hash: string | null;
  analyzed_at: string;
  prompt_version_id: string | null;
  rolling_summary: string | null;
  last_processed_message_id: string;
  follow_up_state: string;
  awaiting_since: string | null;
  expects_reply_message_id: string | null;
  topic_label: string | null;
}>;

export interface ProvenanceColumns {
  readonly source_type: SourceType;
  readonly source_id: string;
  readonly source_provider: Provider | null;
  readonly source_timestamp: string;
  readonly confidence: number;
  readonly evidence: readonly StoredEvidence[];
}

export interface CommitmentInsert extends ProvenanceColumns {
  readonly user_id: string;
  readonly contact_id: string | null;
  readonly counterparty_name: string | null;
  readonly direction: CommitmentDirection;
  readonly text: string;
  readonly due_at: string | null;
  readonly due_is_date_only: boolean;
  readonly dedupe_key: string;
  readonly origin: 'email_analysis' | 'post_meeting' | 'capture' | 'assistant' | 'user';
}

export interface ApprovalInsert extends ProvenanceColumns {
  readonly user_id: string;
  readonly action_type: 'commitment_create';
  readonly payload: Record<string, unknown>;
  readonly payload_hash: string;
  readonly what: string;
  readonly why: string | null;
  readonly change_summary: string;
  readonly side_effects: readonly { code: string; text: string }[];
  readonly idempotency_key: string;
  readonly origin: 'commitment_detection';
  readonly origin_ref_id: string | null;
  readonly exact_change: Record<string, unknown>;
  readonly destination_label: string | null;
}

export interface MemoryChunkInsert extends ProvenanceColumns {
  readonly user_id: string;
  readonly chunk_kind: string;
  readonly content: string;
  /** Hex of the chunk content hash (32 bytes). */
  readonly content_hash: string;
  readonly contact_ids: readonly string[];
  readonly occurred_at: string;
  readonly page_no: number | null;
  /** The source row's retention expiry (memory is deleted with its source). */
  readonly expires_at: string | null;
}

export interface MemoryChunkRow {
  readonly id: string;
  readonly user_id: string;
  readonly content: string;
  readonly embedding_model: string | null;
}

export interface InsightRow {
  readonly id: string;
  readonly kind: InsightKind;
  readonly status: ItemStatus;
  readonly dedupe_key: string;
  readonly urgency: Urgency;
  readonly title: string;
  readonly body: string | null;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly due_at: string | null;
  readonly event_at: string | null;
  readonly rank_score: number;
  readonly reason_code: string;
  readonly source_type: SourceType;
  readonly source_id: string;
  readonly source_provider: Provider | null;
  readonly source_timestamp: string;
  readonly confidence: number;
  readonly evidence: readonly StoredEvidence[];
  readonly created_at: string;
  readonly suppression_key: string | null;
  readonly flow_card_type: FlowCardType | null;
  readonly done_at: string | null;
}

export interface InsightUpsert extends ProvenanceColumns {
  readonly user_id: string;
  readonly kind: InsightKind;
  readonly urgency: Urgency;
  readonly title: string;
  readonly body: string | null;
  readonly why_important: string | null;
  readonly decision_tier: DecisionTier;
  readonly reason_code: string;
  readonly rule_id: string | null;
  readonly learned_preference_id: string | null;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly flow_card_type: FlowCardType | null;
  readonly actions: readonly InsightAction[];
  readonly due_at: string | null;
  readonly event_at: string | null;
  readonly rank_score: number;
  readonly suppression_key: string | null;
  readonly dedupe_key: string;
}

export interface CommitmentRow {
  readonly id: string;
  readonly contact_id: string | null;
  readonly counterparty_name: string | null;
  readonly direction: CommitmentDirection;
  readonly text: string;
  readonly due_at: string | null;
  readonly due_is_date_only: boolean;
  readonly status: CommitmentStatus;
  readonly completed_at: string | null;
  readonly source_type: SourceType;
  readonly source_id: string;
  readonly source_provider: Provider | null;
  readonly source_timestamp: string;
  readonly confidence: number;
  readonly evidence: readonly StoredEvidence[];
}

export interface LifeEventRow {
  readonly id: string;
  readonly type: LifeEventType;
  readonly title: string;
  readonly status: ItemStatus;
  readonly event_at: string | null;
  readonly due_at: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly amount: string | null;
  readonly currency: string | null;
  readonly tracking_url: string | null;
  readonly suppressed: boolean;
  readonly resolved_at: string | null;
  readonly updated_at: string;
  readonly source_type: SourceType;
  readonly source_id: string;
  readonly source_provider: Provider | null;
  readonly source_timestamp: string;
  readonly confidence: number;
  readonly evidence: readonly StoredEvidence[];
}

export interface CalendarEventRow {
  readonly id: string;
  readonly provider: Provider;
  readonly title: string | null;
  readonly start_at: string;
  readonly end_at: string;
  readonly all_day: boolean;
  readonly status: 'confirmed' | 'tentative' | 'cancelled';
  readonly location: string | null;
  readonly is_online: boolean;
  readonly organizer_self: boolean;
  readonly can_modify: boolean;
  readonly attendees: readonly {
    email?: string;
    name?: string | null;
    response?: string | null;
    self?: boolean;
    contact_id?: string | null;
  }[];
  readonly attendee_count: number;
  readonly description_excerpt: string | null;
  readonly updated_at: string;
}

export interface TaskRow {
  readonly id: string;
  readonly title: string;
  readonly due_date: string | null;
  readonly due_at: string | null;
  readonly status: ItemStatus;
  readonly completed_at: string | null;
  readonly connected_account_id: string | null;
  readonly provider: Provider | null;
  readonly source_type: SourceType | null;
  readonly source_id: string | null;
  readonly created_at: string;
}

export interface ApprovalRow {
  readonly id: string;
  readonly action_type: string;
  readonly status: string;
  readonly what: string;
  readonly approval_expires_at: string;
  readonly executed_at: string | null;
  readonly created_at: string;
}

export interface BriefingRow {
  readonly id: string;
  readonly user_id: string;
  readonly kind: BriefingKind;
  readonly local_date: string;
  readonly time_zone: string;
  readonly scheduled_for: string;
  readonly status: BriefingStatus;
  readonly generated_at: string | null;
  readonly version: number;
  readonly origin: string;
  readonly idempotency_key: string;
  readonly counts: Readonly<Record<string, unknown>>;
  readonly weekly_stats: Readonly<Record<string, unknown>> | null;
  readonly evening_ready_at: string | null;
  readonly provenance?: Readonly<Record<string, unknown>>;
  readonly job_id?: string | null;
}

export type BriefingPatch = Partial<{
  status: BriefingStatus;
  skipped_reason: string | null;
  generated_at: string;
  failed_at: string | null;
  error_code: string | null;
  headline: string | null;
  hero_line: string | null;
  narrative: string | null;
  sections: string[];
  counts: Record<string, unknown>;
  provenance: Record<string, unknown>;
  audio_chapters: unknown[];
  source_freshness: Record<string, unknown>;
  weekly_stats: Record<string, unknown> | null;
  prompt_version_id: string | null;
  ai_cost_usd_micros: number;
  latency_ms: number;
  job_id: string | null;
  origin: string;
}>;

export interface BriefingItemInsert extends ProvenanceColumns {
  readonly user_id: string;
  readonly briefing_id: string;
  readonly section: string;
  readonly position: number;
  readonly insight_id: string | null;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly title: string;
  readonly meta: string | null;
  readonly badge: string | null;
}

export interface BriefingItemRow extends BriefingItemInsert {
  readonly id: string;
  readonly carried_over_to: string | null;
}
