/**
 * Commitment due dates, resolved deterministically from the quote relative to the message time in
 * the user's zone (M§18: "Cuma gönderirim", "Yarın ararım", "Haftaya dönerim").
 */
import {
  type DatePrecision,
  type DateResolution,
  dueInstant,
  parseDatesTR,
} from '../extract/date-tr.ts';
import type { Instant } from '../time/zone.ts';

export interface CommitmentDue {
  readonly localDate: string;
  readonly localTime: string | null;
  /** `commitments.due_at`: the time, or 18:00 local for a date-only due. */
  readonly dueAt: Date;
  /** `commitments.due_is_date_only`. */
  readonly dateOnly: boolean;
  readonly precision: DatePrecision;
  readonly ambiguous: boolean;
  readonly by: boolean;
  readonly ruleId: DateResolution['ruleId'];
  /** Span of the date expression in the input. */
  readonly span: readonly [number, number];
}

export function toCommitmentDue(r: DateResolution, timeZone: string): CommitmentDue {
  return {
    localDate: r.localDate,
    localTime: r.localTime,
    dueAt: dueInstant(r, timeZone),
    dateOnly: r.precision !== 'datetime',
    precision: r.precision,
    ambiguous: r.ambiguous,
    by: r.by,
    ruleId: r.ruleId,
    span: r.span,
  };
}

/**
 * Resolves the due date of a commitment sentence: the date expression nearest to the promise verb
 * (or the only one). Past dates are never due dates ("dün" describes the past).
 */
export function resolveCommitmentDue(
  text: string,
  opts: { readonly anchor: Instant; readonly timeZone: string; readonly near?: number },
): CommitmentDue | null {
  const all = parseDatesTR(text, { anchor: opts.anchor, timeZone: opts.timeZone }).filter(
    (r) => !r.past || r.ruleId === 'R_TIME_ONLY',
  );
  if (all.length === 0) return null;
  const near = opts.near ?? 0;
  const dist = (r: DateResolution): number =>
    Math.min(Math.abs(r.span[0] - near), Math.abs(r.span[1] - near));
  const best = [...all].sort((a, b) => dist(a) - dist(b))[0];
  return best ? toCommitmentDue(best, opts.timeZone) : null;
}
