/**
 * Records and the storage port of the integration services (INTEGRATION_PLAN §3.1; DATABASE_AND_RLS_PLAN
 * §4.2–§4.3; migration 20260924002000). Column names are the database names. The supabase-backed
 * implementation is `store.ts`; tests use the in-memory store of `_shared/testing/integrations.ts`,
 * which mirrors the SQL functions' semantics.
 */
import type { AccountStatus, Capability, Provider } from '@da/domain';
import type { EncryptedToken, TokenKind } from '../../crypto/token-cipher.ts';

export type Toggles = Readonly<Record<string, boolean>>;

export interface AccountRecord {
  readonly id: string;
  readonly user_id: string;
  readonly provider: Provider;
  readonly provider_account_id: string;
  readonly account_email: string | null;
  readonly display_label: string | null;
  readonly tenant_type: 'personal' | 'work' | null;
  readonly tenant_id: string | null;
  readonly status: AccountStatus;
  readonly status_reason: string | null;
  readonly granted_scopes: readonly string[];
  readonly capabilities_granted: readonly Capability[];
  readonly data_source_toggles: Toggles;
  readonly connected_at: string | null;
  readonly last_sync_at: string | null;
  readonly last_successful_sync_at: string | null;
  readonly last_error_code: string | null;
  readonly last_error_at: string | null;
  readonly reauth_required_at: string | null;
  readonly disconnected_at: string | null;
  readonly revocation_mode: 'provider_revoked' | 'local_only' | 'device_local' | null;
  readonly pending_binding_until: string | null;
  readonly demo_flavor: 'google' | 'microsoft' | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export type AccountPatch = Partial<
  Pick<
    AccountRecord,
    | 'status'
    | 'status_reason'
    | 'granted_scopes'
    | 'capabilities_granted'
    | 'data_source_toggles'
    | 'last_sync_at'
    | 'last_successful_sync_at'
    | 'last_error_code'
    | 'last_error_at'
    | 'reauth_required_at'
    | 'account_email'
    | 'display_label'
  >
>;

export type OAuthPurpose = 'connect' | 'reauth' | 'upgrade';

export type OAuthPreResult =
  | 'pending_confirmation'
  | 'success'
  | 'partial'
  | 'denied'
  | 'error'
  | 'account_mismatch'
  | 'already_linked'
  | 'plan_limit'
  | 'admin_consent_required';

export interface OAuthStateRecord {
  readonly id: string;
  readonly user_id: string;
  readonly provider: 'google' | 'microsoft' | 'demo';
  readonly purpose: OAuthPurpose;
  readonly connected_account_id: string | null;
  readonly requested_capabilities: readonly Capability[];
  readonly requested_scopes: readonly string[];
  readonly code_verifier_iv: Uint8Array;
  readonly code_verifier_ciphertext: Uint8Array;
  readonly key_version: number;
  readonly nonce_hash: Uint8Array | null;
  readonly return_to: string;
  readonly expires_at: string;
  readonly used_at: string | null;
  readonly device_nonce_hash: Uint8Array;
  readonly completion_code_hash: Uint8Array | null;
  readonly approval_id: string | null;
  readonly token_ciphertext: Uint8Array | null;
  readonly token_iv: Uint8Array | null;
  readonly result: OAuthPreResult | null;
  readonly error_code: string | null;
  readonly completed_at: string | null;
  readonly created_at: string;
}

export type NewOAuthState = Omit<
  OAuthStateRecord,
  | 'used_at'
  | 'completion_code_hash'
  | 'token_ciphertext'
  | 'token_iv'
  | 'result'
  | 'error_code'
  | 'completed_at'
  | 'created_at'
> & { readonly state_hash: Uint8Array };

/** What the callback stores on the consumed state (`private.oauth_callback_store`). */
export interface CallbackStatePatch {
  readonly result: OAuthPreResult;
  readonly completionCodeHash: Uint8Array | null;
  readonly errorCode: string | null;
  /** The held token set (reconnect / upgrade), bound to the state row. */
  readonly token: { ciphertext: Uint8Array; iv: Uint8Array; keyVersion: number } | null;
  readonly connectedAccountId: string | null;
}

/** A new identity's `connecting` row inserted by the callback. */
export interface PendingAccountInsert {
  readonly id: string;
  readonly provider_account_id: string;
  readonly account_email: string | null;
  readonly display_label: string | null;
  readonly tenant_type: 'personal' | 'work' | null;
  readonly tenant_id: string | null;
  readonly granted_scopes: readonly string[];
  readonly capabilities_granted: readonly Capability[];
  readonly demo_flavor: 'google' | 'microsoft' | null;
  readonly credential_expires_at: string | null;
}

export interface CredentialWrite {
  readonly kind: TokenKind;
  readonly token: EncryptedToken;
  readonly accessExpiresAt: string | null;
  readonly scopeSnapshot: string | null;
}

export interface CredentialRecord extends EncryptedToken {
  readonly id: string;
  readonly connected_account_id: string;
  readonly kind: TokenKind;
  readonly access_expires_at: string | null;
}

export interface CompletionPatch {
  readonly status: AccountStatus;
  readonly capabilities_granted: readonly Capability[];
  readonly granted_scopes: readonly string[] | null;
  readonly account_email: string | null;
  readonly display_label: string | null;
  readonly credential_expires_at: string | null;
}

export type SyncResource =
  | 'gmail_mailbox'
  | 'graph_mail_inbox'
  | 'graph_mail_sentitems'
  | 'google_calendar'
  | 'graph_calendar_view'
  | 'google_tasks'
  | 'todo_list'
  | 'device_calendar'
  | 'device_reminders';

export type WatchKind = 'none' | 'gmail_watch' | 'gcal_channel' | 'graph_subscription';

export interface SyncStateRecord {
  readonly id: string;
  readonly user_id: string;
  readonly connected_account_id: string;
  readonly calendar_id: string | null;
  readonly resource: SyncResource;
  readonly resource_key: string;
  readonly cursor: string | null;
  readonly status: 'idle' | 'running' | 'backfilling' | 'resync_required' | 'error' | 'paused';
  readonly page_token: string | null;
  readonly backfill_until: string | null;
  readonly backfill_cursor: string | null;
  readonly window_start: string | null;
  readonly window_end: string | null;
  readonly rebaseline_due_at: string | null;
  readonly watch_kind: WatchKind;
  readonly watch_id: string | null;
  readonly watch_resource_id: string | null;
  /** sha256 hex of the channel token / Graph clientState. */
  readonly watch_token_hash: string | null;
  readonly watch_history_id: string | null;
  readonly watch_expires_at: string | null;
  readonly watch_renew_after: string | null;
  readonly lifecycle_last_event:
    'reauthorizationRequired' | 'subscriptionRemoved' | 'missed' | null;
  readonly lifecycle_last_at: string | null;
  readonly next_poll_at: string | null;
  readonly cursor_invalidated_at: string | null;
  readonly last_full_sync_at: string | null;
  readonly last_incremental_sync_at: string | null;
  readonly last_success_at: string | null;
  readonly last_error_code: string | null;
  readonly consecutive_failures: number;
  readonly stats: Readonly<Record<string, number>>;
}

export type SyncStatePatch = Partial<
  Omit<SyncStateRecord, 'id' | 'user_id' | 'connected_account_id'>
>;

export interface CalendarRecord {
  readonly id: string;
  readonly user_id: string;
  readonly connected_account_id: string;
  readonly provider: Provider;
  readonly provider_calendar_id: string;
  readonly name: string;
  readonly color: string | null;
  readonly time_zone: string | null;
  readonly access_role: 'owner' | 'writer' | 'reader' | 'free_busy_reader';
  readonly is_primary: boolean;
  readonly selected: boolean;
  readonly can_write: boolean;
}

export interface CalendarUpsert {
  readonly provider_calendar_id: string;
  readonly name: string;
  readonly color: string | null;
  readonly time_zone: string | null;
  readonly access_role: CalendarRecord['access_role'];
  readonly is_primary: boolean;
  readonly can_write: boolean;
  readonly kind: 'default' | 'holidays' | 'birthdays' | 'shared' | 'other';
}

/** One message row for `private.upsert_mail_messages` (headers subset + ≤200-char snippet). */
export interface MailRow {
  readonly provider_message_id: string;
  readonly provider_thread_id: string;
  readonly internet_message_id: string | null;
  readonly in_reply_to: string | null;
  readonly references_ids: readonly string[];
  readonly direction: 'inbound' | 'outbound';
  readonly from_email: string;
  readonly from_name: string | null;
  readonly to_emails: readonly string[];
  readonly cc_emails: readonly string[];
  readonly subject: string;
  readonly snippet: string;
  readonly sent_at: string | null;
  readonly received_at: string;
  readonly is_read: boolean;
  readonly importance: 'low' | 'normal' | 'high' | null;
  readonly labels: readonly string[];
  readonly has_attachments: boolean;
  readonly list_unsubscribe: boolean;
  readonly auto_submitted: boolean;
  readonly precedence_bulk: boolean;
  readonly dkim_pass: boolean | null;
  readonly spf_pass: boolean | null;
  /** sha256 hex of the normalised subject + snippet. */
  readonly content_hash: string;
  readonly web_link: string | null;
  readonly thread_web_link: string | null;
  readonly deleted: boolean;
}

export interface MailUpsertResult {
  readonly id: string;
  readonly provider_message_id: string;
  readonly thread_id: string;
  readonly inserted: boolean;
}

/** One event row for `private.upsert_calendar_events`. */
export interface EventRow {
  readonly provider_event_id: string;
  readonly ical_uid: string | null;
  readonly recurring_event_id: string | null;
  readonly etag: string | null;
  readonly title: string;
  readonly description_excerpt: string | null;
  readonly location: string | null;
  readonly conference_url: string | null;
  readonly start_at: string;
  readonly end_at: string;
  readonly all_day: boolean;
  readonly start_date: string | null;
  readonly end_date: string | null;
  readonly time_zone: string | null;
  readonly status: 'confirmed' | 'tentative' | 'cancelled';
  readonly organizer_email: string | null;
  readonly organizer_self: boolean;
  readonly can_modify: boolean;
  readonly attendees: readonly { email: string; name: string | null; response: string | null }[];
  readonly attendee_count: number;
  readonly da_approval_id: string | null;
  readonly provider_updated_at: string | null;
  readonly deleted: boolean;
}

/** One task row for `private.upsert_tasks`. */
export interface TaskRow {
  readonly provider_task_id: string;
  readonly provider_list_id: string;
  readonly title: string;
  readonly notes_excerpt: string | null;
  readonly due_date: string | null;
  readonly due_at: string | null;
  readonly status: 'open' | 'completed';
  readonly completed_at: string | null;
  readonly deleted: boolean;
}

export interface StoredMessage {
  readonly id: string;
  readonly user_id: string;
  readonly connected_account_id: string;
  readonly provider_message_id: string;
  readonly provider_thread_id: string;
  readonly subject: string | null;
  readonly from_email: string;
  readonly from_name: string | null;
  readonly to_emails: readonly string[];
  readonly cc_emails: readonly string[];
  readonly received_at: string;
  readonly web_link: string | null;
  readonly provider_deleted_at: string | null;
}

export interface DisconnectOutcome {
  readonly account: AccountRecord;
  readonly already: boolean;
  readonly purgeJobId: string | null;
  readonly disconnectedAt: string;
}

export interface PurgeStep {
  readonly done: boolean;
  readonly skipped?: string;
  readonly deleted?: Readonly<Record<string, number>>;
}

export interface DemoResourceState {
  readonly state: { readonly writes?: Readonly<Record<string, Readonly<Record<string, unknown>>>> };
  readonly demo_clock: string | null;
}

/** An approval named by an upgrade's `resume` (API-INT-02). */
export interface ResumeApproval {
  readonly id: string;
  readonly user_id: string;
  readonly action_type:
    | 'email_send'
    | 'calendar_create'
    | 'calendar_update'
    | 'task_create'
    | 'reminder_create'
    | 'commitment_create';
  readonly status: string;
  readonly destination_account_id: string | null;
}

export interface JobStatusRow {
  readonly id: string;
  readonly status: 'queued' | 'running' | 'completed' | 'retrying' | 'failed' | 'dead_letter';
}

export interface IntegrationStore {
  // accounts
  getAccount(id: string): Promise<AccountRecord | null>;
  findAccount(
    userId: string,
    provider: Provider,
    providerAccountId: string,
  ): Promise<AccountRecord | null>;
  /** An active account of another user with this provider identity (already linked). */
  linkedToOtherUser(
    provider: Provider,
    providerAccountId: string,
    userId: string,
  ): Promise<boolean>;
  /** Active Google (or demo) accounts whose mailbox address is `email` (Gmail push routing). */
  findMailAccountsByEmail(email: string): Promise<AccountRecord[]>;
  countActiveWithCapability(
    userId: string,
    capability: Capability,
    exceptId?: string,
  ): Promise<number>;
  /** `user_preferences.timezone` (IANA; the schema default when absent). */
  userTimeZone(userId: string): Promise<string>;
  approvalForResume(approvalId: string, userId: string): Promise<ResumeApproval | null>;
  planLimit(userId: string, key: string): Promise<number | null>;
  updateAccount(id: string, patch: AccountPatch): Promise<AccountRecord>;
  pausedByPlan(id: string): Promise<boolean>;
  accountCan(id: string, capability: Capability): Promise<boolean>;
  upsertDeviceAccount(
    userId: string,
    provider: 'apple_device' | 'android_device',
    installationId: string,
    capabilities: readonly Capability[],
  ): Promise<{ accountId: string; created: boolean }>;

  // OAuth states (R-07)
  insertState(state: NewOAuthState): Promise<void>;
  /** Atomic single-use consume: unused and unexpired → `used_at = now()`; otherwise null. */
  consumeState(stateHash: Uint8Array): Promise<OAuthStateRecord | null>;
  findStateByHash(stateHash: Uint8Array): Promise<OAuthStateRecord | null>;
  findStateByCompletionHash(hash: Uint8Array): Promise<OAuthStateRecord | null>;
  getState(id: string): Promise<OAuthStateRecord | null>;
  callbackStore(
    stateId: string,
    patch: CallbackStatePatch,
    account: PendingAccountInsert | null,
    credentials: readonly CredentialWrite[],
  ): Promise<void>;
  completeBinding(
    stateId: string,
    userId: string,
    accountId: string,
    patch: CompletionPatch,
    credentials: readonly CredentialWrite[],
  ): Promise<AccountRecord & { paused_by_plan: boolean }>;
  closeFlow(
    stateId: string,
    result: OAuthPreResult,
    errorCode: string | null,
  ): Promise<{ deletedAccountId: string | null }>;
  /** Uncompleted reconnect/upgrade states of an account that expired while holding a token set. */
  expiredHeldStates(accountId: string): Promise<OAuthStateRecord[]>;

  // credentials
  getCredential(accountId: string, kind: TokenKind): Promise<CredentialRecord | null>;
  saveCredential(account: AccountRecord, write: CredentialWrite): Promise<void>;
  deleteCredentials(accountId: string): Promise<void>;
  tryLockRefresh(accountId: string, owner: string, seconds: number): Promise<boolean>;
  releaseRefreshLock(accountId: string, owner: string): Promise<void>;

  // sync states
  ensureSyncState(input: {
    userId: string;
    accountId: string;
    resource: SyncResource;
    resourceKey: string;
    calendarId?: string | null;
  }): Promise<SyncStateRecord>;
  getSyncState(id: string): Promise<SyncStateRecord | null>;
  listSyncStates(accountId: string): Promise<SyncStateRecord[]>;
  findSyncStateByWatch(kind: WatchKind, watchId: string): Promise<SyncStateRecord | null>;
  updateSyncState(id: string, patch: SyncStatePatch): Promise<SyncStateRecord>;
  acquireLease(id: string, owner: string, seconds: number): Promise<boolean>;
  releaseLease(id: string, owner: string): Promise<void>;

  // calendars
  upsertCalendars(
    accountId: string,
    calendars: readonly CalendarUpsert[],
  ): Promise<{ calendars: CalendarRecord[]; missing: string[] }>;
  listCalendars(accountId: string): Promise<CalendarRecord[]>;
  getCalendar(id: string): Promise<CalendarRecord | null>;
  deleteCalendars(ids: readonly string[]): Promise<void>;
  /** Throws `ENTITLEMENT_REQUIRED {limit_key:'max_calendars'}` beyond the plan allowance. */
  setCalendarSelected(id: string, selected: boolean): Promise<void>;
  countSelectedCalendars(userId: string): Promise<number>;
  defaultWriteCalendar(userId: string): Promise<string | null>;
  setDefaultWriteCalendar(userId: string, calendarId: string | null): Promise<void>;

  // content
  upsertMail(accountId: string, rows: readonly MailRow[]): Promise<MailUpsertResult[]>;
  applyMailChanges(
    accountId: string,
    labelChanges: readonly {
      provider_message_id: string;
      labels: readonly string[];
      is_read: boolean | null;
    }[],
    deleted: readonly string[],
  ): Promise<{ label_changes: number; deleted: number }>;
  listRecentMessageIds(accountId: string, since: string): Promise<string[]>;
  getMessage(id: string): Promise<StoredMessage | null>;
  upsertEvents(
    accountId: string,
    calendarId: string,
    rows: readonly EventRow[],
    origin: 'provider_sync' | 'demo' | 'approval_write',
  ): Promise<{ upserted: number; cancelled: number }>;
  markEventsDeleted(calendarId: string, providerEventIds: readonly string[]): Promise<number>;
  pruneEvents(
    calendarId: string,
    since: string,
    windowStart: string | null,
    windowEnd: string | null,
  ): Promise<number>;
  upsertTasks(accountId: string, rows: readonly TaskRow[]): Promise<{ upserted: number }>;
  /** Stages an accepted device snapshot for its ingest job (identical content_hash → same id). */
  stageDeviceSnapshot(accountId: string, snapshot: Record<string, unknown>): Promise<string>;
  /** JOB-06: applies the staged snapshot once (`{skipped:'already_applied'}` on a re-run). */
  applyStagedDeviceSnapshot(
    accountId: string,
    contentHash: string,
  ): Promise<Record<string, unknown>>;

  // demo adapter state
  demoState(accountId: string): Promise<Readonly<Record<string, DemoResourceState>>>;
  demoRecordWrite(
    accountId: string,
    resource: 'mail' | 'calendar' | 'tasks',
    key: string,
    item: Record<string, unknown>,
  ): Promise<{ created: boolean; item: Record<string, unknown> }>;
  demoSetClock(
    accountId: string,
    resource: 'mail' | 'calendar' | 'tasks',
    clock: string,
  ): Promise<void>;

  // lifecycle
  disconnect(
    accountId: string,
    userId: string,
    revocationMode: 'provider_revoked' | 'local_only' | 'device_local' | null,
    purgeContent: boolean,
    correlationId: string | null,
  ): Promise<DisconnectOutcome>;
  purgeBatch(
    accountId: string,
    disconnectedAt: string | null,
    purgeDerived: boolean,
    batch: number,
    reason: 'disconnect' | 'binding_expired',
  ): Promise<PurgeStep>;
  jobStatuses(ids: readonly string[]): Promise<JobStatusRow[]>;
}
