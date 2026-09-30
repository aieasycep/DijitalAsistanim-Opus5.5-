/**
 * Sealed email parameters (JOB-31 `transactional_email`): a value that must reach the email body
 * but never sit in `jobs.payload` in clear text (an admin invite token) is encrypted with the
 * token keyring (AES-256-GCM, the active `TOKEN_ENC_KEY_V{n}`), bound to a purpose label as AAD.
 * Format: `s1.<key version>.<iv base64url>.<ciphertext+tag base64url>`.
 */
import { buf, fromBase64Url, toBase64Url, utf8 } from '../crypto/encoding.ts';
import type { TokenKeyring } from '../crypto/token-cipher.ts';

const IV_BYTES = 12;

export class SealError extends Error {
  constructor(readonly reason: 'format' | 'unknown_key_version' | 'open_failed') {
    super(`email_seal_${reason}`);
    this.name = 'SealError';
  }
}

export async function sealEmailParam(
  keyring: TokenKeyring,
  plaintext: string,
  aad: string,
): Promise<string> {
  const key = keyring.key(keyring.activeVersion);
  if (key === undefined) throw new SealError('unknown_key_version');
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: buf(iv), additionalData: buf(utf8.encode(aad)), tagLength: 128 },
      key,
      buf(utf8.encode(plaintext)),
    ),
  );
  return `s1.${keyring.activeVersion}.${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
}

export async function openEmailParam(
  keyring: TokenKeyring,
  sealed: string,
  aad: string,
): Promise<string> {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== 's1' || !/^\d+$/.test(parts[1] ?? '')) {
    throw new SealError('format');
  }
  const key = keyring.key(Number(parts[1]));
  if (key === undefined) throw new SealError('unknown_key_version');
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: buf(fromBase64Url(parts[2] ?? '')),
        additionalData: buf(utf8.encode(aad)),
        tagLength: 128,
      },
      key,
      buf(fromBase64Url(parts[3] ?? '')),
    );
    return utf8.decode(new Uint8Array(plain));
  } catch {
    throw new SealError('open_failed');
  }
}
