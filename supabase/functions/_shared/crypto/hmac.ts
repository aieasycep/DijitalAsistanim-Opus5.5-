/**
 * HMAC-SHA256 and constant-time comparison (API_CONTRACTS §1 `crypto/hmac.ts`, SECURITY_AND_PRIVACY
 * CTL-3.7). Used for webhook channel tokens, secret-key checks and peppered hashes.
 */
import { buf, toBase64Url, toHex, utf8 } from './encoding.ts';

export type BytesLike = string | Uint8Array;

function bytes(value: BytesLike): Uint8Array {
  return typeof value === 'string' ? utf8.encode(value) : value;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function importHmacKey(key: BytesLike): Promise<CryptoKey> {
  const cacheKey = typeof key === 'string' ? `s:${key}` : `b:${toHex(key)}`;
  let pending = keyCache.get(cacheKey);
  if (pending === undefined) {
    pending = crypto.subtle.importKey(
      'raw',
      buf(bytes(key)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    if (keyCache.size > 64) keyCache.clear();
    keyCache.set(cacheKey, pending);
  }
  return pending;
}

export async function hmacSha256(key: BytesLike, data: BytesLike): Promise<Uint8Array> {
  const cryptoKey = await importHmacKey(key);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, buf(bytes(data))));
}

export async function hmacSha256Hex(key: BytesLike, data: BytesLike): Promise<string> {
  return toHex(await hmacSha256(key, data));
}

export async function hmacSha256Base64Url(key: BytesLike, data: BytesLike): Promise<string> {
  return toBase64Url(await hmacSha256(key, data));
}

export async function sha256(data: BytesLike): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf(bytes(data))));
}

export async function sha256Hex(data: BytesLike): Promise<string> {
  return toHex(await sha256(data));
}

/** Constant-time equality of two byte strings (length differences are not short-circuited). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.byteLength, b.byteLength);
  let diff = a.byteLength ^ b.byteLength;
  for (let i = 0; i < length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * Compares two secrets in constant time by comparing their SHA-256 digests, so neither the length
 * nor the position of the first difference leaks.
 */
export async function secretsEqual(provided: BytesLike, expected: BytesLike): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(provided), sha256(expected)]);
  return timingSafeEqual(a, b);
}

/** Verifies an HMAC-SHA256 signature (hex or base64url) in constant time. */
export async function verifyHmacSha256(
  key: BytesLike,
  data: BytesLike,
  signature: string,
  encoding: 'hex' | 'base64url' = 'hex',
): Promise<boolean> {
  const expected =
    encoding === 'hex' ? await hmacSha256Hex(key, data) : await hmacSha256Base64Url(key, data);
  return secretsEqual(signature, expected);
}
