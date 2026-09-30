/** Success envelope helpers (API_CONTRACTS §2.4, §2.14). */
import type { Meta } from '@da/validation';
import type { AppContext } from './context.ts';

export type MetaExtras = Omit<Partial<Meta>, 'correlation_id' | 'request_id' | 'server_time'>;

export function buildMeta(c: AppContext, extras: MetaExtras = {}, now: Date = new Date()): Meta {
  return {
    correlation_id: c.get('correlationId'),
    request_id: c.get('requestId'),
    server_time: now.toISOString(),
    ...extras,
  };
}

/** `{data, meta}` with the route's success status. */
export function sendData(
  c: AppContext,
  data: unknown,
  status: 200 | 201 | 202 = 200,
  extras: MetaExtras = {},
): Response {
  return c.json({ data, meta: buildMeta(c, extras) }, status);
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Weak ETag over a stable representation (§2.14). */
export async function weakEtag(stable: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(stable)),
  );
  return `W/"${toHex(digest).slice(0, 32)}"`;
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header
    .split(',')
    .map((v) => v.trim())
    .some((v) => v === etag || v === '*' || v.replace(/^W\//, '') === etag.replace(/^W\//, ''));
}

/**
 * GET responses with `Cache-Control: private, no-cache` and a weak ETag computed over `stable`
 * (the payload without volatile fields such as `server_now`). A matching `If-None-Match` → 304.
 */
export async function sendCacheable(
  c: AppContext,
  data: unknown,
  stable: unknown,
  extras: MetaExtras = {},
): Promise<Response> {
  const etag = await weakEtag(stable);
  c.header('ETag', etag);
  c.header('Cache-Control', 'private, no-cache');
  if (etagMatches(c.req.header('If-None-Match'), etag)) {
    return c.body(null, 304);
  }
  return sendData(c, data, 200, extras);
}
