/**
 * Hashed referral anti-abuse signals (plan §16; SECURITY_AND_PRIVACY_PLAN THR-15;
 * packages/domain referrals/signals.ts). Every identity signal is `HMAC(HASH_PEPPER, material)` in
 * hex; raw e-mails, Apple subjects, installation ids and IPs are never stored or logged.
 *
 * - e-mail / provider mailbox / Apple subject / installation: `referralSignalMaterial(kind, value)`
 *   (the same material `privacy_tombstones` stores);
 * - device: `app_installations.device_hash` (written by API-DEV-01 as `HMAC(installation:{id})`
 *   or `HMAC(device:{fingerprint})`), compared as stored;
 * - network: `networkDaySignalMaterial(ip, utc_day)` (IPv4 /24 or IPv6 /48 plus the day).
 */
import {
  networkDaySignalMaterial,
  type ReferralSignalKind,
  referralSignalMaterial,
} from '@da/domain';
import { hashIdHex, type Pepper } from '../../crypto/hash.ts';

export async function signalHash(
  pepper: Pepper,
  kind: ReferralSignalKind,
  value: string | null | undefined,
): Promise<string | null> {
  if (value === null || value === undefined || value.trim() === '') return null;
  const material = referralSignalMaterial(kind, value);
  return material === null ? null : await hashIdHex(pepper, material);
}

/** Hashes a list, dropping values that cannot be normalised; duplicates collapse. */
export async function signalHashes(
  pepper: Pepper,
  kind: ReferralSignalKind,
  values: readonly (string | null | undefined)[],
): Promise<string[]> {
  const out = new Set<string>();
  for (const value of values) {
    const hash = await signalHash(pepper, kind, value);
    if (hash !== null) out.add(hash);
  }
  return [...out];
}

/** The device hash API-DEV-01 stores for an installation registered without a fingerprint. */
export function installationDeviceHash(pepper: Pepper, installationId: string): Promise<string> {
  return hashIdHex(pepper, `installation:${installationId}`);
}

/** Same-network-same-day signal of a client IP (null for a non-IP value). */
export async function networkDayHash(
  pepper: Pepper,
  ip: string | null,
  now: Date,
): Promise<string | null> {
  if (ip === null) return null;
  const material = networkDaySignalMaterial(ip, now.toISOString().slice(0, 10));
  return material === null ? null : await hashIdHex(pepper, material);
}
