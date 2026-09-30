/**
 * Admin MFA recovery codes (BACKOFFICE_PLAN §3.4): 10 codes `XXXX-XXXX-XX` of Crockford base32
 * (50 bits each), shown once; only `HMAC_SHA256(RECOVERY_CODE_PEPPER, code)` is stored
 * (`admin_mfa_recovery_codes.code_hash`). Redemption normalises the typed code the same way.
 */
import { toByteaHex } from '../../_shared/crypto/encoding.ts';
import { hmacSha256 } from '../../_shared/crypto/hmac.ts';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const RECOVERY_CODE_COUNT = 10;

/** One code: 10 characters (5 bits each from uniform random bytes), grouped `XXXX-XXXX-XX`. */
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const chars = Array.from(bytes, (b) => CROCKFORD[b & 31] ?? '0').join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

export function generateRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < n) codes.add(generateRecoveryCode());
  return [...codes];
}

/**
 * The hashed form of a code: upper case, separators removed, and the Crockford aliases folded
 * (`O` → `0`, `I`/`L` → `1`), so a typed code matches however it was grouped.
 */
export function recoveryCodeHash(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

/** `\x…` bytea of `HMAC_SHA256(pepper, normalised code)`. */
export async function recoveryCodeDigest(pepper: string, code: string): Promise<string> {
  return toByteaHex(await hmacSha256(pepper, recoveryCodeHash(code)));
}
