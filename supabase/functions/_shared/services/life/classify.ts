/**
 * Life intelligence (IMPLEMENTATION_PLAN T-5.04; AI_PIPELINE_PLAN §13.7):
 *
 *   1. account-security templates (T0 only; DKIM/SPF alignment required, spoofed mail rejected)
 *   2. schema.org JSON-LD / microdata
 *   3. Turkish sender templates
 *   4. T1 `LifeIntelV1` (Pro) only when triage flagged a life signal and nothing matched
 *
 * Amounts and deadlines are kept only with verified evidence; a tracking URL only when it appears
 * in the source and its host is allow-listed. Rows are keyed by `lifeEventDedupeKey`, so the same
 * shipment from the merchant, the carrier and an Android signal merges into one event.
 */
import {
  lifeEventDedupeKey,
  minorToDecimalString,
  type Provider,
  type StoredEvidence,
  type TrackingMatch,
  type FlightMatch,
  type PnrMatch,
} from '@da/domain';
import { LifeIntelV1, type LifeIntelEvent, refineLifeIntelV1 } from '@da/validation';
import type { UntrustedDoc } from '../../ai/untrusted.ts';
import { clip, copy, type CopyLocale } from '../copy.ts';
import {
  aliasMap,
  groundAmount,
  groundDate,
  groundField,
  groundQuote,
  GroundingTally,
  type GroundingScope,
  storedEvidence,
} from '../ai/grounding.ts';
import { callModel, type PipelineContext } from '../ai/pipeline.ts';
import { allowedTrackingUrl } from './allowlists.ts';
import { structuredCandidates } from './jsonld.ts';
import { carrierDisplay, detectSecurity, isTemplateSender, parseTemplate } from './templates-tr.ts';
import type { LifeCandidate } from './types.ts';

export interface LifeInput {
  readonly fromEmail: string;
  readonly subject: string;
  /** Visible text (hygiene applied). */
  readonly text: string;
  readonly html: string | null;
  readonly anchor: Date;
  readonly timeZone: string;
  readonly dkimPass: boolean | null;
  readonly spfPass: boolean | null;
}

export interface LifeDetection {
  readonly candidates: readonly LifeCandidate[];
  /** A deterministic parser produced the result (no model needed). */
  readonly matched: boolean;
  /** Transactional sender or structured markup (a T0 informational signal). */
  readonly transactional: boolean;
  readonly security: 'none' | 'verified' | 'rejected';
}

export function detectLife(input: LifeInput): LifeDetection {
  const templateInput = {
    fromEmail: input.fromEmail,
    subject: input.subject,
    text: input.text,
    anchor: input.anchor,
    timeZone: input.timeZone,
    dkimPass: input.dkimPass,
    spfPass: input.spfPass,
  };
  const security = detectSecurity(templateInput);
  if (security.kind === 'event') {
    return { candidates: [security.candidate], matched: true, transactional: true, security: 'verified' };
  }
  if (security.kind === 'rejected') {
    return { candidates: [], matched: true, transactional: false, security: 'rejected' };
  }
  const authenticated = input.dkimPass === true || input.spfPass === true;
  const structured = authenticated ? structuredCandidates(input.html) : [];
  if (structured.length > 0) {
    return { candidates: structured, matched: true, transactional: true, security: 'none' };
  }
  const { template, candidate } = parseTemplate(templateInput);
  return {
    candidates: candidate === null ? [] : [candidate],
    matched: candidate !== null,
    transactional: template !== null && authenticated && isTemplateSender(input.fromEmail),
    security: 'none',
  };
}

// ── T1 fallback (LifeIntelV1) ────────────────────────────────────────────────

function quoted(
  scope: GroundingScope,
  ref: string,
  quote: string | null,
  field: string,
  tally: GroundingTally,
): { text: string; evidence: StoredEvidence } | null {
  if (quote === null || quote.trim() === '') return null;
  const v = groundQuote({ ref, quote }, scope, tally, field);
  return v === null ? null : { text: v.quote, evidence: storedEvidence(field, v) };
}

/** Maps one verified model event to a candidate; required fields must verify or it is dropped. */
export function candidateFromModel(
  event: LifeIntelEvent,
  ref: string,
  scope: GroundingScope,
  tally: GroundingTally,
): LifeCandidate | null {
  const anchorEv = groundQuote(event.evidence, scope, tally, 'evidence');
  if (anchorEv === null) return null;
  const evidence: StoredEvidence[] = [storedEvidence('event', anchorEv)];
  const dropped: string[] = [];
  const date = (quote: string | null, field: string) => {
    if (quote === null) return null;
    const d = groundDate({ ref, quote }, scope, tally, field);
    if (d === null) {
      dropped.push(field);
      return null;
    }
    evidence.push(storedEvidence(field, d.evidence));
    return d;
  };
  const common = {
    origin: 'llm' as const,
    trackingUrl: null,
    ctaUrl: null,
  };
  switch (event.kind) {
    case 'shipment': {
      const tracking =
        event.tracking_quote === null
          ? null
          : groundField<TrackingMatch>('tracking', { ref, quote: event.tracking_quote }, scope, tally, 'tracking_no');
      if (event.tracking_quote !== null && tracking === null) dropped.push('tracking_no');
      if (tracking !== null) evidence.push(storedEvidence('tracking_no', tracking.evidence));
      const merchant = quoted(scope, ref, event.merchant_quote, 'merchant', tally);
      const carrier = quoted(scope, ref, event.carrier_quote, 'carrier', tally);
      const eta = date(event.eta_quote, 'eta');
      const carrierName =
        tracking?.value.carrier !== null && tracking?.value.carrier !== undefined
          ? carrierDisplay(tracking.value.carrier)
          : (carrier?.text ?? null);
      return {
        ...common,
        type: 'shipment',
        status: event.status,
        fields: {
          merchant: merchant?.text ?? null,
          carrier: carrierName,
          tracking_no: tracking?.value.value ?? null,
          order_ref: null,
        },
        eventAt: eta?.resolution.start ?? null,
        dueAt: null,
        amount: null,
        trackingUrl: null,
        evidence: evidence.slice(0, 5),
        identity:
          tracking !== null
            ? [tracking.value.carrier ?? carrierName ?? 'carrier', tracking.value.value]
            : [merchant?.text ?? carrierName ?? 'shipment', anchorEv.quote],
        confidence: tracking !== null ? 0.85 : 0.7,
        droppedFields: dropped,
      };
    }
    case 'flight': {
      const flight = groundField<FlightMatch>('flight', { ref, quote: event.flight_no_quote }, scope, tally, 'flight_no');
      if (flight === null) return null;
      evidence.push(storedEvidence('flight_no', flight.evidence));
      const pnr =
        event.pnr_quote === null
          ? null
          : groundField<PnrMatch>('pnr', { ref, quote: event.pnr_quote }, scope, tally, 'pnr');
      if (event.pnr_quote !== null && pnr === null) dropped.push('pnr');
      const depart = date(event.depart_quote, 'depart_at');
      const from = quoted(scope, ref, event.from_quote, 'from', tally);
      const to = quoted(scope, ref, event.to_quote, 'to', tally);
      const gate = quoted(scope, ref, event.gate_quote, 'gate', tally);
      return {
        ...common,
        type: 'flight',
        status: event.checkin_status === 'open' ? 'checkin_open' : 'confirmed',
        fields: {
          airline: flight.value.airline,
          flight_no: flight.value.flightNo,
          from: from?.text ?? null,
          to: to?.text ?? null,
          gate: gate?.text ?? null,
          pnr: pnr?.value.code ?? null,
          checkin_status: event.checkin_status,
        },
        eventAt: depart?.resolution.start ?? null,
        dueAt: null,
        amount: null,
        evidence: evidence.slice(0, 5),
        identity: [flight.value.flightNo, depart?.resolution.localDate ?? null],
        confidence: 0.85,
        droppedFields: dropped,
      };
    }
    case 'reservation': {
      const venue = quoted(scope, ref, event.venue_quote, 'venue', tally);
      if (venue === null) return null;
      const at = date(event.at_quote, 'at');
      const confirmBy = date(event.confirm_deadline_quote, 'confirm_by');
      const party = quoted(scope, ref, event.party_size_quote, 'party_size', tally);
      const partyN = party === null ? null : Number(/\d{1,2}/.exec(party.text)?.[0] ?? 'NaN');
      return {
        ...common,
        type: 'reservation',
        status: 'confirmed',
        fields: {
          venue: clip(venue.text, 120),
          reservation_type: event.reservation_type,
          party_size: partyN !== null && Number.isFinite(partyN) ? partyN : null,
        },
        eventAt: at?.resolution.start ?? null,
        dueAt: confirmBy?.dueAt ?? null,
        amount: null,
        evidence: evidence.slice(0, 5),
        identity: [venue.text, at === null ? null : Math.trunc(at.resolution.start.getTime() / 1000)],
        confidence: 0.8,
        droppedFields: dropped,
      };
    }
    case 'payment': {
      const payee = quoted(scope, ref, event.payee_quote, 'payee', tally);
      if (payee === null) return null;
      const amount =
        event.amount_quote === null ? null : groundAmount({ ref, quote: event.amount_quote }, scope, tally);
      if (event.amount_quote !== null && amount === null) dropped.push('amount');
      const due = date(event.due_quote, 'due_at');
      const amountEv = amount === null ? null : storedEvidence('amount', amount.evidence);
      if (amountEv !== null) evidence.push(amountEv);
      return {
        ...common,
        type: 'payment',
        status: event.status,
        fields: { payee: clip(payee.text, 120) },
        eventAt: null,
        dueAt: due?.dueAt ?? null,
        amount:
          amount === null || amountEv === null
            ? null
            : { minor: Math.abs(amount.value.minor), currency: amount.value.currency, evidence: amountEv },
        evidence: evidence.slice(0, 5),
        identity: [payee.text, due?.resolution.localDate ?? null, amount === null ? 'na' : Math.abs(amount.value.minor)],
        confidence: 0.8,
        droppedFields: dropped,
      };
    }
    case 'subscription': {
      const service = quoted(scope, ref, event.service_quote, 'service', tally);
      if (service === null) return null;
      const amount =
        event.amount_quote === null ? null : groundAmount({ ref, quote: event.amount_quote }, scope, tally);
      if (event.amount_quote !== null && amount === null) dropped.push('amount');
      const renews = date(event.renews_quote, 'renews_at');
      const amountEv = amount === null ? null : storedEvidence('amount', amount.evidence);
      if (amountEv !== null) evidence.push(amountEv);
      return {
        ...common,
        type: 'subscription',
        status: event.event,
        fields: { service: clip(service.text, 120), period: event.period },
        eventAt: renews?.resolution.start ?? null,
        dueAt: null,
        amount:
          amount === null || amountEv === null
            ? null
            : { minor: Math.abs(amount.value.minor), currency: amount.value.currency, evidence: amountEv },
        evidence: evidence.slice(0, 5),
        identity: [service.text, renews?.resolution.localDate ?? null],
        confidence: 0.8,
        droppedFields: dropped,
      };
    }
  }
}

export interface LifeModelResult {
  readonly kind: 'ai' | 't0';
  readonly candidates: readonly LifeCandidate[];
  readonly tally: GroundingTally;
  readonly injectionSuspected: boolean;
}

/** T1 fallback for one message whose triage flagged a life signal that no parser matched. */
export async function lifeFromModel(
  ctx: PipelineContext,
  input: {
    readonly text: string;
    readonly context: readonly string[];
    readonly anchor: Date;
    readonly senderDomain: string;
    readonly injectionSuspected: boolean;
  },
): Promise<LifeModelResult> {
  const tally = new GroundingTally();
  const doc: UntrustedDoc = { ref: 'm1', kind: 'email', text: input.text };
  const result = await callModel(ctx, {
    feature: 'life_intel_extract',
    schema: LifeIntelV1,
    schemaName: 'LifeIntelV1',
    context: input.context,
    docs: [doc],
    cacheContent: `life_intel\n${input.text}`,
    units: 1,
    injection: { suspected: input.injectionSuspected, signals: [] },
  });
  if (result.kind !== 'ai') return { kind: 't0', candidates: [], tally, injectionSuspected: false };
  const refined = refineLifeIntelV1(result.data, { aliases: ['m1'] });
  const scope: GroundingScope = {
    aliases: aliasMap([['m1', input.text]]),
    anchor: input.anchor,
    timeZone: ctx.user.timeZone,
    senderDomain: input.senderDomain,
  };
  const candidates: LifeCandidate[] = [];
  let injection = false;
  for (const item of refined.data.items) {
    injection = injection || item.injection_suspected;
    for (const event of item.events) {
      const c = candidateFromModel(event, item.ref, scope, tally);
      if (c !== null) candidates.push(c);
    }
  }
  return { kind: 'ai', candidates, tally, injectionSuspected: injection };
}

// ── Persistence rows ─────────────────────────────────────────────────────────

export interface LifeEventInsert {
  readonly user_id: string;
  readonly type: LifeCandidate['type'];
  readonly title: string;
  readonly event_at: string | null;
  readonly due_at: string | null;
  readonly payload: Record<string, unknown>;
  readonly amount: string | null;
  readonly currency: string | null;
  readonly amount_evidence: StoredEvidence[] | null;
  readonly tracking_url: string | null;
  readonly dedupe_key: string;
  readonly source_type: 'email_message';
  readonly source_id: string;
  readonly source_provider: Provider;
  readonly source_timestamp: string;
  readonly confidence: number;
  readonly evidence: StoredEvidence[];
}

function titleOf(c: LifeCandidate, locale: CopyLocale): string {
  const f = c.fields;
  const name = (v: unknown, fallback = 'none') =>
    typeof v === 'string' && v.trim() !== '' ? clip(v, 60) : fallback;
  switch (c.type) {
    case 'shipment':
      return copy(locale, 'life.generated.shipment', {
        status: c.status,
        merchant: name(f.merchant, name(f.carrier)),
      });
    case 'flight':
      return copy(locale, 'life.generated.flight', {
        flight: name(f.flight_no),
        route: typeof f.from === 'string' && typeof f.to === 'string' ? `${f.from}–${f.to}` : 'none',
      });
    case 'reservation':
      return copy(locale, 'life.generated.reservation', { venue: name(f.venue) });
    case 'payment':
      return copy(locale, 'life.generated.payment', { status: c.status, payee: name(f.payee) });
    case 'subscription':
      return copy(locale, 'life.generated.subscription', { event: c.status, service: name(f.service) });
    case 'security':
      return copy(locale, 'life.generated.security', { event: c.status, service: name(f.service) });
  }
}

/** A candidate → `life_events` insert (provenance of the source message). */
export function lifeEventRow(
  c: LifeCandidate,
  source: {
    readonly userId: string;
    readonly messageId: string;
    readonly provider: Provider;
    readonly receivedAt: string;
    readonly text: string;
    readonly locale: CopyLocale;
  },
): LifeEventInsert {
  const trackingUrl =
    c.trackingUrl === null ? null : (allowedTrackingUrl(c.trackingUrl, source.text) ?? null);
  return {
    user_id: source.userId,
    type: c.type,
    title: clip(titleOf(c, source.locale), 200),
    event_at: c.eventAt?.toISOString() ?? null,
    due_at: c.dueAt?.toISOString() ?? null,
    payload: {
      ...c.fields,
      status: c.status,
      origin: c.origin,
      dropped_fields: c.droppedFields,
      ...(c.ctaUrl === null ? {} : { cta_url: c.ctaUrl }),
    },
    amount: c.amount === null ? null : minorToDecimalString(c.amount.minor),
    currency: c.amount === null ? null : c.amount.currency,
    amount_evidence: c.amount === null ? null : [c.amount.evidence],
    tracking_url: trackingUrl,
    dedupe_key: lifeEventDedupeKey(c.type, c.identity),
    source_type: 'email_message',
    source_id: source.messageId,
    source_provider: source.provider,
    source_timestamp: source.receivedAt,
    confidence: Math.round(c.confidence * 1000) / 1000,
    evidence: c.evidence.length > 0 ? [...c.evidence].slice(0, 5) : [],
  };
}

