/**
 * Secrets of an OAuth flow (API_CONTRACTS API-INT-01, OAUTH-01; INTEGRATION_PLAN §3.2.1; R-07).
 *
 * - `state` and the id_token `nonce` are derived from the state row id with an HMAC of `HASH_PEPPER`
 *   (32 bytes, unpadded base64url): only their SHA-256 is stored, and an idempotent replay of
 *   API-INT-01/02 re-renders the same authorization URL from the stored row.
 * - The PKCE verifier and the held token set of a reconnect / upgrade are AES-256-GCM encrypted with
 *   the token keyring and the AAD `v1|oauth_state|{state_id}|{field}`, so a ciphertext cannot be moved
 *   to another state row or field.
 */
import { buf, toBase64Url, utf8 } from '../../crypto/encoding.ts';
import { hmacSha256, sha256 } from '../../crypto/hmac.ts';
import { TokenCipherError, type TokenKeyring } from '../../crypto/token-cipher.ts';

export type StateSecretField = 'code_verifier' | 'token_set';

export interface SealedStateSecret {
  readonly ciphertext: Uint8Array;
  readonly iv: Uint8Array;
  readonly keyVersion: number;
}

function aad(stateId: string, field: StateSecretField): Uint8Array {
  return utf8.encode(`v1|oauth_state|${stateId}|${field}`);
}

export async function sealStateSecret(
  keyring: TokenKeyring,
  stateId: string,
  field: StateSecretField,
  plaintext: string,
): Promise<SealedStateSecret> {
  const key = keyring.key(keyring.activeVersion);
  if (key === undefined) throw new TokenCipherError('active_key_missing');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: buf(iv), additionalData: buf(aad(stateId, field)), tagLength: 128 },
      key,
      buf(utf8.encode(plaintext)),
    ),
  );
  return { ciphertext, iv, keyVersion: keyring.activeVersion };
}

export async function openStateSecret(
  keyring: TokenKeyring,
  stateId: string,
  field: StateSecretField,
  sealed: SealedStateSecret,
): Promise<string> {
  const key = keyring.key(sealed.keyVersion);
  if (key === undefined) throw new TokenCipherError('unknown_key_version');
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: buf(sealed.iv),
        additionalData: buf(aad(stateId, field)),
        tagLength: 128,
      },
      key,
      buf(sealed.ciphertext),
    );
    return utf8.decode(new Uint8Array(plain));
  } catch {
    throw new TokenCipherError('decrypt_failed');
  }
}

/** The `state` query value of a flow (43 chars). */
export async function stateValueFor(pepper: string, stateId: string): Promise<string> {
  return toBase64Url(await hmacSha256(pepper, `oauth-state:v1:${stateId}`));
}

/** The OpenID Connect `nonce` of a flow (43 chars). */
export async function nonceValueFor(pepper: string, stateId: string): Promise<string> {
  return toBase64Url(await hmacSha256(pepper, `oauth-nonce:v1:${stateId}`));
}

export async function sha256Of(value: string): Promise<Uint8Array> {
  return await sha256(value);
}
