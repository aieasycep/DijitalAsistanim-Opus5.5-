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

const TITLE_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  quot: '"',
  '#39': "'",
  lt: '<',
  gt: '>',
};

/**
 * The five title entities decoded in one pass: every entity is read once, so `&amp;lt;` stays
 * the text `&lt;` (chained replaces decoded `&amp;` first and then the `&lt;` it produced).
 */
export function decodeTitleEntities(value: string): string {
  return value.replace(/&(amp|quot|#39|lt|gt);/g, (whole, name: string) => {
    return TITLE_ENTITIES[name] ?? whole;
  });
}

const TITLE_MAX = 300;

/** ASCII-only lower case: the same length as the input, so indices stay aligned. */
function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

const SPACE = new Set([' ', '\t', '\n', '\f', '\r']);
const NAME_END = new Set([...SPACE, '"', "'", '<', '>', '/', '=']);

/**
 * One tag's attributes (names lower-cased, first occurrence wins) by a single forward pass over
 * the tag text: no regex, so no backtracking on a long attribute-free run.
 */
function tagAttributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  const n = tag.length;
  const skipSpace = (from: number): number => {
    let i = from;
    while (i < n && SPACE.has(tag[i] ?? '')) i++;
    return i;
  };
  let i = 0;
  while (i < n) {
    while (i < n && (SPACE.has(tag[i] ?? '') || tag[i] === '/')) i++;
    const start = i;
    while (i < n && !NAME_END.has(tag[i] ?? '')) i++;
    if (i === start) {
      i++;
      continue;
    }
    const name = asciiLower(tag.slice(start, i));
    i = skipSpace(i);
    let value = '';
    if (tag[i] === '=') {
      i = skipSpace(i + 1);
      const quote = tag[i];
      if (quote === '"' || quote === "'") {
        const end = tag.indexOf(quote, i + 1);
        value = end === -1 ? tag.slice(i + 1) : tag.slice(i + 1, end);
        i = end === -1 ? n : end + 1;
      } else {
        const from = i;
        while (i < n && !SPACE.has(tag[i] ?? '')) i++;
        value = tag.slice(from, i);
      }
    }
    if (!out.has(name)) out.set(name, value);
  }
  return out;
}

/**
 * The `og:title` meta content, else the `<title>` text (each ≤ 300 characters). A single forward
 * scan: every `<meta` / `<title` start is found with `indexOf` and the scan resumes after that
 * tag's `>`, so a crafted page (thousands of unclosed `<meta` or `<title` openers in the 64 KiB
 * preview) costs linear time; the former `<meta[^>]+…` regexes backtracked quadratically there.
 */
export function titleOf(html: string): string | null {
  const lower = asciiLower(html);
  let og: string | undefined;
  for (let at = lower.indexOf('<meta'); at !== -1;) {
    const close = lower.indexOf('>', at);
    if (close === -1) break;
    const attrs = tagAttributes(html.slice(at + 5, close));
    const content = attrs.get('content');
    if (
      asciiLower(attrs.get('property') ?? '') === 'og:title' &&
      content !== undefined &&
      content.length >= 1 &&
      content.length <= TITLE_MAX
    ) {
      og = content;
      break;
    }
    at = lower.indexOf('<meta', close);
  }
  let title = og;
  for (let at = title === undefined ? lower.indexOf('<title') : -1; at !== -1;) {
    const close = lower.indexOf('>', at);
    if (close === -1) break;
    const end = html.indexOf('<', close + 1);
    if (end === -1) break;
    const text = html.slice(close + 1, end);
    if (text.length >= 1 && text.length <= TITLE_MAX && lower.startsWith('</title>', end)) {
      title = text;
      break;
    }
    at = lower.indexOf('<title', end);
  }
  if (title === undefined) return null;
  const clean = decodeTitleEntities(title).replace(/\s+/g, ' ').trim();
  return clean === '' ? null : clean.slice(0, TITLE_MAX);
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
