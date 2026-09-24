/**
 * Provider-level idempotency markers of an approval (INTEGRATION_PLAN §2.3, API_CONTRACTS §6.4):
 *
 * - `rfc822MessageId`: `<approval-{id}@{MAIL_MESSAGE_ID_DOMAIN}>` (Gmail `rfc822msgid:` probe);
 * - `googleEventId`: `da` + base32hex(uuid bytes), lower case, no padding (28 chars, a–v0–9); a
 *   duplicate insert answers 409;
 * - `graphTransactionId`: the approval id (Graph de-duplicates client retries);
 * - `textMarker`: `[DA:{sha256(idempotency_key)[0..12]}]` in task notes and device event notes;
 * - `deepLinkUrl`: `{PUBLIC_WEB_URL}/app/approvals/{id}` (EventKit url, To Do linkedResources).
 * The key is per payload version, so a user retry (`failed → executing`, same key) reuses every
 * marker and the pre-retry probe finds the earlier write.
 */
import { type IdempotencyMarker, sha256Hex } from '@da/domain';

export const DEFAULT_MAIL_MESSAGE_ID_DOMAIN = 'mail.dijitalasistan.app';
export const DEFAULT_PUBLIC_WEB_URL = 'https://dijitalasistan.app';

const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';

export function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new RangeError('invalid_uuid');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** RFC 4648 base32 with the extended hex alphabet, lower case, no padding. */
export function base32hex(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32HEX[(value << (5 - bits)) & 31];
  return out;
}

export interface MarkerConfig {
  readonly mailDomain?: string | undefined;
  readonly webUrl?: string | undefined;
}

export function deriveMarker(
  approvalId: string,
  idempotencyKey: string,
  cfg: MarkerConfig = {},
): IdempotencyMarker {
  const domain = cfg.mailDomain?.trim() || DEFAULT_MAIL_MESSAGE_ID_DOMAIN;
  const web = (cfg.webUrl?.trim() || DEFAULT_PUBLIC_WEB_URL).replace(/\/+$/, '');
  return {
    approvalId,
    idempotencyKey,
    rfc822MessageId: `<approval-${approvalId}@${domain}>`,
    googleEventId: `da${base32hex(uuidBytes(approvalId))}`,
    graphTransactionId: approvalId,
    textMarker: `[DA:${sha256Hex(idempotencyKey).slice(0, 12)}]`,
    deepLinkUrl: `${web}/app/approvals/${approvalId}`,
  };
}
