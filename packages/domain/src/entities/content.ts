/**
 * Content entities derived from provider data (DATABASE_AND_RLS_PLAN §4.3). There is no raw mail
 * body anywhere (ADR-05): only headers, a ≤200-char snippet and AI-derived fields.
 */
import type {
  CaptureKind,
  CaptureStatus,
  CommitmentDirection,
  CommitmentStatus,
  DecisionTier,
  ExtractedEntityType,
  ItemStatus,
  LifeEventType,
  MailCategory,
  Provider,
  ReminderStatus,
  Urgency,
  VipRelationship,
} from '../enums.ts';
import type { Provenance, StoredEvidence } from '../provenance.ts';
import type { IsoDate, IsoDateTime, Owned, Timestamps, Uuid } from './common.ts';

export type ReplyState = 'none' | 'awaiting_my_reply' | 'awaiting_their_reply';
export type FollowUpState = 'none' | 'waiting' | 'nudge_due' | 'nudged' | 'muted' | 'resolved';

export interface ThreadParticipant {
  readonly email: string;
  readonly name: string | null;
  readonly contact_id: Uuid | null;
  readonly role: 'from' | 'to' | 'cc';
}

export interface EmailThread extends Owned, Timestamps {
  readonly connected_account_id: Uuid;
  readonly provider: Provider;
  readonly provider_thread_id: string;
  readonly subject: string | null;
  readonly participants: readonly ThreadParticipant[];
  readonly message_count: number;
  readonly last_message_at: IsoDateTime;
  readonly last_inbound_at: IsoDateTime | null;
  readonly last_outbound_at: IsoDateTime | null;
  readonly has_unread: boolean;
  readonly category: MailCategory | null;
  readonly category_tier: DecisionTier | null;
  readonly category_reason: string | null;
  readonly category_rule_id: Uuid | null;
  readonly category_confidence: number | null;
  readonly urgency: Urgency | null;
  readonly reply_state: ReplyState;
  readonly ai_summary: string | null;
  readonly deadline_at: IsoDateTime | null;
  readonly deadline_evidence: readonly StoredEvidence[] | null;
  readonly labels: readonly string[];
  readonly follow_up_state: FollowUpState;
  readonly awaiting_since: IsoDateTime | null;
  readonly expects_reply_message_id: Uuid | null;
  readonly is_muted: boolean;
  readonly expires_at: IsoDateTime | null;
}

export interface EmailMessage extends Owned, Timestamps {
  readonly connected_account_id: Uuid;
  readonly thread_id: Uuid;
  readonly provider: Provider;
  readonly provider_message_id: string;
  readonly internet_message_id: string | null;
  readonly direction: 'inbound' | 'outbound';
  readonly from_email: string;
  readonly from_name: string | null;
  readonly to_emails: readonly string[];
  readonly cc_emails: readonly string[];
  readonly subject: string | null;
  /** ≤200 chars; never the body. */
  readonly snippet: string | null;
  readonly sent_at: IsoDateTime | null;
  readonly received_at: IsoDateTime;
  readonly is_read: boolean;
  readonly labels: readonly string[];
  readonly has_attachments: boolean;
  readonly list_unsubscribe: boolean;
  readonly auto_submitted: boolean;
  readonly precedence_bulk: boolean;
  readonly dkim_pass: boolean | null;
  readonly spf_pass: boolean | null;
  readonly classification: MailCategory | null;
  readonly classification_tier: DecisionTier | null;
  readonly classification_reason: string | null;
  readonly classification_rule_id: Uuid | null;
  readonly classification_confidence: number | null;
  readonly injection_suspected: boolean;
  readonly dropped_fields: readonly string[];
}

export type AttendeeResponse = 'accepted' | 'declined' | 'tentative' | 'needs_action';

export interface CalendarAttendee {
  readonly email: string;
  readonly name: string | null;
  readonly response: AttendeeResponse | null;
  readonly self: boolean;
  readonly contact_id: Uuid | null;
}

export interface CalendarEvent extends Owned, Timestamps {
  readonly connected_account_id: Uuid;
  readonly calendar_id: Uuid;
  readonly provider: Provider;
  readonly provider_event_id: string;
  readonly title: string | null;
  readonly location: string | null;
  readonly is_online: boolean;
  readonly conference_url: string | null;
  readonly start_at: IsoDateTime;
  readonly end_at: IsoDateTime;
  readonly all_day: boolean;
  readonly status: 'confirmed' | 'tentative' | 'cancelled';
  readonly organizer_email: string | null;
  readonly organizer_self: boolean;
  readonly can_modify: boolean;
  readonly attendees: readonly CalendarAttendee[];
  readonly attendee_count: number;
  readonly origin: 'provider_sync' | 'device_snapshot' | 'demo' | 'approval_write';
}

export interface Task extends Owned, Timestamps {
  readonly connected_account_id: Uuid | null;
  readonly provider: Provider | null;
  readonly title: string;
  readonly due_date: IsoDate | null;
  readonly due_at: IsoDateTime | null;
  readonly status: ItemStatus;
  readonly completed_at: IsoDateTime | null;
  readonly origin: 'provider_sync' | 'user' | 'ai_proposal' | 'capture' | 'approval_write';
}

export interface Contact extends Owned, Timestamps {
  readonly display_name: string;
  readonly primary_email: string | null;
  readonly emails: readonly string[];
  readonly organization: string | null;
  readonly last_contact_at: IsoDateTime | null;
  readonly origin: 'mail' | 'calendar' | 'device' | 'manual' | 'capture';
}

export interface VipPerson extends Owned, Timestamps {
  readonly contact_id: Uuid;
  readonly relationship: VipRelationship;
  readonly always_notify: boolean;
  /** Per-VIP override of the quiet-hours bypass (R-13). */
  readonly bypass_quiet_hours: boolean;
  readonly origin: 'user' | 'suggestion' | 'onboarding';
}

export interface Commitment extends Owned, Timestamps, Provenance {
  readonly contact_id: Uuid | null;
  readonly counterparty_name: string | null;
  readonly direction: CommitmentDirection;
  readonly text: string;
  readonly due_at: IsoDateTime | null;
  readonly due_is_date_only: boolean;
  readonly status: CommitmentStatus;
  readonly snoozed_until: IsoDateTime | null;
  readonly completed_at: IsoDateTime | null;
  readonly cancelled_at: IsoDateTime | null;
  readonly dedupe_key: string;
  readonly origin: 'email_analysis' | 'post_meeting' | 'capture' | 'assistant' | 'user';
  readonly approval_action_id: Uuid | null;
}

export type ReminderPreset =
  'before_30m' | 'before_1h' | 'this_evening' | 'tomorrow_morning' | 'smart' | 'custom';

export type ReminderOrigin =
  | 'email_detail'
  | 'today'
  | 'deadline'
  | 'meeting'
  | 'commitment'
  | 'life_event'
  | 'followup'
  | 'assistant'
  | 'plan';

export interface ReminderDestination {
  readonly kind: 'in_app' | 'google_tasks' | 'microsoft_todo' | 'apple_reminders';
  readonly account_id?: Uuid;
  readonly list_id?: string;
}

export interface Reminder extends Owned, Timestamps {
  readonly title: string;
  readonly note: string | null;
  readonly remind_at: IsoDateTime;
  readonly preset: ReminderPreset;
  readonly anchor_at: IsoDateTime | null;
  readonly destination: ReminderDestination;
  readonly origin: ReminderOrigin;
  readonly resolution_reason: string | null;
  readonly channel: 'push' | 'local' | 'provider_task' | 'apple_reminders';
  readonly status: ReminderStatus;
  readonly target_type:
    | 'email_thread'
    | 'insight'
    | 'commitment'
    | 'life_event'
    | 'calendar_event'
    | 'capture'
    | 'task'
    | 'follow_up'
    | null;
  readonly target_id: Uuid | null;
  readonly idempotency_key: string;
  readonly approval_action_id: Uuid | null;
}

/** Typed `life_events.payload` per type. */
export interface LifeEventPayloads {
  readonly shipment: {
    readonly merchant: string | null;
    readonly carrier: string | null;
    readonly tracking_no: string | null;
    readonly eta_window: string | null;
  };
  readonly flight: {
    readonly carrier: string | null;
    readonly flight_no: string;
    readonly from: string | null;
    readonly to: string | null;
    readonly depart_at: IsoDateTime | null;
    readonly gate?: string;
    readonly checkin_url?: string;
  };
  readonly reservation: {
    readonly venue: string;
    readonly at: IsoDateTime | null;
    readonly party_size?: number;
    readonly confirm_url?: string;
    readonly address?: string;
  };
  readonly payment: { readonly payee: string; readonly account_ref_masked?: string };
  readonly subscription: {
    readonly service: string;
    readonly period?: string;
    readonly manage_url?: string;
  };
  readonly security: {
    readonly provider: string;
    readonly event: string;
    readonly device?: string;
    readonly location?: string;
  };
}

export interface LifeEvent<T extends LifeEventType = LifeEventType>
  extends Owned, Timestamps, Provenance {
  readonly type: T;
  readonly title: string;
  readonly status: ItemStatus;
  readonly event_at: IsoDateTime | null;
  readonly due_at: IsoDateTime | null;
  readonly payload: LifeEventPayloads[T];
  /**
   * `numeric(14,2)` as an exact decimal string ("1842.50"); written from integer minor units with
   * `minorToDecimalString()`, never from floats. Null when not grounded.
   */
  readonly amount: string | null;
  readonly currency: string | null;
  readonly amount_evidence: readonly StoredEvidence[] | null;
  readonly dedupe_key: string;
  readonly suppressed: boolean;
}

export interface ExtractedCaptureItem {
  readonly entity_type: ExtractedEntityType;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly evidence: readonly StoredEvidence[];
  readonly confidence: number;
}

export interface Capture extends Owned, Timestamps {
  readonly kind: CaptureKind;
  readonly status: CaptureStatus;
  readonly mime_type: string | null;
  readonly size_bytes: number | null;
  readonly extracted: readonly ExtractedCaptureItem[];
  readonly extracted_types: readonly ExtractedEntityType[];
  readonly primary_type: ExtractedEntityType | null;
  readonly idempotency_key: string;
}

export type MemoryChunkKind =
  | 'email_summary'
  | 'thread_summary'
  | 'key_point'
  | 'event'
  | 'commitment'
  | 'life_event'
  | 'capture_extract'
  | 'meeting_note'
  | 'person_fact'
  | 'briefing_fact';

export interface MemoryChunk extends Owned, Timestamps, Provenance {
  readonly chunk_kind: MemoryChunkKind;
  /** Derived facts only (≤2000 chars), never full bodies. */
  readonly content: string;
  readonly embedding_model: string | null;
  readonly contact_ids: readonly Uuid[];
  readonly occurred_at: IsoDateTime;
  readonly expires_at: IsoDateTime | null;
}
