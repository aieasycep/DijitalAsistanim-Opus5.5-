/**
 * Shipment tracking numbers (AI_PIPELINE_PLAN §6.9.4). UPU S10 codes are validated with their
 * mod-11 check digit; UPS by format; DHL/FedEx and Turkish domestic carriers (no public format)
 * only with carrier context plus a tracking label. Carrier links are parsed, never fetched.
 */
import { foldTR, normalizeTR } from './normalize-tr.ts';

export type CarrierId =
  | 'yurtici'
  | 'aras'
  | 'mng'
  | 'ptt'
  | 'surat'
  | 'hepsijet'
  | 'trendyol_express'
  | 'kolay_gelsin'
  | 'sendeo'
  | 'ups'
  | 'dhl'
  | 'fedex';

export interface CarrierInfo {
  readonly id: CarrierId;
  /** Folded, lower-case names searched in text. */
  readonly names: readonly string[];
  /** Sender / link domains (suffix match). */
  readonly domains: readonly string[];
  readonly domestic: boolean;
}

export const CARRIERS: readonly CarrierInfo[] = [
  {
    id: 'yurtici',
    names: ['yurtici kargo', 'yurtici'],
    domains: ['yurticikargo.com'],
    domestic: true,
  },
  { id: 'aras', names: ['aras kargo'], domains: ['araskargo.com.tr'], domestic: true },
  { id: 'mng', names: ['mng kargo', 'mng'], domains: ['mngkargo.com.tr'], domestic: true },
  { id: 'ptt', names: ['ptt kargo', 'ptt'], domains: ['ptt.gov.tr', 'pttavm.com'], domestic: true },
  { id: 'surat', names: ['surat kargo'], domains: ['suratkargo.com.tr'], domestic: true },
  { id: 'hepsijet', names: ['hepsijet'], domains: ['hepsijet.com'], domestic: true },
  {
    id: 'trendyol_express',
    names: ['trendyol express'],
    domains: ['trendyolexpress.com'],
    domestic: true,
  },
  { id: 'kolay_gelsin', names: ['kolay gelsin'], domains: ['kolaygelsin.com'], domestic: true },
  { id: 'sendeo', names: ['sendeo'], domains: ['sendeo.com.tr'], domestic: true },
  { id: 'ups', names: ['ups'], domains: ['ups.com', 'ups.com.tr'], domestic: false },
  { id: 'dhl', names: ['dhl'], domains: ['dhl.com', 'dhl.com.tr'], domestic: false },
  { id: 'fedex', names: ['fedex'], domains: ['fedex.com'], domestic: false },
];

export type TrackingKind = 's10' | 'ups' | 'dhl' | 'fedex' | 'domestic' | 'link_param';

export interface TrackingMatch {
  readonly value: string;
  readonly kind: TrackingKind;
  readonly carrier: CarrierId | null;
  readonly span: readonly [number, number];
}

const S10_WEIGHTS = [8, 6, 4, 2, 3, 5, 9, 7] as const;

/** UPU S10 check (e.g. `RR123456785TR`): weights 8,6,4,2,3,5,9,7; 11 − sum mod 11; 10→0; 11→5. */
export function isValidS10(code: string): boolean {
  const m = /^[A-Z]{2}(\d{8})(\d)[A-Z]{2}$/.exec(code);
  if (!m) return false;
  const serial = m[1] ?? '';
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(serial[i]) * (S10_WEIGHTS[i] ?? 0);
  let check = 11 - (sum % 11);
  if (check === 10) check = 0;
  else if (check === 11) check = 5;
  return check === Number(m[2]);
}

function domainMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  return h === domain || h.endsWith(`.${domain}`);
}

/** Carrier detected from the sender domain or the text (folded names, word boundaries). */
export function detectCarrier(text: string, senderDomain?: string | null): CarrierInfo | null {
  if (senderDomain) {
    const byDomain = CARRIERS.find((c) => c.domains.some((d) => domainMatches(senderDomain, d)));
    if (byDomain) return byDomain;
  }
  const folded = foldTR(normalizeTR(text));
  for (const c of CARRIERS) {
    for (const name of c.names) {
      if (new RegExp(`(?<![\\p{L}\\d])${name}(?![\\p{L}\\d])`, 'u').test(folded)) return c;
    }
  }
  return null;
}

const S10_RE = /(?<![A-Z0-9])[A-Z]{2}\d{9}[A-Z]{2}(?![A-Z0-9])/g;
const UPS_RE = /(?<![A-Z0-9])1Z[0-9A-Z]{16}(?![A-Z0-9])/g;
/**
 * Label, optional `:`/`#`, value. The separator is `\s*(?:[:#]\s*)?`, not `\s*[:#]?\s*`: two
 * adjacent `\s*` split a run of spaces in O(n) ways (quadratic after "barkod" + many spaces).
 */
const LABEL_RE =
  /(?:kargo\s*takip\s*(?:no|numarası|numarasi|kodu)|gönderi\s*(?:no|kodu|numarası|numarasi)|gonderi\s*(?:no|kodu|numarasi)|takip\s*(?:no|numarası|numarasi|kodu)|barkod(?:\s*no)?|tracking\s*(?:number|no|id))\s*(?:[:#]\s*)?([A-Z0-9-]{8,24})(?![A-Z0-9-])/giu;

const HTTPS = 'https://';
const LINK_HOST_CHAR = /[a-z0-9.-]/;
const LINK_END_CHAR = /[\s"'<>]/;
/** A tracking parameter at one `?` / `&` position (sticky, bounded). */
const LINK_PARAM = /[?&](?:code|barcode|trackingNumber|takipNo|kargoTakipNo)=([A-Za-z0-9-]{8,30})/y;

interface LinkParam {
  readonly host: string;
  readonly value: string;
  /** Index of `value` in the text. */
  readonly start: number;
}

/**
 * Carrier-link parameters with the semantics of
 * `/https:\/\/([a-z0-9.-]+)\/[^\s"'<>]*?[?&](?:code|…)=([A-Za-z0-9-]{8,30})/g` (per link, the
 * first tracking parameter) in one linear scan. The regex rescanned the rest of the link from
 * every later `https://` inside it, so "https://-/https://-/…" was quadratic. Here a link whose
 * path holds no parameter is skipped whole: each later `https://` inside it sees a suffix of the
 * same path with the same end, so it cannot match either.
 */
function findLinkParams(text: string): LinkParam[] {
  const out: LinkParam[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(HTTPS, from);
    if (at === -1) return out;
    const hostStart = at + HTTPS.length;
    let slash = hostStart;
    while (slash < text.length && LINK_HOST_CHAR.test(text.charAt(slash))) slash += 1;
    if (slash === hostStart || text.charAt(slash) !== '/') {
      from = at + 1;
      continue;
    }
    let p = slash + 1;
    let found: RegExpExecArray | null = null;
    for (; p < text.length && !LINK_END_CHAR.test(text.charAt(p)); p += 1) {
      const c = text.charAt(p);
      if (c !== '?' && c !== '&') continue;
      LINK_PARAM.lastIndex = p;
      found = LINK_PARAM.exec(text);
      if (found !== null) break;
    }
    if (found === null) {
      from = p;
      continue;
    }
    const value = found[1] ?? '';
    const end = p + found[0].length;
    out.push({ host: text.slice(hostStart, slash), value, start: end - value.length });
    from = end;
  }
}

function within(text: string, index: number, re: RegExp, radius = 60): boolean {
  return re.test(text.slice(Math.max(0, index - radius), index + radius));
}

export interface TrackingOptions {
  /** Domain of the sender address (carrier detection by sender). */
  readonly senderDomain?: string | null;
}

/** Tracking numbers in `text`. Domestic numbers need both a carrier and a tracking label. */
export function findTrackingNumbers(text: string, opts: TrackingOptions = {}): TrackingMatch[] {
  const out: TrackingMatch[] = [];
  const push = (m: TrackingMatch): void => {
    if (out.some((x) => x.value === m.value)) return;
    out.push(m);
  };
  const carrier = detectCarrier(text, opts.senderDomain);

  for (const m of text.matchAll(S10_RE)) {
    if (isValidS10(m[0])) {
      push({
        value: m[0],
        kind: 's10',
        carrier: m[0].endsWith('TR') ? 'ptt' : (carrier?.id ?? null),
        span: [m.index, m.index + m[0].length],
      });
    }
  }
  for (const m of text.matchAll(UPS_RE)) {
    push({ value: m[0], kind: 'ups', carrier: 'ups', span: [m.index, m.index + m[0].length] });
  }
  for (const m of text.matchAll(/(?<![\d])(\d{10}|\d{12}|\d{15})(?![\d])/g)) {
    const v = m[1] ?? '';
    if (v.length === 10 && within(text, m.index, /dhl/i)) {
      push({ value: v, kind: 'dhl', carrier: 'dhl', span: [m.index, m.index + v.length] });
    } else if ((v.length === 12 || v.length === 15) && within(text, m.index, /fedex/i)) {
      push({ value: v, kind: 'fedex', carrier: 'fedex', span: [m.index, m.index + v.length] });
    }
  }
  if (carrier?.domestic) {
    for (const m of text.matchAll(LABEL_RE)) {
      const v = m[1] ?? '';
      if (!/\d/.test(v) || out.some((x) => x.value === v)) continue;
      const start = m.index + m[0].length - v.length;
      push({ value: v, kind: 'domestic', carrier: carrier.id, span: [start, start + v.length] });
    }
  }
  for (const { host, value: v, start } of findLinkParams(text)) {
    const linkCarrier = CARRIERS.find((c) => c.domains.some((d) => domainMatches(host, d)));
    if (!linkCarrier) continue;
    push({
      value: v,
      kind: 'link_param',
      carrier: linkCarrier.id,
      span: [start, start + v.length],
    });
  }
  return out.sort((a, b) => a.span[0] - b.span[0]);
}
