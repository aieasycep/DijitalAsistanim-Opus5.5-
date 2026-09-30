/**
 * AES-256-GCM token cipher for `oauth_credentials` (ADR-05, SECURITY_AND_PRIVACY_PLAN CTL-3.3,
 * IMPLEMENTATION_PLAN T-3.04).
 *
 * - Keys: every `TOKEN_ENC_KEY_V{n}` (32 bytes, base64) is imported non-extractable; `encrypt()`
 *   uses `TOKEN_ENC_ACTIVE_VERSION`, `decrypt()` accepts any loaded version (rotation).
 * - IV: 12 random bytes per encryption, never reused. The 16-byte tag is appended to the
 *   ciphertext (WebCrypto layout).
 * - AAD: `v1|{account}|{provider}|{kind}` where `account` is the connected account id (or the
 *   user id for the Apple SIWA token). Its SHA-256 is stored in `aad_hash` so a row cannot be
 *   re-bound to another account, provider or token kind.
 */
import { buf, fromBase64, utf8 } from './encoding.ts';
import { sha256, timingSafeEqual } from './hmac.ts';

export type TokenKind = 'refresh' | 'access' | 'apple_siwa_refresh';

export interface TokenBinding {
  /** `connected_account_id`, or the user id for `apple_siwa_refresh`. */
  readonly account: string;
  readonly provider: string;
  readonly kind: TokenKind;
}

export interface EncryptedToken {
  readonly keyVersion: number;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly aadHash: Uint8Array;
}

export interface TokenKeyring {
  readonly activeVersion: number;
  readonly versions: readonly number[];
  key(version: number): CryptoKey | undefined;
}

export class TokenCipherError extends Error {
  constructor(
    readonly reason:
      | 'unknown_key_version'
      | 'aad_mismatch'
      | 'decrypt_failed'
      | 'invalid_key'
      | 'active_key_missing',
  ) {
    super(`token_cipher_${reason}`);
    this.name = 'TokenCipherError';
  }
}

const IV_BYTES = 12;

export function tokenAad(binding: TokenBinding): string {
  for (const part of [binding.account, binding.provider, binding.kind]) {
    if (part === '' || part.includes('|')) throw new TokenCipherError('aad_mismatch');
  }
  return `v1|${binding.account}|${binding.provider}|${binding.kind}`;
}

function importKey(base64: string): Promise<CryptoKey> {
  const raw = fromBase64(base64);
  if (raw.byteLength !== 32) return Promise.reject(new TokenCipherError('invalid_key'));
  return crypto.subtle.importKey('raw', buf(raw), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Builds the keyring from the parsed env (`token_encryption_keys` by version and
 * `TOKEN_ENC_ACTIVE_VERSION`).
 */
export async function loadKeyring(input: {
  readonly token_encryption_keys: Readonly<Record<number, string>>;
  readonly TOKEN_ENC_ACTIVE_VERSION: number;
}): Promise<TokenKeyring> {
  const keys = new Map<number, CryptoKey>();
  for (const [version, value] of Object.entries(input.token_encryption_keys)) {
    keys.set(Number(version), await importKey(value));
  }
  if (!keys.has(input.TOKEN_ENC_ACTIVE_VERSION)) throw new TokenCipherError('active_key_missing');
  return {
    activeVersion: input.TOKEN_ENC_ACTIVE_VERSION,
    versions: [...keys.keys()].sort((a, b) => a - b),
    key: (version) => keys.get(version),
  };
}

export async function encryptToken(
  keyring: TokenKeyring,
  plaintext: string,
  binding: TokenBinding,
): Promise<EncryptedToken> {
  const key = keyring.key(keyring.activeVersion);
  if (key === undefined) throw new TokenCipherError('active_key_missing');
  const aad = utf8.encode(tokenAad(binding));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: buf(iv), additionalData: buf(aad), tagLength: 128 },
      key,
      buf(utf8.encode(plaintext)),
    ),
  );
  return { keyVersion: keyring.activeVersion, iv, ciphertext, aadHash: await sha256(aad) };
}

export async function decryptToken(
  keyring: TokenKeyring,
  record: EncryptedToken,
  binding: TokenBinding,
): Promise<string> {
  const key = keyring.key(record.keyVersion);
  if (key === undefined) throw new TokenCipherError('unknown_key_version');
  const aad = utf8.encode(tokenAad(binding));
  if (!timingSafeEqual(await sha256(aad), record.aadHash))
    throw new TokenCipherError('aad_mismatch');
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf(record.iv), additionalData: buf(aad), tagLength: 128 },
      key,
      buf(record.ciphertext),
    );
    return utf8.decode(new Uint8Array(plain));
  } catch {
    throw new TokenCipherError('decrypt_failed');
  }
}

/** Re-encrypts to the active key version; `null` when the record already uses it. */
export async function reencryptToActive(
  keyring: TokenKeyring,
  record: EncryptedToken,
  binding: TokenBinding,
): Promise<EncryptedToken | null> {
  if (record.keyVersion === keyring.activeVersion) return null;
  const plain = await decryptToken(keyring, record, binding);
  return encryptToken(keyring, plain, binding);
}
