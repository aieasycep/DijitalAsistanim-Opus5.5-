/**
 * Turkish sender templates (AI_PIPELINE_PLAN §13.7 parser registry; T0, no model): Trendyol,
 * Hepsiburada, Amazon.com.tr, Yurtiçi, Aras, MNG, PTT, Sürat, HepsiJet, Trendyol Express, THY,
 * Pegasus, AJet, SunExpress, Booking.com, Airbnb, obilet, Biletix, utilities, telcos and banks,
 * subscriptions, and the account-security senders. Values come from the TR extractors of
 * `@da/domain` over the visible text; each value keeps the exact source span as evidence.
 *
 * Every template requires DKIM or SPF pass for the From domain (lookalike senders never match).
 */
import {
  detectCarrier,
  dueInstant,
  findAirports,
  findFlightNumbers,
  findPnrs,
  findTrackingNumbers,
  foldTR,
  normalizeTR,
  parseAmountsTR,
  parseDatesTR,
  type DateResolution,
  type Instant,
} from '@da/domain';
import {
  domainMatches,
  domainOf,
  findTrackingUrl,
  securitySenderFor,
  type SecuritySender,
} from './allowlists.ts';
import { type LifeCandidate, type LifeKind, quoteAt } from './types.ts';

export interface TemplateInput {
  readonly fromEmail: string;
  readonly subject: string;
  /** Visible text (hygiene applied, not redacted: amounts and codes are parsed here). */
  readonly text: string;
  readonly anchor: Instant;
  readonly timeZone: string;
  readonly dkimPass: boolean | null;
  readonly spfPass: boolean | null;
}

export interface SenderTemplate {
  readonly id: string;
  readonly kind: Exclude<LifeKind, 'security'>;
  readonly name: string;
  readonly domains: readonly string[];
  /** Folded subject/body must match for subscription senders that also send other mail. */
  readonly requires?: RegExp;
}

/** The registry (domains are suffix-matched). */
export const SENDER_TEMPLATES: readonly SenderTemplate[] = [
  { id: 'trendyol', kind: 'shipment', name: 'Trendyol', domains: ['trendyol.com'] },
  { id: 'hepsiburada', kind: 'shipment', name: 'Hepsiburada', domains: ['hepsiburada.com'] },
  {
    id: 'amazon_tr',
    kind: 'shipment',
    name: 'Amazon',
    domains: ['amazon.com.tr'],
    requires: /(siparis|kargo|teslim|gonderi)/u,
  },
  { id: 'yurtici', kind: 'shipment', name: 'Yurtiçi Kargo', domains: ['yurticikargo.com'] },
  { id: 'aras', kind: 'shipment', name: 'Aras Kargo', domains: ['araskargo.com.tr'] },
  { id: 'mng', kind: 'shipment', name: 'MNG Kargo', domains: ['mngkargo.com.tr'] },
  { id: 'ptt', kind: 'shipment', name: 'PTT Kargo', domains: ['ptt.gov.tr'] },
  { id: 'surat', kind: 'shipment', name: 'Sürat Kargo', domains: ['suratkargo.com.tr'] },
  { id: 'hepsijet', kind: 'shipment', name: 'HepsiJet', domains: ['hepsijet.com'] },
  {
    id: 'trendyol_express',
    kind: 'shipment',
    name: 'Trendyol Express',
    domains: ['trendyolexpress.com'],
  },
  { id: 'thy', kind: 'flight', name: 'THY', domains: ['thy.com', 'turkishairlines.com'] },
  { id: 'pegasus', kind: 'flight', name: 'Pegasus', domains: ['flypgs.com'] },
  { id: 'ajet', kind: 'flight', name: 'AJet', domains: ['ajet.com'] },
  { id: 'sunexpress', kind: 'flight', name: 'SunExpress', domains: ['sunexpress.com'] },
  { id: 'booking', kind: 'reservation', name: 'Booking.com', domains: ['booking.com'] },
  { id: 'airbnb', kind: 'reservation', name: 'Airbnb', domains: ['airbnb.com', 'airbnb.com.tr'] },
  { id: 'obilet', kind: 'reservation', name: 'obilet', domains: ['obilet.com'] },
  { id: 'biletix', kind: 'reservation', name: 'Biletix', domains: ['biletix.com'] },
  { id: 'ckenerji', kind: 'payment', name: 'CK Enerji', domains: ['ckenerji.com.tr'] },
  { id: 'enerjisa', kind: 'payment', name: 'Enerjisa', domains: ['enerjisa.com.tr'] },
  { id: 'igdas', kind: 'payment', name: 'İGDAŞ', domains: ['igdas.com.tr'] },
  { id: 'iski', kind: 'payment', name: 'İSKİ', domains: ['iski.gov.tr'] },
  { id: 'turkcell', kind: 'payment', name: 'Turkcell', domains: ['turkcell.com.tr'] },
  { id: 'vodafone', kind: 'payment', name: 'Vodafone', domains: ['vodafone.com.tr'] },
  { id: 'turktelekom', kind: 'payment', name: 'Türk Telekom', domains: ['turktelekom.com.tr'] },
  { id: 'garanti', kind: 'payment', name: 'Garanti BBVA', domains: ['garantibbva.com.tr'] },
  { id: 'isbank', kind: 'payment', name: 'İş Bankası', domains: ['isbank.com.tr'] },
  { id: 'akbank', kind: 'payment', name: 'Akbank', domains: ['akbank.com'] },
  { id: 'yapikredi', kind: 'payment', name: 'Yapı Kredi', domains: ['yapikredi.com.tr'] },
  { id: 'ziraat', kind: 'payment', name: 'Ziraat Bankası', domains: ['ziraatbank.com.tr'] },
  { id: 'qnb', kind: 'payment', name: 'QNB', domains: ['qnb.com.tr'] },
  { id: 'netflix', kind: 'subscription', name: 'Netflix', domains: ['netflix.com'] },
  { id: 'spotify', kind: 'subscription', name: 'Spotify', domains: ['spotify.com'] },
  {
    id: 'youtube_premium',
    kind: 'subscription',
    name: 'YouTube Premium',
    domains: ['youtube.com', 'google.com'],
    requires: /youtube premium/u,
  },
  {
    id: 'google_one',
    kind: 'subscription',
    name: 'Google One',
    domains: ['google.com'],
    requires: /google one/u,
  },
  {
    id: 'apple_sub',
    kind: 'subscription',
    name: 'Apple',
    domains: ['email.apple.com', 'apple.com'],
    requires: /(abonelik|subscription|yenile|makbuz|receipt)/u,
  },
  { id: 'disney', kind: 'subscription', name: 'Disney+', domains: ['disneyplus.com'] },
  {
    id: 'prime',
    kind: 'subscription',
    name: 'Amazon Prime',
    domains: ['amazon.com.tr'],
    requires: /prime/u,
  },
];

function authenticated(input: TemplateInput): boolean {
  return input.dkimPass === true || input.spfPass === true;
}

export function templateFor(
  input: Pick<TemplateInput, 'fromEmail' | 'subject' | 'text'>,
): SenderTemplate | null {
  const domain = domainOf(input.fromEmail);
  const folded = foldTR(normalizeTR(`${input.subject}\n${input.text.slice(0, 2000)}`));
  const candidates = SENDER_TEMPLATES.filter((t) =>
    t.domains.some((d) => domainMatches(domain, d)),
  );
  // a template with a `requires` pattern wins when it matches (e.g. Prime vs Amazon orders)
  return (
    candidates.find((t) => t.requires !== undefined && t.requires.test(folded)) ??
    candidates.find((t) => t.requires === undefined) ??
    null
  );
}

/** True when the sender belongs to a transactional template (a T0 `transactional` signal). */
export function isTemplateSender(fromEmail: string): boolean {
  const domain = domainOf(fromEmail);
  return SENDER_TEMPLATES.some((t) => t.domains.some((d) => domainMatches(domain, d)));
}

function firstIndex(folded: string, re: RegExp): number {
  const m = re.exec(folded);
  return m === null ? -1 : m.index;
}

/** Dates of a text near a label (folded search, original spans). */
function dateNear(
  input: TemplateInput,
  label: RegExp,
  radius = 120,
): { r: DateResolution; start: number; end: number } | null {
  const folded = foldTR(normalizeTR(input.text));
  const at = firstIndex(folded, label);
  const all = parseDatesTR(input.text, { anchor: input.anchor, timeZone: input.timeZone });
  if (all.length === 0) return null;
  const pick =
    at === -1
      ? null
      : (all
          .filter((d) => Math.abs(d.span[0] - at) <= radius)
          .sort((a, b) => Math.abs(a.span[0] - at) - Math.abs(b.span[0] - at))[0] ?? null);
  return pick === null ? null : { r: pick, start: pick.span[0], end: pick.span[1] };
}

function amountNear(input: TemplateInput, label: RegExp) {
  const folded = foldTR(normalizeTR(input.text));
  const at = firstIndex(folded, label);
  const all = parseAmountsTR(input.text);
  if (all.length === 0) return null;
  const near =
    at === -1
      ? all.length === 1
        ? all[0]
        : undefined
      : all
          .filter((a) => Math.abs(a.span[0] - at) <= 160)
          .sort((a, b) => Math.abs(a.span[0] - at) - Math.abs(b.span[0] - at))[0];
  return near ?? null;
}

const SHIPMENT_STATUS: readonly [RegExp, string][] = [
  [/(teslim edilemedi|teslimat basarisiz|adreste bulunamad)/u, 'delivery_failed'],
  [/(teslim edildi|teslim edilmistir|teslim aldiniz)/u, 'delivered'],
  [/(dagitima cikti|dagitimda|bugun teslim|kurye yola)/u, 'out_for_delivery'],
  [/(yola cikti|transfer merkez|yolda|tasiniyor|aktarma)/u, 'in_transit'],
  [/(kargoya verildi|kargoya teslim|gonderildi|kargolandi)/u, 'shipped'],
  [/(siparisiniz alindi|siparis onay|siparisin alindi|siparisiniz olusturuldu)/u, 'ordered'],
];

function shipment(t: SenderTemplate, input: TemplateInput): LifeCandidate | null {
  const folded = foldTR(normalizeTR(`${input.subject}\n${input.text}`));
  const status = SHIPMENT_STATUS.find(([re]) => re.test(folded))?.[1] ?? null;
  const domain = domainOf(input.fromEmail);
  const trackings = findTrackingNumbers(input.text, { senderDomain: domain });
  const tracking = trackings[0] ?? null;
  if (status === null && tracking === null) return null;
  const carrier = detectCarrier(input.text, domain);
  const merchantTemplate = !carrier || !carrier.domains.some((d) => domainMatches(domain, d));
  const orderMatch = /sipari[sş]\s*(?:no|numaras[ıi]|kodu)\s*[:#]?\s*([A-Z0-9-]{6,20})/iu.exec(
    input.text,
  );
  const evidence = [];
  const dropped: string[] = [];
  if (tracking !== null)
    evidence.push(quoteAt(input.text, tracking.span[0], tracking.span[1], 'tracking_no'));
  if (orderMatch !== null)
    evidence.push(
      quoteAt(input.text, orderMatch.index, orderMatch.index + orderMatch[0].length, 'order_ref'),
    );
  const eta = dateNear(input, /(tahmini teslim|teslimat tarihi|tahmini varis|teslim edilecek)/u);
  if (eta !== null) evidence.push(quoteAt(input.text, eta.start, eta.end, 'eta'));
  if (evidence.length === 0 && status !== null) {
    const line = input.text.split('\n').find((l) => l.trim() !== '') ?? input.subject;
    const s = input.text.indexOf(line);
    if (s !== -1) evidence.push(quoteAt(input.text, s, s + Math.min(line.length, 200), 'status'));
  }
  if (evidence.length === 0) return null;
  const merchant = merchantTemplate ? t.name : null;
  const carrierName =
    carrier === null ? (merchantTemplate ? null : t.name) : carrierDisplay(carrier.id);
  return {
    type: 'shipment',
    origin: 'template',
    status: status ?? 'unknown',
    fields: {
      merchant,
      carrier: carrierName,
      tracking_no: tracking?.value ?? null,
      order_ref: orderMatch?.[1] ?? null,
    },
    eventAt: eta === null ? null : eta.r.start,
    dueAt: null,
    amount: null,
    trackingUrl: findTrackingUrl(input.text),
    ctaUrl: null,
    evidence: evidence.slice(0, 5),
    identity:
      tracking !== null
        ? [carrier?.id ?? carrierName ?? 'carrier', tracking.value]
        : [merchant ?? carrierName ?? t.id, orderMatch?.[1] ?? input.subject],
    confidence: tracking !== null ? 0.9 : 0.75,
    droppedFields: dropped,
  };
}

const CARRIER_NAMES: Readonly<Record<string, string>> = {
  yurtici: 'Yurtiçi Kargo',
  aras: 'Aras Kargo',
  mng: 'MNG Kargo',
  ptt: 'PTT Kargo',
  surat: 'Sürat Kargo',
  hepsijet: 'HepsiJet',
  trendyol_express: 'Trendyol Express',
  kolay_gelsin: 'Kolay Gelsin',
  sendeo: 'Sendeo',
  ups: 'UPS',
  dhl: 'DHL',
  fedex: 'FedEx',
};

export function carrierDisplay(id: string): string {
  return CARRIER_NAMES[id] ?? id;
}

function flight(t: SenderTemplate, input: TemplateInput): LifeCandidate | null {
  const flights = findFlightNumbers(input.text);
  const f = flights[0];
  if (f === undefined) return null;
  const evidence = [quoteAt(input.text, f.span[0], f.span[1], 'flight_no')];
  const pnr = findPnrs(input.text)[0] ?? null;
  if (pnr !== null) evidence.push(quoteAt(input.text, pnr.span[0], pnr.span[1], 'pnr'));
  const depart =
    dateNear(input, /(kalkis|ucus tarihi|departure|gidis)/u, 200) ??
    ((): { r: DateResolution; start: number; end: number } | null => {
      const all = parseDatesTR(input.text, {
        anchor: input.anchor,
        timeZone: input.timeZone,
      }).filter((d) => !d.past);
      const d = all.find((x) => x.precision === 'datetime') ?? all[0];
      return d === undefined ? null : { r: d, start: d.span[0], end: d.span[1] };
    })();
  if (depart !== null) evidence.push(quoteAt(input.text, depart.start, depart.end, 'depart_at'));
  const airports = findAirports(input.text);
  const gate = /kap[ıi]\s*[:#]?\s*([A-Z]?\d{1,3}[A-Z]?)(?![\p{L}\d])/iu.exec(input.text);
  if (gate !== null)
    evidence.push(quoteAt(input.text, gate.index, gate.index + gate[0].length, 'gate'));
  const folded = foldTR(normalizeTR(`${input.subject}\n${input.text}`));
  const checkin = /(check-?in (islemi )?(acildi|acik|basladi)|online check-?in)/u.test(folded)
    ? 'open'
    : 'unknown';
  const departLocal = depart?.r.localDate ?? null;
  return {
    type: 'flight',
    origin: 'template',
    status: checkin === 'open' ? 'checkin_open' : 'confirmed',
    fields: {
      airline: t.name,
      flight_no: f.flightNo,
      from: airports[0] ?? null,
      to: airports[1] ?? null,
      gate: gate?.[1] ?? null,
      pnr: pnr?.code ?? null,
      checkin_status: checkin,
    },
    eventAt: depart === null ? null : depart.r.start,
    dueAt: null,
    amount: null,
    trackingUrl: null,
    ctaUrl: null,
    evidence: evidence.slice(0, 5),
    identity: [f.flightNo, departLocal],
    confidence: depart === null ? 0.75 : 0.9,
    droppedFields: depart === null ? ['depart_at'] : [],
  };
}

function reservation(t: SenderTemplate, input: TemplateInput): LifeCandidate | null {
  const folded = foldTR(normalizeTR(`${input.subject}\n${input.text}`));
  if (!/(rezervasyon|reservation|booking|bilet|konaklama|check-?in)/u.test(folded)) return null;
  const at =
    dateNear(input, /(giris|check-?in|tarih|etkinlik|sefer|kalkis)/u, 200) ??
    ((): { r: DateResolution; start: number; end: number } | null => {
      const d = parseDatesTR(input.text, { anchor: input.anchor, timeZone: input.timeZone }).find(
        (x) => !x.past,
      );
      return d === undefined ? null : { r: d, start: d.span[0], end: d.span[1] };
    })();
  if (at === null) return null;
  const evidence = [quoteAt(input.text, at.start, at.end, 'at')];
  const party = /(\d{1,2})\s*(?:kişi|kisi|misafir|yetişkin|yetiskin)/iu.exec(input.text);
  if (party !== null)
    evidence.push(quoteAt(input.text, party.index, party.index + party[0].length, 'party_size'));
  const deadline = dateNear(input, /(onay(lamak)? icin son|son onay|iptal icin son)/u);
  if (deadline !== null)
    evidence.push(quoteAt(input.text, deadline.start, deadline.end, 'confirm_by'));
  const venue = t.name;
  return {
    type: 'reservation',
    origin: 'template',
    status: 'confirmed',
    fields: {
      venue,
      reservation_type:
        t.id === 'booking' || t.id === 'airbnb'
          ? 'hotel'
          : t.id === 'obilet'
            ? 'transport'
            : 'event',
      party_size: party === null ? null : Number(party[1]),
    },
    eventAt: at.r.start,
    dueAt: deadline === null ? null : dueInstant(deadline.r, input.timeZone),
    amount: null,
    trackingUrl: null,
    ctaUrl: null,
    evidence: evidence.slice(0, 5),
    identity: [venue, Math.trunc(at.r.start.getTime() / 1000)],
    confidence: 0.85,
    droppedFields: [],
  };
}

function payment(t: SenderTemplate, input: TemplateInput): LifeCandidate | null {
  const folded = foldTR(normalizeTR(`${input.subject}\n${input.text}`));
  if (!/(fatura|odeme|ekstre|borc|tahsil|son odeme|asgari)/u.test(folded)) return null;
  const status = /(odendi|odemeniz alindi|tahsil edildi|basariyla odenmistir)/u.test(folded)
    ? 'paid'
    : /(basarisiz|gerceklestirilemedi|reddedildi)/u.test(folded)
      ? 'failed'
      : /(iade)/u.test(folded)
        ? 'refund'
        : 'due';
  const amount = amountNear(
    input,
    /(fatura tutari|odenecek tutar|toplam tutar|tutar|asgari|borc)/u,
  );
  const due = dateNear(input, /(son odeme|odeme tarihi|vade)/u, 160);
  const evidence = [];
  const dropped: string[] = [];
  if (amount !== null) evidence.push(quoteAt(input.text, amount.span[0], amount.span[1], 'amount'));
  else dropped.push('amount');
  if (due !== null) evidence.push(quoteAt(input.text, due.start, due.end, 'due_at'));
  else dropped.push('due_at');
  if (evidence.length === 0) return null;
  const dueAt = due === null ? null : dueInstant(due.r, input.timeZone);
  return {
    type: 'payment',
    origin: 'template',
    status,
    fields: { payee: t.name },
    eventAt: null,
    dueAt,
    amount:
      amount === null
        ? null
        : { minor: Math.abs(amount.minor), currency: amount.currency, evidence: evidence[0]! },
    trackingUrl: null,
    ctaUrl: null,
    evidence,
    identity: [t.name, due?.r.localDate ?? null, amount === null ? 'na' : Math.abs(amount.minor)],
    confidence: amount !== null && due !== null ? 0.9 : 0.75,
    droppedFields: dropped,
  };
}

const SUBSCRIPTION_EVENTS: readonly [RegExp, string][] = [
  [/(deneme sure(n|niz)|ucretsiz deneme).{0,40}(bit|sona er)/u, 'trial_ending'],
  [/(iptal edildi|aboneliginiz sona erdi|uyeliginiz iptal)/u, 'cancelled'],
  [/(fiyat(i|lar)? degis|yeni fiyat|fiyat guncellemesi)/u, 'price_change'],
  [/(yenilendi|odemeniz alindi|makbuz|receipt)/u, 'renewed'],
  [/(yenilenecek|yenileme tarihi|bir sonraki odeme|otomatik olarak yenilen)/u, 'renewal_upcoming'],
];

function subscription(t: SenderTemplate, input: TemplateInput): LifeCandidate | null {
  const folded = foldTR(normalizeTR(`${input.subject}\n${input.text}`));
  const event = SUBSCRIPTION_EVENTS.find(([re]) => re.test(folded))?.[1] ?? null;
  if (event === null) return null;
  const amount = amountNear(input, /(tutar|ucret|fiyat|aylik|yillik|toplam)/u);
  const renews = dateNear(input, /(yenilen|bir sonraki odeme|sona er|bitis|tarih)/u, 160);
  const evidence = [];
  const dropped: string[] = [];
  if (renews !== null) evidence.push(quoteAt(input.text, renews.start, renews.end, 'renews_at'));
  else dropped.push('renews_at');
  if (amount !== null) evidence.push(quoteAt(input.text, amount.span[0], amount.span[1], 'amount'));
  else dropped.push('amount');
  if (evidence.length === 0) {
    const s = input.text.indexOf(input.text.trim().split('\n')[0] ?? '');
    evidence.push(quoteAt(input.text, Math.max(0, s), Math.max(0, s) + 80, 'event'));
  }
  const period = /(yillik|yearly|annual)/u.test(folded)
    ? 'yearly'
    : /(aylik|monthly)/u.test(folded)
      ? 'monthly'
      : 'unknown';
  return {
    type: 'subscription',
    origin: 'template',
    status: event,
    fields: { service: t.name, period },
    eventAt: renews === null ? null : renews.r.start,
    dueAt: null,
    amount:
      amount === null
        ? null
        : {
            minor: Math.abs(amount.minor),
            currency: amount.currency,
            evidence: evidence.find((e) => e.field === 'amount')!,
          },
    trackingUrl: null,
    ctaUrl: null,
    evidence,
    identity: [t.name, renews?.r.localDate ?? null],
    confidence: 0.85,
    droppedFields: dropped,
  };
}

// ── Security (T0 only, never a model) ────────────────────────────────────────

const SECURITY_SUBJECT =
  /(guvenlik uyarisi|guvenlik bildirimi|yeni (bir )?oturum|yeni giris|oturum acildi|sign-?in|security alert|sifreniz (degistirildi|guncellendi)|password (was )?changed|kurtarma (e-?postasi|telefonu|bilgi)|recovery (email|phone)|supheli|suspicious|hesabiniza erisim)/u;

const SECURITY_EVENTS: readonly [RegExp, string][] = [
  [/(sifreniz (degistirildi|guncellendi)|password (was )?changed)/u, 'password_changed'],
  [
    /(kurtarma (e-?postasi|telefonu|bilgi)|recovery (email|phone|information))/u,
    'recovery_changed',
  ],
  [/(supheli|suspicious|olagan disi|engellendi|blocked)/u, 'suspicious_activity'],
  [/(yeni (bir )?oturum|yeni giris|oturum acildi|sign-?in|new device|yeni cihaz)/u, 'new_sign_in'],
];

export type SecurityOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'rejected'; readonly sender: SecuritySender }
  | { readonly kind: 'event'; readonly sender: SecuritySender; readonly candidate: LifeCandidate };

/**
 * Account-security templates. A matching mail without DKIM/SPF alignment on the From domain is
 * `rejected` (a spoofed security mail never becomes a security event and is never elevated).
 */
export function detectSecurity(input: TemplateInput): SecurityOutcome {
  const sender = securitySenderFor(input.fromEmail);
  const folded = foldTR(normalizeTR(`${input.subject}\n${input.text.slice(0, 3000)}`));
  if (!SECURITY_SUBJECT.test(folded)) return { kind: 'none' };
  if (sender === null) return { kind: 'none' };
  if (!authenticated(input)) return { kind: 'rejected', sender };
  const event = SECURITY_EVENTS.find(([re]) => re.test(folded))?.[1] ?? 'suspicious_activity';
  const source = `${input.subject}\n${input.text}`;
  const line =
    source.split('\n').find((l) => SECURITY_SUBJECT.test(foldTR(normalizeTR(l)))) ?? input.subject;
  const at = Math.max(0, source.indexOf(line));
  const whenMatch = parseDatesTR(input.text, { anchor: input.anchor, timeZone: input.timeZone })[0];
  const occurred = whenMatch?.precision === 'datetime' ? whenMatch.start : new Date(input.anchor);
  return {
    kind: 'event',
    sender,
    candidate: {
      type: 'security',
      origin: 'security',
      status: event,
      fields: { provider: sender.provider, service: sender.name, event },
      eventAt: occurred,
      dueAt: null,
      amount: null,
      trackingUrl: null,
      ctaUrl: sender.securityUrl,
      evidence: [quoteAt(source, at, at + Math.min(line.length, 200), 'event')],
      identity: [sender.provider, event, Math.trunc(occurred.getTime() / 60_000)],
      confidence: 0.95,
      droppedFields: [],
    },
  };
}

/** The T0 template parse of one mail (security excluded; see {@link detectSecurity}). */
export function parseTemplate(input: TemplateInput): {
  template: SenderTemplate | null;
  candidate: LifeCandidate | null;
} {
  const template = templateFor(input);
  if (template === null || !authenticated(input)) return { template, candidate: null };
  const candidate =
    template.kind === 'shipment'
      ? shipment(template, input)
      : template.kind === 'flight'
        ? flight(template, input)
        : template.kind === 'reservation'
          ? reservation(template, input)
          : template.kind === 'payment'
            ? payment(template, input)
            : subscription(template, input);
  return { template, candidate };
}
