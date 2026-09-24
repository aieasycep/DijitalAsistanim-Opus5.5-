/**
 * Notification decision engine (M§132; ADR-10; R-13, R-14; TEST_PLAN §2.12). The seven checks
 * run in this order and the first failing check decides:
 *
 *   1 relevance → 2 urgency → 3 category preference → 4 quiet hours (user tz) → 5 dedupe key →
 *   6 rolling 24 h frequency caps → 7 lock-screen sensitivity / detail mode
 *
 * The outcome is `send | schedule | suppress` with a reason code recorded in `notifications`.
 * Quiet hours (default on, 22:30–07:30) defer everything except (a) user-created smart reminders
 * at the time the user chose and (b) VIP `critical_email` with `vip_bypass_quiet` (Pro, per-VIP
 * override), still deduped and capped at 3 per quiet window. Admin test pushes never bypass.
 */
import type {
  NotificationCategory,
  NotificationDecision,
  NotificationDetail,
  Urgency,
} from '../enums.ts';
import type { NotificationSuppressionReason } from '../entities/intelligence.ts';
import type { NotificationPreferences } from '../entities/preferences.ts';
import { type Instant, quietWindowContaining, toDate } from '../time/zone.ts';

export type CandidateKind = 'standard' | 'user_reminder' | 'admin_test';

export interface NotificationCandidate {
  readonly category: NotificationCategory;
  readonly kind?: CandidateKind;
  readonly dedupeKey: string;
  readonly urgency: Urgency;
  /** The underlying item is still open/meaningful (false → `low_relevance`). */
  readonly relevant?: boolean;
  /** The user's plan allows this category (midday/evening/follow-up need Pro). */
  readonly entitled?: boolean;
  /** Intended delivery time (briefing slot, reminder fire time). */
  readonly scheduledFor?: Instant | null;
  /** After this instant the push is stale (a meeting start, an expiring approval). */
  readonly validUntil?: Instant | null;
  /** VIP sender (the engines apply VIP effects only for Pro users). */
  readonly vip?: { readonly isVip: boolean; readonly bypassQuietHours: boolean } | null;
}

/** A push already delivered in the last 24 h (from the `notifications` ledger). */
export interface SentRecord {
  readonly category: NotificationCategory;
  readonly kind?: CandidateKind;
  readonly sentAt: Instant;
  readonly bypassedQuietHours?: boolean;
}

export interface DecisionState {
  /** `notifications (user_id, dedupe_key)` already exists (sent or scheduled). */
  readonly dedupeKeyExists: boolean;
  readonly recent: readonly SentRecord[];
  readonly hasActiveDevice: boolean;
  readonly osPermission?: 'granted' | 'denied' | 'provisional' | 'undetermined';
}

export type DeliveryPlatform = 'ios' | 'android';

export interface DecisionContext {
  readonly prefs: Omit<NotificationPreferences, 'user_id'>;
  readonly timeZone: string;
  readonly now: Instant;
  readonly isPro: boolean;
  /** Per-category rolling 24 h caps (`app_settings` `notifications.cap.*`). */
  readonly categoryCaps?: Partial<Readonly<Record<NotificationCategory, number>>>;
  /** Late-delivery threshold in minutes (ADR-28: 90). */
  readonly lateDeliveryMinutes?: number;
  /** VIP pushes allowed through one quiet window (R-13: 3). */
  readonly vipQuietWindowCap?: number;
}

export type DecisionOutcome = 'send' | 'schedule' | 'suppress';

export type CheckName =
  | 'relevance'
  | 'urgency'
  | 'category_preference'
  | 'quiet_hours'
  | 'dedupe'
  | 'frequency_cap'
  | 'detail_mode';

/** The seven M§132 checks, in evaluation order. */
export const DECISION_CHECKS: readonly CheckName[] = [
  'relevance',
  'urgency',
  'category_preference',
  'quiet_hours',
  'dedupe',
  'frequency_cap',
  'detail_mode',
];

export interface NotificationDecisionResult {
  readonly outcome: DecisionOutcome;
  /** `notifications.decision` to record (`sent` once the Expo send succeeds). */
  readonly ledgerDecision: NotificationDecision;
  readonly reason: NotificationSuppressionReason | null;
  /** The check that decided (`detail_mode` when every check passed). */
  readonly decidedBy: CheckName;
  readonly scheduleAt: Date | null;
  /** Detail mode per platform (iOS capped at `title_only` while `lock_screen_private`). */
  readonly detail: Readonly<Record<DeliveryPlatform, NotificationDetail>>;
  /** Detail recorded in the ledger (the most private of the platforms). */
  readonly detailMode: NotificationDetail;
  readonly bypassedQuietHours: boolean;
}

export const DEFAULT_CATEGORY_CAPS: Readonly<Partial<Record<NotificationCategory, number>>> = {
  follow_up: 2,
  life_intel: 3,
  deadline: 3,
};
export const LATE_DELIVERY_MINUTES = 90;
export const VIP_QUIET_WINDOW_CAP = 3;

/** Categories that never count toward the non-critical daily cap. */
export const CRITICAL_CATEGORIES: readonly NotificationCategory[] = [
  'critical_email',
  'meeting',
  'account',
];
const BRIEFINGS: readonly NotificationCategory[] = ['morning', 'midday', 'evening'];

/** Whether a push counts toward `daily_cap` (R-14: non-critical only; briefings are user-scheduled). */
export function countsTowardDailyCap(
  category: NotificationCategory,
  kind: CandidateKind = 'standard',
): boolean {
  if (kind !== 'standard') return false;
  return !CRITICAL_CATEGORIES.includes(category) && !BRIEFINGS.includes(category);
}

const DETAIL_ORDER: readonly NotificationDetail[] = ['generic', 'title_only', 'full'];

/** The more private of two detail modes. */
export function minDetail(a: NotificationDetail, b: NotificationDetail): NotificationDetail {
  return DETAIL_ORDER.indexOf(a) <= DETAIL_ORDER.indexOf(b) ? a : b;
}

/**
 * Detail mode per platform (INTEGRATION_PLAN §9.5): admin test pushes are always `generic`; with
 * `lock_screen_private` iOS is capped at `title_only` (the server cannot know whether the device is
 * locked); Android relies on the PRIVATE channel and keeps the chosen mode.
 */
export function detailModeFor(
  prefs: Pick<NotificationPreferences, 'detail_level' | 'lock_screen_private'>,
  platform: DeliveryPlatform,
  kind: CandidateKind = 'standard',
): NotificationDetail {
  if (kind === 'admin_test') return 'generic';
  if (platform === 'ios' && prefs.lock_screen_private)
    return minDetail(prefs.detail_level, 'title_only');
  return prefs.detail_level;
}

const DAY_MS = 86_400_000;

/**
 * `decide()`: runs the seven checks and returns send / schedule / suppress with its reason.
 * Pure; `now` and the ledger state are inputs.
 */
export function decide(
  candidate: NotificationCandidate,
  state: DecisionState,
  ctx: DecisionContext,
): NotificationDecisionResult {
  const now = toDate(ctx.now);
  const kind = candidate.kind ?? 'standard';
  const prefs = ctx.prefs;
  const detail = {
    ios: detailModeFor(prefs, 'ios', kind),
    android: detailModeFor(prefs, 'android', kind),
  } as const;
  const detailMode = minDetail(detail.ios, detail.android);
  const base = { detail, detailMode, bypassedQuietHours: false };

  const suppress = (
    decidedBy: CheckName,
    reason: NotificationSuppressionReason,
  ): NotificationDecisionResult => ({
    ...base,
    outcome: 'suppress',
    ledgerDecision: reason === 'deduplicated' ? 'deduplicated' : 'suppressed',
    reason,
    decidedBy,
    scheduleAt: null,
  });
  const schedule = (decidedBy: CheckName, at: Date): NotificationDecisionResult => ({
    ...base,
    outcome: 'schedule',
    ledgerDecision: 'scheduled',
    reason: null,
    decidedBy,
    scheduleAt: at,
  });
  const validUntil = candidate.validUntil ? toDate(candidate.validUntil) : null;

  // 1. relevance (incl. entitlement and late delivery, ADR-28)
  if (candidate.relevant === false) return suppress('relevance', 'low_relevance');
  if (candidate.entitled === false) return suppress('relevance', 'not_entitled');
  if (validUntil && validUntil.getTime() <= now.getTime())
    return suppress('relevance', 'low_relevance');
  const scheduledFor = candidate.scheduledFor ? toDate(candidate.scheduledFor) : null;
  const lateLimit = (ctx.lateDeliveryMinutes ?? LATE_DELIVERY_MINUTES) * 60_000;
  if (kind === 'standard' && scheduledFor && now.getTime() - scheduledFor.getTime() > lateLimit) {
    return suppress('relevance', 'late_delivery');
  }

  // 2. urgency (smart filter "Yalnızca gerçekten önemliyse bildir": only urgent/today pass)
  const urgencyExempt =
    kind !== 'standard' ||
    BRIEFINGS.includes(candidate.category) ||
    candidate.category === 'account';
  if (!urgencyExempt) {
    if (candidate.urgency === 'low') return suppress('urgency', 'low_relevance');
    if (prefs.smart_filter && candidate.urgency !== 'urgent' && candidate.urgency !== 'today') {
      return suppress('urgency', 'smart_filter');
    }
  }

  // 3. category preference (+ "Yarına Hazırım" snooze of non-critical categories)
  if (kind === 'standard' && !prefs[candidate.category]) {
    return suppress('category_preference', 'category_disabled');
  }
  const snoozeUntil = prefs.snooze_until ? toDate(prefs.snooze_until) : null;
  const snoozeExempt =
    kind === 'user_reminder' ||
    candidate.category === 'critical_email' ||
    candidate.category === 'meeting';
  if (snoozeUntil && snoozeUntil.getTime() > now.getTime() && !snoozeExempt) {
    if (validUntil && validUntil.getTime() <= snoozeUntil.getTime()) {
      return suppress('category_preference', 'snoozed');
    }
    return schedule('category_preference', snoozeUntil);
  }

  // not due yet: deliver at the intended time (the worker re-runs decide() then)
  if (scheduledFor && scheduledFor.getTime() > now.getTime()) {
    return schedule('relevance', scheduledFor);
  }

  // 4. quiet hours in the user's zone (R-13)
  let bypassed = false;
  if (prefs.quiet_hours_enabled) {
    const window = quietWindowContaining(
      { start: prefs.quiet_start, end: prefs.quiet_end, days: prefs.quiet_days },
      now,
      ctx.timeZone,
    );
    if (window) {
      const vipBypass =
        kind === 'standard' &&
        candidate.category === 'critical_email' &&
        ctx.isPro &&
        prefs.vip_bypass_quiet &&
        candidate.vip?.isVip === true &&
        candidate.vip.bypassQuietHours;
      const cap = ctx.vipQuietWindowCap ?? VIP_QUIET_WINDOW_CAP;
      const usedInWindow = state.recent.filter((r) => {
        const t = toDate(r.sentAt).getTime();
        return (
          r.bypassedQuietHours === true && t >= window.start.getTime() && t < window.end.getTime()
        );
      }).length;
      if (kind === 'user_reminder') {
        bypassed = true;
      } else if (vipBypass && usedInWindow < cap) {
        bypassed = true;
      } else {
        if (validUntil && validUntil.getTime() <= window.end.getTime()) {
          return suppress('quiet_hours', 'quiet_hours');
        }
        return schedule('quiet_hours', window.end);
      }
    }
  }

  // 5. dedupe key
  if (state.dedupeKeyExists) return suppress('dedupe', 'deduplicated');

  // 6. rolling 24 h caps: per category and the global non-critical daily cap (R-14)
  const since = now.getTime() - DAY_MS;
  const last24 = state.recent.filter((r) => toDate(r.sentAt).getTime() > since);
  const caps = { ...DEFAULT_CATEGORY_CAPS, ...ctx.categoryCaps };
  const catCap = kind === 'standard' ? caps[candidate.category] : undefined;
  if (catCap !== undefined) {
    const n = last24.filter(
      (r) => r.category === candidate.category && (r.kind ?? 'standard') === 'standard',
    ).length;
    if (n >= catCap) return suppress('frequency_cap', 'frequency_cap');
  }
  if (countsTowardDailyCap(candidate.category, kind)) {
    const n = last24.filter((r) => countsTowardDailyCap(r.category, r.kind ?? 'standard')).length;
    if (n >= prefs.daily_cap) return suppress('frequency_cap', 'frequency_cap');
  }

  // 7. lock-screen sensitivity / detail mode, then deliverability
  if (!state.hasActiveDevice) return suppress('detail_mode', 'no_device');
  if (state.osPermission === 'denied') return suppress('detail_mode', 'os_permission_denied');
  return {
    ...base,
    bypassedQuietHours: bypassed,
    outcome: 'send',
    ledgerDecision: 'sent',
    reason: null,
    decidedBy: 'detail_mode',
    scheduleAt: null,
  };
}
