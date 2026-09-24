/**
 * Data access of the AI pipeline part 2 (IMPLEMENTATION_PLAN T-5.09…T-5.15): reply drafts,
 * meetings, the assistant, captures, planning, First Analysis and briefing audio. The routes and
 * jobs depend on this interface; `supabase-store.ts` implements it over the service client and
 * `_shared/testing/assist.ts` in memory. Every method is scoped by the verified user id of the
 * request or job, never by an id from a request body.
 */
import type {
  AccountStatus,
  Capability,
  ExtractedEntityType,
  InsightKind,
  ItemStatus,
  Provider,
  SourceType,
} from '@da/domain';
import type { BriefingKind, BriefingStatus } from '@da/domain';
import type {
  BriefingItemRow,
  CalendarEventRow,
  CommitmentRow,
  MailMessageRow,
  MailThreadRow,
} from '../intel/types.ts';

// ── Reply drafts (API-MAIL-02…06, API-MAIL-08) ─────────────────────────────
export type Tone = 'short' | 'professional' | 'friendly' | 'detailed';

export interface ReplyAttachment {
  readonly storage_path: string;
  readonly name: string;
  readonly mime: string;
  readonly size_bytes: number;
  readonly client_attachment_id?: string;
}

export interface ReplyDraftRow {
  readonly id: string;
  readonly user_id: string;
  readonly thread_id: string;
  readonly message_id: string | null;
  readonly connected_account_id: string;
  readonly kind: 'reply' | 'follow_up';
  readonly tone: Tone;
  readonly to_emails: readonly string[];
  readonly cc_emails: readonly string[];
  readonly subject: string | null;
  readonly body: string;
  readonly version: number;
  readonly status: 'draft' | 'submitted' | 'sent' | 'discarded' | 'failed';
  readonly generated_by: 'ai' | 'user_edit';
  readonly approval_action_id: string | null;
  readonly ai_request_id: string | null;
  readonly prompt_version_id: string | null;
  readonly attachments: readonly ReplyAttachment[];
  readonly source_type: SourceType;
  readonly source_id: string;
  readonly source_provider: Provider | null;
  readonly source_timestamp: string;
  readonly confidence: number;
  readonly language: 'tr' | 'en' | null;
  readonly warnings: readonly string[] | null;
  readonly facts_used: readonly unknown[] | null;
  readonly content_key: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export type ReplyDraftInsert = Omit<
  ReplyDraftRow,
  'id' | 'version' | 'status' | 'approval_action_id' | 'created_at' | 'updated_at'
> & { readonly expires_at: string | null };

export type ReplyDraftPatch = Partial<
  Pick<
    ReplyDraftRow,
    | 'tone'
    | 'to_emails'
    | 'cc_emails'
    | 'subject'
    | 'body'
    | 'status'
    | 'generated_by'
    | 'approval_action_id'
    | 'ai_request_id'
    | 'prompt_version_id'
    | 'attachments'
    | 'warnings'
    | 'facts_used'
    | 'content_key'
  >
>;

// ── Meetings (API-MEET-01…04, JOB-15) ──────────────────────────────────────
export interface MeetingEventRow extends CalendarEventRow {
  readonly user_id: string;
  readonly connected_account_id: string;
  readonly calendar_id: string;
  readonly conference_url: string | null;
  readonly organizer_email: string | null;
}

export interface MeetingPrepRow {
  readonly id: string;
  readonly user_id: string;
  readonly calendar_event_id: string;
  readonly status: 'pending' | 'generating' | 'ready' | 'failed' | 'stale';
  readonly purpose: string | null;
  readonly purpose_evidence: readonly unknown[];
  readonly primary_contact_id: string | null;
  readonly last_interaction: Record<string, unknown> | null;
  readonly recent_email_ids: readonly string[];
  readonly open_loops: readonly unknown[];
  readonly user_commitment_ids: readonly string[];
  readonly their_commitment_ids: readonly string[];
  readonly relevant_files: readonly unknown[];
  readonly talking_points: readonly unknown[];
  readonly summary_2min: string | null;
  readonly reading_time_sec: number | null;
  readonly sources: readonly unknown[];
  /** Hex of `input_hash` (the source-set hash), or null. */
  readonly source_hash: string | null;
  readonly generated_at: string | null;
  readonly prompt_version_id: string | null;
  readonly ai_request_id: string | null;
  readonly updated_at: string;
}

export type MeetingPrepUpsert = Omit<MeetingPrepRow, 'id' | 'updated_at'> & {
  readonly source_provider: Provider | null;
  readonly source_timestamp: string;
  readonly confidence: number;
};

export interface MeetingNoteRow {
  readonly id: string;
  readonly user_id: string;
  readonly calendar_event_id: string;
  readonly kind: 'prep_note' | 'post_meeting';
  readonly body: string;
  readonly input: 'text' | 'voice_transcript';
  readonly client_note_id: string | null;
  readonly created_at: string;
}

export interface MeetingContact {
  readonly id: string;
  readonly display_name: string;
  readonly emails: readonly string[];
  readonly organization: string | null;
  readonly role_text: string | null;
}

// ── Assistant (API-AST-01/02) ──────────────────────────────────────────────
export interface AssistantThreadRow {
  readonly id: string;
  readonly user_id: string;
  readonly scope: 'global' | 'person' | 'meeting';
  readonly scope_ref_id: string | null;
  readonly client_thread_id: string | null;
  readonly created_at: string;
}

export interface AssistantMessageRow {
  readonly id: string;
  readonly user_id: string;
  readonly thread_id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly cards: readonly unknown[];
  readonly citations: readonly unknown[];
  readonly proposed_approval_ids: readonly string[];
  readonly followup_suggestions: readonly unknown[];
  readonly status: 'streaming' | 'complete' | 'failed' | 'refused';
  readonly grounded: boolean;
  readonly input_channel: 'text' | 'voice';
  readonly client_message_id: string | null;
  readonly finish_reason: 'stop' | 'length' | 'client_disconnected' | 'refused_ungrounded' | null;
  readonly prompt_version_id: string | null;
  readonly ai_request_id: string | null;
  readonly created_at: string;
}

export type AssistantMessageInsert = Omit<AssistantMessageRow, 'id' | 'created_at'> & {
  readonly id?: string;
};

export type AssistantMessagePatch = Partial<
  Pick<
    AssistantMessageRow,
    | 'content'
    | 'cards'
    | 'citations'
    | 'proposed_approval_ids'
    | 'followup_suggestions'
    | 'status'
    | 'grounded'
    | 'finish_reason'
    | 'prompt_version_id'
    | 'ai_request_id'
  >
>;

export interface ContactMatch {
  readonly id: string;
  readonly display_name: string;
  readonly primary_email: string | null;
  readonly organization: string | null;
}

// ── Captures (API-CAP-01…05, JOB-27) ───────────────────────────────────────
export type CaptureKind = 'photo' | 'screenshot' | 'pdf' | 'file' | 'link' | 'text' | 'share';
export type CaptureStatus =
  'pending_upload' | 'uploaded' | 'analyzing' | 'extracted' | 'actioned' | 'discarded' | 'failed';

export interface CaptureRow {
  readonly id: string;
  readonly user_id: string;
  readonly kind: CaptureKind;
  readonly status: CaptureStatus;
  readonly storage_path: string | null;
  readonly mime_type: string | null;
  readonly size_bytes: number | null;
  /** Hex sha256 of the declared file (without `\x`), or null. */
  readonly sha256: string | null;
  readonly original_filename: string | null;
  readonly source_url: string | null;
  readonly final_url: string | null;
  readonly text_content: string | null;
  readonly page_count: number | null;
  readonly extracted: readonly Record<string, unknown>[];
  readonly extracted_types: readonly ExtractedEntityType[];
  readonly primary_type: ExtractedEntityType | null;
  readonly share_origin: string;
  readonly progress: Record<string, unknown>;
  readonly file_deleted_at: string | null;
  readonly idempotency_key: string;
  readonly error_code: string | null;
  readonly analyzed_at: string | null;
  readonly link_preview: { title: string | null; domain: string } | null;
  readonly created_at: string;
  readonly expires_at: string | null;
}

export type CaptureInsert = Pick<
  CaptureRow,
  | 'user_id'
  | 'kind'
  | 'status'
  | 'storage_path'
  | 'mime_type'
  | 'size_bytes'
  | 'sha256'
  | 'original_filename'
  | 'source_url'
  | 'text_content'
  | 'share_origin'
  | 'idempotency_key'
  | 'link_preview'
> & { readonly id: string };

export type CapturePatch = Partial<
  Pick<
    CaptureRow,
    | 'status'
    | 'storage_path'
    | 'final_url'
    | 'text_content'
    | 'page_count'
    | 'extracted'
    | 'extracted_types'
    | 'primary_type'
    | 'progress'
    | 'file_deleted_at'
    | 'error_code'
    | 'analyzed_at'
  >
> & { readonly ai_request_id?: string | null };

// ── Planning (API-PLAN-01…04) ──────────────────────────────────────────────
export interface AccountSource {
  readonly id: string;
  readonly provider: Provider;
  readonly status: AccountStatus;
  readonly last_sync_at: string | null;
  readonly capabilities_granted: readonly Capability[];
  readonly data_source_toggles: Readonly<Record<string, boolean>>;
}

export interface WritableCalendar {
  readonly id: string;
  readonly connected_account_id: string;
  readonly provider: Provider;
  readonly can_write: boolean;
  readonly toggles: Readonly<Record<string, boolean>>;
}

export interface PlanInsightRow {
  readonly id: string;
  readonly user_id: string;
  readonly kind: InsightKind;
  readonly status: ItemStatus;
  readonly title: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly dedupe_key: string;
  readonly suppression_key: string | null;
  readonly evidence: readonly { quote?: string; field?: string }[];
  readonly payload: Record<string, unknown> | null;
  readonly source_type: SourceType;
  readonly source_id: string;
  readonly source_provider: Provider | null;
  readonly source_timestamp: string;
}

export interface PlanItem {
  readonly title: string;
  readonly due_at: string | null;
  /** Work items use working hours; personal ones (life events) the personal hours. */
  readonly personal: boolean;
}

export interface QuietHours {
  readonly enabled: boolean;
  readonly start: string;
  readonly end: string;
}

// ── First Analysis (API-ONB-01/02, JOB-13) ─────────────────────────────────
export interface JobView {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly user_id: string | null;
  readonly idempotency_key: string;
  readonly progress: Record<string, unknown>;
  readonly result: Record<string, unknown> | null;
  readonly created_at: string;
  readonly last_error_code: string | null;
}

export interface FirstAnalysisCounts {
  readonly mails_found: number;
  readonly classified: number;
  readonly potential_important: number;
  readonly upcoming_events: number;
  readonly possible_followups: number;
}

export interface TopInsight {
  readonly id: string;
  readonly kind: InsightKind;
  readonly title: string;
  readonly due_at: string | null;
  readonly event_at: string | null;
}

// ── Briefing audio (API-BRF-01, JOB-30) ────────────────────────────────────
export interface AudioChapter {
  readonly index: number;
  readonly title: string;
  readonly start_s: number;
  readonly duration_s: number;
}

export interface BriefingAudioRow {
  readonly id: string;
  readonly user_id: string;
  readonly kind: BriefingKind;
  readonly status: BriefingStatus;
  readonly version: number;
  readonly local_date: string;
  readonly hero_line: string | null;
  readonly narrative: string | null;
  readonly sections: readonly string[];
  readonly audio_status: 'none' | 'queued' | 'generating' | 'ready' | 'failed';
  readonly audio_storage_path: string | null;
  readonly audio_duration_s: number | null;
  readonly audio_chapters: readonly AudioChapter[];
}

export type BriefingAudioPatch = Partial<
  Pick<
    BriefingAudioRow,
    'audio_status' | 'audio_storage_path' | 'audio_duration_s' | 'audio_chapters'
  > & { audio_engine: 'premium_tts' | 'native_tts' | null }
>;

export interface AssistStore {
  // Reply drafts
  replyDraft(userId: string, id: string): Promise<ReplyDraftRow | null>;
  insertReplyDraft(row: ReplyDraftInsert): Promise<ReplyDraftRow>;
  /** Updates when `version` still equals `expectedVersion` (then `version+1`); null otherwise. */
  updateReplyDraft(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: ReplyDraftPatch,
  ): Promise<ReplyDraftRow | null>;
  reusableDraft(userId: string, contentKey: string, since: Date): Promise<ReplyDraftRow | null>;
  messageWebLink(userId: string, messageId: string): Promise<string | null>;

  // Meetings
  meetingEvent(userId: string, eventId: string): Promise<MeetingEventRow | null>;
  meetingPrep(userId: string, eventId: string): Promise<MeetingPrepRow | null>;
  meetingPrepById(userId: string, prepId: string): Promise<MeetingPrepRow | null>;
  upsertMeetingPrep(row: MeetingPrepUpsert): Promise<MeetingPrepRow>;
  meetingNoteByClient(userId: string, clientNoteId: string): Promise<MeetingNoteRow | null>;
  insertMeetingNote(row: Omit<MeetingNoteRow, 'id' | 'created_at'>): Promise<MeetingNoteRow>;
  meetingNotes(userId: string, eventId: string): Promise<MeetingNoteRow[]>;
  contactsForEmails(userId: string, emails: readonly string[]): Promise<MeetingContact[]>;
  /** Messages exchanged with the addresses since `since`, newest first. */
  mailsWith(
    userId: string,
    emails: readonly string[],
    since: Date,
    limit: number,
  ): Promise<MailMessageRow[]>;
  /** Threads with these participants waiting on either side. */
  awaitingThreadsWith(userId: string, emails: readonly string[]): Promise<MailThreadRow[]>;
  openCommitmentsWith(
    userId: string,
    contactIds: readonly string[],
    names: readonly string[],
  ): Promise<CommitmentRow[]>;

  // Assistant
  assistantThread(userId: string, id: string): Promise<AssistantThreadRow | null>;
  assistantThreadByClient(userId: string, clientId: string): Promise<AssistantThreadRow | null>;
  insertAssistantThread(
    row: Omit<AssistantThreadRow, 'id' | 'created_at'>,
  ): Promise<AssistantThreadRow>;
  assistantMessageByClient(
    threadId: string,
    clientMessageId: string,
  ): Promise<AssistantMessageRow | null>;
  insertAssistantMessage(row: AssistantMessageInsert): Promise<AssistantMessageRow>;
  updateAssistantMessage(id: string, patch: AssistantMessagePatch): Promise<void>;
  /** The newest `limit` complete messages of a thread, oldest first. */
  assistantHistory(threadId: string, limit: number): Promise<AssistantMessageRow[]>;
  /** A message of the user still `streaming` (one concurrent stream per user). */
  streamingMessage(userId: string, since: Date): Promise<AssistantMessageRow | null>;
  touchAssistantThread(threadId: string, at: Date): Promise<void>;
  contactsNamed(userId: string, names: readonly string[]): Promise<ContactMatch[]>;
  /** Approval ids of a proposal batch (post-meeting note, capture), oldest first. */
  approvalIdsByBatch(userId: string, batchId: string): Promise<string[]>;
  contact(userId: string, id: string): Promise<ContactMatch | null>;

  // Captures
  capture(userId: string, id: string): Promise<CaptureRow | null>;
  captureByClient(userId: string, clientId: string): Promise<CaptureRow | null>;
  insertCapture(row: CaptureInsert): Promise<CaptureRow>;
  updateCapture(userId: string, id: string, patch: CapturePatch): Promise<CaptureRow | null>;
  /** API-CAP-05 (`discard_capture`): the row and the object path to delete. */
  discardCapture(
    userId: string,
    id: string,
  ): Promise<{ capture: CaptureRow; storagePath: string | null }>;
  /** Captures whose file analysis finished > 24 h ago and still hold the file. */
  capturesWithStaleFiles(userId: string, before: Date): Promise<CaptureRow[]>;

  // Planning
  accountSources(userId: string): Promise<AccountSource[]>;
  timedTasks(userId: string, from: Date, to: Date): Promise<{ start: string; end: string }[]>;
  quietHours(userId: string): Promise<QuietHours | null>;
  writableCalendar(userId: string, calendarId: string | null): Promise<WritableCalendar | null>;
  planItem(
    userId: string,
    item: { type: 'task' | 'commitment' | 'insight' | 'email_message'; id: string },
  ): Promise<PlanItem | null>;
  planInsight(userId: string, id: string): Promise<PlanInsightRow | null>;
  setInsightPayload(userId: string, id: string, payload: Record<string, unknown>): Promise<void>;
  /** Points a schedule suggestion at its `calendar_create` approval (the plan card's route). */
  linkInsightApproval(userId: string, id: string, approvalId: string): Promise<void>;
  dismissInsight(userId: string, id: string, suppressionKey: string): Promise<void>;
  /** Phone numbers in the source text of an insight (`tel:` only when the source shows one). */
  sourcePhones(userId: string, sourceType: SourceType, sourceId: string): Promise<string[]>;

  // First Analysis
  job(id: string): Promise<JobView | null>;
  jobByKey(key: string): Promise<JobView | null>;
  jobsByKeyPrefix(prefix: string): Promise<JobView[]>;
  firstAnalysisCounts(userId: string, since: Date, now: Date): Promise<FirstAnalysisCounts>;
  topInsights(userId: string, limit: number): Promise<{ items: TopInsight[]; total: number }>;
  setOnboardingStep(userId: string, step: 'analysis' | 'ready'): Promise<void>;

  // Briefing audio
  briefingAudio(userId: string, id: string): Promise<BriefingAudioRow | null>;
  briefingItems(userId: string, briefingId: string): Promise<BriefingItemRow[]>;
  updateBriefingAudio(id: string, patch: BriefingAudioPatch): Promise<void>;
}
