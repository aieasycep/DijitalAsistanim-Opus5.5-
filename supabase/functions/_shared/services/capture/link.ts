/**
 * Link captures (IMPLEMENTATION_PLAN T-5.13; API-CAP-02/03, JOB-27; M§84, R-11). Every fetch goes
 * through the SSRF-safe fetcher (`https:` only, DNS pinning with private / loopback / metadata
 * ranges refused on every hop, ≤3 redirects, size and time caps, content-type allow-list, no
 * cookies). The preview reads only `<title>` / `og:title` from the first 64 KiB within 5 s; the
 * analysis reads the page once (5 MiB, 10 s) and keeps its readable text (≤50,000 characters).
 */
import { checkFetchTarget } from '@da/domain';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { AppError } from '../../errors.ts';
import { type DnsResolver, safeFetch, SsrfError } from '../../security/ssrf-fetch.ts';

export interface FetchDeps {
  readonly fetch?: typeof fetch;
  readonly resolver?: DnsResolver;
  readonly signal?: AbortSignal;
}

const PREVIEW_BYTES = 64 * 1024;
const PAGE_BYTES = 5 * 1024 * 1024;
export const PAGE_TEXT_MAX = 50_000;
/** Fewer readable characters than this: "Sayfa okunamadı · Metni yapıştır". */
export const PAGE_MIN_TEXT = 200;

/** API-CAP-02 pre-check: scheme and host literal only (resolution is checked at fetch). */
export function assertLinkAllowed(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError('SSRF_BLOCKED', { details: { reason: 'invalid_url' } });
  }
  const check = checkFetchTarget(parsed, {});
  if (!check.ok) throw new AppError('SSRF_BLOCKED', { details: { reason: check.code } });
  return parsed;
}

function titleOf(html: string): string | null {
  const og =
    /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']{1,300})["']/i.exec(html) ??
    /<meta[^>]+content=["']([^"']{1,300})["'][^>]*property=["']og:title["']/i.exec(html);
  const title = og?.[1] ?? /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html)?.[1];
  if (title === undefined) return null;
  const clean = title
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return clean === '' ? null : clean.slice(0, 300);
}

/** Title and domain only; any failure is `null` (never an error). */
export async function linkPreview(
  url: string,
  deps: FetchDeps = {},
): Promise<{ title: string | null; domain: string } | null> {
  let domain: string;
  try {
    domain = new URL(url).hostname;
  } catch {
    return null;
  }
  try {
    const page = await safeFetch(url, {
      maxBytes: PREVIEW_BYTES,
      timeoutMs: 5_000,
      accept: ['text/html'],
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
      ...(deps.resolver === undefined ? {} : { resolver: deps.resolver }),
    });
    return { title: page.text === null ? null : titleOf(page.text), domain };
  } catch {
    return null;
  }
}

export interface ReadPage {
  readonly finalUrl: string;
  readonly title: string | null;
  readonly text: string;
  /** A PDF link: the bytes go through the PDF pipeline. */
  readonly pdf: Uint8Array | null;
}

/** Readable text of a page (Readability over linkedom), or the PDF bytes of a PDF link. */
export async function readPage(url: string, deps: FetchDeps = {}): Promise<ReadPage> {
  const page = await safeFetch(url, {
    maxBytes: PAGE_BYTES,
    timeoutMs: 10_000,
    accept: ['text/html', 'text/plain', 'application/pdf'],
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    ...(deps.resolver === undefined ? {} : { resolver: deps.resolver }),
    ...(deps.signal === undefined ? {} : { signal: deps.signal }),
  });
  if (page.contentType === 'application/pdf') {
    return { finalUrl: page.finalUrl, title: null, text: '', pdf: page.bytes };
  }
  const raw = page.text ?? '';
  if (page.contentType !== 'text/html') {
    return { finalUrl: page.finalUrl, title: null, text: raw.slice(0, PAGE_TEXT_MAX), pdf: null };
  }
  // linkedom's window type lacks `document`; Readability only needs the DOM interface.
  const dom = parseHTML(raw) as unknown as { document: { body?: { textContent?: string | null } } };
  let text = '';
  try {
    const article = new Readability(
      dom.document as ConstructorParameters<typeof Readability>[0],
    ).parse();
    text = article?.textContent ?? '';
  } catch {
    text = '';
  }
  if (text.trim() === '') text = dom.document.body?.textContent ?? '';
  return {
    finalUrl: page.finalUrl,
    title: titleOf(raw),
    text: text
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, PAGE_TEXT_MAX),
    pdf: null,
  };
}

export { SsrfError };
