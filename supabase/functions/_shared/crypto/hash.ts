/**
 * Peppered hashes for PII lookups and log pseudonyms (API_CONTRACTS §1 `hashId`, §2.9 IP hashing,
 * §2.12 `user_id_hash`). `hashId(value)` = HMAC-SHA256(`HASH_PEPPER`, value); raw identifiers such
 * as IP addresses are never stored, only their peppered hash.
 */
import { hmacSha256, hmacSha256Hex } from './hmac.ts';
import { toByteaHex } from './encoding.ts';

export interface Pepper {
  readonly HASH_PEPPER: string;
}

/** 32-byte peppered hash (stored as `bytea`). */
export function hashId(pepper: Pepper, value: string): Promise<Uint8Array> {
  return hmacSha256(pepper.HASH_PEPPER, value);
}

export function hashIdHex(pepper: Pepper, value: string): Promise<string> {
  return hmacSha256Hex(pepper.HASH_PEPPER, value);
}

/** `bytea` literal for PostgREST (`\x…`). */
export async function hashIdBytea(pepper: Pepper, value: string): Promise<string> {
  return toByteaHex(await hashId(pepper, value));
}

/** Short pseudonym for logs (`user_hash`): the first 16 hex chars of the peppered hash. */
export async function logHash(pepper: Pepper, value: string): Promise<string> {
  return (await hashIdHex(pepper, `log:${value}`)).slice(0, 16);
}

/** Normalises an e-mail before hashing (lower case, trimmed). */
export function normalizeEmailForHash(email: string): string {
  return email.trim().toLowerCase();
}

/** First hop of `X-Forwarded-For` (the client IP as seen by the Supabase gateway). */
export function clientIp(forwardedFor: string | undefined | null): string | null {
  const first = forwardedFor?.split(',')[0]?.trim() ?? '';
  return first === '' ? null : first;
}
