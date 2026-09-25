/**
 * Time-based notification triggers (IMPLEMENTATION_PLAN T-6.08, API_CONTRACTS §11.3, JOB-18). Each
 * trigger turns an ids-only job payload into a `NotificationSpec` from fresh data, or skips when the
 * item is gone, finished or no longer due. `onSent` / `onDropped` update the source row (reminder
 * delivered, briefing delivered, …).
 */
import type { InsightKind, NotificationCategory, ReminderStatus } from '@da/domain';
import type { NotificationJobPayload } from '../create.ts';
import type { NotificationSpec } from '../model.ts';

export interface EventInfo {
  readonly id: string;
  readonly title: string | null;
  readonly start_at: string;
  readonly end_at: string;
  readonly status: 'confirmed' | 'tentative' | 'cancelled';
  readonly all_day: boolean;
  readonly attendee_count: number;
  readonly provider_deleted_at: string | null;
}

export interface ReminderInfo {
  readonly id: string;
  readonly title: string;
  readonly remind_at: string;
  readonly channel: 'push' | 'local' | 'provider_task' | 'apple_reminders';
  readonly status: ReminderStatus;
  readonly notification_category: NotificationCategory | null;
}

export interface InsightInfo {
  readonly id: string;
  readonly kind: InsightKind;
  readonly status: string;
  readonly title: string;
  readonly urgency: 'urgent' | 'today' | 'normal' | 'low';
  readonly entity_type: string;
  readonly entity_id: string;
  readonly due_at: string | null;
  readonly event_at: string | null;
  readonly created_at: string;
  /** Counterparty display name for follow-ups, when known. */
  readonly person: string | null;
}

export interface ApprovalInfo {
  readonly id: string;
  readonly status: string;
  readonly what: string;
  readonly action_type: string;
  readonly approval_expires_at: string;
  readonly attempt_count: number;
  readonly payload_version: number;
}

export interface BriefingInfo {
  readonly id: string;
  readonly kind: 'morning' | 'midday' | 'evening' | 'weekly';
  readonly status: string;
  readonly scheduled_for: string;
  readonly headline: string | null;
  readonly counts: Readonly<Record<string, unknown>>;
  readonly weekly_stats: Readonly<Record<string, unknown>> | null;
}

export interface SubscriptionInfo {
  readonly status: string;
  readonly period_type: string | null;
  readonly expires_at: string | null;
  readonly will_renew: boolean;
  readonly product_id: string | null;
}

/** Reads and state updates the triggers need (service role, verified user id). */
export interface TriggerRepo {
  event(userId: string, id: string): Promise<EventInfo | null>;
  meetingPrep(userId: string, eventId: string): Promise<{ status: string; topics: number } | null>;
  reminder(userId: string, id: string): Promise<ReminderInfo | null>;
  setReminderStatus(
    userId: string,
    id: string,
    status: 'delivered' | 'failed',
    at: Date,
  ): Promise<void>;
  insight(userId: string, id: string): Promise<InsightInfo | null>;
  approval(userId: string, id: string): Promise<ApprovalInfo | null>;
  briefing(userId: string, id: string): Promise<BriefingInfo | null>;
  markBriefingDelivered(userId: string, id: string, at: Date): Promise<void>;
  subscription(userId: string): Promise<SubscriptionInfo | null>;
  /** The connected account of an `account_reauth` notification (absent → the job is skipped). */
  connectedAccount?(userId: string, id: string): Promise<AccountInfo | null>;
}

export interface AccountInfo {
  readonly provider: string;
  readonly demo_flavor: string | null;
  readonly status: string;
}

export interface TriggerContext {
  readonly repo: TriggerRepo;
  readonly userId: string;
  readonly payload: NotificationJobPayload;
  readonly now: Date;
  readonly timeZone: string;
  readonly locale: 'tr' | 'en';
  readonly isPro: boolean;
  /** The job row's idempotency key (for keys derived from the enqueuer). */
  readonly jobKey: string;
}

export type TriggerOutcome =
  | {
      readonly kind: 'spec';
      readonly spec: NotificationSpec;
      readonly onSent?: (at: Date) => Promise<void>;
      readonly onDropped?: (reason: string, at: Date) => Promise<void>;
    }
  | {
      readonly kind: 'skip';
      readonly reason: string;
      readonly after?: (at: Date) => Promise<void>;
    };

export function skip(reason: string, after?: (at: Date) => Promise<void>): TriggerOutcome {
  return after === undefined ? { kind: 'skip', reason } : { kind: 'skip', reason, after };
}
