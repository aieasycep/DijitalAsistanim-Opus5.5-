/**
 * Shared adapter plumbing (INTEGRATION_PLAN §2, §3.6, §3.10):
 * - `authorizedFetch`: bearer token from the context's `AccessTokenSource`, quota, retries and error
 *   classification through `providerFetch`; a 401 triggers exactly one forced refresh, a second 401
 *   is `auth_token_rejected` (→ `needs_reauth`);
 * - text reduction for the stored subset: snippets ≤ 200 chars, description / notes excerpts ≤ 500,
 *   whitespace-normalised and HTML-free (raw bodies never leave the adapter call);
 * - a small counting semaphore (Graph: ≤ 4 concurrent requests per mailbox).
 */
import {
  type ProviderContext,
  ProviderError,
  type QuotaBucket,
  type QuotaPriority,
} from '@da/domain';
import { sanitizeHtml } from '../security/html-sanitize.ts';
import type { ProviderErrorBody } from './errors.ts';
import { defaultParseError, providerFetch } from './http.ts';

export interface AdapterHttp {
  readonly fetch: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
}

export interface AuthorizedRequest {
  readonly url: string;
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly headers?: Record<string, string>;
  readonly body?: BodyInit | null;
  readonly idempotent?: boolean;
  readonly quota?: { bucket: QuotaBucket; units: number; priority?: QuotaPriority };
  readonly parseError?: (response: Response) => Promise<ProviderErrorBody>;
}

/** One provider call with the account's access token (401 → one forced refresh, then give up). */
export async function authorizedFetch(
  ctx: ProviderContext,
  http: AdapterHttp,
  request: AuthorizedRequest,
): Promise<Response> {
  const run = async (token: string) =>
    await providerFetch(
      {
        url: request.url,
        method: request.method ?? 'GET',
        headers: { ...(request.headers ?? {}), Authorization: `Bearer ${token}` },
        body: request.body ?? null,
        ...(request.idempotent === undefined ? {} : { idempotent: request.idempotent }),
        ...(request.quota === undefined ? {} : { quota: request.quota }),
      },
      {
        fetch: http.fetch,
        quota: ctx.quota,
        ...(http.sleep === undefined ? {} : { sleep: http.sleep }),
        ...(http.timeoutMs === undefined ? {} : { timeoutMs: http.timeoutMs }),
        ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
        parseError: request.parseError ?? defaultParseError,
      },
    );
  try {
    return await run(await ctx.tokens.get());
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'auth_token_rejected') {
      return await run(await ctx.tokens.get({ forceRefresh: true }));
    }
    throw error;
  }
}

export async function authorizedJson<T>(
  ctx: ProviderContext,
  http: AdapterHttp,
  request: AuthorizedRequest,
): Promise<T> {
  const response = await authorizedFetch(ctx, http, request);
  if (response.status === 204 || response.status === 202) {
    await response.body?.cancel();
    return {} as T;
  }
  return (await response.json()) as T;
}

/** JSON body helper for write requests. */
export function jsonBody(value: unknown): { body: string; headers: Record<string, string> } {
  return { body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' } };
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decodes the HTML entities Gmail snippets carry (`&#39;`, `&amp;`, `&quot;` …). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X'))
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Whitespace-normalised, HTML-free text capped at `max` characters (code points). */
export function excerpt(text: string | null | undefined, max: number): string {
  if (text === null || text === undefined) return '';
  const plain = /<[a-z!/][^>]*>/i.test(text)
    ? sanitizeHtml(text, { maxTextChars: max * 4 }).text
    : text;
  const normalized = decodeEntities(plain)
    .replace(/[​-‏‪-‮⁠-⁤﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...normalized];
  return chars.length <= max ? normalized : chars.slice(0, max).join('').trimEnd();
}

export function excerptOrNull(text: string | null | undefined, max: number): string | null {
  const value = excerpt(text, max);
  return value === '' ? null : value;
}

/** Plain text of an HTML body (transient; used for the pipeline text and the original view). */
export function htmlToText(html: string, maxChars = 200_000): string {
  return sanitizeHtml(html, { maxTextChars: maxChars }).text;
}

/** A counting semaphore; `run` waits for a slot. */
export class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  constructor(private readonly slots: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.slots) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }

  get inFlight(): number {
    return this.active;
  }
}

/** Maps with bounded parallelism (order preserved). */
export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** The address part of `Name <addr@host>` (lower case), or null. */
export function parseAddress(
  value: string | null | undefined,
): { address: string; name: string | null } | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const angle = /^(.*?)<([^>]+)>\s*$/.exec(trimmed);
  const address = (angle?.[2] ?? trimmed).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(address)) return null;
  const rawName =
    angle?.[1]
      ?.trim()
      .replace(/^"(.*)"$/, '$1')
      .trim() ?? '';
  return { address, name: rawName === '' ? null : decodeMimeWords(rawName) };
}

/** Splits an address list header on commas outside quotes. */
export function parseAddressList(
  value: string | null | undefined,
  cap = 50,
): { address: string; name: string | null }[] {
  if (value === null || value === undefined || value.trim() === '') return [];
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let angle = 0;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    if (ch === '<') angle++;
    if (ch === '>') angle = Math.max(0, angle - 1);
    if (ch === ',' && !quoted && angle === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  const out: { address: string; name: string | null }[] = [];
  for (const part of parts) {
    const parsed = parseAddress(part);
    if (parsed !== null) out.push(parsed);
    if (out.length >= cap) break;
  }
  return out;
}

/** RFC 2047 encoded words (`=?UTF-8?B?…?=`, `=?UTF-8?Q?…?=`) in a header value. */
export function decodeMimeWords(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (whole, charset: string, enc: string, text: string) => {
      try {
        const bytes =
          enc.toUpperCase() === 'B'
            ? Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
            : Uint8Array.from(
                text
                  .replace(/_/g, ' ')
                  .replace(/=([0-9A-F]{2})/gi, (_m, hex: string) =>
                    String.fromCharCode(Number.parseInt(hex, 16)),
                  ),
                (c) => c.charCodeAt(0),
              );
        return new TextDecoder(
          charset.toLowerCase() === 'utf8' ? 'utf-8' : charset.toLowerCase(),
        ).decode(bytes);
      } catch {
        return whole;
      }
    },
  );
}

/** `2026-09-23T05:42:00Z` style UTC ISO string of a date-like value (null when invalid). */
export function isoOrNull(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
