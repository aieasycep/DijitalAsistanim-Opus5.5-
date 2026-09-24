import { z } from 'zod';
import { Email, IsoDateTime } from '../api/common.ts';

/*
 * WH-01 · POST /webhooks-google/gmail (Pub/Sub push, docs/API_CONTRACTS.md §10). Auth is the Pub/Sub
 * OIDC JWT (checked before this schema). `message.data` is base64 JSON `{emailAddress, historyId}`.
 */

/** Maximum encoded `message.data` size (Pub/Sub bodies ≤ 64 KiB). */
export const PUBSUB_DATA_MAX_CHARS = 65536;

export const PubSubPush = z.object({
  message: z.object({
    data: z
      .string()
      .max(PUBSUB_DATA_MAX_CHARS)
      .regex(/^[A-Za-z0-9+/_-]*={0,2}$/),
    messageId: z.string().min(1).max(128),
    publishTime: IsoDateTime.or(z.string()),
    attributes: z.record(z.string(), z.string()).optional(),
  }),
  subscription: z.string().max(512),
});
export type PubSubPush = z.infer<typeof PubSubPush>;

/** The decoded Gmail push payload; `historyId` arrives as a number or string and is kept as a string. */
export const GmailPushData = z.object({
  emailAddress: Email,
  historyId: z.union([z.string().regex(/^\d{1,20}$/), z.int().min(0)]).transform(String),
});
export type GmailPushData = z.infer<typeof GmailPushData>;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes standard or URL-safe base64 to a UTF-8 string without runtime globals (`null` if invalid). */
export function decodeBase64Utf8(input: string): string | null {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(normalized) || normalized.length % 4 === 1) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of normalized) {
    buffer = (buffer << 6) | BASE64_ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b0 = bytes[i] ?? 0;
    let code: number;
    let size: number;
    if (b0 < 0x80) [code, size] = [b0, 1];
    else if (b0 >= 0xc0 && b0 < 0xe0) [code, size] = [b0 & 0x1f, 2];
    else if (b0 >= 0xe0 && b0 < 0xf0) [code, size] = [b0 & 0x0f, 3];
    else if (b0 >= 0xf0 && b0 < 0xf8) [code, size] = [b0 & 0x07, 4];
    else return null;
    for (let k = 1; k < size; k += 1) {
      const next = bytes[i + k];
      if (next === undefined || (next & 0xc0) !== 0x80) return null;
      code = (code << 6) | (next & 0x3f);
    }
    out += String.fromCodePoint(code);
    i += size;
  }
  return out;
}

/** Parses a push body and its base64 `message.data` into `{push, data}` in one step. */
export function parseGmailPush(
  body: unknown,
):
  | { success: true; push: PubSubPush; data: GmailPushData }
  | { success: false; error: 'body' | 'data' } {
  const push = PubSubPush.safeParse(body);
  if (!push.success) return { success: false, error: 'body' };
  const decoded = decodeBase64Utf8(push.data.message.data);
  if (decoded === null) return { success: false, error: 'data' };
  let json: unknown;
  try {
    json = JSON.parse(decoded);
  } catch {
    return { success: false, error: 'data' };
  }
  const data = GmailPushData.safeParse(json);
  if (!data.success) return { success: false, error: 'data' };
  return { success: true, push: push.data, data: data.data };
}

/** Google Calendar channel notification headers (WH-02); the body is empty. */
export const CalendarChannelHeaders = z.object({
  'x-goog-channel-id': z.uuid(),
  'x-goog-channel-token': z.string().min(1).max(256),
  'x-goog-resource-id': z.string().min(1).max(256),
  'x-goog-resource-state': z.enum(['sync', 'exists', 'not_exists']),
  'x-goog-message-number': z.string().regex(/^\d{1,20}$/),
  'x-goog-channel-expiration': z.string().max(64).optional(),
});
