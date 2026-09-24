/**
 * Suggested prompts (M-ASST-01, M§24, SREQ-27): a pure, deterministic set of up to six prompts
 * from cached context — never an empty chat. Order: focus, replies, tomorrow, last talked,
 * deadlines this week, payments. "{Ad} ile en son ne konuştuk?" needs a real person (the next
 * meeting's contact or the most recently contacted VIP) and is omitted otherwise; it moves first
 * when a meeting starts within 3 hours. The payments prompt moves up when a payment or
 * subscription is due within 7 days.
 */

export type PromptKey =
  'focus' | 'replies' | 'tomorrow_busy' | 'last_talked' | 'deadlines_this_week' | 'payments_due';

export interface SuggestedPrompt {
  readonly key: PromptKey;
  /** The first name for `last_talked`. */
  readonly name?: string;
}

export interface PromptContext {
  readonly now: Date;
  /** First name of the person to ask about (next meeting contact, else a VIP). */
  readonly personName?: string | null;
  /** Start of the next meeting, if any. */
  readonly nextMeetingAt?: string | null;
  /** Due times of open payment / subscription life events. */
  readonly paymentDueAt?: readonly string[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function buildSuggestedPrompts(context: PromptContext): readonly SuggestedPrompt[] {
  const person = context.personName?.trim() ?? '';
  const meetingSoon =
    context.nextMeetingAt !== undefined &&
    context.nextMeetingAt !== null &&
    Date.parse(context.nextMeetingAt) - context.now.getTime() <= 3 * HOUR &&
    Date.parse(context.nextMeetingAt) >= context.now.getTime();
  const paymentSoon = (context.paymentDueAt ?? []).some((at) => {
    const diff = Date.parse(at) - context.now.getTime();
    return diff >= 0 && diff <= 7 * DAY;
  });
  const lastTalked: SuggestedPrompt | null =
    person === '' ? null : { key: 'last_talked', name: person.split(/\s+/)[0] ?? person };
  const base: SuggestedPrompt[] = [
    { key: 'focus' },
    { key: 'replies' },
    { key: 'tomorrow_busy' },
    ...(lastTalked === null ? [] : [lastTalked]),
    { key: 'deadlines_this_week' },
    { key: 'payments_due' },
  ];
  let ordered = base;
  if (paymentSoon) {
    const payments = ordered.filter((p) => p.key === 'payments_due');
    ordered = [...payments, ...ordered.filter((p) => p.key !== 'payments_due')];
  }
  if (meetingSoon && lastTalked !== null) {
    ordered = [lastTalked, ...ordered.filter((p) => p.key !== 'last_talked')];
  }
  return ordered.slice(0, 6);
}

/** The three most relevant prompts shown as chips in an empty new thread. */
export function topPrompts(prompts: readonly SuggestedPrompt[]): readonly SuggestedPrompt[] {
  return prompts.slice(0, 3);
}
