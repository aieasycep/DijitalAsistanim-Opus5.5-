/** PKCE (RFC 7636, S256) for the OAuth integration flows (INTEGRATION_PLAN §3.2). */
import { sha256 } from './hmac.ts';
import { toBase64Url } from './encoding.ts';

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

/** 32 random bytes → a 43-character base64url code verifier. */
export function createCodeVerifier(byteLength = 32): string {
  if (byteLength < 32 || byteLength > 96) throw new RangeError('pkce_verifier_length');
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export function isValidCodeVerifier(verifier: string): boolean {
  return VERIFIER_RE.test(verifier);
}

/** `code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))`, method `S256`. */
export async function codeChallengeS256(verifier: string): Promise<string> {
  if (!isValidCodeVerifier(verifier)) throw new RangeError('pkce_verifier_invalid');
  return toBase64Url(await sha256(verifier));
}

export async function createPkcePair(): Promise<{
  verifier: string;
  challenge: string;
  method: 'S256';
}> {
  const verifier = createCodeVerifier();
  return { verifier, challenge: await codeChallengeS256(verifier), method: 'S256' };
}

/** Opaque random token (OAuth `state`, completion codes): base64url of `byteLength` random bytes. */
export function randomToken(byteLength = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}
