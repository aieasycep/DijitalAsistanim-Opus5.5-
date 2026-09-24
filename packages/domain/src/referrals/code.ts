/**
 * Referral codes (M§45; plan §16; `referral_codes.code`).
 *
 * A code is 7 characters from the unambiguous alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0, O,
 * 1, I or L; 31 symbols): 6 random payload characters followed by 1 check character.
 *
 * Check character: with v(c) the index of c in the alphabet,
 *   check = ALPHABET[(Σ_{i=0..5} (i + 1) · v(payload[i])) mod 31]
 * 31 is prime and the weights 1..6 are distinct and non-zero, so every single-character typo and
 * every swap of two adjacent payload characters changes the check character. Codes are unique
 * per user (`referral_codes (code)` unique; generation retries on collision).
 */

export const REFERRAL_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const REFERRAL_CODE_PAYLOAD_LENGTH = 6;
export const REFERRAL_CODE_LENGTH = REFERRAL_CODE_PAYLOAD_LENGTH + 1;

const RADIX = REFERRAL_CODE_ALPHABET.length;

/** Returns a uniformly distributed integer in `[0, exclusiveMax)`. */
export type RandomIndex = (exclusiveMax: number) => number;

function valueOf(ch: string): number {
  return REFERRAL_CODE_ALPHABET.indexOf(ch);
}

/** The check character for a 6-character payload. */
export function referralCheckChar(payload: string): string {
  if (payload.length !== REFERRAL_CODE_PAYLOAD_LENGTH) {
    throw new RangeError(`payload must be ${REFERRAL_CODE_PAYLOAD_LENGTH} characters`);
  }
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const v = valueOf(payload.charAt(i));
    if (v < 0) throw new RangeError('payload contains a character outside the alphabet');
    sum += (i + 1) * v;
  }
  return REFERRAL_CODE_ALPHABET.charAt(sum % RADIX);
}

/** Generates one code from an injected uniform random source (e.g. crypto-backed). */
export function generateReferralCode(randomIndex: RandomIndex): string {
  let payload = '';
  for (let i = 0; i < REFERRAL_CODE_PAYLOAD_LENGTH; i++) {
    const index = randomIndex(RADIX);
    if (!Number.isInteger(index) || index < 0 || index >= RADIX) {
      throw new RangeError('randomIndex must return an integer in [0, exclusiveMax)');
    }
    payload += REFERRAL_CODE_ALPHABET.charAt(index);
  }
  return payload + referralCheckChar(payload);
}

/**
 * Generates a code that `isTaken` does not report as used, retrying on collision. Returns null
 * after `maxAttempts` collisions so the caller can surface a retryable error.
 */
export function generateUniqueReferralCode(
  randomIndex: RandomIndex,
  isTaken: (code: string) => boolean,
  maxAttempts = 8,
): string | null {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateReferralCode(randomIndex);
    if (!isTaken(code)) return code;
  }
  return null;
}

/**
 * Builds a `RandomIndex` from a byte source (e.g. `crypto.getRandomValues`) with rejection
 * sampling, so every index is equally likely.
 */
export function randomIndexFromBytes(nextByte: () => number): RandomIndex {
  return (exclusiveMax: number) => {
    if (!Number.isInteger(exclusiveMax) || exclusiveMax < 1 || exclusiveMax > 256) {
      throw new RangeError('exclusiveMax must be an integer in [1, 256]');
    }
    const limit = 256 - (256 % exclusiveMax);
    for (;;) {
      const byte = nextByte();
      if (byte < limit) return byte % exclusiveMax;
    }
  };
}

/**
 * Normalises user input: accepts the bare code or a `/r/{code}` link, ignores case, spaces and
 * hyphens. The result may still be invalid; validate it with `validateReferralCode`.
 */
export function normalizeReferralCode(input: string): string {
  const trimmed = input.trim();
  const fromLink = /\/r\/([^/?#\s]+)/i.exec(trimmed)?.[1] ?? trimmed;
  return fromLink.replace(/[\s-]/g, '').toUpperCase();
}

export type ReferralCodeCheck =
  { valid: true; code: string } | { valid: false; reason: 'length' | 'alphabet' | 'checksum' };

export function validateReferralCode(input: string): ReferralCodeCheck {
  const code = normalizeReferralCode(input);
  if (code.length !== REFERRAL_CODE_LENGTH) return { valid: false, reason: 'length' };
  for (const ch of code) {
    if (valueOf(ch) < 0) return { valid: false, reason: 'alphabet' };
  }
  const payload = code.slice(0, REFERRAL_CODE_PAYLOAD_LENGTH);
  if (referralCheckChar(payload) !== code.charAt(REFERRAL_CODE_PAYLOAD_LENGTH)) {
    return { valid: false, reason: 'checksum' };
  }
  return { valid: true, code };
}

export function isValidReferralCode(input: string): boolean {
  return validateReferralCode(input).valid;
}

/** The share link `${PUBLIC_WEB_URL}/r/{code}` (API-BIZ-02 `share_url`). */
export function referralShareUrl(publicWebUrl: string, code: string): string {
  return `${publicWebUrl.replace(/\/+$/, '')}/r/${code}`;
}
