/**
 * Source grounding verifier (M§80, M§83; AI_PIPELINE_PLAN §6.1–6.6; TEST_PLAN §2.10).
 *
 *   1 REF    the claim's `ref` must be a request alias (`m1`, `e2`) — else the claim is dropped
 *   2 NORM   quote and source are normalised with `normTR`
 *   3 MATCH  exact substring, or fuzzy (≥8 tokens, token LCS ≥ 0.90 and every digit run verbatim)
 *   4 DERIVE values are re-parsed from the verified quote only (dates, amounts, flight, PNR,
 *            tracking, person); the parse must yield exactly one value
 *   5 SANITY date ∈ [anchor − 365 d, anchor + 730 d]; 0 < |amount| < 10^12; owner "user" only on
 *            the user's own text
 *   6 OUTCOME verified → persisted with provenance; otherwise the field is dropped and the UI shows
 *            the "Kaynakta kesinleşmiyor." family (i18n `explain.unverified.*`)
 */
import type { MessageRef } from '../entities/message.ts';
import { messageRef } from '../entities/message.ts';
import { type AmountMatch, resolveAmountTR } from '../extract/amount-tr.ts';
import { type DateResolution, resolveDateTR } from '../extract/date-tr.ts';
import { findFlightNumbers, type FlightMatch } from '../extract/flight.ts';
import { foldTR, normTR, originalSpan, tokensTR } from '../extract/normalize-tr.ts';
import { findPnrs, type PnrMatch } from '../extract/pnr.ts';
import { findTrackingNumbers, type TrackingMatch } from '../extract/tracking.ts';
import { MAX_QUOTE_LENGTH, type StoredEvidence } from '../provenance.ts';
import { type Instant, toDate } from '../time/zone.ts';
import { calibrateConfidence, type ModelConfidence, type SenderType } from './calibrate.ts';

/** Model-side evidence: a request alias and a verbatim quote. */
export interface EvidenceClaim {
  readonly ref: string;
  readonly quote: string;
}

/** Request alias pattern (§4.2): m1..m5, t1, e1.., n1, p1..p30, img1, i1.., s1.., f1.., r1.., x1... */
export const REF_PATTERN = /^(?:m|t|e|n|p|img|i|s|f|r|x)\d{1,3}$/;
export const MIN_QUOTE_LENGTH = 3;
export const FUZZY_MIN_TOKENS = 8;
export const FUZZY_MIN_SIMILARITY = 0.9;

/** The alias map of one request: ref → source text (never provider ids). */
export type AliasMap = ReadonlyMap<string, string>;

export type EvidenceMatch = 'exact' | 'fuzzy';

export interface VerifiedEvidence {
  readonly ref: string;
  /** The matched text as it appears in the source (≤300 chars). */
  readonly quote: string;
  readonly spanStart: number;
  readonly spanEnd: number;
  readonly match: EvidenceMatch;
  readonly similarity: number;
}

export type DropReason =
  | 'bad_ref'
  | 'quote_too_short'
  | 'quote_too_long'
  | 'quote_not_found'
  | 'no_value'
  | 'ambiguous'
  | 'out_of_range'
  | 'owner_mismatch'
  | 'invalid_identifier'
  | 'negated';

export type QuoteMatch =
  | { readonly ok: true; readonly evidence: VerifiedEvidence }
  | { readonly ok: false; readonly reason: DropReason };

function lcsLength(a: readonly string[], b: readonly string[]): number {
  const dp = new Array<number>(b.length + 1).fill(0);
  for (const x of a) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j] ?? 0;
      dp[j] = x === b[j - 1] ? prev + 1 : Math.max(dp[j] ?? 0, dp[j - 1] ?? 0);
      prev = tmp;
    }
  }
  return dp[b.length] ?? 0;
}

interface Tok {
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

function tokenize(s: string): Tok[] {
  return [...s.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({
    text: m[0],
    from: m.index,
    to: m.index + m[0].length,
  }));
}

/** Verifies that `quote` occurs in `source` (exact after `normTR`, or fuzzy per §6.3). */
export function matchQuote(ref: string, quote: string, source: string): QuoteMatch {
  const q = normTR(quote).text;
  if (q.length < MIN_QUOTE_LENGTH) return { ok: false, reason: 'quote_too_short' };
  if (q.length > MAX_QUOTE_LENGTH) return { ok: false, reason: 'quote_too_long' };
  const src = normTR(source);
  const at = src.text.indexOf(q);
  if (at !== -1) {
    const [s, e] = originalSpan(src, at, at + q.length);
    return {
      ok: true,
      evidence: {
        ref,
        quote: source.slice(s, e),
        spanStart: s,
        spanEnd: e,
        match: 'exact',
        similarity: 1,
      },
    };
  }
  const qTokens = tokensTR(foldTR(q));
  if (qTokens.length < FUZZY_MIN_TOKENS) return { ok: false, reason: 'quote_not_found' };
  const srcTokens = tokenize(foldTR(src.text));
  const digitRuns = q.match(/\d+/g) ?? [];
  let best: { sim: number; from: number; to: number } | null = null;
  for (let size = qTokens.length - 2; size <= qTokens.length + 2; size++) {
    if (size < 1) continue;
    for (let i = 0; i + size <= srcTokens.length; i++) {
      const win = srcTokens.slice(i, i + size);
      const sim =
        lcsLength(
          qTokens,
          win.map((t) => t.text),
        ) / Math.max(qTokens.length, size);
      if (sim < FUZZY_MIN_SIMILARITY) continue;
      const first = win[0];
      const last = win[win.length - 1];
      if (!first || !last) continue;
      const windowText = src.text.slice(first.from, last.to);
      if (!digitRuns.every((d) => new RegExp(`(?<!\\d)${d}(?!\\d)`).test(windowText))) continue;
      if (!best || sim > best.sim) best = { sim, from: first.from, to: last.to };
    }
  }
  if (!best) return { ok: false, reason: 'quote_not_found' };
  const [s, e] = originalSpan(src, best.from, best.to);
  return {
    ok: true,
    evidence: {
      ref,
      quote: source.slice(s, e).slice(0, MAX_QUOTE_LENGTH),
      spanStart: s,
      spanEnd: e,
      match: 'fuzzy',
      similarity: Math.round(best.sim * 1000) / 1000,
    },
  };
}

/** Steps 1–3: the ref must be in the alias map and the quote must be found in that source. */
export function verifyEvidence(claim: EvidenceClaim, aliases: AliasMap): QuoteMatch {
  if (!REF_PATTERN.test(claim.ref)) return { ok: false, reason: 'bad_ref' };
  const source = aliases.get(claim.ref);
  if (source === undefined) return { ok: false, reason: 'bad_ref' };
  return matchQuote(claim.ref, claim.quote, source);
}

// ---------------------------------------------------------------------------------------------
// Field re-derivation (§6.4)
// ---------------------------------------------------------------------------------------------

export type FieldKind = 'date' | 'amount' | 'flight' | 'pnr' | 'tracking' | 'text';

export interface FieldValues {
  readonly date: DateResolution;
  readonly amount: AmountMatch;
  readonly flight: FlightMatch;
  readonly pnr: PnrMatch;
  readonly tracking: TrackingMatch;
  readonly text: string;
}

export interface GroundingContext {
  readonly aliases: AliasMap;
  /** Date anchor (mail Date in the user's zone, capture time, event end). */
  readonly anchor: Instant;
  readonly timeZone: string;
  readonly senderType?: SenderType;
  /** Sender domain for domestic carrier detection. */
  readonly senderDomain?: string | null;
}

export interface FieldClaim<K extends FieldKind = FieldKind> {
  /** Column / payload field the claim fills (`due_at`, `amount`, `flight_no`, …). */
  readonly field: string;
  readonly kind: K;
  readonly evidence: EvidenceClaim;
  readonly modelConfidence?: ModelConfidence | null;
  readonly certainty?: 'explicit' | 'hedged';
}

export type FieldVerification<K extends FieldKind = FieldKind> =
  | {
      readonly status: 'verified';
      readonly field: string;
      readonly kind: K;
      readonly value: FieldValues[K];
      readonly evidence: VerifiedEvidence;
      readonly confidence: number;
      /** "muhtemelen" wording (ambiguous date, confidence capped at 0.70). */
      readonly ambiguous: boolean;
    }
  | {
      readonly status: 'unverified';
      readonly field: string;
      readonly kind: K;
      readonly reason: DropReason;
      /** "Kaynakta kesinleşmiyor." family. */
      readonly message: MessageRef;
    };

const DAY = 86_400_000;
export const DATE_WINDOW_PAST_DAYS = 365;
export const DATE_WINDOW_FUTURE_DAYS = 730;
export const AMOUNT_MAX_MINOR = 1_000_000_000_000;

/** i18n key of the "Kaynakta kesinleşmiyor." copy for a dropped field. */
export function unverifiedMessage(field: string, kind: FieldKind): MessageRef {
  if (/^(due|deadline)/.test(field) || (kind === 'date' && /date|due|at$/.test(field))) {
    return messageRef('explain.unverified.due_at');
  }
  if (kind === 'amount' || field.includes('amount')) return messageRef('explain.unverified.amount');
  if (field.includes('time')) return messageRef('explain.unverified.time');
  if (/person|counterparty|contact/.test(field)) return messageRef('explain.unverified.person');
  return messageRef('explain.unverified.generic');
}

function dropped<K extends FieldKind>(
  claim: FieldClaim<K>,
  reason: DropReason,
): FieldVerification<K> {
  return {
    status: 'unverified',
    field: claim.field,
    kind: claim.kind,
    reason,
    message: unverifiedMessage(claim.field, claim.kind),
  };
}

function derive<K extends FieldKind>(
  claim: FieldClaim<K>,
  evidence: VerifiedEvidence,
  ctx: GroundingContext,
):
  | { value: FieldValues[K]; ambiguous: boolean; precision?: DateResolution['precision'] }
  | DropReason {
  const quote = evidence.quote;
  const source = ctx.aliases.get(evidence.ref) ?? '';
  switch (claim.kind) {
    case 'date': {
      const r = resolveDateTR(quote, { anchor: ctx.anchor, timeZone: ctx.timeZone });
      if (r.status === 'none') return 'no_value';
      if (r.status === 'ambiguous') return 'ambiguous';
      const t = r.value.start.getTime();
      const a = toDate(ctx.anchor).getTime();
      if (t < a - DATE_WINDOW_PAST_DAYS * DAY || t > a + DATE_WINDOW_FUTURE_DAYS * DAY)
        return 'out_of_range';
      return {
        value: r.value as FieldValues[K],
        ambiguous: r.value.ambiguous,
        precision: r.value.precision,
      };
    }
    case 'amount': {
      const r = resolveAmountTR(quote);
      if (r.status === 'none') return 'no_value';
      if (r.status === 'ambiguous') return 'ambiguous';
      if (r.value.minor === 0 || Math.abs(r.value.minor) >= AMOUNT_MAX_MINOR) return 'out_of_range';
      return { value: r.value as FieldValues[K], ambiguous: r.value.confidence === 'medium' };
    }
    case 'flight': {
      // the context word may sit around the quote: validate on the source window (±60 chars)
      const from = Math.max(0, evidence.spanStart - 60);
      const window = source.slice(from, evidence.spanEnd + 60);
      const inQuote = findFlightNumbers(window).filter(
        (f) => from + f.span[0] >= evidence.spanStart && from + f.span[1] <= evidence.spanEnd,
      );
      if (inQuote.length !== 1 || !inQuote[0])
        return inQuote.length === 0 ? 'invalid_identifier' : 'ambiguous';
      return { value: inQuote[0] as FieldValues[K], ambiguous: false };
    }
    case 'pnr': {
      const found = findPnrs(quote);
      if (found.length !== 1 || !found[0])
        return found.length === 0 ? 'invalid_identifier' : 'ambiguous';
      return { value: found[0] as FieldValues[K], ambiguous: false };
    }
    case 'tracking': {
      const found = findTrackingNumbers(quote, { senderDomain: ctx.senderDomain ?? null });
      if (found.length !== 1 || !found[0])
        return found.length === 0 ? 'invalid_identifier' : 'ambiguous';
      return { value: found[0] as FieldValues[K], ambiguous: false };
    }
    case 'text':
      return { value: quote as FieldValues[K], ambiguous: false };
  }
  return 'no_value';
}

/** Verifies one field claim (steps 1–6). */
export function verifyField<K extends FieldKind>(
  claim: FieldClaim<K>,
  ctx: GroundingContext,
): FieldVerification<K> {
  const m = verifyEvidence(claim.evidence, ctx.aliases);
  if (!m.ok) return dropped(claim, m.reason);
  const d = derive(claim, m.evidence, ctx);
  if (typeof d === 'string') return dropped(claim, d);
  const confidence = calibrateConfidence({
    match: m.evidence.match,
    parseAgrees: true,
    precision: d.precision ?? null,
    ambiguous: d.ambiguous,
    certainty: claim.certainty ?? 'explicit',
    modelConfidence: claim.modelConfidence ?? null,
    senderType: ctx.senderType ?? 'unknown',
  });
  return {
    status: 'verified',
    field: claim.field,
    kind: claim.kind,
    value: d.value,
    evidence: m.evidence,
    confidence,
    ambiguous: d.ambiguous,
  };
}

export interface ItemVerification {
  readonly verified: readonly Extract<FieldVerification, { status: 'verified' }>[];
  /** Fields removed by the verifier (`dropped_fields text[]`). */
  readonly droppedFields: readonly string[];
  readonly unverified: readonly Extract<FieldVerification, { status: 'unverified' }>[];
  /** Counters for `ai_requests.grounding_proposed / _verified / _dropped`. */
  readonly counters: {
    readonly proposed: number;
    readonly verified: number;
    readonly dropped: number;
  };
  /** Item confidence: the lowest verified field confidence (0 when nothing verified). */
  readonly confidence: number;
}

/** Verifies every field of one extracted item; unverified fields are dropped, never guessed. */
export function verifyItem(claims: readonly FieldClaim[], ctx: GroundingContext): ItemVerification {
  const results = claims.map((c) => verifyField(c, ctx));
  const verified = results.filter(
    (r): r is Extract<FieldVerification, { status: 'verified' }> => r.status === 'verified',
  );
  const unverified = results.filter(
    (r): r is Extract<FieldVerification, { status: 'unverified' }> => r.status === 'unverified',
  );
  return {
    verified,
    unverified,
    droppedFields: unverified.map((u) => u.field),
    counters: { proposed: claims.length, verified: verified.length, dropped: unverified.length },
    confidence: verified.length === 0 ? 0 : Math.min(...verified.map((v) => v.confidence)),
  };
}

/** Evidence rows for `evidence jsonb` (≤5 items, key whitelist). */
export function toStoredEvidence(
  verified: readonly { readonly field: string; readonly evidence: VerifiedEvidence }[],
): StoredEvidence[] {
  return verified.slice(0, 5).map((v) => ({
    quote: v.evidence.quote.slice(0, MAX_QUOTE_LENGTH),
    field: v.field,
    locator: `${v.evidence.ref}:${v.evidence.spanStart}-${v.evidence.spanEnd}`,
  }));
}

// ---------------------------------------------------------------------------------------------
// Person linking and ownership
// ---------------------------------------------------------------------------------------------

export interface PersonCandidate {
  readonly id: string;
  readonly name: string;
  readonly email?: string | null;
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** pg_trgm-style similarity of two folded strings. */
export function trigramSimilarity(a: string, b: string): number {
  const x = trigrams(foldTR(normTR(a).text));
  const y = trigrams(foldTR(normTR(b).text));
  let inter = 0;
  for (const g of x) if (y.has(g)) inter++;
  const union = x.size + y.size - inter;
  return union === 0 ? 0 : inter / union;
}

export type PersonLink =
  | { readonly linked: true; readonly id: string; readonly similarity: number }
  | { readonly linked: false; readonly text: string };

/**
 * Links a quoted person to a thread participant or contact (trigram ≥0.8 on the full name, or the
 * first name when exactly one candidate has it). Otherwise the person stays unlinked text; a
 * person relation is never created from a model claim.
 */
export function linkPerson(name: string, candidates: readonly PersonCandidate[]): PersonLink {
  const clean = name.trim();
  const scored = candidates
    .map((c) => ({ c, sim: trigramSimilarity(clean, c.name) }))
    .sort((a, b) => b.sim - a.sim);
  const top = scored[0];
  if (top && top.sim >= 0.8)
    return { linked: true, id: top.c.id, similarity: Math.round(top.sim * 1000) / 1000 };
  const first = foldTR(normTR(clean).text).split(' ')[0] ?? '';
  const byFirst = candidates.filter(
    (c) => (foldTR(normTR(c.name).text).split(' ')[0] ?? '') === first,
  );
  const only = byFirst[0];
  if (first.length >= 2 && byFirst.length === 1 && only && !clean.includes(' ')) {
    return {
      linked: true,
      id: only.id,
      similarity: Math.round(trigramSimilarity(clean, only.name) * 1000) / 1000,
    };
  }
  return { linked: false, text: clean };
}

export type ClaimOwner = 'user' | 'counterparty' | 'team';

/** Owner "user" is accepted only on the user's own sent mail or note (§6.3 step 5). */
export function ownerAllowed(
  owner: ClaimOwner,
  sourceKind: 'sent_mail' | 'received_mail' | 'user_note',
): boolean {
  if (owner === 'user' || owner === 'team') return sourceKind !== 'received_mail';
  return true;
}

export type CommitmentOutcome = 'create' | 'propose' | 'drop';

/**
 * §6.6: all required fields verified and explicit → create; hedged or partly verified → propose a
 * `commitment_create` approval ("Bu bir söz mü?"); negated or unverifiable → drop.
 */
export function commitmentOutcome(input: {
  readonly certainty: 'explicit' | 'hedged' | 'negated';
  readonly quoteVerified: boolean;
  readonly ownerOk: boolean;
  readonly allFieldsVerified: boolean;
  readonly confidence: number;
}): CommitmentOutcome {
  if (input.certainty === 'negated' || !input.quoteVerified || !input.ownerOk) return 'drop';
  if (input.certainty === 'hedged' || !input.allFieldsVerified || input.confidence < 0.8)
    return 'propose';
  return 'create';
}
