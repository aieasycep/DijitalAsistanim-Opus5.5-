/** Byte encodings used by the crypto helpers (no dependencies). */

export const utf8 = {
  encode: (text: string): Uint8Array => new TextEncoder().encode(text),
  decode: (bytes: Uint8Array): string => new TextDecoder().decode(bytes),
};

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) throw new Error('invalid_hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const fromBase64Url = fromBase64;

/** Postgres `bytea` as PostgREST expects it in JSON (`\x…` hex). */
export function toByteaHex(bytes: Uint8Array): string {
  return `\\x${toHex(bytes)}`;
}

/** Parses a `bytea` returned by PostgREST (`\x…` hex). */
export function fromByteaHex(value: string): Uint8Array {
  return fromHex(value);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

/** A fresh copy backed by its own `ArrayBuffer` (never a view into a shared buffer). */
export function buf(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}
