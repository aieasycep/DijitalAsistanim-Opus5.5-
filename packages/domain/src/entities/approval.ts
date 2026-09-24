/**
 * Approval actions and their typed payloads (API_CONTRACTS §5.1; the zod schemas in
 * `packages/validation` validate these shapes on the wire).
 */
import type {
  ApprovalActionType,
  ApprovalStatus,
  ApprovalVia,
  CommitmentDirection,
  SourceType,
} from '../enums.ts';
import type { Provenance } from '../provenance.ts';
import type { IsoDate, IsoDateTime, Owned, Timestamps, Uuid } from './common.ts';
import type { ReminderPreset } from './content.ts';

export interface Recipient {
  readonly email: string;
  readonly name?: string;
}

export type EventTime =
  | {
      readonly kind: 'timed';
      readonly start: IsoDateTime;
      readonly end: IsoDateTime;
      readonly time_zone: string;
    }
  | { readonly kind: 'all_day'; readonly start_date: IsoDate; readonly end_date: IsoDate };

export type CalendarTarget =
  | { readonly kind: 'provider'; readonly connected_account_id: Uuid; readonly calendar_id: Uuid }
  | {
      readonly kind: 'device';
      readonly provider: 'apple_device' | 'android_device';
      readonly installation_id: Uuid;
      readonly device_calendar_hash: string;
    };

export interface SourceRef {
  readonly source_type: SourceType;
  readonly source_id: Uuid | null;
  readonly source_provider: string;
  readonly source_timestamp: IsoDateTime;
  readonly label?: string;
  readonly open_route?: string;
}

export interface EvidenceRef {
  readonly quote: string;
  readonly source: SourceRef;
  readonly offsets?: { readonly start: number; readonly end: number };
  readonly page?: number;
}

export interface EmailSendPayload {
  readonly action_type: 'email_send';
  readonly connected_account_id: Uuid;
  readonly provider: 'google' | 'microsoft';
  readonly mode: 'reply' | 'follow_up';
  readonly reply_draft_id: Uuid;
  readonly thread: { readonly email_thread_id: Uuid; readonly reply_to_message_id: Uuid };
  readonly to: readonly Recipient[];
  readonly cc: readonly Recipient[];
  readonly subject: string;
  readonly body_text: string;
  readonly language: 'tr' | 'en';
  readonly attachments: readonly {
    readonly storage_path: string;
    readonly name: string;
    readonly mime: string;
    readonly size_bytes: number;
  }[];
}

export interface CalendarCreatePayload {
  readonly action_type: 'calendar_create';
  readonly target: CalendarTarget;
  readonly title: string;
  readonly description?: string;
  readonly location?: string;
  readonly time: EventTime;
  readonly attendees: readonly { readonly email: string; readonly optional: boolean }[];
  readonly reminders_minutes: readonly number[];
  readonly origin_task_ref?: {
    readonly type: 'task' | 'commitment' | 'insight' | 'capture_item';
    readonly id: string;
  };
}

export interface CalendarUpdatePayload {
  readonly action_type: 'calendar_update';
  readonly target: CalendarTarget;
  readonly calendar_event_id: Uuid;
  readonly changes: {
    readonly time?: EventTime;
    readonly title?: string;
    readonly location?: string;
    readonly description?: string;
  };
}

export interface TaskCreatePayload {
  readonly action_type: 'task_create';
  readonly target:
    | {
        readonly kind: 'provider';
        readonly connected_account_id: Uuid;
        readonly task_list_id: string;
      }
    | {
        readonly kind: 'device';
        readonly provider: 'apple_device';
        readonly installation_id: Uuid;
        readonly reminder_list_hash: string;
      }
    | { readonly kind: 'in_app' };
  readonly title: string;
  readonly notes?: string;
  readonly due?:
    | { readonly kind: 'date'; readonly date: IsoDate }
    | { readonly kind: 'date_time'; readonly at: IsoDateTime; readonly time_zone: string };
  readonly importance?: 'low' | 'normal' | 'high';
  readonly related_person?: { readonly contact_id: Uuid };
}

export interface ReminderCreatePayload {
  readonly action_type: 'reminder_create';
  readonly destination:
    | { readonly kind: 'in_app'; readonly channel: 'push' | 'local' }
    | {
        readonly kind: 'device';
        readonly provider: 'apple_device';
        readonly installation_id: Uuid;
        readonly reminder_list_hash: string;
      };
  readonly title: string;
  readonly preset: ReminderPreset;
  readonly fire_at: IsoDateTime;
  readonly anchor_at?: IsoDateTime;
  readonly time_zone: string;
  readonly reason_text?: string;
  readonly subject?: { readonly type: SourceType; readonly id: Uuid };
}

export interface CommitmentCreatePayload {
  readonly action_type: 'commitment_create';
  readonly text: string;
  readonly direction: CommitmentDirection;
  readonly counterparty: {
    readonly contact_id?: Uuid;
    readonly name?: string;
    readonly email?: string;
  };
  readonly due_at: IsoDateTime | null;
  readonly due_text?: string;
  readonly due_precision: 'datetime' | 'date' | 'none';
  readonly source: SourceRef;
  readonly evidence: EvidenceRef;
  readonly confidence: number;
}

/** Payload by action type. */
export interface ApprovalPayloadMap {
  readonly email_send: EmailSendPayload;
  readonly calendar_create: CalendarCreatePayload;
  readonly calendar_update: CalendarUpdatePayload;
  readonly task_create: TaskCreatePayload;
  readonly reminder_create: ReminderCreatePayload;
  readonly commitment_create: CommitmentCreatePayload;
}

export type ApprovalPayload = ApprovalPayloadMap[ApprovalActionType];

export type ApprovalOrigin =
  | 'reply_draft'
  | 'assistant'
  | 'voice'
  | 'capture'
  | 'plan_proposal'
  | 'conflict_resolution'
  | 'post_meeting'
  | 'email_detail'
  | 'life_event'
  | 'follow_up'
  | 'reminder_sheet'
  | 'commitment_detection'
  | 'insight'
  | 'manual';

export type ApprovalRejectionReason = 'user_reject' | 'user_cancel';

/** `approval_actions` row. */
export interface ApprovalAction<T extends ApprovalActionType = ApprovalActionType>
  extends Owned, Timestamps, Provenance {
  readonly action_type: T;
  readonly status: ApprovalStatus;
  readonly payload: ApprovalPayloadMap[T];
  readonly payload_version: number;
  readonly what: string;
  readonly why: string | null;
  readonly change_summary: string;
  readonly idempotency_key: string;
  readonly provider_idempotency_ref: string | null;
  readonly origin: ApprovalOrigin;
  readonly origin_ref_id: Uuid | null;
  readonly approved_via: ApprovalVia | null;
  readonly executor: 'server' | 'device';
  readonly device_installation_id: Uuid | null;
  readonly batch_id: Uuid | null;
  readonly approval_expires_at: IsoDateTime;
  readonly approved_at: IsoDateTime | null;
  readonly rejected_at: IsoDateTime | null;
  readonly rejection_reason: ApprovalRejectionReason | null;
  readonly executing_at: IsoDateTime | null;
  readonly executed_at: IsoDateTime | null;
  readonly failed_at: IsoDateTime | null;
  readonly attempt_count: number;
  readonly last_error_code: string | null;
}

export type ApprovalActor = 'user' | 'system' | 'worker' | 'admin';

/** `approval_events` row (append-only transition history, no payload). */
export interface ApprovalEvent {
  readonly approval_action_id: Uuid;
  readonly from_status: ApprovalStatus | null;
  readonly to_status: ApprovalStatus;
  readonly actor: ApprovalActor;
  readonly actor_id: Uuid | null;
  readonly payload_version: number;
  readonly idempotency_key: string;
  readonly reason: string | null;
  readonly created_at: IsoDateTime;
}
