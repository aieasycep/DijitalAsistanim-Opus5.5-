/**
 * Booking references (PNR) and THY e-ticket numbers (AI_PIPELINE_PLAN §6.9.5). A PNR needs a
 * label, six uppercase alphanumerics with at least one letter, and must not be a dictionary word.
 */

const LABEL_RE =
  /(?:pnr|rezervasyon\s*(?:kodu|no|numarası|numarasi)|booking\s*(?:reference|code|ref)|confirmation\s*(?:code|number)|record\s*locator)\s*[:#]?\s*([A-Za-z0-9]{6})(?![A-Za-z0-9])/giu;
const TICKET_RE = /(?<![\d-])(235-?\d{10})(?![\d])/g;

/** Six-letter words that follow booking labels in real mail but are never codes. */
const DICTIONARY: ReadonlySet<string> = new Set([
  'ONLINE',
  'BOOKED',
  'TICKET',
  'NUMBER',
  'CHANGE',
  'STATUS',
  'DETAIL',
  'ADULTS',
  'FLIGHT',
  'RETURN',
  'PLEASE',
  'BELOW',
  'CANCEL',
  'UPDATE',
  'TARIFE',
  'BILGIN',
  'YOLCUN',
  'BILETI',
  'ISLEMI',
]);

export interface PnrMatch {
  readonly code: string;
  readonly span: readonly [number, number];
}

export interface TicketNumberMatch {
  readonly ticketNumber: string;
  readonly span: readonly [number, number];
}

export function isPlausiblePnr(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(code) && /[A-Z]/.test(code) && !DICTIONARY.has(code);
}

/** Labelled booking references ("PNR: X7K2QA"). */
export function findPnrs(text: string): PnrMatch[] {
  const out: PnrMatch[] = [];
  for (const m of text.matchAll(LABEL_RE)) {
    const code = m[1] ?? '';
    if (!isPlausiblePnr(code)) continue;
    if (out.some((p) => p.code === code)) continue;
    const start = m.index + m[0].length - code.length;
    out.push({ code, span: [start, start + code.length] });
  }
  return out;
}

/** THY e-ticket numbers `235-XXXXXXXXXX` (a separate field, never a PNR). */
export function findTicketNumbers(text: string): TicketNumberMatch[] {
  return [...text.matchAll(TICKET_RE)].map((m) => ({
    ticketNumber: (m[1] ?? '').replace('-', ''),
    span: [m.index, m.index + (m[1] ?? '').length] as const,
  }));
}
