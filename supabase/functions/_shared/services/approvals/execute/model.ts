/**
 * Types of the `approval_execute` job (API_CONTRACTS JOB-17, §6.4; INTEGRATION_PLAN §3.12).
 */
import type {
  IdempotencyMarker,
  ProviderContext,
  ProviderAccountRef,
  ServerProvider,
  ServerProviderAdapters,
} from '@da/domain';
import type { EnqueueInput, Json } from '../../../jobs/types.ts';
import type { Logger } from '../../../logging/logger.ts';
import type { ApprovalRow, CalendarEventInfo, CalendarInfo, TransitionInput } from '../model.ts';

/** A provider account plus the adapters and context to call it. */
export interface ProviderSession {
  readonly provider: ServerProvider;
  readonly adapters: ServerProviderAdapters;
  readonly ctx: ProviderContext;
}

export interface ProviderSessions {
  open(
    account: ProviderAccountRef,
    opts: { signal: AbortSignal; log: Logger; correlationId: string },
  ): Promise<ProviderSession>;
}

export interface MailContext {
  readonly providerThreadId: string;
  readonly providerMessageId: string;
  readonly internetMessageId: string | null;
  readonly references: readonly string[];
}

/** Rows the executor reads and writes (service role; ids from the approval row only). */
export interface ExecuteRepo {
  approval(id: string): Promise<ApprovalRow | null>;
  transition(input: TransitionInput): Promise<ApprovalRow>;
  accountRef(userId: string, accountId: string): Promise<ProviderAccountRef | null>;
  calendar(userId: string, calendarId: string): Promise<CalendarInfo | null>;
  calendarEvent(userId: string, eventId: string): Promise<CalendarEventInfo | null>;
  mailContext(userId: string, threadId: string, messageId: string): Promise<MailContext | null>;
  displayName(userId: string): Promise<string | null>;
  planFeature(userId: string, key: string): Promise<boolean>;
  /** In-app task (`tasks`, key `approval:{id}`); returns the row id, existing or new. */
  insertTask(row: Record<string, unknown>): Promise<{ id: string; created: boolean }>;
  /** In-app reminder through `schedule_reminder` (key `approval:{id}`). */
  scheduleReminder(
    userId: string,
    row: Record<string, unknown>,
  ): Promise<{ id: string; created: boolean }>;
  /** Commitment (`commitments`, dedupe key `approval:{id}`). */
  insertCommitment(row: Record<string, unknown>): Promise<{ id: string; created: boolean }>;
  markReplyDraftSent(userId: string, draftId: string): Promise<void>;
  markThreadAwaitingReply(userId: string, threadId: string): Promise<void>;
  markInsightDone(userId: string, insightId: string): Promise<void>;
}

export interface ExecEnv {
  readonly approval: ApprovalRow;
  readonly repo: ExecuteRepo;
  readonly sessions: ProviderSessions;
  readonly marker: IdempotencyMarker;
  /** A crash or retry may have written already: probe for the marker first. */
  readonly probeFirst: boolean;
  readonly now: Date;
  readonly signal: AbortSignal;
  readonly log: Logger;
  readonly correlationId: string;
  readonly sleep: (ms: number) => Promise<void>;
}

export interface ExecOutcome {
  /** `approval_actions.provider_idempotency_ref` (Message-ID, event id, transactionId, task id). */
  readonly providerRef: string | null;
  /** `approval_actions.result` (server-only ids, `web_link`, `already_existed`). */
  readonly result: Record<string, Json>;
  readonly followUps: readonly EnqueueInput[];
}

/** A write that failed with a normalised API error code (API_CONTRACTS §2.7). */
export class ExecutionFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds: number | null = null,
    message?: string,
    /** Extra `approval_actions.result` fields (e.g. the provider's `current` state on a 412). */
    readonly detail: Record<string, Json> | null = null,
  ) {
    super(message ?? code);
    this.name = 'ExecutionFailure';
  }
}
