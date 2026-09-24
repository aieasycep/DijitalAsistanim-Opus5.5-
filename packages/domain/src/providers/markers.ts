/**
 * Provider-level idempotency markers (INTEGRATION_PLAN §2.3, §3.12; API_CONTRACTS §6.4). A pure
 * derivation from the approval id and its idempotency key, identical on the server (approval
 * executor, adapters' marker probes) and on the device (EventKit / CalendarContract writes):
 * - Gmail: `Message-ID: <approval-{approvalId}@{MAIL_MESSAGE_ID_DOMAIN}>`;
 * - Google Calendar: deterministic event id `da` + base32hex(uuid bytes) (lower case, a–v0–9);
 * - Graph: `transactionId = approvalId` (plus the `da_approval_id` extended property);
 * - Google Tasks / device notes: the visible text marker `[DA:{sha256(idempotencyKey)[0..12)}]`;
 * - deep link `${PUBLIC_WEB_URL}/app/approvals/{approvalId}` (To Do linkedResources, EventKit url).
 */
import { isUuid, sha256Hex } from '../ids.ts';
import type { IdempotencyMarker } from './types.ts';

const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';

/** RFC 4648 base32hex (lower case, no padding) of the 16 bytes of a UUID. */
export function uuidBase32Hex(uuid: string): string {
  if (!isUuid(uuid)) throw new RangeError('approvalId must be a UUID');
  const hex = uuid.replace(/-/g, '').toLowerCase();
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < hex.length; i += 2) {
    value = (value << 8) | Number.parseInt(hex.slice(i, i + 2), 16);
    bits += 8;
    while (bits >= 5) {
      out += BASE32HEX.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32HEX.charAt((value << (5 - bits)) & 31);
  return out;
}

/** Deterministic Google Calendar event id of an approval (28 chars, charset a–v0–9). */
export function googleEventIdFor(approvalId: string): string {
  return `da${uuidBase32Hex(approvalId)}`;
}

/** `[DA:xxxxxxxxxxxx]`: the visible marker appended to task notes (no client id exists there). */
export function textMarkerFor(idempotencyKey: string): string {
  if (idempotencyKey.length === 0) throw new RangeError('idempotencyKey must be non-empty');
  return `[DA:${sha256Hex(idempotencyKey).slice(0, 12)}]`;
}

/** Finds a text marker inside provider notes (`null` when absent). */
export function findTextMarker(text: string | null | undefined): string | null {
  const match = /\[DA:[0-9a-f]{12}\]/.exec(text ?? '');
  return match === null ? null : match[0];
}

/** `<approval-{approvalId}@{domain}>`: the RFC 5322 Message-ID of an approved reply. */
export function approvalMessageId(approvalId: string, mailDomain: string): string {
  if (!isUuid(approvalId)) throw new RangeError('approvalId must be a UUID');
  if (!/^[a-z0-9.-]+$/i.test(mailDomain)) throw new RangeError('mailDomain must be a hostname');
  return `<approval-${approvalId.toLowerCase()}@${mailDomain.toLowerCase()}>`;
}

export function deriveMarker(
  approvalId: string,
  idempotencyKey: string,
  cfg: { mailDomain: string; webUrl: string },
): IdempotencyMarker {
  const id = approvalId.toLowerCase();
  return {
    approvalId: id,
    idempotencyKey,
    rfc822MessageId: approvalMessageId(id, cfg.mailDomain),
    googleEventId: googleEventIdFor(id),
    graphTransactionId: id,
    textMarker: textMarkerFor(idempotencyKey),
    deepLinkUrl: `${cfg.webUrl.replace(/\/+$/, '')}/app/approvals/${id}`,
  };
}
