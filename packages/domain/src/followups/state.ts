/**
 * Thread reply state and Smart Follow-Up lifecycle (M§17; AI_PIPELINE_PLAN §6.9.7; T0).
 * `awaiting_their_reply` is never a model label: this state machine assigns it from the thread.
 */
import type { Instant } from '../time/zone.ts';
import { localDate, localDateDiffDays, toDate } from '../time/zone.ts';
import { foldTR, normalizeTR } from '../extract/normalize-tr.ts';
import type { FollowUpState, ReplyState } from '../entities/content.ts';

export type ExpectsReply = 'yes' | 'no' | 'ambiguous';

/** `user_preferences.follow_up_after_days` default. */
export const FOLLOW_UP_AFTER_DAYS_DEFAULT = 2;
/** VIP threads are nudged after one day (AI_PIPELINE_PLAN §7.2). */
export const FOLLOW_UP_AFTER_DAYS_VIP = 1;
/** Waiting badge thresholds, everywhere (SCREEN_AND_FLOW_MAP §0.12). */
export const WAIT_BADGE_AMBER_DAYS = 3;
export const WAIT_BADGE_CORAL_DAYS = 7;

export interface ThreadMessageMeta {
  readonly direction: 'inbound' | 'outbound';
  readonly at: Instant;
  /** Inbound: the T0/T1 triage says the user should answer. */
  readonly needsReply?: boolean;
  /** Outbound: result of {@link detectExpectsReply}. */
  readonly expectsReply?: ExpectsReply;
  /** Auto-replies and bulk mail never create reply obligations. */
  readonly automated?: boolean;
}

export interface ThreadReplyResult {
  readonly state: ReplyState;
  /** When the wait started (the message that created the obligation). */
  readonly since: Date | null;
}

/**
 * Who owes a reply: the last meaningful message decides. The user's last sent message with an
 * expected answer → `awaiting_their_reply`; an inbound message needing a reply without a later
 * user message → `awaiting_my_reply`.
 */
export function threadReplyState(messages: readonly ThreadMessageMeta[]): ThreadReplyResult {
  const sorted = [...messages]
    .filter((m) => !m.automated)
    .sort((a, b) => toDate(a.at).getTime() - toDate(b.at).getTime());
  const last = sorted[sorted.length - 1];
  if (!last) return { state: 'none', since: null };
  if (last.direction === 'outbound') {
    return last.expectsReply === 'yes'
      ? { state: 'awaiting_their_reply', since: toDate(last.at) }
      : { state: 'none', since: null };
  }
  // inbound: the earliest unanswered inbound that needs a reply starts the wait
  const lastOutbound = [...sorted].reverse().find((m) => m.direction === 'outbound');
  const cutoff = lastOutbound ? toDate(lastOutbound.at).getTime() : -Infinity;
  const pending = sorted.filter(
    (m) => m.direction === 'inbound' && m.needsReply === true && toDate(m.at).getTime() > cutoff,
  );
  const first = pending[0];
  return first
    ? { state: 'awaiting_my_reply', since: toDate(first.at) }
    : { state: 'none', since: null };
}

/** Whole local calendar days waited in the user's zone. */
export function waitingDays(since: Instant, now: Instant, timeZone: string): number {
  return Math.max(0, localDateDiffDays(localDate(since, timeZone), localDate(now, timeZone)));
}

export type WaitBadge = 'neutral' | 'amber' | 'coral';

/** Days pill colour: neutral under 3 days, amber from 3, coral from 7 (UT-FUP-01). */
export function waitBadge(days: number): WaitBadge {
  if (days >= WAIT_BADGE_CORAL_DAYS) return 'coral';
  if (days >= WAIT_BADGE_AMBER_DAYS) return 'amber';
  return 'neutral';
}

export interface FollowUpInput {
  readonly replyState: ReplyState;
  readonly awaitingSince: Instant | null;
  readonly now: Instant;
  readonly timeZone: string;
  /** `user_preferences.follow_up_after_days` (1..14). */
  readonly followUpAfterDays?: number;
  readonly vip?: boolean;
  /** A follow-up draft was sent / the user was nudged for this wait. */
  readonly nudgedAt?: Instant | null;
  /** "Bunu takip etme" (per thread or person). */
  readonly muted?: boolean;
  readonly previous?: FollowUpState;
}

/** `email_threads.follow_up_state`: none → waiting → nudge_due → nudged, or muted / resolved. */
export function followUpState(input: FollowUpInput): FollowUpState {
  if (input.muted) return 'muted';
  const waiting =
    input.previous === 'waiting' || input.previous === 'nudge_due' || input.previous === 'nudged';
  if (input.replyState !== 'awaiting_their_reply' || input.awaitingSince === null) {
    return waiting ? 'resolved' : 'none';
  }
  const since = toDate(input.awaitingSince).getTime();
  if (input.nudgedAt && toDate(input.nudgedAt).getTime() >= since) return 'nudged';
  const threshold = input.vip
    ? Math.min(FOLLOW_UP_AFTER_DAYS_VIP, input.followUpAfterDays ?? FOLLOW_UP_AFTER_DAYS_DEFAULT)
    : (input.followUpAfterDays ?? FOLLOW_UP_AFTER_DAYS_DEFAULT);
  const days = waitingDays(input.awaitingSince, input.now, input.timeZone);
  return days >= threshold ? 'nudge_due' : 'waiting';
}

const YES_PATTERNS: readonly RegExp[] = [
  /\?/u,
  /(?:donus(?:unuzu|unu)?|geri donus|yanit(?:inizi)?|cevab(?:inizi|ini))\s*(?:bekliyorum|rica ederim|bekleriz)/u,
  /(?:gorus(?:unuzu|lerinizi)|onay(?:inizi)?|teyid(?:inizi)?|fikr(?:inizi)?)\s*(?:alabilir miyim|rica ederim|bekliyorum|iletir misiniz|paylasir misiniz)/u,
  /(?:iletebilir|gonderebilir|paylasabilir|bakabilir|teyit edebilir)\s*mi(?:siniz|sin)?(?!\p{L})/u,
  /haber (?:verir|verebilir) mi(?:siniz|sin)?(?!\p{L})/u,
  /ne dersin(?:iz)?(?!\p{L})/u,
];
const FYI = /(?<!\p{L})(?:bilginize|bilgilerinize|bilgi icin|fyi)(?!\p{L})/u;
const THANKS_ONLY =
  /^(?:\s|[.,!])*(?:tesekkurler|tesekkur ederim|cok tesekkurler|sagolun|sag olun|eyvallah|rica ederim|iyi calismalar|kolay gelsin|thanks|thank you)(?:\s|[.,!]|iyi calismalar|kolay gelsin)*$/u;

/**
 * Expects-reply detector for the user's sent mail (§6.9.7): `yes` on a question or a request for
 * an answer in the last two paragraphs, `no` for thanks-only / FYI notes under 25 words,
 * `ambiguous` otherwise.
 */
export function detectExpectsReply(body: string): ExpectsReply {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith('>'));
  const tail = foldTR(normalizeTR(paragraphs.slice(-2).join('\n')));
  if (YES_PATTERNS.some((re) => re.test(tail))) return 'yes';
  const all = foldTR(normalizeTR(paragraphs.join(' ')));
  const words = all.split(/\s+/).filter((w) => w.length > 0).length;
  if (words < 25 && (THANKS_ONLY.test(all) || FYI.test(all))) return 'no';
  return 'ambiguous';
}
