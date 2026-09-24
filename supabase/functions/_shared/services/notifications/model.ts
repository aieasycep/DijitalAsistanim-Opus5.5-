/**
 * Notification pipeline types (API_CONTRACTS JOB-18/19, DATABASE_AND_RLS_PLAN §4.5, INTEGRATION_PLAN
 * §9): the internal notification spec every producer resolves to, the ledger row and the database
 * access of the pipeline, the receipts job and the time-based triggers.
 */
import type {
  CandidateKind,
  InterruptionLevel,
  NotificationCategory,
  NotificationDecision,
  NotificationDetail,
  NotificationPreferences,
  NotificationSuppressionReason,
  PushTemplate,
  Urgency,
} from '@da/domain';
import type { Json } from '../../jobs/types.ts';

/** What to push, before the decision engine (one ledger row per spec, keyed by `dedupeKey`). */
export interface NotificationSpec {
  readonly category: NotificationCategory;
  readonly dedupeKey: string;
  /** Catalog template: `push.<template>.<variant>.<mode>.title|body`. */
  readonly template: PushTemplate;
  readonly variant: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly deeplink: string | null;
  /** Counts, times, minutes: rendered in `full` and `title_only`. */
  readonly paramsPublic: Readonly<Record<string, string | number>>;
  /** Names, subjects, titles: rendered in `full` only (C-14). */
  readonly paramsSensitive: Readonly<Record<string, string>>;
  readonly urgency: Urgency;
  readonly kind: CandidateKind;
  readonly scheduledFor: Date | null;
  readonly validUntil: Date | null;
  readonly relevant: boolean;
  readonly entitled: boolean;
  readonly vip: { readonly isVip: boolean; readonly bypassQuietHours: boolean } | null;
  /** Explicit iOS level (post-meeting prompts are passive); otherwise derived per category. */
  readonly interruption: InterruptionLevel | null;
  readonly minutesToStart: number | null;
  readonly approvalExpiringSoon: boolean;
  readonly fromAndroidSignal: boolean;
  /** Deliver only to this installation (`app_installations.id`), e.g. test pushes. */
  readonly installationRowId: string | null;
  readonly isTest: boolean;
  /** User test pushes: "Test · " title prefix, no caps, no dedupe against other pushes. */
  readonly userTest: boolean;
  readonly sound: boolean;
  /** Ledger priority 0..100. */
  readonly priority: number;
}

export interface NotificationRow {
  readonly id: string;
  readonly user_id: string;
  readonly category: NotificationCategory;
  readonly decision: NotificationDecision;
  readonly suppression_reason: NotificationSuppressionReason | null;
  readonly dedupe_key: string;
  readonly scheduled_for: string;
  readonly sent_at: string | null;
  readonly job_id: string | null;
  readonly is_test: boolean;
}

export interface NotificationInsert {
  readonly user_id: string;
  readonly category: NotificationCategory;
  readonly decision: NotificationDecision;
  readonly suppression_reason: NotificationSuppressionReason | null;
  readonly dedupe_key: string;
  readonly priority: number;
  readonly detail_mode: NotificationDetail;
  readonly title_rendered: string | null;
  readonly body_rendered: string | null;
  readonly data: { type: string; entity_id: string | null; deeplink: string };
  readonly entity_type: string | null;
  readonly entity_id: string | null;
  readonly interruption_level: InterruptionLevel;
  readonly android_channel: string;
  readonly scheduled_for: string;
  readonly sent_at: string | null;
  readonly failed_at: string | null;
  readonly error_code: string | null;
  readonly job_id: string | null;
  readonly correlation_id: string | null;
  readonly is_test: boolean;
}

export type NotificationUpdate = Partial<Omit<NotificationInsert, 'user_id' | 'dedupe_key'>>;

export interface PushTarget {
  /** `push_tokens.id` */
  readonly tokenId: string;
  readonly token: string;
  readonly platform: 'ios' | 'android';
  readonly installationRowId: string;
}

export interface UserNotificationState {
  readonly prefs: Omit<NotificationPreferences, 'user_id'>;
  readonly timeZone: string;
  readonly locale: 'tr' | 'en';
  readonly isPro: boolean;
  readonly osPermission: 'granted' | 'denied' | 'provisional' | 'undetermined';
}

export type TicketStatus = 'ok' | 'error' | 'pending_receipt' | 'receipt_ok' | 'receipt_error';
export type ExpoErrorCode =
  | 'DeviceNotRegistered'
  | 'MessageTooBig'
  | 'MessageRateExceeded'
  | 'MismatchSenderId'
  | 'InvalidCredentials'
  | 'Unknown';

export interface TicketInsert {
  readonly user_id: string;
  readonly notification_id: string;
  readonly push_token_id: string;
  readonly expo_ticket_id: string | null;
  readonly status: TicketStatus;
  readonly error_code: ExpoErrorCode | null;
  readonly sent_at: string;
}

export interface PendingTicket {
  readonly id: string;
  readonly expo_ticket_id: string;
  readonly push_token_id: string | null;
  readonly sent_at: string;
}

/** Database access of the notification pipeline (service role, verified ids only). */
export interface NotificationsRepo {
  getNotification(userId: string, id: string): Promise<NotificationRow | null>;
  findByDedupe(userId: string, dedupeKey: string): Promise<NotificationRow | null>;
  /** Inserts a ledger row; `null` when `(user_id, dedupe_key)` already exists. */
  insertNotification(row: NotificationInsert): Promise<NotificationRow | null>;
  updateNotification(id: string, patch: NotificationUpdate): Promise<void>;
  userState(userId: string): Promise<UserNotificationState>;
  /** Active, non-backed-off push tokens (optionally one installation). */
  activeTargets(userId: string, installationRowId: string | null, now: Date): Promise<PushTarget[]>;
  /** `sent` pushes since `since` (caps and the VIP quiet-window count). */
  recentSent(
    userId: string,
    since: Date,
  ): Promise<
    { category: NotificationCategory; sent_at: string; dedupe_key: string; is_test: boolean }[]
  >;
  categoryCaps(): Promise<Partial<Record<NotificationCategory, number>>>;
  ticketCount(notificationId: string): Promise<number>;
  insertTickets(rows: readonly TicketInsert[]): Promise<void>;
  disableToken(tokenId: string, reason: 'device_not_registered'): Promise<void>;
  backoffToken(tokenId: string, until: Date): Promise<void>;
  /** Tickets waiting for a receipt, sent before `sentBefore` (oldest first). */
  pendingTickets(
    sentBefore: Date,
    limit: number,
    ids?: readonly string[],
  ): Promise<PendingTicket[]>;
  resolveTicket(
    id: string,
    status: TicketStatus,
    errorCode: ExpoErrorCode | null,
    checkedAt: Date,
  ): Promise<void>;
  recordPushHealth(status: 'degraded' | 'healthy', detail: Record<string, Json>): Promise<void>;
}

export class NotificationSkip extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'NotificationSkip';
  }
}
