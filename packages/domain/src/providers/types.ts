/**
 * Provider adapter contracts (INTEGRATION_PLAN §2.1–§2.7; ADR-07). Interfaces and normalised DTOs
 * only: implementations live in `supabase/functions/_shared/providers/{google,microsoft,demo}` and
 * the device providers in the mobile app. Provider-specific logic never enters this package.
 *
 * Naming: the DTOs keep the INTEGRATION_PLAN names (`NormalizedMailMessage`, `NormalizedEvent`,
 * `NormalizedTask`, …). Generic helper names from that document are prefixed here so they cannot
 * collide with other domain modules re-exported from `index.ts`: `Page` → `ProviderPage`,
 * `Clock` → `ProviderClock`, `EmailAddress` → `MailAddress`, `DataSourceToggles` →
 * `AccountDataSourceToggles`. Timestamps are RFC 3339 UTC strings; dates are `YYYY-MM-DD`.
 */
import type { Capability, Provider } from '../enums.ts';

export const SERVER_PROVIDERS = ['google', 'microsoft', 'demo'] as const;
export type ServerProvider = (typeof SERVER_PROVIDERS)[number];
export const DEVICE_PROVIDERS = ['apple_device', 'android_device'] as const;
export type DeviceProvider = (typeof DEVICE_PROVIDERS)[number];

export const READ_CAPABILITIES = ['mail_read', 'calendar_read', 'tasks_read'] as const;
export type ReadCapability = (typeof READ_CAPABILITIES)[number];
export const WRITE_CAPABILITY_FOR: Readonly<Record<ReadCapability, Capability>> = {
  mail_read: 'mail_send',
  calendar_read: 'calendar_write',
  tasks_read: 'tasks_write',
};

export interface ProviderPage<T> {
  items: T[];
  nextPageToken: string | null;
}

export interface ProviderClock {
  now(): Date;
}

type LogFields = Record<string, string | number | boolean | null>;

/** Structured, content-free logger: values never contain tokens, addresses, subjects or bodies. */
export interface ContentFreeLogger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export type QuotaBucket =
  | 'gmail_user_units'
  | 'gmail_project_units_day'
  | 'gcal_user_requests'
  | 'gtasks_project_requests_day'
  | 'graph_mailbox_requests'
  | 'graph_subscription_ops';
export type QuotaPriority = 'interactive' | 'sync' | 'backfill';

export interface QuotaGate {
  /** Waits until `units` fit; throws ProviderError('rate_limited') once maxWaitMs is exceeded. */
  acquire(
    bucket: QuotaBucket,
    units: number,
    opts?: { maxWaitMs?: number; priority?: QuotaPriority },
  ): Promise<void>;
}

export interface AccessTokenSource {
  get(opts?: { forceRefresh?: boolean }): Promise<string>;
}

/** `connected_accounts.data_source_toggles` (SREQ-68), enforced server-side before any fetch. */
export interface AccountDataSourceToggles {
  mail_read: boolean;
  attachments_analyze: boolean;
  deadline_detect: boolean;
  draft_replies: boolean;
  calendar_read: boolean;
  schedule_suggest: boolean;
  calendar_write_with_approval: boolean;
  tasks_read: boolean;
}

export interface ProviderAccountRef {
  connectedAccountId: string;
  userId: string;
  provider: Provider;
  /** Google `sub`; Graph `oid`; device: installation-scoped key. */
  providerAccountId: string;
  email: string | null;
  /** Graph `tid`. */
  tenantId: string | null;
  tenantType: 'personal' | 'work' | null;
  capabilitiesGranted: readonly Capability[];
  dataSourceToggles: AccountDataSourceToggles;
}

export interface ProviderContext {
  readonly account: ProviderAccountRef;
  readonly tokens: AccessTokenSource;
  readonly quota: QuotaGate;
  readonly clock: ProviderClock;
  readonly log: ContentFreeLogger;
  readonly correlationId: string;
  readonly signal?: AbortSignal;
}

// ---------------------------------------------------------------------------------------------
// Normalised models (§2.2)

export interface MailAddress {
  address: string;
  name: string | null;
}

export type AuthResult = 'pass' | 'fail' | 'none' | null;

/** Deterministic triage headers (AI_PIPELINE_PLAN pre-filter allow-list). */
export interface DeterministicHeaders {
  listUnsubscribe: boolean;
  listId: string | null;
  /** `bulk` | `list` | `junk` */
  precedence: string | null;
  /** `auto-generated` | `auto-replied` */
  autoSubmitted: string | null;
  authentication: {
    dkim: AuthResult;
    spf: AuthResult;
    dmarc: AuthResult;
    dkimDomain: string | null;
  } | null;
  /** X-Priority / Importance. */
  priority: 'high' | 'normal' | 'low' | null;
}

export interface NormalizedMailMessage {
  /** Gmail id | Graph immutable id. */
  providerMessageId: string;
  /** Gmail threadId | Graph conversationId. */
  providerThreadId: string;
  /** Message-ID | internetMessageId (cross-account dedupe). */
  rfc822MessageId: string | null;
  inReplyTo: string | null;
  /** Last 20 kept. */
  references: string[];
  folder: 'inbox' | 'sent' | 'archive' | 'other';
  /** Provider labels/categories, normalised upper-case. */
  labels: string[];
  providerCategory:
    'primary' | 'promotions' | 'social' | 'updates' | 'forums' | 'focused' | 'other' | null;
  from: MailAddress | null;
  replyTo: MailAddress[];
  /** Capped at 50. */
  to: MailAddress[];
  /** Capped at 50. */
  cc: MailAddress[];
  /** ≤ 500 chars. */
  subject: string;
  /** ≤ 200 chars, whitespace-normalised, HTML-free. */
  snippet: string;
  sentAt: string | null;
  receivedAt: string;
  isRead: boolean;
  /** Gmail STARRED | Graph flag.flagStatus === 'flagged'. */
  isFlagged: boolean;
  providerImportance: 'high' | 'normal' | 'low' | null;
  hasAttachments: boolean | null;
  sizeBytes: number | null;
  headers: DeterministicHeaders;
  /** Graph webLink; Gmail built via MailProvider.webLinkFor. */
  webLink: string | null;
  deleted: boolean;
}

/** The WBS name for the normalised mail DTO (T-1.15). */
export type NormalizedMessage = NormalizedMailMessage;

/** Never persisted, never logged; lives only inside one pipeline step. */
export interface TransientMailBody {
  /** Plain text, ≤ 200 KB. */
  text: string;
  /** Raw HTML (sanitised only when returned by GET /mail/:id/original). */
  html: string | null;
  truncated: boolean;
  attachments: {
    providerAttachmentId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    inline: boolean;
  }[];
}

export interface NormalizedCalendar {
  providerCalendarId: string;
  name: string;
  color: string | null;
  timeZone: string | null;
  /** `calendars.access_role` values. */
  accessRole: 'owner' | 'writer' | 'reader' | 'free_busy_reader';
  isPrimary: boolean;
  /** Google: owner (calendar.events.owned); Graph: canEdit. */
  canWrite: boolean;
  kind: 'default' | 'holidays' | 'birthdays' | 'shared' | 'other';
  deleted: boolean;
}

export interface NormalizedAttendee {
  email: string;
  name: string | null;
  responseStatus: 'accepted' | 'declined' | 'tentative' | 'needs_action' | null;
  isSelf: boolean;
  isOrganizer: boolean;
}

export type EventTime = { dateTime: string; timeZone: string | null } | { date: string };

export interface NormalizedEvent {
  /** Instance id for occurrences. */
  providerEventId: string;
  providerCalendarId: string;
  iCalUid: string | null;
  seriesMasterId: string | null;
  /** For modified occurrences. */
  originalStart: EventTime | null;
  isOccurrence: boolean;
  status: 'confirmed' | 'tentative' | 'cancelled';
  /** ≤ 300. */
  title: string;
  /** Sanitised plain text ≤ 500 chars; the full description is only ever transient. */
  descriptionSnippet: string | null;
  /** ≤ 300. */
  location: string | null;
  start: EventTime;
  end: EventTime;
  allDay: boolean;
  organizer: MailAddress | null;
  userIsOrganizer: boolean;
  /** Capped at 100. */
  attendees: NormalizedAttendee[];
  /** Allow-listed conferencing URL only (url-safety `checkConferencingUrl`). */
  conferenceUrl: string | null;
  transparency: 'busy' | 'free';
  visibility: 'default' | 'public' | 'private' | 'confidential';
  etag: string | null;
  updatedAt: string | null;
  /** extendedProperties.private.da_approval_id / Graph extended property. */
  daApprovalId: string | null;
  deleted: boolean;
}

export interface NormalizedTaskList {
  providerListId: string;
  name: string;
  isDefault: boolean;
  deleted: boolean;
}

export interface NormalizedTask {
  providerTaskId: string;
  providerListId: string;
  /** ≤ 1,024 (Google limit). */
  title: string;
  /** ≤ 500. */
  notesSnippet: string | null;
  status: 'open' | 'completed';
  /** Google Tasks: date only. */
  due: { date: string } | { dateTime: string; timeZone: string } | null;
  completedAt: string | null;
  importance: 'low' | 'normal' | 'high' | null;
  updatedAt: string | null;
  /** "[DA:…]" found in notes / linkedResources.externalId. */
  daMarker: string | null;
  deleted: boolean;
}

// ---------------------------------------------------------------------------------------------
// Idempotency markers and write specs (§2.3)

export interface IdempotencyMarker {
  /** approval_actions.id (uuid). */
  approvalId: string;
  /** approval_actions.idempotency_key. */
  idempotencyKey: string;
  /** `<approval-${approvalId}@${MAIL_MESSAGE_ID_DOMAIN}>` */
  rfc822MessageId: string;
  /** 'da' + base32hex(uuid bytes), lower-case, no padding. */
  googleEventId: string;
  /** = approvalId. */
  graphTransactionId: string;
  /** `[DA:${sha256hex(idempotencyKey).slice(0, 12)}]` */
  textMarker: string;
  /** `${PUBLIC_WEB_URL}/app/approvals/${approvalId}` */
  deepLinkUrl: string;
}

export type WriteOutcome =
  | {
      kind: 'created';
      providerId: string;
      providerThreadId?: string | null;
      webLink?: string | null;
    }
  | { kind: 'already_exists'; providerId: string; webLink?: string | null }
  | { kind: 'updated'; providerId: string };

export interface OutboundReply {
  inReplyToProviderMessageId: string;
  providerThreadId: string;
  originalRfc822MessageId: string | null;
  originalReferences: string[];
  /** Must equal the connected mailbox; enforced by the executor. */
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  /** Exactly as approved. */
  subject: string;
  /** Exactly as approved, ≤ 20,000 chars. */
  bodyText: string;
  marker: IdempotencyMarker;
}

export interface EventWriteSpec {
  providerCalendarId: string;
  title: string;
  /** Approved text only. */
  description: string | null;
  start: EventTime;
  end: EventTime;
  location: string | null;
  /** Empty unless the approval explicitly lists attendees. */
  attendees: MailAddress[];
  /** 'all' only when attendees are non-empty; disclosed as a side effect in the approval. */
  sendUpdates: 'all' | 'none';
  /** ≤ 5 entries. */
  reminderMinutes: number[];
  marker: IdempotencyMarker;
}

export interface EventPatchSpec {
  providerCalendarId: string;
  providerEventId: string;
  expectedEtag: string | null;
  start?: EventTime;
  end?: EventTime;
  title?: string;
  location?: string | null;
  sendUpdates: 'all' | 'none';
  marker: IdempotencyMarker;
}

export interface TaskWriteSpec {
  providerListId: string;
  title: string;
  notes: string | null;
  due: { date: string } | { dateTime: string; timeZone: string } | null;
  importance: 'low' | 'normal' | 'high';
  marker: IdempotencyMarker;
}

// ---------------------------------------------------------------------------------------------
// OAuth (§2.4)

export interface TokenSet {
  accessToken: string;
  accessTokenExpiresAt: string;
  /** Google: omitted on refresh; Microsoft: rotated on every use. */
  refreshToken: string | null;
  /** Space-delimited, as returned by the token endpoint. */
  grantedScope: string;
  idToken: string | null;
}

export interface ProviderIdentity {
  providerAccountId: string;
  email: string | null;
  displayName: string | null;
  tenantId: string | null;
  tenantType: 'personal' | 'work' | null;
}

export type RevokeResult =
  | { mode: 'provider_revoked' }
  | { mode: 'local_only'; userActionUrl: string }
  | { mode: 'device_local' };

export interface OAuthProvider {
  readonly provider: ServerProvider;
  scopesFor(capabilities: readonly Capability[], opts: { includeIdentity: boolean }): string[];
  buildAuthorizationUrl(p: {
    state: string;
    codeChallenge: string;
    scopes: string[];
    redirectUri: string;
    loginHint?: string | null;
    prompt?: 'consent' | 'select_account' | null;
    locale: 'tr' | 'en';
  }): string;
  exchangeCode(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenSet>;
  refresh(p: { refreshToken: string; tenantId?: string | null }): Promise<TokenSet>;
  revoke(p: { refreshToken: string }): Promise<RevokeResult>;
  identify(tokens: TokenSet): Promise<ProviderIdentity>;
  capabilitiesFromGrantedScope(grantedScope: string): Capability[];
  classifyError(e: unknown): ProviderErrorCode;
}

// ---------------------------------------------------------------------------------------------
// MailProvider (§2.5)

export interface MailWindowQuery {
  folder: 'inbox' | 'sent';
  receivedAfter: string;
  receivedBefore?: string;
  /** Gmail: -category:promotions -category:social -category:forums */
  excludeBulkCategories: boolean;
  /** VIP / explicit-rule senders (≤ 20 per query). */
  fromAnyOf?: string[];
}

export interface MailCursor {
  kind: 'gmail_history' | 'graph_delta' | 'demo_clock';
  value: string;
  folder?: 'inbox' | 'sentitems';
}

export interface MailChangeSet {
  /** Graph delta returns full selected fields. */
  upserts: NormalizedMailMessage[];
  /** Gmail history returns ids only. */
  needsMetadata: string[];
  labelChanges: { providerMessageId: string; labels: string[]; isRead: boolean | null }[];
  deleted: string[];
  nextCursor: MailCursor;
  /** Non-null ⇒ call again before committing nextCursor. */
  pageToken: string | null;
}

/** → sync_states.resource / resource_key, watch_id, watch_resource_id, watch_expires_at, watch_token_hash */
export interface WatchHandle {
  resource: string;
  resourceKey: string;
  watchId: string;
  providerResourceId: string | null;
  expiresAt: string;
  tokenHash: string | null;
}

export interface MailProvider {
  readonly provider: ServerProvider;
  getProfile(
    ctx: ProviderContext,
  ): Promise<ProviderIdentity & { mailboxCursorHint: string | null }>;
  /** Cheap list-only count (First Analysis "N mail bulundu"). */
  countMessages(ctx: ProviderContext, q: MailWindowQuery): Promise<number>;
  listMessageIds(
    ctx: ProviderContext,
    q: MailWindowQuery,
    pageToken?: string | null,
  ): Promise<ProviderPage<{ id: string; threadId: string }>>;
  getMessagesMetadata(
    ctx: ProviderContext,
    ids: string[],
  ): Promise<(NormalizedMailMessage | { providerMessageId: string; notFound: true })[]>;
  getMessageBody(
    ctx: ProviderContext,
    providerMessageId: string,
    opts: { maxBytes: number },
  ): Promise<TransientMailBody>;
  getAttachment(
    ctx: ProviderContext,
    providerMessageId: string,
    providerAttachmentId: string,
    opts: { maxBytes: number },
  ): Promise<{ bytes: Uint8Array; mimeType: string }>;
  baseline(ctx: ProviderContext, folder: 'inbox' | 'sentitems'): Promise<MailCursor>;
  /** Throws ProviderError('cursor_invalid') when the cursor is gone. */
  changesSince(
    ctx: ProviderContext,
    cursor: MailCursor,
    pageToken?: string | null,
  ): Promise<MailChangeSet>;
  watch(ctx: ProviderContext, resourceKey: string): Promise<WatchHandle>;
  renewWatch(ctx: ProviderContext, handle: WatchHandle): Promise<WatchHandle>;
  stopWatch(ctx: ProviderContext, handle: WatchHandle): Promise<void>;
  sendReply(ctx: ProviderContext, reply: OutboundReply): Promise<WriteOutcome>;
  findSentByMarker(
    ctx: ProviderContext,
    marker: IdempotencyMarker,
    reply: OutboundReply,
    sentAfter: string,
  ): Promise<WriteOutcome | null>;
  webLinkFor(
    ctx: ProviderContext,
    msg: Pick<NormalizedMailMessage, 'providerMessageId' | 'providerThreadId' | 'webLink'>,
  ): string | null;
}

// ---------------------------------------------------------------------------------------------
// CalendarProvider (§2.6)

export interface CalendarWindow {
  start: string;
  end: string;
}

export interface CalendarCursor {
  kind: 'gcal_sync_token' | 'graph_calendar_view_delta' | 'demo_clock';
  value: string;
  window?: CalendarWindow;
}

export interface CalendarChangeSet {
  upserts: NormalizedEvent[];
  deleted: string[];
  nextCursor: CalendarCursor | null;
  pageToken: string | null;
}

export interface CalendarProvider {
  readonly provider: ServerProvider;
  listCalendars(ctx: ProviderContext): Promise<NormalizedCalendar[]>;
  getUserTimeZone(ctx: ProviderContext): Promise<string | null>;
  fullSync(
    ctx: ProviderContext,
    providerCalendarId: string,
    window: CalendarWindow,
    pageToken?: string | null,
  ): Promise<CalendarChangeSet>;
  /** Throws ProviderError('cursor_invalid') on 410. */
  changesSince(
    ctx: ProviderContext,
    providerCalendarId: string,
    cursor: CalendarCursor,
    pageToken?: string | null,
  ): Promise<CalendarChangeSet>;
  expandSeries(
    ctx: ProviderContext,
    providerCalendarId: string,
    seriesMasterId: string,
    window: CalendarWindow,
  ): Promise<NormalizedEvent[]>;
  getEvent(
    ctx: ProviderContext,
    providerCalendarId: string,
    providerEventId: string,
  ): Promise<NormalizedEvent | null>;
  /** Transient: never persisted. */
  getEventDescription(
    ctx: ProviderContext,
    providerCalendarId: string,
    providerEventId: string,
    opts: { maxBytes: number },
  ): Promise<string | null>;
  watch(ctx: ProviderContext, providerCalendarId: string): Promise<WatchHandle>;
  renewWatch(ctx: ProviderContext, handle: WatchHandle): Promise<WatchHandle>;
  stopWatch(ctx: ProviderContext, handle: WatchHandle): Promise<void>;
  createEvent(ctx: ProviderContext, spec: EventWriteSpec): Promise<WriteOutcome>;
  updateEvent(ctx: ProviderContext, patch: EventPatchSpec): Promise<WriteOutcome>;
  findEventByMarker(
    ctx: ProviderContext,
    providerCalendarId: string,
    marker: IdempotencyMarker,
    around: CalendarWindow,
  ): Promise<WriteOutcome | null>;
}

// ---------------------------------------------------------------------------------------------
// TaskProvider (§2.7)

export interface TaskCursor {
  kind: 'gtasks_updated_min' | 'graph_todo_delta' | 'demo_clock';
  value: string;
}

export interface TaskChangeSet {
  upserts: NormalizedTask[];
  deleted: string[];
  nextCursor: TaskCursor;
  pageToken: string | null;
}

export interface TaskProvider {
  readonly provider: ServerProvider;
  listTaskLists(ctx: ProviderContext): Promise<NormalizedTaskList[]>;
  changesSince(
    ctx: ProviderContext,
    providerListId: string,
    cursor: TaskCursor | null,
    pageToken?: string | null,
  ): Promise<TaskChangeSet>;
  createTask(ctx: ProviderContext, spec: TaskWriteSpec): Promise<WriteOutcome>;
  findTaskByMarker(
    ctx: ProviderContext,
    providerListId: string,
    marker: IdempotencyMarker,
    createdAfter: string,
  ): Promise<WriteOutcome | null>;
}

export interface ServerProviderAdapters {
  oauth: OAuthProvider;
  mail?: MailProvider;
  calendar?: CalendarProvider;
  tasks?: TaskProvider;
}

export type ServerProviderRegistry = Record<ServerProvider, ServerProviderAdapters>;

/** The error codes adapters classify provider failures into (§2.9; see errors.ts). */
export const PROVIDER_ERROR_CODES = [
  'auth_invalid_grant',
  'auth_token_rejected',
  'consent_admin_required',
  'consent_denied',
  'scope_missing',
  'account_mismatch',
  'mailbox_unavailable',
  'conditional_access_blocked',
  'rate_limited',
  'quota_exhausted_daily',
  'cursor_invalid',
  'not_found',
  'conflict_exists',
  'precondition_failed',
  'not_organizer',
  'provider_unavailable',
  'client_credential_invalid',
  'external_credential_required',
  'payload_invalid',
  'unknown',
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];
