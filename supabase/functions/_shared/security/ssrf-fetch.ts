/**
 * SSRF-safe fetcher for user-supplied links (M§84, R-11, SECURITY_AND_PRIVACY_PLAN CTL-3.10,
 * IMPLEMENTATION_PLAN T-3.05).
 *
 * Rules, enforced on every hop:
 * - `https:` only; `http:` is rejected, never upgraded; no credentials in the URL; port 443 only.
 * - Hostname policy and IP-literal checks from `@da/domain` (`checkFetchTarget`), including the
 *   decimal / octal / hex IPv4 forms (`2130706433`) and bracketed IPv6.
 * - DNS: every A and AAAA answer must be public (`checkResolvedAddresses`); one private answer
 *   rejects the host.
 * - Redirects are followed manually, at most 3; each `Location` is validated from scratch.
 * - Streaming read with a 5 MB cap and a 10 s overall `AbortSignal`.
 * - Content types: HTML, XHTML, plain text, PDF and images; binary bodies must match their magic
 *   bytes.
 * - Requests carry no cookies and no `Authorization`; `User-Agent: DijitalAsistanBot/1.0`.
 *
 * Residual risk (documented in SECURITY_AND_PRIVACY_PLAN): `fetch` resolves the hostname again, so a
 * DNS answer that changes between our lookup and the connection (rebinding with a very short TTL)
 * is not covered by this layer. The Edge runtime has no public-IP egress to private networks of the
 * platform; the window is limited to the lookup-to-connect gap of one hop.
 */
import {
  checkFetchTarget,
  checkResolvedAddresses,
  type FetchPolicyOptions,
  type IpBlockReason,
} from '@da/domain';
import { sniffMime } from './upload-validate.ts';

export type SsrfErrorCode =
  | 'insecure_scheme'
  | 'invalid_url'
  | 'blocked_address'
  | 'dns_mixed_private'
  | 'unresolvable'
  | 'too_many_redirects'
  | 'too_large'
  | 'timeout'
  | 'unsupported_type'
  | 'encoded_response'
  | 'upstream_error'
  | 'magic_mismatch';

export class SsrfError extends Error {
  constructor(
    readonly code: SsrfErrorCode,
    readonly detail: Record<string, string | number | null> = {},
  ) {
    super(`ssrf_${code}`);
    this.name = 'SsrfError';
  }

  /** `SSRF_BLOCKED` (422) for policy refusals, `FETCH_FAILED` (424) for everything else. */
  get apiCode(): 'SSRF_BLOCKED' | 'FETCH_FAILED' {
    return this.code === 'insecure_scheme' ||
      this.code === 'invalid_url' ||
      this.code === 'blocked_address' ||
      this.code === 'dns_mixed_private'
      ? 'SSRF_BLOCKED'
      : 'FETCH_FAILED';
  }
}

export type DnsResolver = (hostname: string, type: 'A' | 'AAAA') => Promise<string[]>;

/** `Deno.resolveDns`; a missing record type resolves to `[]`. */
export const denoResolver: DnsResolver = async (hostname, type) => {
  try {
    return await Deno.resolveDns(hostname, type);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
};

export const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

const BINARY_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export const USER_AGENT = 'DijitalAsistanBot/1.0';

export interface SafeFetchOptions extends FetchPolicyOptions {
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
  /** Narrower allow-list for one call (e.g. images only for OG thumbnails). */
  readonly accept?: readonly AllowedContentType[];
  readonly resolver?: DnsResolver;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface SafeFetchResult {
  readonly finalUrl: string;
  readonly contentType: AllowedContentType;
  readonly bytes: Uint8Array;
  readonly redirects: readonly string[];
  /** Decoded text for `text/*` and HTML/XHTML. */
  readonly text: string | null;
}

async function vetUrl(raw: string, options: SafeFetchOptions, resolver: DnsResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError('invalid_url', { detail: 'parse' });
  }
  const check = checkFetchTarget(url, options);
  if (!check.ok) {
    throw new SsrfError(check.code, { detail: check.detail, ip_reason: check.ipReason });
  }
  if (check.ip !== null) return url;
  const [v4, v6] = await Promise.all([
    resolver(check.host, 'A').catch(() => [] as string[]),
    resolver(check.host, 'AAAA').catch(() => [] as string[]),
  ]);
  const vetted = checkResolvedAddresses([...v4, ...v6]);
  if (!vetted.ok) {
    const first = vetted.blocked[0];
    throw new SsrfError(vetted.code, {
      ip_reason: (first?.reason ?? null) as IpBlockReason | 'not_an_ip' | null,
    });
  }
  return url;
}

function baseType(header: string | null): string {
  return (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function charsetOf(header: string | null): string {
  const match = /charset\s*=\s*"?([A-Za-z0-9._-]+)"?/i.exec(header ?? '');
  return match?.[1] ?? 'utf-8';
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('Content-Length') ?? 'NaN');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new SsrfError('too_large', { limit: maxBytes });
  }
  if (response.body === null) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SsrfError('too_large', { limit: maxBytes });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Fetches an untrusted `https:` URL under the CTL-3.10 rules. Throws `SsrfError`. */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 3;
  const resolver = options.resolver ?? denoResolver;
  const doFetch = options.fetch ?? fetch;
  const accept = options.accept ?? ALLOWED_CONTENT_TYPES;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  const signal =
    options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);

  const redirects: string[] = [];
  let current = rawUrl;
  try {
    for (let hop = 0; ; hop++) {
      const url = await vetUrl(current, options, resolver);
      const response = await doFetch(url.href, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: accept.join(', '),
          'Accept-Encoding': 'identity',
          'Accept-Language': 'tr,en;q=0.8',
        },
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get('Location');
        if (![301, 302, 303, 307, 308].includes(response.status) || location === null) {
          throw new SsrfError('upstream_error', { status: response.status });
        }
        if (hop >= maxRedirects) throw new SsrfError('too_many_redirects', { limit: maxRedirects });
        current = new URL(location, url).href;
        redirects.push(current);
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new SsrfError('upstream_error', { status: response.status });
      }
      const encoding = (response.headers.get('Content-Encoding') ?? 'identity')
        .trim()
        .toLowerCase();
      if (encoding !== '' && encoding !== 'identity') {
        await response.body?.cancel();
        throw new SsrfError('encoded_response', { encoding });
      }
      const contentTypeHeader = response.headers.get('Content-Type');
      const type = baseType(contentTypeHeader);
      if (!(accept as readonly string[]).includes(type)) {
        await response.body?.cancel();
        throw new SsrfError('unsupported_type', { type: type === '' ? null : type });
      }
      const bytes = await readCapped(response, maxBytes);
      if (BINARY_TYPES.has(type)) {
        const sniffed = sniffMime(bytes);
        const compatible = sniffed === type || (type === 'image/heif' && sniffed === 'image/heic');
        if (!compatible) throw new SsrfError('magic_mismatch', { type });
      }
      const isText = type.startsWith('text/') || type === 'application/xhtml+xml';
      let text: string | null = null;
      if (isText) {
        try {
          text = new TextDecoder(charsetOf(contentTypeHeader), { fatal: false }).decode(bytes);
        } catch {
          text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        }
      }
      return {
        finalUrl: url.href,
        contentType: type as AllowedContentType,
        bytes,
        redirects,
        text,
      };
    }
  } catch (error) {
    if (error instanceof SsrfError) throw error;
    if (signal.aborted) throw new SsrfError('timeout', { limit_ms: options.timeoutMs ?? 10_000 });
    throw new SsrfError('upstream_error', { status: null });
  }
}
