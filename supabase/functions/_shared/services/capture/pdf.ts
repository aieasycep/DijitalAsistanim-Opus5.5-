/**
 * PDF captures (IMPLEMENTATION_PLAN T-5.13; JOB-27; M§85): structural checks first (encrypted,
 * truncated, more than 50 pages → `UPLOAD_INVALID`), then per-page text with `unpdf` (no workers).
 * A document averaging fewer than 50 characters per page has no usable text layer (scanned).
 */
import { extractText, getDocumentProxy } from 'unpdf';
import { inspectPdf } from '../../security/upload-validate.ts';

export const PDF_MAX_PAGES = 50;
/** Page text blocks sent to the model (`p1..p30`). */
export const PDF_MODEL_PAGES = 30;
const SCANNED_CHARS_PER_PAGE = 50;
const PAGE_TEXT_MAX = 6_000;

export type PdfRead =
  | { readonly kind: 'text'; readonly pages: string[]; readonly pageCount: number }
  | { readonly kind: 'scanned'; readonly pageCount: number }
  | {
      readonly kind: 'invalid';
      readonly reason: 'encrypted' | 'truncated' | 'too_many_pages' | 'unreadable';
    };

export async function readPdf(bytes: Uint8Array): Promise<PdfRead> {
  const inspected = inspectPdf(bytes, PDF_MAX_PAGES);
  if (!inspected.ok) return { kind: 'invalid', reason: inspected.reason };
  let pages: string[];
  let total: number;
  try {
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    const out = await extractText(doc, { mergePages: false });
    total = out.totalPages;
    pages = (Array.isArray(out.text) ? out.text : [String(out.text)]).map((p) =>
      p
        .replace(/[ \t]+/g, ' ')
        .trim()
        .slice(0, PAGE_TEXT_MAX),
    );
  } catch {
    return { kind: 'invalid', reason: 'unreadable' };
  }
  if (total > PDF_MAX_PAGES) return { kind: 'invalid', reason: 'too_many_pages' };
  const chars = pages.reduce((n, p) => n + p.length, 0);
  if (total === 0 || chars / Math.max(1, total) < SCANNED_CHARS_PER_PAGE) {
    return { kind: 'scanned', pageCount: total };
  }
  return { kind: 'text', pages, pageCount: total };
}
