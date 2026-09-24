/**
 * Life-intelligence candidates (AI_PIPELINE_PLAN §13.7): the typed result of the T0 parsers
 * (schema.org JSON-LD / microdata, Turkish sender templates, security templates) and of the T1
 * `LifeIntelV1` fallback, before persistence into `life_events`. Every value carries verified
 * evidence; unverifiable amounts and dates are absent and listed in `droppedFields`.
 */
import type { StoredEvidence } from '@da/domain';

export type LifeKind =
  'shipment' | 'flight' | 'reservation' | 'payment' | 'subscription' | 'security';
/** `android`: structured fields of an on-device-extracted Android notification signal (§13.8). */
export type LifeOrigin = 'jsonld' | 'template' | 'llm' | 'security' | 'android';

export interface LifeAmount {
  readonly minor: number;
  readonly currency: string;
  readonly evidence: StoredEvidence;
}

export interface LifeCandidate {
  readonly type: LifeKind;
  readonly origin: LifeOrigin;
  /** Shipment / payment status, subscription event, security event, or `confirmed`. */
  readonly status: string;
  /** Payload fields (merchant, carrier, tracking_no, flight_no, from, to, gate, pnr, venue …). */
  readonly fields: Readonly<Record<string, string | number | null>>;
  readonly eventAt: Date | null;
  readonly dueAt: Date | null;
  readonly amount: LifeAmount | null;
  readonly trackingUrl: string | null;
  /** Security: the known provider page for "Şifreyi Değiştir" (never a link from the mail). */
  readonly ctaUrl: string | null;
  readonly evidence: readonly StoredEvidence[];
  /** Identity fields of the dedupe key (`lifeEventDedupeKey`). */
  readonly identity: readonly (string | number | null)[];
  readonly confidence: number;
  readonly droppedFields: readonly string[];
}

/** Evidence at a span of the source (exact substring, ≤200 chars around the match). */
export function quoteAt(
  source: string,
  start: number,
  end: number,
  field: string,
  ref = 'm1',
): StoredEvidence {
  const lineStart = Math.max(source.lastIndexOf('\n', start) + 1, start - 80, 0);
  const nl = source.indexOf('\n', end);
  const lineEnd = Math.min(nl === -1 ? source.length : nl, end + 80, lineStart + 200);
  const s = Math.min(lineStart, start);
  const e = Math.max(Math.min(lineEnd, s + 200), Math.min(end, s + 200));
  return {
    quote: source.slice(s, e).trim().slice(0, 200) || source.slice(start, end).slice(0, 200),
    field,
    locator: `${ref}:${s}-${e}`,
  };
}
