import { z } from 'zod';

/*
 * Common building blocks of the structured-output catalogue (docs/AI_PIPELINE_PLAN.md §4.2).
 *
 * Wire rules (§4.1): every object is strict, every property required (optional values are nullable),
 * no numeric/string/array bounds, no formats, nesting depth ≤4, unions only discriminated. Every bound
 * lives in the server-side `refine*()` functions, which run after `safeParse` and return
 * `{ ok, data, dropped }`.
 */

/** Local alias of an input item (`m1`, `e2`, `i3`, `n1`, `img1`, `p12`…); never a provider id. */
export const Ref = z.string();
export const Evidence = z.strictObject({ ref: Ref, quote: z.string() });
export type Evidence = z.infer<typeof Evidence>;
export const Confidence = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof Confidence>;
export const Certainty = z.enum(['explicit', 'hedged', 'negated']);
export const DeadlineClaim = z.strictObject({
  what_tr: z.string(),
  when_quote: z.string(),
  evidence: Evidence,
  certainty: z.enum(['explicit', 'hedged']),
});
export type DeadlineClaim = z.infer<typeof DeadlineClaim>;
export const CommitmentClaim = z.strictObject({
  owner: z.enum(['user', 'counterparty', 'team']),
  counterparty_quote: z.string().nullable(),
  what_tr: z.string(),
  due_quote: z.string().nullable(),
  evidence: Evidence,
  certainty: Certainty,
});
export type CommitmentClaim = z.infer<typeof CommitmentClaim>;
export const ScheduleRequestClaim = z.strictObject({
  kind: z.enum(['reschedule', 'new_meeting', 'cancel', 'availability_question']),
  requested_time_quote: z.string().nullable(),
  evidence: Evidence,
});
export type ScheduleRequestClaim = z.infer<typeof ScheduleRequestClaim>;
export const ReasonCode = z.enum([
  'direct_request',
  'deadline_mentioned',
  'meeting_change',
  'known_sender',
  'financial',
  'transactional',
  'newsletter',
  'promotion',
  'social_notification',
  'fyi_cc',
  'automated',
  'personal',
  'travel',
  'delivery',
  'other',
]);

// ── Refinement layer ─────────────────────────────────────────────────────────

/** Accepted alias shapes (§4.2 plus `w` for a fetched web page in capture, §4.3.13). */
export const REF_PATTERN = /^(m|t|e|n|p|img|i|s|f|r|x|w)\d{1,3}$/;
export const QUOTE_MIN_CHARS = 3;
export const QUOTE_MAX_CHARS = 200;
/** Common length caps (§4.2). */
export const TEXT_CAPS = { what_tr: 80, reason_tr: 140, summary_tr: 200 } as const;

export type DropReason =
  | 'bad_ref'
  | 'duplicate_ref'
  | 'quote_length'
  | 'truncated'
  | 'over_cap'
  | 'negated'
  | 'owner_rewritten'
  | 'cleared'
  | 'number_mismatch'
  | 'word_cap'
  | 'not_allowed'
  | 'empty';

export interface DroppedClaim {
  readonly path: string;
  readonly reason: DropReason;
}

export interface RefineResult<T> {
  /** `false` when the output cannot be used (the caller repairs once, then falls back, §1.6). */
  readonly ok: boolean;
  readonly data: T;
  /** Claims or fields removed or rewritten; counted into `ai_requests.grounding_dropped`. */
  readonly dropped: readonly DroppedClaim[];
  /** Why `ok` is false. */
  readonly errors: readonly string[];
}

export interface BaseRefineContext {
  /** The request alias map: every `ref` in the output must be one of these. */
  readonly aliases: Iterable<string>;
}

/** Collapses whitespace and strips HTML tags and markdown markers from model free text (§4.2). */
export function cleanText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/(\*\*|__|`+)/g, '')
    .replace(/^\s{0,3}(#{1,6}|[-*•]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(value: string): number {
  const trimmed = value.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** Truncates at the last word boundary within `max` chars and appends an ellipsis. */
export function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  const slice = value.slice(0, Math.max(0, max - 1));
  const boundary = slice.lastIndexOf(' ');
  return `${(boundary > max / 2 ? slice.slice(0, boundary) : slice).trimEnd()}…`;
}

/** Keeps the first `maxWords` words and appends an ellipsis when words were removed. */
export function truncateWords(value: string, maxWords: number): string {
  const words = value.trim().split(/\s+/);
  return words.length <= maxWords ? value.trim() : `${words.slice(0, maxWords).join(' ')}…`;
}

/** Digit runs and clock times of a text, used by the number-preservation guards (§4.3.6, §4.3.7). */
export function numericTokens(value: string): string[] {
  return (value.match(/(?<!\d)\d{1,2}[:.]\d{2}(?![\d.,])|\d+(?:[.,]\d+)*/g) ?? []).map((t) =>
    t.replace(',', '.'),
  );
}

function multisetEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

export function sameNumericTokens(candidate: string, original: string): boolean {
  return multisetEqual(numericTokens(candidate), numericTokens(original));
}

/** Mutable collector shared by the per-schema refine functions. */
export class Refiner {
  readonly dropped: DroppedClaim[] = [];
  readonly errors: string[] = [];
  private readonly aliases: ReadonlySet<string>;

  constructor(aliases: Iterable<string>) {
    this.aliases = new Set(aliases);
  }

  drop(path: string, reason: DropReason): void {
    this.dropped.push({ path, reason });
  }

  fail(message: string): void {
    this.errors.push(message);
  }

  /** `true` when `ref` has an accepted shape and is in the alias map. */
  ref(ref: string, path: string): boolean {
    if (REF_PATTERN.test(ref) && this.aliases.has(ref)) return true;
    this.drop(path, 'bad_ref');
    return false;
  }

  /** `true` when an evidence span has a known ref and a 3–200 char quote. */
  evidence(evidence: Evidence, path: string): boolean {
    if (!this.ref(evidence.ref, `${path}.ref`)) return false;
    const length = cleanText(evidence.quote).length;
    if (length < QUOTE_MIN_CHARS || length > QUOTE_MAX_CHARS) {
      this.drop(`${path}.quote`, 'quote_length');
      return false;
    }
    return true;
  }

  /** Nullable evidence: an invalid span becomes `null`. */
  optionalEvidence(evidence: Evidence | null, path: string): Evidence | null {
    if (evidence === null) return null;
    return this.evidence(evidence, path) ? evidence : null;
  }

  /** Cleans free text and truncates it to `max` chars. */
  text(value: string, max: number, path: string): string {
    const cleaned = cleanText(value);
    if (cleaned.length <= max) return cleaned;
    this.drop(path, 'truncated');
    return truncateText(cleaned, max);
  }

  nullableText(value: string | null, max: number, path: string): string | null {
    if (value === null) return null;
    const cleaned = this.text(value, max, path);
    return cleaned === '' ? null : cleaned;
  }

  /** Keeps the first `max` items in model order and counts the rest. */
  cap<T>(items: readonly T[], max: number, path: string): T[] {
    if (items.length <= max) return [...items];
    for (let index = max; index < items.length; index += 1)
      this.drop(`${path}.${index}`, 'over_cap');
    return items.slice(0, max);
  }

  /** Filters items with a predicate that reports its own drops. */
  keep<T>(items: readonly T[], predicate: (item: T, path: string) => boolean, path: string): T[] {
    return items.filter((item, index) => predicate(item, `${path}.${index}`));
  }

  /** Word-capped free text (briefing narratives, summaries, drafts). */
  words(value: string, maxWords: number, path: string): string {
    const cleaned = cleanText(value);
    if (wordCount(cleaned) <= maxWords) return cleaned;
    this.drop(path, 'word_cap');
    return truncateWords(cleaned, maxWords);
  }

  result<T>(data: T): RefineResult<T> {
    return { ok: this.errors.length === 0, data, dropped: this.dropped, errors: this.errors };
  }
}
