/**
 * Approval rows and the context the approval services read (DATABASE_AND_RLS_PLAN §4.4,
 * API_CONTRACTS §5–§6). Every repository call receives the verified user id; clients never write
 * `approval_actions` (plan §5b) — the rows change only through `create_approval`,
 * `transition_approval`, `edit_approval_payload` and `start_device_execution`.
 */
import type {
  AccountStatus,
  ApprovalActionType,
  ApprovalStatus,
  ApprovalVia,
  Capability,
  JobStatus,
  Provider,
  SourceType,
} from '@da/domain';
import type { ApprovalPayload } from '@da/validation';
import type { SideEffectCode } from '@da/validation';

export type ApprovalOriginValue =
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

export interface SideEffectItem {
  readonly code: SideEffectCode;
  readonly text: string;
}

export interface ExactChangeField {
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
}

export type TargetKind = 'provider' | 'device' | 'in_app';

/** Card data stored with the proposal (`approval_actions.exact_change.card`). */
export interface ApprovalCardExtras {
  readonly destination: {
    readonly target_kind: TargetKind;
    readonly provider: Provider | 'in_app';
    readonly account_label: string | null;
    readonly container_label: string | null;
  };
  readonly requires_confirmation: boolean;
  readonly pro_required: boolean;
  /** The write capability the destination needs (null for in-app and device targets). */
  readonly capability: Capability | null;
  readonly source_label: string | null;
  readonly source_route: string | null;
  /** `calendar_update`: the event etag / changeKey seen at proposal (the If-Match precondition). */
  readonly precondition: string | null;
}

export interface StoredExactChange {
  readonly kind: 'send' | 'create' | 'update';
  readonly fields: readonly ExactChangeField[];
  readonly card: ApprovalCardExtras;
}

/** `approval_actions` as the services read it (bytea columns excluded). */
export interface ApprovalRow {
  readonly id: string;
  readonly user_id: string;
  readonly action_type: ApprovalActionType;
  readonly status: ApprovalStatus;
  readonly payload: ApprovalPayload;
  readonly payload_version: number;
  readonly what: string;
  readonly why: string | null;
  readonly change_summary: string;
  readonly side_effects: readonly SideEffectItem[];
  readonly destination_account_id: string | null;
  readonly destination_label: string | null;
  readonly idempotency_key: string;
  readonly provider_idempotency_ref: string | null;
  readonly origin: ApprovalOriginValue;
  readonly origin_ref_id: string | null;
  readonly requires_scope: string | null;
  readonly approved_via: ApprovalVia | null;
  readonly exact_change: StoredExactChange;
  readonly batch_id: string | null;
  readonly executor: 'server' | 'device';
  readonly device_installation_id: string | null;
  readonly approval_expires_at: string;
  readonly approved_at: string | null;
  readonly rejected_at: string | null;
  readonly rejection_reason: 'user_reject' | 'user_cancel' | null;
  readonly executing_at: string | null;
  readonly executed_at: string | null;
  readonly failed_at: string | null;
  readonly attempt_count: number;
  readonly last_error_code: string | null;
  readonly last_error_message: string | null;
  readonly result: Record<string, unknown> | null;
  readonly source_type: SourceType;
  readonly source_id: string;
  readonly source_provider: Provider | null;
  readonly source_timestamp: string;
  readonly confidence: number;
  readonly created_at: string;
}

/** The columns `create_approval` inserts (the key and status are set by the function). */
export interface NewApprovalRow {
  readonly id: string;
  readonly action_type: ApprovalActionType;
  readonly payload: ApprovalPayload;
  readonly payload_hash_hex: string;
  readonly what: string;
  readonly why: string;
  readonly change_summary: string;
  readonly side_effects: readonly SideEffectItem[];
  readonly destination_account_id: string | null;
  readonly destination_label: string | null;
  readonly origin: ApprovalOriginValue;
  readonly origin_ref_id: string | null;
  readonly requires_scope: string | null;
  readonly exact_change: StoredExactChange;
  readonly batch_id: string | null;
  readonly executor: 'server' | 'device';
  readonly device_installation_id: string | null;
  readonly approval_expires_at: string;
  readonly source_type: SourceType;
  readonly source_id: string;
  readonly source_provider: Provider | null;
  readonly source_timestamp: string;
  readonly confidence: number;
  readonly evidence: readonly { quote: string; field: string; locator?: string }[];
  readonly correlation_id: string | null;
}

export interface TransitionInput {
  readonly id: string;
  readonly to: ApprovalStatus;
  readonly actor: 'user' | 'system' | 'worker';
  readonly actorId: string | null;
  readonly idempotencyKey: string | null;
  readonly reason?: string | null;
  readonly result?: Record<string, unknown> | null;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  readonly via?: ApprovalVia | null;
  /** sha256 of the device execution token, 32 bytes as hex. */
  readonly deviceTokenHashHex?: string | null;
}

export interface EditInput {
  readonly id: string;
  readonly userId: string;
  readonly payload: ApprovalPayload;
  readonly payloadHashHex: string;
  readonly changeSummary: string;
  readonly exactChange: StoredExactChange;
  /** Unguarded card columns refreshed together with the new version. */
  readonly what: string;
  readonly sideEffects: readonly SideEffectItem[];
  readonly destinationLabel: string | null;
  readonly approvalExpiresAt: string;
  readonly requiresScope: string | null;
}

export interface AccountInfo {
  readonly id: string;
  readonly provider: Provider;
  readonly account_email: string | null;
  readonly display_label: string | null;
  readonly status: AccountStatus;
  readonly capabilities_granted: readonly Capability[];
  readonly data_source_toggles: Readonly<Record<string, boolean>>;
}

export interface CalendarInfo {
  readonly id: string;
  readonly connected_account_id: string;
  readonly provider: Provider;
  readonly provider_calendar_id: string;
  readonly name: string;
  readonly can_write: boolean;
}

export interface CalendarEventInfo {
  readonly id: string;
  readonly connected_account_id: string;
  readonly calendar_id: string;
  readonly provider: Provider;
  readonly provider_event_id: string;
  readonly etag: string | null;
  readonly title: string | null;
  readonly location: string | null;
  readonly start_at: string;
  readonly end_at: string;
  readonly all_day: boolean;
  readonly start_date: string | null;
  readonly end_date: string | null;
  readonly time_zone: string | null;
  readonly status: 'confirmed' | 'tentative' | 'cancelled';
  readonly organizer_self: boolean;
  readonly attendee_count: number;
  readonly provider_deleted_at: string | null;
}

export interface InstallationInfo {
  readonly id: string;
  readonly installation_id: string;
  readonly platform: 'ios' | 'android';
}

export interface JobInfo {
  readonly id: string;
  readonly status: JobStatus;
}

export interface ApprovalUserContext {
  readonly timeZone: string;
  readonly locale: 'tr' | 'en';
  readonly isPro: boolean;
  readonly learnFromInteractions: boolean;
  readonly quietHours: {
    readonly enabled: boolean;
    readonly start: string;
    readonly end: string;
    readonly days: readonly number[];
  };
}

/** Database access of the approval services (service role, verified user id on every call). */
export interface ApprovalsRepo {
  get(userId: string, id: string): Promise<ApprovalRow | null>;
  /** `create_approval`; throws `DuplicatePendingError` for a second pending proposal of an origin. */
  create(userId: string, row: NewApprovalRow, actor: 'user' | 'system'): Promise<ApprovalRow>;
  transition(input: TransitionInput): Promise<ApprovalRow>;
  edit(input: EditInput): Promise<ApprovalRow>;
  startDeviceExecution(
    id: string,
    userId: string,
    installationRowId: string,
    tokenHashHex: string,
  ): Promise<ApprovalRow>;
  setRequiresScope(userId: string, id: string, capability: Capability | null): Promise<void>;
  /** The stored sha256 of the device execution token (hex), or null. */
  deviceTokenHash(userId: string, id: string): Promise<string | null>;
  job(key: string): Promise<JobInfo | null>;
  userContext(userId: string): Promise<ApprovalUserContext>;
  planFeature(userId: string, key: string): Promise<boolean>;
  account(userId: string, accountId: string): Promise<AccountInfo | null>;
  accountCan(accountId: string, capability: Capability): Promise<boolean>;
  calendar(userId: string, calendarId: string): Promise<CalendarInfo | null>;
  calendarEvent(userId: string, eventId: string): Promise<CalendarEventInfo | null>;
  installationByClientId(userId: string, installationId: string): Promise<InstallationInfo | null>;
  installationById(userId: string, rowId: string): Promise<InstallationInfo | null>;
  /** Whether a referenced row (`SourceType` + id) exists and belongs to the user. */
  owns(userId: string, type: SourceType | 'contact', id: string): Promise<boolean>;
  /** Grounding source text for a commitment quote (derived text only: snippet, summary, note). */
  sourceText(userId: string, type: SourceType, id: string): Promise<string | null>;
  /** API-APR-02 `email_send` edits also update the linked `reply_drafts` row. */
  syncReplyDraft(
    userId: string,
    draftId: string,
    draft: { subject: string; body: string; to: string[]; cc: string[] },
  ): Promise<void>;
  replyDraftStatus(
    userId: string,
    draftId: string,
    status: 'draft' | 'submitted' | 'sent' | 'failed',
  ): Promise<void>;
  recordRejectionFeedback(input: {
    userId: string;
    approval: ApprovalRow;
    note: string | null;
    /** Localised learned-preference statement shown in AI Personalization (M§32). */
    statement: string;
  }): Promise<void>;
}

export class DuplicatePendingError extends Error {
  constructor(readonly existingId: string) {
    super('APPROVAL_PENDING_DUPLICATE');
    this.name = 'DuplicatePendingError';
  }
}
