/**
 * "Model locates, code computes" (AI_PIPELINE_PLAN §6; M§80, M§83): thin helpers over the
 * `@da/domain` grounding verifier for the pipeline. A model claim carries a request alias (`m1`)
 * and a verbatim quote; code verifies the quote against the source text of that alias and
 * re-parses dates / amounts / identifiers from the verified span only. Anything unverified is
 * dropped and recorded in `dropped_fields` (rendered as "Kaynakta kesinleşmiyor.").
 */
import {
  type AliasMap,
  type AmountMatch,
  type DateResolution,
  dueInstant,
  type FieldKind,
  guardFreeText,
  type Instant,
  MAX_QUOTE_LENGTH,
  type SenderType,
  type StoredEvidence,
  verifyEvidence,
  type VerifiedEvidence,
  verifyField,
} from '@da/domain';

export interface EvidenceLike {
  readonly ref: string;
  readonly quote: string;
}

export interface GroundingScope {
  readonly aliases: AliasMap;
  readonly anchor: Instant;
  readonly timeZone: string;
  readonly senderType?: SenderType;
  readonly senderDomain?: string | null;
}

/** Counters for `ai_requests.grounding_*`. */
export class GroundingTally {
  proposed = 0;
  verified = 0;
  dropped = 0;
  readonly droppedFields = new Set<string>();

  note(ok: boolean, field: string): void {
    this.proposed++;
    if (ok) this.verified++;
    else {
      this.dropped++;
      this.droppedFields.add(field);
    }
  }
}

export function aliasMap(entries: Iterable<readonly [string, string]>): AliasMap {
  return new Map(entries);
}

/** Steps 1–3: the quote must occur in the aliased source. */
export function groundQuote(
  evidence: EvidenceLike | null | undefined,
  scope: GroundingScope,
  tally?: GroundingTally,
  field = 'evidence',
): VerifiedEvidence | null {
  if (evidence === null || evidence === undefined) return null;
  const m = verifyEvidence(evidence, scope.aliases);
  tally?.note(m.ok, field);
  return m.ok ? m.evidence : null;
}

export interface GroundedDate {
  readonly resolution: DateResolution;
  readonly dueAt: Date;
  readonly evidence: VerifiedEvidence;
  readonly confidence: number;
  readonly ambiguous: boolean;
}

/** A date / deadline claim: the `quote` (e.g. "bugün 17:00") must verify and parse to one value. */
export function groundDate(
  claim: EvidenceLike,
  scope: GroundingScope,
  tally?: GroundingTally,
  field = 'due_at',
  certainty: 'explicit' | 'hedged' = 'explicit',
): GroundedDate | null {
  const v = verifyField(
    { field, kind: 'date', evidence: claim, certainty },
    {
      aliases: scope.aliases,
      anchor: scope.anchor,
      timeZone: scope.timeZone,
      ...(scope.senderType === undefined ? {} : { senderType: scope.senderType }),
    },
  );
  tally?.note(v.status === 'verified', field);
  if (v.status !== 'verified') return null;
  const resolution = v.value as DateResolution;
  return {
    resolution,
    dueAt: dueInstant(resolution, scope.timeZone),
    evidence: v.evidence,
    confidence: v.confidence,
    ambiguous: v.ambiguous,
  };
}

export interface GroundedValue<T> {
  readonly value: T;
  readonly evidence: VerifiedEvidence;
  readonly confidence: number;
}

/** Amount / flight / PNR / tracking claims (validators of §6.9). */
export function groundField<T>(
  kind: Exclude<FieldKind, 'date'>,
  claim: EvidenceLike,
  scope: GroundingScope,
  tally?: GroundingTally,
  field: string = kind,
): GroundedValue<T> | null {
  const v = verifyField(
    { field, kind, evidence: claim },
    {
      aliases: scope.aliases,
      anchor: scope.anchor,
      timeZone: scope.timeZone,
      ...(scope.senderDomain === undefined ? {} : { senderDomain: scope.senderDomain }),
    },
  );
  tally?.note(v.status === 'verified', field);
  if (v.status !== 'verified') return null;
  return { value: v.value as T, evidence: v.evidence, confidence: v.confidence };
}

export function groundAmount(
  claim: EvidenceLike,
  scope: GroundingScope,
  tally?: GroundingTally,
  field = 'amount',
): GroundedValue<AmountMatch> | null {
  return groundField<AmountMatch>('amount', claim, scope, tally, field);
}

/** `evidence jsonb` row (≤5 items; quote ≤300; locator `ref:start-end`). */
export function storedEvidence(field: string, evidence: VerifiedEvidence): StoredEvidence {
  return {
    quote: evidence.quote.slice(0, MAX_QUOTE_LENGTH),
    field,
    locator: `${evidence.ref}:${evidence.spanStart}-${evidence.spanEnd}`,
  };
}

export function evidenceList(
  items: readonly (readonly [string, VerifiedEvidence | null | undefined])[],
): StoredEvidence[] {
  const out: StoredEvidence[] = [];
  for (const [field, ev] of items) {
    if (ev === null || ev === undefined) continue;
    if (out.some((e) => e.quote === ev.quote.slice(0, MAX_QUOTE_LENGTH) && e.field === field))
      continue;
    out.push(storedEvidence(field, ev));
    if (out.length === 5) break;
  }
  return out;
}

/**
 * §6.5 free-text guard: sentences whose numbers, dates or proper nouns do not occur in the sources
 * (or the trusted names) are removed. Returns null when nothing survives.
 */
export function guardSummary(
  text: string | null | undefined,
  sources: readonly string[],
  trustedNames: readonly string[] = [],
  tally?: GroundingTally,
  field = 'summary',
): string | null {
  if (text === null || text === undefined || text.trim() === '') return null;
  const guarded = guardFreeText(text, sources, { trustedNames });
  const kept = guarded.kept.join(' ').trim();
  tally?.note(guarded.removed === 0, field);
  return kept === '' ? null : kept;
}

/** Calibrated number for the model's self-reported confidence band (prior table §6.7). */
export function bandConfidence(band: 'high' | 'medium' | 'low'): number {
  return band === 'high' ? 0.9 : band === 'medium' ? 0.75 : 0.55;
}
