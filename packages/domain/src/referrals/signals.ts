/**
 * Anti-abuse signal normalisation (plan §16; SECURITY_AND_PRIVACY_PLAN THR-15). Signals are
 * stored and compared only as hashes: the server computes `HMAC(HASH_PEPPER, material)` over the
 * material produced here, so equal inputs always yield equal hashes and raw values are never kept.
 */
import { classifyIp, parseIpv6 } from '../net/ip-ranges.ts';

export const APPLE_PRIVATE_RELAY_DOMAIN = 'privaterelay.appleid.com';
const GMAIL_DOMAINS: ReadonlySet<string> = new Set(['gmail.com', 'googlemail.com']);

/**
 * Canonical mailbox for duplicate detection: lower-case, sub-address (`+tag`) removed, and for
 * Gmail the dots in the local part removed and `googlemail.com` folded into `gmail.com`
 * (UT-REF-02: `a.b+x@gmail.com` ≡ `ab@gmail.com`). Returns null for a malformed address.
 */
export function normalizeEmailForSignal(email: string): string | null {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return null;
  let local = value.slice(0, at);
  let domain = value.slice(at + 1).replace(/\.$/, '');
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  if (local === '' || domain === '' || /\s/.test(local + domain)) return null;
  return `${local}@${domain}`;
}

/** Sign in with Apple "Hide My Email" relay address: e-mail based dedupe cannot see through it. */
export function isApplePrivateRelayEmail(email: string): boolean {
  const value = email.trim().toLowerCase();
  return value.endsWith(`@${APPLE_PRIVATE_RELAY_DOMAIN}`);
}

export type ReferralSignalKind = 'email' | 'provider_email' | 'installation' | 'apple_sub';

/**
 * The versioned HMAC input for a signal (`v1:{kind}:{normalised value}`), or null when the value
 * cannot be normalised. `privacy_tombstones` stores the same hashes for `email`, `installation`
 * and `apple_sub`.
 */
export function referralSignalMaterial(kind: ReferralSignalKind, value: string): string | null {
  let normalized: string | null;
  if (kind === 'email' || kind === 'provider_email') normalized = normalizeEmailForSignal(value);
  else if (kind === 'installation') normalized = value.trim().toLowerCase() || null;
  else normalized = value.trim() || null;
  return normalized === null ? null : `v1:${kind}:${normalized}`;
}

/**
 * HMAC input for the "same network on the same day" signal: the IPv4 /24 (or IPv6 /48) of the
 * client address plus the UTC day. Returns null for a non-IP value.
 */
export function networkDaySignalMaterial(ip: string, utcDay: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDay)) return null;
  const classified = classifyIp(ip);
  if (classified === null) return null;
  if (classified.family === 4) {
    const prefix = classified.address.split('.').slice(0, 3).join('.');
    return `v1:ip24_day:${prefix}.0/24:${utcDay}`;
  }
  const groups = parseIpv6(classified.address) ?? [];
  const prefix = groups
    .slice(0, 3)
    .map((group) => group.toString(16))
    .join(':');
  return `v1:ip48_day:${prefix}::/48:${utcDay}`;
}
