/**
 * schema.org JSON-LD and microdata (AI_PIPELINE_PLAN §13.7 step 1; T0): `ParcelDelivery`,
 * `FlightReservation`, `LodgingReservation`, `FoodEstablishmentReservation`, `EventReservation`,
 * `Order` and `Invoice` in the HTML body become life candidates. Structured values are parsed by
 * code (ISO instants, decimal prices); each kept value quotes its literal text from the HTML
 * source as evidence. Nothing is fetched.
 */
import { decimalStringToMinor, findPnrs, isValidS10, lifeEventDedupeKey } from '@da/domain';
import { allowedTrackingUrl } from './allowlists.ts';
import { carrierDisplay } from './templates-tr.ts';
import { type LifeCandidate, quoteAt } from './types.ts';

type Node = Record<string, unknown>;

const TYPES = new Set([
  'ParcelDelivery',
  'FlightReservation',
  'LodgingReservation',
  'FoodEstablishmentReservation',
  'EventReservation',
  'Order',
  'Invoice',
]);

/** The JSON-LD objects of an HTML document (flattened `@graph` and arrays). */
export function extractJsonLd(html: string): Node[] {
  const out: Node[] = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const v of value) visit(v);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const node = value as Node;
    if (Array.isArray(node['@graph'])) visit(node['@graph']);
    const type = node['@type'];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => typeof t === 'string' && TYPES.has(t))) out.push(node);
  };
  for (const m of html.matchAll(re)) {
    try {
      visit(JSON.parse((m[1] ?? '').trim()));
    } catch {
      // malformed JSON-LD is ignored (the template and model fallbacks still apply)
    }
  }
  return out.slice(0, 10);
}

/** Minimal microdata: `itemtype="http(s)://schema.org/X"` with `itemprop` text values. */
export function extractMicrodata(html: string): Node[] {
  const out: Node[] = [];
  const re = /itemtype\s*=\s*["']https?:\/\/schema\.org\/([A-Za-z]+)["']/g;
  for (const m of html.matchAll(re)) {
    const type = m[1] ?? '';
    if (!TYPES.has(type)) continue;
    const scope = html.slice(m.index, m.index + 4000);
    const node: Node = { '@type': type };
    for (const p of scope.matchAll(
      /itemprop\s*=\s*["']([A-Za-z]+)["'][^>]*?(?:content\s*=\s*["']([^"']{1,200})["'][^>]*>|>([^<]{1,200})<)/g,
    )) {
      const key = p[1] ?? '';
      const value = (p[2] ?? p[3] ?? '').trim();
      if (key !== '' && value !== '' && node[key] === undefined) node[key] = value;
    }
    out.push(node);
  }
  return out.slice(0, 10);
}

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

function obj(value: unknown): Node | null {
  if (Array.isArray(value)) return obj(value[0]);
  return typeof value === 'object' && value !== null ? (value as Node) : null;
}

function nameOf(value: unknown): string | null {
  return str(value) ?? str(obj(value)?.name);
}

function instant(value: unknown): Date | null {
  const s = str(value);
  if (s === null || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Evidence for a literal JSON value: its first occurrence in the HTML source. */
function evidenceFor(html: string, literal: string | null, field: string) {
  if (literal === null) return null;
  const at = html.indexOf(literal);
  return at === -1 ? null : quoteAt(html, at, at + literal.length, field);
}

const DELIVERY_STATUS: Readonly<Record<string, string>> = {
  OrderDelivered: 'delivered',
  OrderInTransit: 'in_transit',
  OrderPickupAvailable: 'out_for_delivery',
  OrderProcessing: 'ordered',
  OrderReturned: 'delivery_failed',
  OrderProblem: 'delivery_failed',
  OrderPaymentDue: 'ordered',
  OrderCancelled: 'unknown',
};

function statusOf(value: unknown): string {
  const s = str(value) ?? '';
  const key = s.replace(/^https?:\/\/schema\.org\//, '');
  return DELIVERY_STATUS[key] ?? 'unknown';
}

function priceOf(node: Node): { value: string; currency: string } | null {
  const total = obj(node.totalPaymentDue) ?? obj(node.acceptedOffer) ?? node;
  const value = str(total.price) ?? str(total.value) ?? str(node.price);
  const currency = str(total.priceCurrency) ?? str(total.currency) ?? str(node.priceCurrency);
  if (value === null || currency === null || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  return { value, currency: currency.toUpperCase() };
}

function base(
  type: LifeCandidate['type'],
  status: string,
): Omit<LifeCandidate, 'fields' | 'identity' | 'evidence'> {
  return {
    type,
    origin: 'jsonld',
    status,
    eventAt: null,
    dueAt: null,
    amount: null,
    trackingUrl: null,
    ctaUrl: null,
    confidence: 0.95,
    droppedFields: [],
  };
}

/** Maps one schema.org node to a candidate (null when no verifiable identity exists). */
export function candidateFromNode(node: Node, html: string): LifeCandidate | null {
  const typeRaw = node['@type'];
  const type = (
    Array.isArray(typeRaw) ? typeRaw.find((t) => typeof t === 'string' && TYPES.has(t)) : typeRaw
  ) as string;
  switch (type) {
    case 'ParcelDelivery': {
      const tracking = str(node.trackingNumber);
      const carrier = nameOf(node.carrier) ?? nameOf(node.provider);
      const order = obj(node.partOfOrder);
      const merchant = nameOf(order?.merchant) ?? nameOf(order?.seller);
      const eta = instant(node.expectedArrivalUntil) ?? instant(node.expectedArrivalFrom);
      const ev = [
        evidenceFor(html, tracking, 'tracking_no'),
        evidenceFor(html, str(node.expectedArrivalUntil) ?? str(node.expectedArrivalFrom), 'eta'),
      ].filter((e) => e !== null);
      if (tracking === null || ev.length === 0) return null;
      const url = allowedTrackingUrl(str(node.trackingUrl), html);
      return {
        ...base('shipment', statusOf(node.deliveryStatus ?? order?.orderStatus)),
        fields: {
          merchant,
          carrier:
            carrier ??
            (tracking.endsWith('TR') && isValidS10(tracking) ? carrierDisplay('ptt') : null),
          tracking_no: tracking,
          order_ref: str(order?.orderNumber),
        },
        eventAt: eta,
        trackingUrl: url,
        evidence: ev,
        identity: [carrier ?? 'carrier', tracking],
      };
    }
    case 'FlightReservation': {
      const flight = obj(node.reservationFor);
      const airline = str(obj(flight?.airline)?.iataCode) ?? str(obj(flight?.provider)?.iataCode);
      const number = str(flight?.flightNumber);
      if (number === null) return null;
      // An IATA designator has at least one letter: a bare `2124` gets the airline prefix.
      const flightNo = /^(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\d/.test(number)
        ? number
        : `${airline ?? ''}${number}`;
      const departRaw = str(flight?.departureTime);
      const depart = instant(departRaw);
      const pnrRaw = str(node.reservationNumber);
      const pnr = pnrRaw !== null && findPnrs(`PNR: ${pnrRaw}`).length === 1 ? pnrRaw : null;
      const ev = [
        evidenceFor(html, number, 'flight_no'),
        evidenceFor(html, departRaw, 'depart_at'),
        evidenceFor(html, pnr, 'pnr'),
      ].filter((e) => e !== null);
      if (ev.length === 0) return null;
      return {
        ...base('flight', 'confirmed'),
        fields: {
          airline: nameOf(flight?.airline) ?? airline,
          flight_no: flightNo,
          from: str(obj(flight?.departureAirport)?.iataCode),
          to: str(obj(flight?.arrivalAirport)?.iataCode),
          gate: str(flight?.departureGate),
          pnr,
          checkin_status: 'unknown',
        },
        eventAt: depart,
        evidence: ev,
        identity: [flightNo, departRaw === null ? null : departRaw.slice(0, 10)],
      };
    }
    case 'LodgingReservation':
    case 'FoodEstablishmentReservation':
    case 'EventReservation': {
      const target = obj(node.reservationFor);
      const venue = nameOf(target);
      const atRaw =
        str(node.checkinTime) ??
        str(node.checkinDate) ??
        str(node.startTime) ??
        str(target?.startDate);
      const at = instant(atRaw);
      if (venue === null || at === null) return null;
      const ev = [evidenceFor(html, venue, 'venue'), evidenceFor(html, atRaw, 'at')].filter(
        (e) => e !== null,
      );
      if (ev.length === 0) return null;
      return {
        ...base('reservation', 'confirmed'),
        fields: {
          venue,
          reservation_type:
            type === 'LodgingReservation'
              ? 'hotel'
              : type === 'FoodEstablishmentReservation'
                ? 'restaurant'
                : 'event',
          party_size: str(node.partySize) === null ? null : Number(str(node.partySize)),
        },
        eventAt: at,
        evidence: ev,
        identity: [venue, Math.trunc(at.getTime() / 1000)],
      };
    }
    case 'Order': {
      const merchant = nameOf(node.merchant) ?? nameOf(node.seller);
      const orderNumber = str(node.orderNumber);
      if (merchant === null || orderNumber === null) return null;
      const ev = [evidenceFor(html, orderNumber, 'order_ref')].filter((e) => e !== null);
      if (ev.length === 0) return null;
      return {
        ...base('shipment', statusOf(node.orderStatus)),
        fields: { merchant, carrier: null, tracking_no: null, order_ref: orderNumber },
        evidence: ev,
        identity: [merchant, orderNumber],
      };
    }
    case 'Invoice': {
      const payee = nameOf(node.provider) ?? nameOf(node.broker);
      const price = priceOf(node);
      const dueRaw = str(node.paymentDueDate) ?? str(node.paymentDue);
      const due = instant(dueRaw);
      if (payee === null) return null;
      const amountEv = price === null ? null : evidenceFor(html, price.value, 'amount');
      const ev = [amountEv, evidenceFor(html, dueRaw, 'due_at')].filter((e) => e !== null);
      if (ev.length === 0) return null;
      const paid = /PaymentComplete|PaymentAutomaticallyApplied/.test(
        str(node.paymentStatus) ?? '',
      );
      return {
        ...base('payment', paid ? 'paid' : 'due'),
        fields: { payee },
        dueAt: due,
        amount:
          price === null || amountEv === null
            ? null
            : {
                minor: decimalStringToMinor(price.value),
                currency: price.currency,
                evidence: amountEv,
              },
        evidence: ev,
        identity: [
          payee,
          dueRaw === null ? null : dueRaw.slice(0, 10),
          price === null ? 'na' : decimalStringToMinor(price.value),
        ],
        droppedFields: [...(price === null ? ['amount'] : []), ...(due === null ? ['due_at'] : [])],
      };
    }
  }
  return null;
}

/** All structured candidates of an HTML body, deduplicated by their identity. */
export function structuredCandidates(html: string | null | undefined): LifeCandidate[] {
  if (html === null || html === undefined || html === '') return [];
  const seen = new Set<string>();
  const out: LifeCandidate[] = [];
  for (const node of [...extractJsonLd(html), ...extractMicrodata(html)]) {
    const c = candidateFromNode(node, html);
    if (c === null) continue;
    const key = lifeEventDedupeKey(c.type, c.identity);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
