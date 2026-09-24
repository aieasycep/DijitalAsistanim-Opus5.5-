/**
 * Life-intelligence allow-lists (AI_PIPELINE_PLAN §13.7, SECURITY_AND_PRIVACY_PLAN §9 item 7):
 * - security senders: the only domains whose account-security mails become `security` life events,
 *   and only with DKIM or SPF alignment on the From domain (anti-phishing, SREQ-25);
 * - security call-to-action URLs: known provider pages, never a link taken from the mail;
 * - tracking-link domains: a tracking URL is kept only when it appears verbatim in the source, uses
 *   https and its host is one of the carrier / merchant domains below.
 */
import { CARRIERS } from '@da/domain';

export type SecurityProvider = 'google' | 'microsoft' | 'apple' | 'meta';

export interface SecuritySender {
  readonly provider: SecurityProvider;
  readonly name: string;
  readonly domains: readonly string[];
  /** Known "Şifreyi Değiştir" destination (never a link from the mail). */
  readonly securityUrl: string;
}

export const SECURITY_SENDERS: readonly SecuritySender[] = [
  {
    provider: 'google',
    name: 'Google',
    domains: ['accounts.google.com', 'google.com'],
    securityUrl: 'https://myaccount.google.com/security',
  },
  {
    provider: 'microsoft',
    name: 'Microsoft',
    domains: ['accountprotection.microsoft.com', 'microsoft.com'],
    securityUrl: 'https://account.microsoft.com/security',
  },
  {
    provider: 'apple',
    name: 'Apple',
    domains: ['id.apple.com', 'email.apple.com', 'apple.com'],
    securityUrl: 'https://account.apple.com',
  },
  {
    provider: 'meta',
    name: 'Meta',
    domains: ['facebookmail.com', 'mail.instagram.com'],
    securityUrl: 'https://accountscenter.facebook.com/password_and_security',
  },
];

export function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1
    ? ''
    : email
        .slice(at + 1)
        .toLowerCase()
        .trim();
}

export function domainMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  return h === domain || h.endsWith(`.${domain}`);
}

export function securitySenderFor(fromEmail: string): SecuritySender | null {
  const d = domainOf(fromEmail);
  return SECURITY_SENDERS.find((s) => s.domains.some((x) => domainMatches(d, x))) ?? null;
}

/** Merchant domains whose order / shipment links may be kept. */
export const MERCHANT_DOMAINS: readonly string[] = [
  'trendyol.com',
  'hepsiburada.com',
  'amazon.com.tr',
  'n11.com',
  'ciceksepeti.com',
];

export const TRACKING_DOMAINS: readonly string[] = [
  ...CARRIERS.flatMap((c) => c.domains),
  ...MERCHANT_DOMAINS,
];

/**
 * A tracking URL survives only when it is https, occurs verbatim in the source text and its host
 * is allow-listed (carrier or merchant).
 */
export function allowedTrackingUrl(url: string | null | undefined, source: string): string | null {
  if (url === null || url === undefined) return null;
  const clean = url.trim().replace(/[.,;:!?)\]]+$/, '');
  if (!clean.startsWith('https://') || !source.includes(clean)) return null;
  let host: string;
  try {
    host = new URL(clean).hostname;
  } catch {
    return null;
  }
  return TRACKING_DOMAINS.some((d) => domainMatches(host, d)) ? clean : null;
}

/** First allow-listed tracking link in a text. */
export function findTrackingUrl(source: string): string | null {
  for (const m of source.matchAll(/https:\/\/[^\s"'<>]+/g)) {
    const kept = allowedTrackingUrl(m[0], source);
    if (kept !== null) return kept;
  }
  return null;
}
