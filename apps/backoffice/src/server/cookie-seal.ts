/**
 * Sealed auth cookies (BACKOFFICE_PLAN §3.8, SECURITY_AND_PRIVACY_PLAN §4 "Cookie").
 *
 * `@supabase/ssr` reads and writes a small cookie jar (the session storage key and its chunks). The
 * backoffice never lets those values reach the browser in the clear: the whole jar is serialised,
 * sealed with AES-256-GCM and written as `__Host-da_admin` (or `__Host-da_admin.0..n` when it needs
 * several cookies). A cookie that fails to unseal, or was sealed for another name, counts as no
 * session.
 *
 * Key: the backoffice's only server secret is `ADMIN_BFF_SECRET` (`.env.example` defines no separate
 * session-sealing variable, IMPLEMENTATION_PLAN step 1 env decision). The sealing key is derived from
 * it with HKDF-SHA256 and a dedicated `info` label, so the two uses never share key material.
 */

export const AUTH_COOKIE = '__Host-da_admin';
/** Login-step cookie: the sealed email between the code request and its verification (§3.2). */
export const LOGIN_COOKIE = '__Host-da_admin_login';
/** Absolute session cap of the auth cookie, seconds (12 h). */
export const AUTH_COOKIE_MAX_AGE = 43_200;
/** Base64url characters per cookie; below the 4096-byte browser limit including the name. */
const CHUNK_SIZE = 3_800;
const MAX_CHUNKS = 8;
const VERSION = 'v1';

export interface CookieWrite {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: true;
    sameSite: 'strict';
    path: '/';
    maxAge: number;
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const keyCache = new Map<string, Promise<CryptoKey>>();

/** AES-256-GCM key derived from the BFF secret (HKDF-SHA256, info `da-admin-cookie-seal/v1`). */
export function sealingKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (key === undefined) {
    key = (async () => {
      const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
        'deriveKey',
      ]);
      return crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: encoder.encode('da-admin-cookie'),
          info: encoder.encode('da-admin-cookie-seal/v1'),
        },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    keyCache.set(secret, key);
  }
  return key;
}

/** Seals a UTF-8 string, bound to `purpose` (additional authenticated data). */
export async function seal(key: CryptoKey, plaintext: string, purpose: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(purpose) },
      key,
      encoder.encode(plaintext),
    ),
  );
  const joined = new Uint8Array(iv.length + cipher.length);
  joined.set(iv, 0);
  joined.set(cipher, iv.length);
  return `${VERSION}.${toBase64Url(joined)}`;
}

/** Opens a sealed string; `null` for anything tampered, foreign, truncated or malformed. */
export async function unseal(
  key: CryptoKey,
  sealed: string,
  purpose: string,
): Promise<string | null> {
  const [version, body] = sealed.split('.', 2);
  if (version !== VERSION || body === undefined) return null;
  const bytes = fromBase64Url(body);
  if (bytes === null || bytes.length < 12 + 16) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(purpose) },
      key,
      bytes.slice(12),
    );
    return decoder.decode(plain);
  } catch {
    return null;
  }
}

export type CookieJar = Record<string, string>;

/** The real cookie names that hold a sealed value for `base` (`base`, `base.0`, `base.1`, …). */
export function chunkNames(base: string, count: number): string[] {
  if (count <= 1) return [base];
  return Array.from({ length: count }, (_, i) => `${base}.${String(i)}`);
}

/** Reassembles a sealed value from request cookies; `null` when absent or incomplete. */
export function readChunks(
  cookies: readonly { name: string; value: string }[],
  base: string,
): string | null {
  const byName = new Map(cookies.map((c) => [c.name, c.value]));
  const single = byName.get(base);
  if (single !== undefined && single !== '') return single;
  const parts: string[] = [];
  for (let i = 0; i < MAX_CHUNKS; i += 1) {
    const part = byName.get(`${base}.${String(i)}`);
    if (part === undefined || part === '') break;
    parts.push(part);
  }
  return parts.length === 0 ? null : parts.join('');
}

/** Every cookie name under `base` present in the request (for cleanup). */
export function presentChunkNames(
  cookies: readonly { name: string; value: string }[],
  base: string,
): string[] {
  return cookies
    .map((c) => c.name)
    .filter((name) => name === base || new RegExp(`^${escapeRegExp(base)}\\.\\d+$`).test(name));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cookieOptions(maxAge: number): CookieWrite['options'] {
  return { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge };
}

/**
 * The writes that store `sealed` under `base` and delete every stale chunk. An empty `sealed`
 * deletes all of them.
 */
export function chunkWrites(
  base: string,
  sealed: string,
  existing: readonly string[],
  maxAge = AUTH_COOKIE_MAX_AGE,
): CookieWrite[] {
  const writes: CookieWrite[] = [];
  const keep = new Set<string>();
  if (sealed !== '') {
    const count = Math.ceil(sealed.length / CHUNK_SIZE);
    if (count > MAX_CHUNKS) throw new Error('sealed cookie too large');
    const names = chunkNames(base, count);
    names.forEach((name, i) => {
      keep.add(name);
      writes.push({
        name,
        value: sealed.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        options: cookieOptions(maxAge),
      });
    });
  }
  for (const name of existing) {
    if (!keep.has(name)) writes.push({ name, value: '', options: cookieOptions(0) });
  }
  return writes;
}

/** Opens the sealed jar stored under `base`; an empty jar when absent or invalid. */
export async function openJar(
  key: CryptoKey,
  cookies: readonly { name: string; value: string }[],
  base: string = AUTH_COOKIE,
): Promise<CookieJar> {
  const sealed = readChunks(cookies, base);
  if (sealed === null) return {};
  const plain = await unseal(key, sealed, base);
  if (plain === null) return {};
  try {
    const parsed: unknown = JSON.parse(plain);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const jar: CookieJar = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') jar[name] = value;
    }
    return jar;
  } catch {
    return {};
  }
}

/** Seals a jar for storage under `base`; `''` for an empty jar. */
export async function sealJar(
  key: CryptoKey,
  jar: CookieJar,
  base: string = AUTH_COOKIE,
): Promise<string> {
  if (Object.keys(jar).length === 0) return '';
  return seal(key, JSON.stringify(jar), base);
}

/**
 * Applies `@supabase/ssr` `setAll` writes to the jar: an empty value or `maxAge: 0` deletes the
 * entry. Returns a new jar.
 */
export function applyJarWrites(
  jar: CookieJar,
  writes: readonly { name: string; value: string; options?: { maxAge?: number } }[],
): CookieJar {
  const next = new Map(Object.entries(jar));
  for (const write of writes) {
    if (write.value === '' || write.options?.maxAge === 0) next.delete(write.name);
    else next.set(write.name, write.value);
  }
  return Object.fromEntries(next);
}
