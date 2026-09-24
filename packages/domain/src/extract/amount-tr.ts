/**
 * Money amounts, TRY first (AI_PIPELINE_PLAN §6.9.3; TEST_PLAN §2.4). Values are integer minor
 * units computed with string arithmetic — floats are never used for parsing or storage.
 *
 * Turkish convention: `.` groups thousands and `,` is the decimal separator ("₺1.842,50").
 * English-style input ("₺1,842.50") and a bare decimal dot ("1842.50 TL") parse with confidence
 * `medium`. A number without a currency is not an amount.
 */
import { foldTR, normTR, originalSpan } from './normalize-tr.ts';

export type CurrencyCode = 'TRY' | 'USD' | 'EUR' | 'GBP';
export type AmountConfidence = 'high' | 'medium';

export interface AmountMatch {
  /** Signed integer minor units (kuruş / cents). */
  readonly minor: number;
  readonly currency: CurrencyCode;
  readonly confidence: AmountConfidence;
  /** A refund / credit ("iade", leading minus). */
  readonly refund: boolean;
  readonly span: readonly [number, number];
  readonly text: string;
}

const CURRENCY_WORDS: readonly [RegExp, CurrencyCode][] = [
  [/^(?:₺|tl|try|turk lirasi|turk lirasina|turk lirasi'?dir|lira|liralik|lirayi)$/u, 'TRY'],
  [/^(?:\$|usd|dolar|dolarlik)$/u, 'USD'],
  [/^(?:€|eur|euro|avro)$/u, 'EUR'],
  [/^(?:£|gbp|sterlin)$/u, 'GBP'],
];

function currencyOf(token: string): CurrencyCode | null {
  const t = token.trim();
  for (const [re, code] of CURRENCY_WORDS) if (re.test(t)) return code;
  return null;
}

const NUM = '\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';
const SYMBOL = '₺|\\$|€|£';
const CODE = 'tl|try|usd|eur|gbp';
const WORD =
  "turk lirasi(?:'?dir|na)?|turk lirasina|liralik|lirayi|lira|dolarlik|dolar|euro|avro|sterlin";
/** A minus sign directly attached to the amount ("-1.250 TL"); "Fiyat - 1.250 TL" is not negative. */
const SIGN = '(?<sign>[-\\u2212])?';
const SCALE = '(?:\\s*(?<scale>bin|milyon|milyar))?';

/** prefix: "₺1.842,50", "TL 1.842", "$49.99" (letter codes need a space: "TL2412" is not money). */
const PREFIX = new RegExp(
  `(?<![\\p{L}\\d.,]|\\d\\s)${SIGN}(?:(?<psym>${SYMBOL})\\s?|(?<pcode>${CODE})\\s)(?<pnum>${NUM})(?![\\d])${SCALE}`,
  'gu',
);
/** suffix: "1.842 TL", "12,5 bin TL", "2 milyon lira", "49,90 €". */
const SUFFIX_RE = new RegExp(
  `(?<![\\p{L}\\d.,])${SIGN}(?<snum>${NUM})(?![\\d])${SCALE}\\s?(?<scur>${SYMBOL}|(?:${CODE}|${WORD})(?!\\p{L}))`,
  'gu',
);
const KURUS = /(?<![\p{L}\d.,])(\d{1,2})\s*(?:kurus|kr\.?)(?!\p{L})/gu;
const REFUND_NEAR = /(?:^|[^\p{L}])(iade|geri odeme|refund|alacak)(?!\p{L})/u;

const SCALES: Readonly<Record<string, number>> = { bin: 3, milyon: 6, milyar: 9 };

interface ParsedNumber {
  readonly intDigits: string;
  readonly fracDigits: string;
  readonly confidence: AmountConfidence;
}

/**
 * Splits a number string into integer and fraction digits. TR style is the default; EN style
 * (`1,842.50`) and ambiguous forms are `medium`. `enFirst` (USD/GBP) reads a lone dot as decimal.
 */
export function parseNumberTR(raw: string, enFirst = false): ParsedNumber | null {
  const s = raw.trim();
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const groupsOk = (intPart: string, sep: string): boolean =>
    new RegExp(`^\\d{1,3}(?:\\${sep}\\d{3})*$`).test(intPart);

  if (lastDot !== -1 && lastComma !== -1) {
    const decSep = lastDot > lastComma ? '.' : ',';
    const thouSep = decSep === '.' ? ',' : '.';
    const idx = decSep === '.' ? lastDot : lastComma;
    const intPart = s.slice(0, idx);
    const frac = s.slice(idx + 1);
    if (!/^\d{1,2}$/.test(frac) || !groupsOk(intPart, thouSep)) return null;
    return {
      intDigits: intPart.split(thouSep).join(''),
      fracDigits: frac,
      confidence: decSep === ',' ? 'high' : enFirst ? 'high' : 'medium',
    };
  }
  if (lastComma !== -1) {
    const parts = s.split(',');
    const last = parts[parts.length - 1] ?? '';
    if (parts.length === 2 && /^\d{1,2}$/.test(last)) {
      return { intDigits: parts[0] ?? '', fracDigits: last, confidence: 'high' };
    }
    if (groupsOk(s, ',')) {
      return { intDigits: parts.join(''), fracDigits: '', confidence: enFirst ? 'high' : 'medium' };
    }
    return null;
  }
  if (lastDot !== -1) {
    const parts = s.split('.');
    const last = parts[parts.length - 1] ?? '';
    if (groupsOk(s, '.') && !(enFirst && parts.length === 2 && last.length !== 3)) {
      return { intDigits: parts.join(''), fracDigits: '', confidence: enFirst ? 'medium' : 'high' };
    }
    if (parts.length === 2 && /^\d{1,2}$/.test(last)) {
      return {
        intDigits: parts[0] ?? '',
        fracDigits: last,
        confidence: enFirst ? 'high' : 'medium',
      };
    }
    return null;
  }
  return { intDigits: s, fracDigits: '', confidence: 'high' };
}

/** Integer minor units from digit strings, with an optional power-of-ten scale ("bin"). */
function toMinor(n: ParsedNumber, scalePow: number): number | null {
  const frac2 = (n.fracDigits + '00').slice(0, 2);
  let digits = `${n.intDigits.replace(/^0+(?=\d)/, '')}${frac2}`;
  if (scalePow > 0) digits = `${digits}${'0'.repeat(scalePow)}`;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

interface RawMatch {
  from: number;
  to: number;
  minor: number;
  currency: CurrencyCode;
  confidence: AmountConfidence;
  negative: boolean;
}

/** All money amounts in `text`, left to right. */
export function parseAmountsTR(text: string): AmountMatch[] {
  const norm = normTR(text);
  const folded = foldTR(norm.text);
  const raws: RawMatch[] = [];
  const add = (r: RawMatch): void => {
    if (raws.some((x) => r.from < x.to && x.from < r.to)) return;
    raws.push(r);
  };

  const handle = (m: RegExpMatchArray, numText: string, curText: string): void => {
    const currency = currencyOf(curText);
    if (!currency) return;
    const groups = m.groups ?? {};
    const enFirst = currency === 'USD' || currency === 'GBP';
    const parsed = parseNumberTR(numText, enFirst);
    if (!parsed) return;
    const scale = groups.scale ? (SCALES[groups.scale] ?? 0) : 0;
    const minor = toMinor(parsed, scale);
    if (minor === null) return;
    add({
      from: m.index ?? 0,
      to: (m.index ?? 0) + m[0].length,
      minor,
      currency,
      confidence: parsed.confidence,
      negative: groups.sign !== undefined,
    });
  };

  // Turkish suffix form first ("10 TL 50 kuruş" must not read "TL 50" as a prefix amount)
  for (const m of folded.matchAll(SUFFIX_RE)) {
    const g = m.groups ?? {};
    handle(m, g.snum ?? '', g.scur ?? '');
  }
  for (const m of folded.matchAll(PREFIX)) {
    const g = m.groups ?? {};
    handle(m, g.pnum ?? '', g.psym ?? g.pcode ?? '');
  }
  // "50 kuruş", and "10 TL 50 kuruş"
  for (const m of folded.matchAll(KURUS)) {
    const from = m.index;
    const to = from + m[0].length;
    const kurus = Number(m[1]);
    const prev = raws.find(
      (r) =>
        r.currency === 'TRY' &&
        r.minor % 100 === 0 &&
        r.to <= from &&
        /^\s*$/.test(folded.slice(r.to, from)),
    );
    if (prev) {
      prev.minor += kurus;
      prev.to = to;
      continue;
    }
    add({ from, to, minor: kurus, currency: 'TRY', confidence: 'high', negative: false });
  }

  raws.sort((a, b) => a.from - b.from);
  return raws.map((r) => {
    const context = `${folded.slice(Math.max(0, r.from - 24), r.from)} ${folded.slice(r.to, r.to + 24)}`;
    const refund = r.negative || REFUND_NEAR.test(context);
    const [s, e] = originalSpan(norm, r.from, r.to);
    return {
      minor: refund ? -Math.abs(r.minor) : r.minor,
      currency: r.currency,
      confidence: r.confidence,
      refund,
      span: [s, e] as const,
      text: text.slice(s, e),
    };
  });
}

export type SingleAmountResult =
  | { readonly status: 'none' }
  | { readonly status: 'one'; readonly value: AmountMatch }
  | { readonly status: 'ambiguous'; readonly values: readonly AmountMatch[] };

/** The grounding re-derivation (§6.4): the quote must yield exactly one amount. */
export function resolveAmountTR(quote: string): SingleAmountResult {
  const all = parseAmountsTR(quote);
  const first = all[0];
  if (!first) return { status: 'none' };
  if (all.every((a) => a.minor === first.minor && a.currency === first.currency)) {
    return { status: 'one', value: first };
  }
  return { status: 'ambiguous', values: all };
}

/** Exact decimal string for `numeric(14,2)` columns and the API `Money.value` ("1842.50"). */
export function minorToDecimalString(minor: number): string {
  if (!Number.isSafeInteger(minor)) throw new RangeError('minor units must be a safe integer');
  const sign = minor < 0 ? '-' : '';
  const digits = String(Math.abs(minor)).padStart(3, '0');
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Parses an exact decimal string ("1842.5", "-12.00") into minor units without floats. */
export function decimalStringToMinor(value: string): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new RangeError(`not a decimal amount: ${value}`);
  const minor = Number(`${m[2] ?? '0'}${((m[3] ?? '') + '00').slice(0, 2)}`);
  return m[1] === '-' ? -minor : minor;
}

/** Display formatting ("₺1.842,00"); floats appear only in this presentation step. */
export function formatMoney(
  minor: number,
  currency: CurrencyCode,
  locale: 'tr-TR' | 'en-US' = 'tr-TR',
): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100);
}
