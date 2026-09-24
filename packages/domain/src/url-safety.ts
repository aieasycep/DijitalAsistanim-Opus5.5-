/**
 * Link safety for content shown to users (mail links, capture links, meeting links; TEST_PLAN
 * UT-URL-01, SREQ-23, SECURITY_AND_PRIVACY_PLAN THR-07/THR-09).
 *
 * - Scheme allow-list for openable links: `https:` and `mailto:`.
 * - Conferencing hand-off allow-list ("Toplantıya Katıl"): exactly the hosts accepted by the
 *   `calendar_events.conference_url` check constraint (DATABASE_AND_RLS_PLAN §4.3):
 *   `meet.google.com`, `teams.microsoft.com`, `teams.live.com`, `zoom.us` and one-label
 *   subdomains of `zoom.us` (e.g. `us02web.zoom.us`), `https:` only.
 * - IDN display: a host is shown in Unicode only when every label is ASCII or Latin script
 *   (Turkish letters included); mixed-script or non-Latin labels are shown as punycode (`xn--`).
 * - Anchor mismatch: a link whose visible text names a different site than its real target.
 *
 * The parser is a small WHATWG-compatible subset written in plain TypeScript, because the React
 * Native runtime has no complete `URL` implementation; it never needs network access.
 */
import { classifyIp, hostEndsInNumber, parseIpv4Loose, formatIpv4 } from './net/ip-ranges.ts';
import { decodeLabel, toAsciiHost } from './net/punycode.ts';

export const LINK_SCHEME_ALLOWLIST = ['https:', 'mailto:'] as const;
export type AllowedLinkScheme = (typeof LINK_SCHEME_ALLOWLIST)[number];

export const CONFERENCING_HOSTS = [
  'meet.google.com',
  'teams.microsoft.com',
  'teams.live.com',
  'zoom.us',
] as const;
/** Parents whose single-label subdomains are allowed (`([a-z0-9-]+\.)?zoom\.us` in the DB check). */
export const CONFERENCING_SUBDOMAIN_PARENTS = ['zoom.us'] as const;

export interface ParsedLink {
  /** Lower-case scheme including the trailing colon, e.g. `https:`. */
  scheme: string;
  /** ASCII (A-label) host without a trailing dot; IPv6 in brackets; null when there is none. */
  host: string | null;
  /** Explicit non-default port, or `''`. */
  port: string;
  hasCredentials: boolean;
  /** Everything after the authority (path, query, fragment); for opaque schemes the remainder. */
  rest: string;
  /** For `mailto:` links: the first recipient, lower-cased. */
  mailtoAddress: string | null;
}

const SPECIAL_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:', 'file:']);
const DEFAULT_PORTS: Readonly<Record<string, string>> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
  'ftp:': '21',
};
const FORBIDDEN_HOST_CHARS = /[\s#%/:<>?@[\\\]^|]/;

function trimC0AndSpace(input: string): string {
  let start = 0;
  let end = input.length;
  while (start < end && input.charCodeAt(start) <= 0x20) start++;
  while (end > start && input.charCodeAt(end - 1) <= 0x20) end--;
  return input.slice(start, end);
}

function removeTabsAndNewlines(input: string): string {
  return input.replace(/[\t\n\r]/g, '');
}

function percentDecode(input: string): string | null {
  if (!input.includes('%')) return input;
  try {
    return decodeURIComponent(input);
  } catch {
    return null;
  }
}

/** Normalises a host the way WHATWG does for special schemes; null when invalid. */
export function normalizeLinkHost(rawHost: string): string | null {
  if (rawHost.startsWith('[')) {
    if (!rawHost.endsWith(']')) return null;
    const ip = classifyIp(rawHost);
    return ip?.family === 6 ? `[${ip.address}]` : null;
  }
  const decoded = percentDecode(rawHost);
  if (decoded === null || decoded === '' || FORBIDDEN_HOST_CHARS.test(decoded)) return null;
  const ascii = toAsciiHost(decoded);
  if (ascii === null) return null;
  const host = ascii.endsWith('.') ? ascii.slice(0, -1) : ascii;
  if (host === '' || host.split('.').some((label) => label === '')) return null;
  if (hostEndsInNumber(host)) {
    const value = parseIpv4Loose(host);
    return value === null ? null : formatIpv4(value);
  }
  return host;
}

/** Parses a link with WHATWG-compatible host handling. Returns null for unparseable input. */
export function parseLink(raw: string): ParsedLink | null {
  const input = removeTabsAndNewlines(trimC0AndSpace(raw));
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(input);
  if (schemeMatch === null) return null;
  const scheme = `${(schemeMatch[1] ?? '').toLowerCase()}:`;
  let rest = input.slice(schemeMatch[0].length);

  if (scheme === 'mailto:') {
    const target = percentDecode((rest.split('?')[0] ?? '').split(',')[0] ?? '');
    if (target === null) return null;
    const address = target.trim().toLowerCase();
    const at = address.lastIndexOf('@');
    const host = at > 0 ? normalizeLinkHost(address.slice(at + 1)) : null;
    return {
      scheme,
      host,
      port: '',
      hasCredentials: false,
      rest,
      mailtoAddress: at > 0 && host !== null ? `${address.slice(0, at)}@${host}` : null,
    };
  }

  const special = SPECIAL_SCHEMES.has(scheme);
  if (special) {
    rest = rest.replace(/^[/\\]*/, '');
  } else if (rest.startsWith('//')) {
    rest = rest.slice(2);
  } else {
    return { scheme, host: null, port: '', hasCredentials: false, rest, mailtoAddress: null };
  }

  const delimiter = special ? /[/?#\\]/ : /[/?#]/;
  const match = delimiter.exec(rest);
  const end = match === null ? rest.length : match.index;
  const authority = rest.slice(0, end);
  let after = rest.slice(end);
  if (special) {
    const queryStart = after.search(/[?#]/);
    const path = queryStart < 0 ? after : after.slice(0, queryStart);
    after = path.replace(/\\/g, '/') + (queryStart < 0 ? '' : after.slice(queryStart));
  }

  const at = authority.lastIndexOf('@');
  const hostPort = authority.slice(at + 1);
  let rawHost = hostPort;
  let port = '';
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    if (close < 0) return null;
    rawHost = hostPort.slice(0, close + 1);
    const tail = hostPort.slice(close + 1);
    if (tail !== '') {
      if (!tail.startsWith(':')) return null;
      port = tail.slice(1);
    }
  } else {
    const colon = hostPort.lastIndexOf(':');
    if (colon >= 0) {
      rawHost = hostPort.slice(0, colon);
      port = hostPort.slice(colon + 1);
    }
  }
  if (port !== '') {
    if (!/^[0-9]+$/.test(port) || Number(port) > 65535) return null;
    port = String(Number(port));
    if (DEFAULT_PORTS[scheme] === port) port = '';
  }
  if (rawHost === '') {
    if (scheme === 'file:') {
      return {
        scheme,
        host: null,
        port,
        hasCredentials: at >= 0,
        rest: after,
        mailtoAddress: null,
      };
    }
    return null;
  }
  const host = normalizeLinkHost(rawHost);
  if (host === null) return null;
  return { scheme, host, port, hasCredentials: at >= 0, rest: after, mailtoAddress: null };
}

export function isAllowedLinkScheme(raw: string): boolean {
  const parsed = parseLink(raw);
  return parsed !== null && (LINK_SCHEME_ALLOWLIST as readonly string[]).includes(parsed.scheme);
}

// ---------------------------------------------------------------------------------------------
// IDN display

type Script =
  | 'ascii'
  | 'latin'
  | 'greek'
  | 'cyrillic'
  | 'armenian'
  | 'hebrew'
  | 'arabic'
  | 'cjk'
  | 'hangul'
  | 'thai'
  | 'devanagari'
  | 'georgian'
  | 'other';

function inRange(cp: number, from: number, to: number): boolean {
  return cp >= from && cp <= to;
}

function scriptOf(cp: number): Script {
  if (inRange(cp, 0x61, 0x7a) || inRange(cp, 0x30, 0x39) || cp === 0x2d) return 'ascii';
  if ((inRange(cp, 0xc0, 0x24f) && cp !== 0xd7 && cp !== 0xf7) || inRange(cp, 0x1e00, 0x1eff)) {
    return 'latin';
  }
  if (inRange(cp, 0x370, 0x3ff) || inRange(cp, 0x1f00, 0x1fff)) return 'greek';
  if (
    inRange(cp, 0x400, 0x52f) ||
    inRange(cp, 0x1c80, 0x1c8f) ||
    inRange(cp, 0x2de0, 0x2dff) ||
    inRange(cp, 0xa640, 0xa69f)
  ) {
    return 'cyrillic';
  }
  if (inRange(cp, 0x530, 0x58f)) return 'armenian';
  if (inRange(cp, 0x590, 0x5ff)) return 'hebrew';
  if (inRange(cp, 0x600, 0x6ff) || inRange(cp, 0x750, 0x77f) || inRange(cp, 0x8a0, 0x8ff)) {
    return 'arabic';
  }
  if (inRange(cp, 0x3040, 0x30ff) || inRange(cp, 0x3400, 0x4dbf) || inRange(cp, 0x4e00, 0x9fff)) {
    return 'cjk';
  }
  if (inRange(cp, 0xac00, 0xd7af)) return 'hangul';
  if (inRange(cp, 0xe00, 0xe7f)) return 'thai';
  if (inRange(cp, 0x900, 0x97f)) return 'devanagari';
  if (inRange(cp, 0x10a0, 0x10ff)) return 'georgian';
  return 'other';
}

export type IdnDisplayReason = 'mixed_script' | 'non_latin_script' | 'invalid_punycode';

export interface HostDisplay {
  /** A-label form. */
  ascii: string;
  /** U-label form, or null when a label is not valid punycode. */
  unicode: string | null;
  /** What the UI shows. */
  display: string;
  isIdn: boolean;
  shownAsPunycode: boolean;
  reason: IdnDisplayReason | null;
}

function labelDisplayProblem(label: string): IdnDisplayReason | null {
  let latinLetters = false;
  let otherScript = false;
  for (const ch of label) {
    const cp = ch.codePointAt(0) ?? 0;
    const script = scriptOf(cp);
    if (script === 'latin' || (script === 'ascii' && inRange(cp, 0x61, 0x7a))) latinLetters = true;
    else if (script !== 'ascii') otherScript = true;
  }
  if (!otherScript) return null;
  return latinLetters ? 'mixed_script' : 'non_latin_script';
}

/** Decides how a host is displayed (Unicode for Latin-script IDNs, punycode otherwise). */
export function displayHost(host: string): HostDisplay {
  if (host.startsWith('[') || classifyIp(host) !== null) {
    const ip = host.toLowerCase();
    return {
      ascii: ip,
      unicode: ip,
      display: ip,
      isIdn: false,
      shownAsPunycode: false,
      reason: null,
    };
  }
  const ascii = toAsciiHost(host) ?? host.toLowerCase();
  const labels = ascii.split('.');
  const isIdn = labels.some((label) => label.startsWith('xn--'));
  const unicodeLabels: string[] = [];
  let reason: IdnDisplayReason | null = null;
  for (const label of labels) {
    const decoded = decodeLabel(label);
    if (decoded === null) {
      return {
        ascii,
        unicode: null,
        display: ascii,
        isIdn,
        shownAsPunycode: true,
        reason: 'invalid_punycode',
      };
    }
    reason ??= labelDisplayProblem(decoded);
    unicodeLabels.push(decoded);
  }
  const unicode = unicodeLabels.join('.');
  const shownAsPunycode = reason !== null;
  return {
    ascii,
    unicode,
    display: shownAsPunycode ? ascii : unicode,
    isIdn,
    shownAsPunycode,
    reason,
  };
}

// ---------------------------------------------------------------------------------------------
// Site (registrable domain) approximation and anchor-text mismatch

/**
 * Two-label public suffixes recognised when approximating the registrable domain. This is a
 * deliberate subset of the Public Suffix List covering Turkish second-level domains and the most
 * common country-code patterns; other hosts use their last two labels.
 */
export const TWO_LABEL_PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  'com.tr',
  'net.tr',
  'org.tr',
  'gov.tr',
  'edu.tr',
  'gen.tr',
  'bel.tr',
  'k12.tr',
  'av.tr',
  'dr.tr',
  'bbs.tr',
  'biz.tr',
  'info.tr',
  'name.tr',
  'tel.tr',
  'web.tr',
  'pol.tr',
  'tsk.tr',
  'kep.tr',
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.br',
  'com.cn',
  'com.mx',
  'co.nz',
  'co.za',
  'com.sg',
  'com.hk',
  'co.in',
  'co.kr',
]);

/** Approximate registrable domain ("site") of an ASCII host; IP literals are their own site. */
export function siteOf(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (h.startsWith('[') || classifyIp(h) !== null) return h;
  const labels = h.split('.');
  if (labels.length <= 2) return h;
  const lastTwo = labels.slice(-2).join('.');
  return TWO_LABEL_PUBLIC_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

/** Dot-separated labels (Unicode letters allowed) ending in a label that starts with a letter. */
const LABELS = String.raw`(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?[.。．｡])+\p{L}[\p{L}\p{N}-]*`;
/** A host after an explicit scheme (`https://…`) or after `www.`, anywhere in the text. */
const URL_IN_TEXT = new RegExp(
  String.raw`(?:\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s@/]+@)?|\bwww\.)(${LABELS})`,
  'iu',
);
/** The whole text is one host, scheme-less URL or e-mail address. */
const WHOLE_HOST = new RegExp(
  String.raw`^(?:[^\s@/]+@)?(${LABELS})(?::[0-9]+)?(?:[/?#]\S*)?$`,
  'iu',
);
const WRAPPING_PUNCTUATION = /^[<(["'«“]+|[>)\]"'»”.,;:!?]+$/gu;

/**
 * Host named by visible link text: a URL with a scheme or a `www.` host anywhere in the text, or
 * a text that is itself a single host / e-mail address. Prose without such a token names no host.
 */
export function hostInText(text: string): string | null {
  const trimmed = text.trim();
  const candidate =
    URL_IN_TEXT.exec(trimmed)?.[1] ??
    WHOLE_HOST.exec(trimmed.replace(WRAPPING_PUNCTUATION, ''))?.[1];
  if (candidate === undefined) return null;
  const ascii = normalizeLinkHost(candidate);
  if (ascii === null) return null;
  const tld = ascii.split('.').pop() ?? '';
  return tld.length >= 2 ? ascii : null;
}

export interface AnchorCheck {
  mismatch: boolean;
  /** Host named in the anchor text (ASCII), when the text names one. */
  textHost: string | null;
  /** Real target host (ASCII), or the mail domain for `mailto:`. */
  hrefHost: string | null;
}

/**
 * Warns when the visible text of a link names a different site than the link target, e.g. text
 * "garanti.com.tr" pointing at `https://garanti-giris.example`. Subdomains of the same site match.
 */
export function detectAnchorMismatch(anchorText: string, href: string): AnchorCheck {
  const textHost = hostInText(anchorText);
  const parsed = parseLink(href);
  const hrefHost = parsed?.host ?? null;
  if (textHost === null || hrefHost === null) return { mismatch: false, textHost, hrefHost };
  return { mismatch: siteOf(textHost) !== siteOf(hrefHost), textHost, hrefHost };
}

export type LinkWarning =
  'invalid' | 'scheme_not_allowed' | 'credentials' | 'ip_host' | 'idn_punycode' | 'anchor_mismatch';

export interface LinkAssessment {
  /** True when the link may be opened (valid, allowed scheme, no embedded credentials). */
  openable: boolean;
  scheme: string | null;
  host: HostDisplay | null;
  warnings: LinkWarning[];
}

/** One call for UI surfaces that render a link: openability, host display and warnings. */
export function assessLink(href: string, anchorText?: string): LinkAssessment {
  const parsed = parseLink(href);
  if (parsed === null) return { openable: false, scheme: null, host: null, warnings: ['invalid'] };
  const warnings: LinkWarning[] = [];
  const schemeAllowed = (LINK_SCHEME_ALLOWLIST as readonly string[]).includes(parsed.scheme);
  if (!schemeAllowed) warnings.push('scheme_not_allowed');
  if (parsed.hasCredentials) warnings.push('credentials');
  if (parsed.host !== null && (parsed.host.startsWith('[') || classifyIp(parsed.host) !== null)) {
    warnings.push('ip_host');
  }
  const host = parsed.host === null ? null : displayHost(parsed.host);
  if (host?.shownAsPunycode) warnings.push('idn_punycode');
  if (anchorText !== undefined && detectAnchorMismatch(anchorText, href).mismatch) {
    warnings.push('anchor_mismatch');
  }
  const hasTarget = parsed.scheme === 'mailto:' ? parsed.mailtoAddress !== null : host !== null;
  return {
    openable: schemeAllowed && !parsed.hasCredentials && hasTarget,
    scheme: parsed.scheme,
    host,
    warnings,
  };
}

// ---------------------------------------------------------------------------------------------
// Conferencing hand-off

export type ConferencingRejection = 'invalid' | 'scheme' | 'credentials' | 'port' | 'host';

export type ConferencingCheck =
  { ok: true; url: string; host: string } | { ok: false; reason: ConferencingRejection };

export function isConferencingHost(host: string): boolean {
  const h = host.toLowerCase();
  if ((CONFERENCING_HOSTS as readonly string[]).includes(h)) return true;
  return CONFERENCING_SUBDOMAIN_PARENTS.some((parent) => {
    if (!h.endsWith(`.${parent}`)) return false;
    const label = h.slice(0, -parent.length - 1);
    return /^[a-z0-9-]+$/.test(label);
  });
}

function encodeUnsafe(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    out += cp <= 0x20 || cp >= 0x7f || '"<>`{}|^'.includes(ch) ? encodeURIComponent(ch) : ch;
  }
  return out;
}

/**
 * Validates a meeting link for "Toplantıya Katıl" and returns it normalised so that it satisfies
 * the `calendar_events.conference_url` check (`^https://<allow-listed host>/`).
 */
export function checkConferencingUrl(raw: string): ConferencingCheck {
  const parsed = parseLink(raw);
  if (parsed === null) return { ok: false, reason: 'invalid' };
  if (parsed.scheme !== 'https:') return { ok: false, reason: 'scheme' };
  if (parsed.hasCredentials) return { ok: false, reason: 'credentials' };
  if (parsed.port !== '') return { ok: false, reason: 'port' };
  if (parsed.host === null || !isConferencingHost(parsed.host))
    return { ok: false, reason: 'host' };
  const rest = parsed.rest.startsWith('/') ? parsed.rest : `/${parsed.rest}`;
  return { ok: true, url: `https://${parsed.host}${encodeUnsafe(rest)}`, host: parsed.host };
}

export function isConferencingUrl(raw: string): boolean {
  return checkConferencingUrl(raw).ok;
}
