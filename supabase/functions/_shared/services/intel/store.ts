/**
 * Data access of the AI pipeline (T-5.01…T-5.08). Handlers depend on these interfaces; the worker
 * wires the service-client implementation (`supabase-store.ts`), tests an in-memory one. Every
 * method is scoped by the verified `user_id` of the job or request.
 */
import type {
  BriefingKind,
  LearnedPreference,
  PriorityRule,
  Provider,
  TransientMailBody,
} from '@da/domain';
import type { LifeEventInsert } from '../life/classify.ts';
import type {
  AccountRow,
  ApprovalInsert,
  ApprovalRow,
  BriefingItemInsert,
  BriefingItemRow,
  BriefingPatch,
  BriefingRow,
  CalendarEventRow,
  CommitmentInsert,
  CommitmentRow,
  InsightRow,
  InsightUpsert,
  LifeEventRow,
  MailMessageRow,
  MailThreadRow,
  MemoryChunkInsert,
  MemoryChunkRow,
  MessagePatch,
  TaskRow,
  ThreadPatch,
} from './types.ts';

export interface VipSet {
  readonly contactIds: readonly string[];
  readonly emails: readonly string[];
  readonly notifyOff: readonly string[];
}

export interface SenderHistory {
  /** Senders with ≥1 two-way exchange in the window (known contacts, AI_PIPELINE_PLAN §1.5). */
  readonly known: ReadonlySet<string>;
  /** Senders the user has written to. */
  readonly repliedBefore: ReadonlySet<string>;
}

export interface PersonRef {
  readonly email: string;
  readonly name?: string | null;
  readonly organization?: string | null;
  readonly at?: string | null;
  readonly role: 'from' | 'to' | 'cc' | 'attendee';
}

export interface ContactRef {
  readonly id: string;
  readonly display_name: string;
  readonly emails: readonly string[];
}

export interface MailStore {
  account(accountId: string): Promise<AccountRow | null>;
  messages(ids: readonly string[]): Promise<MailMessageRow[]>;
  threads(ids: readonly string[]): Promise<MailThreadRow[]>;
  /** The newest `limit` messages of a thread, oldest first. */
  threadMessages(threadId: string, limit: number): Promise<MailMessageRow[]>;
  ownAddresses(userId: string): Promise<string[]>;
  rules(userId: string): Promise<PriorityRule[]>;
  learned(userId: string): Promise<LearnedPreference[]>;
  vip(userId: string): Promise<VipSet>;
  senderHistory(userId: string, emails: readonly string[], since: Date): Promise<SenderHistory>;
  updateMessage(id: string, patch: MessagePatch): Promise<void>;
  updateThread(id: string, patch: ThreadPatch): Promise<void>;
  upsertContacts(userId: string, people: readonly PersonRef[]): Promise<Record<string, string>>;
  linkContacts(userId: string, threadIds: readonly string[], eventIds: readonly string[]): Promise<void>;
  refreshContactStats(userId: string, contactIds: readonly string[] | null): Promise<void>;
  contactsByEmail(userId: string, emails: readonly string[]): Promise<ContactRef[]>;
  upsertLifeEvents(rows: readonly LifeEventInsert[]): Promise<{ id: string; dedupe_key: string }[]>;
  upsertCommitments(rows: readonly CommitmentInsert[]): Promise<{ id: string; dedupe_key: string }[]>;
  /** Pending proposals; duplicates of an `idempotency_key` are ignored. Returns the inserted count. */
  insertApprovals(rows: readonly ApprovalInsert[]): Promise<number>;
  /** Non-cancelled events overlapping [from, to) (busy blocks, conflicts). */
  events(userId: string, from: Date, to: Date): Promise<CalendarEventRow[]>;
  upsertInsights(rows: readonly InsightUpsert[]): Promise<{ id: string; dedupe_key: string }[]>;
}

export interface InsightSnapshot {
  readonly threads: readonly MailThreadRow[];
  /** Latest inbound message per thread in `threads` (source of reply insights). */
  readonly latestInbound: readonly MailMessageRow[];
  readonly commitments: readonly CommitmentRow[];
  readonly lifeEvents: readonly LifeEventRow[];
  readonly events: readonly CalendarEventRow[];
  readonly tasks: readonly TaskRow[];
  readonly approvals: readonly ApprovalRow[];
  /** Existing insights (any status) of the user, for dedupe, suppression and staleness. */
  readonly insights: readonly InsightRow[];
  readonly vip: VipSet;
  readonly ownAddresses: readonly string[];
  readonly ownDomains: readonly string[];
  /** Addresses the user asked not to follow up ("Bunu takip etme", learned `follow_up:'mute'`). */
  readonly mutedContacts: readonly string[];
}

export interface InsightStore {
  snapshot(userId: string, now: Date): Promise<InsightSnapshot>;
  upsertInsights(rows: readonly InsightUpsert[]): Promise<{ id: string; dedupe_key: string }[]>;
  /** open / snoozed → expired (sources that no longer qualify). */
  expireInsights(userId: string, ids: readonly string[]): Promise<void>;
  updateThreads(patches: readonly { id: string; patch: ThreadPatch }[]): Promise<void>;
}

export interface BriefingStore {
  byId(id: string): Promise<BriefingRow | null>;
  forDate(userId: string, kind: BriefingKind, localDate: string): Promise<BriefingRow | null>;
  /** Inserts the scheduled row (`on conflict` returns the existing one). */
  ensure(row: {
    user_id: string;
    kind: BriefingKind;
    local_date: string;
    time_zone: string;
    scheduled_for: string;
    idempotency_key: string;
    origin: string;
  }): Promise<BriefingRow>;
  update(id: string, patch: BriefingPatch): Promise<void>;
  replaceItems(briefingId: string, rows: readonly BriefingItemInsert[]): Promise<void>;
  items(briefingId: string): Promise<BriefingItemRow[]>;
  /** Morning items carried over to `localDate` by last evening's "Yarına Hazırım". */
  carriedTo(userId: string, localDate: string): Promise<BriefingItemRow[]>;
}

export interface WeeklyCounts {
  readonly mailsAnalyzed: number;
  readonly importantCount: number;
  readonly meetings: number;
  readonly prepNotes: number;
  readonly prepNotesOpened: number;
  readonly followups: number;
  readonly followupsAnswered: number;
  readonly deadlines: number;
  readonly deadlinesSurfacedInTime: number;
  readonly draftsSent: number;
  /** Meetings per local weekday (1 = Monday). */
  readonly meetingsByWeekday: Readonly<Record<number, number>>;
  /** The day with most meetings and its longest free gap between them (working hours). */
  readonly busiest: { readonly weekday: number; readonly meetings: number; readonly maxGapMin: number } | null;
}

export interface StatsStore {
  /** Inbound messages received in [from, to) and how many were attention-flagged. */
  mailCounts(userId: string, from: Date, to: Date): Promise<{ total: number; attention: number; calendars: number }>;
  weekly(userId: string, from: Date, to: Date, timeZone: string): Promise<WeeklyCounts>;
  /** Account freshness at generation (`briefings.source_freshness`). */
  freshness(userId: string): Promise<Record<string, unknown>>;
}

export interface MemoryItem {
  readonly kind: 'email_summary' | 'life_event' | 'commitment' | 'capture' | 'meeting_note' | 'assistant_fact' | 'person_profile';
  readonly id: string;
}

export interface MemoryStore {
  /** Builds the derived chunk inputs of the items (never raw bodies). */
  sources(userId: string, items: readonly MemoryItem[]): Promise<MemorySource[]>;
  upsertChunks(rows: readonly MemoryChunkInsert[]): Promise<MemoryChunkRow[]>;
  /** Chunks of the user still without an embedding for the model (bounded). */
  pendingChunks(userId: string, ids: readonly string[] | null, limit: number): Promise<MemoryChunkRow[]>;
  writeEmbeddings(rows: readonly { id: string; embedding: readonly number[]; model: string }[]): Promise<void>;
}

/** Derived inputs for one memory chunk (§10.1). */
export interface MemorySource {
  readonly userId: string;
  readonly chunkKind: string;
  readonly sourceType: MemoryChunkInsert['source_type'];
  readonly sourceId: string;
  readonly sourceProvider: Provider | null;
  readonly sourceTimestamp: string;
  readonly occurredAt: string;
  readonly confidence: number;
  readonly evidence: MemoryChunkInsert['evidence'];
  readonly contactIds: readonly string[];
  /** Derived text: subject, sender, date, summary, key points, verified quotes. */
  readonly content: string;
  readonly expiresAt: string | null;
}

/** Transient mail bodies (provider fetch through the account's adapter; never stored). */
export interface MailBodySource {
  fetch(input: {
    readonly userId: string;
    readonly accountId: string;
    readonly provider: Provider;
    readonly providerMessageId: string;
    readonly maxBytes: number;
    readonly correlationId: string;
    readonly signal?: AbortSignal;
  }): Promise<TransientMailBody | null>;
}
