/**
 * The deletion confirmation address (JOB-23 step 9, JOB-31; API_CONTRACTS "Proposed additions"
 * `data_deletion_requests.notify_email_ciphertext`). The address is captured before the auth user
 * is deleted, sealed with the token keyring (AES-256-GCM, AAD bound to the request id) and opened
 * only by the `transactional_email` resolver, which wipes it after sending. It never appears in a
 * job payload, a log line or an API response.
 *
 * Layout: key version (1 byte) ‖ IV (12 bytes) ‖ ciphertext with the 16-byte tag.
 */
import { buf, concatBytes, utf8 } from '../../crypto/encoding.ts';
import { TokenCipherError, type TokenKeyring } from '../../crypto/token-cipher.ts';

const IV_BYTES = 12;

function aad(requestId: string): Uint8Array {
  return utf8.encode(`v1|${requestId}|deletion_request|notify_email`);
}

export async function sealNotifyEmail(
  keyring: TokenKeyring,
  requestId: string,
  address: string,
): Promise<Uint8Array> {
  const key = keyring.key(keyring.activeVersion);
  if (key === undefined || keyring.activeVersion > 255) {
    throw new TokenCipherError('active_key_missing');
  }
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: buf(iv), additionalData: buf(aad(requestId)), tagLength: 128 },
      key,
      buf(utf8.encode(address.trim())),
    ),
  );
  return concatBytes(new Uint8Array([keyring.activeVersion]), iv, sealed);
}

export async function openNotifyEmail(
  keyring: TokenKeyring,
  requestId: string,
  sealed: Uint8Array,
): Promise<string> {
  const version = sealed[0] ?? 0;
  const key = keyring.key(version);
  if (key === undefined) throw new TokenCipherError('unknown_key_version');
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: buf(sealed.slice(1, 1 + IV_BYTES)),
        additionalData: buf(aad(requestId)),
        tagLength: 128,
      },
      key,
      buf(sealed.slice(1 + IV_BYTES)),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new TokenCipherError('decrypt_failed');
  }
}
