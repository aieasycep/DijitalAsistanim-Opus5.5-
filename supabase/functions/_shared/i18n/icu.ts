/**
 * ICU MessageFormat subset for server-rendered copy (push text, approval cards, reminder reasons;
 * API_CONTRACTS §2.13, ADR-14). The catalogs in `packages/i18n/messages` use plain arguments,
 * `select`, `plural` (with `#`, `=n` and `offset:`) and `number`; this renderer supports exactly
 * those, with ICU's apostrophe rules (`''` is a literal apostrophe; `'{…}'` quotes syntax; a lone
 * apostrophe elsewhere is literal, so "Onay Bekleyenler'de" renders as written).
 *
 * Turkish case suffixes are never computed inside a message: callers pass pre-inflected values
 * (`time_loc`, `name_dat`, …) built with `withTrCases` from `@da/i18n/tr-suffix`.
 */

export type IcuLocale = 'tr' | 'en';
export type IcuValue = string | number;
export type IcuParams = Readonly<Record<string, IcuValue>>;

const INTL_LOCALE: Readonly<Record<IcuLocale, string>> = { tr: 'tr-TR', en: 'en-US' };

export class IcuSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IcuSyntaxError';
  }
}

function isQuoteStart(next: string | undefined, inPlural: boolean): boolean {
  return next === '{' || next === '}' || next === '|' || (inPlural && next === '#');
}

/** Index of the `}` closing the argument that opens at `start` (quotes and nesting respected). */
function closingBrace(src: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'") {
      const next = src[i + 1];
      if (next === "'") {
        i += 2;
        continue;
      }
      if (isQuoteStart(next, true)) {
        const end = src.indexOf("'", i + 1);
        i = end === -1 ? src.length : end + 1;
        continue;
      }
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  throw new IcuSyntaxError('unbalanced_braces');
}

/** Splits `key {msg} key2 {msg2}` into pairs. */
function parseOptions(body: string): [string, string][] {
  const out: [string, string][] = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i] ?? '')) i++;
    if (i >= body.length) break;
    let key = '';
    while (i < body.length && body[i] !== '{' && !/\s/.test(body[i] ?? '')) key += body[i++];
    while (i < body.length && /\s/.test(body[i] ?? '')) i++;
    if (body[i] !== '{' || key === '') throw new IcuSyntaxError('bad_option');
    const end = closingBrace(body, i);
    out.push([key, body.slice(i + 1, end)]);
    i = end + 1;
  }
  return out;
}

function formatNumber(value: number, locale: IcuLocale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: 2 }).format(value);
}

function toNumber(value: IcuValue | undefined): number {
  if (typeof value === 'number') return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatArgument(inner: string, params: IcuParams, locale: IcuLocale): string {
  const firstComma = inner.indexOf(',');
  const name = (firstComma === -1 ? inner : inner.slice(0, firstComma)).trim();
  if (firstComma === -1) {
    const value = params[name];
    if (value === undefined) return '';
    return typeof value === 'number' ? formatNumber(value, locale) : value;
  }
  const rest = inner.slice(firstComma + 1);
  const secondComma = rest.indexOf(',');
  const type = (secondComma === -1 ? rest : rest.slice(0, secondComma)).trim();
  const body = secondComma === -1 ? '' : rest.slice(secondComma + 1);
  const value = params[name];
  if (type === 'number') return formatNumber(toNumber(value), locale);
  if (type === 'select') {
    const options = parseOptions(body);
    const key = value === undefined ? 'other' : String(value);
    const chosen = options.find(([k]) => k === key) ?? options.find(([k]) => k === 'other');
    return chosen === undefined ? '' : render(chosen[1], params, locale, null);
  }
  if (type === 'plural' || type === 'selectordinal') {
    let text = body.trim();
    let offset = 0;
    const offsetMatch = /^offset:\s*(\d+)\s*/.exec(text);
    if (offsetMatch !== null) {
      offset = Number(offsetMatch[1]);
      text = text.slice(offsetMatch[0].length);
    }
    const options = parseOptions(text);
    const n = toNumber(value);
    const exact = options.find(([k]) => k === `=${n}`);
    const rules = new Intl.PluralRules(INTL_LOCALE[locale], {
      type: type === 'plural' ? 'cardinal' : 'ordinal',
    });
    const category = rules.select(n - offset);
    const chosen =
      exact ?? options.find(([k]) => k === category) ?? options.find(([k]) => k === 'other');
    return chosen === undefined ? '' : render(chosen[1], params, locale, n - offset);
  }
  throw new IcuSyntaxError(`unsupported_type:${type}`);
}

function render(src: string, params: IcuParams, locale: IcuLocale, plural: number | null): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i] ?? '';
    if (ch === "'") {
      const next = src[i + 1];
      if (next === "'") {
        out += "'";
        i += 2;
        continue;
      }
      if (isQuoteStart(next, plural !== null)) {
        let j = i + 1;
        while (j < src.length) {
          if (src[j] === "'") {
            if (src[j + 1] === "'") {
              out += "'";
              j += 2;
              continue;
            }
            break;
          }
          out += src[j];
          j++;
        }
        i = j + 1;
        continue;
      }
      out += "'";
      i++;
      continue;
    }
    if (ch === '#' && plural !== null) {
      out += formatNumber(plural, locale);
      i++;
      continue;
    }
    if (ch === '{') {
      const end = closingBrace(src, i);
      out += formatArgument(src.slice(i + 1, end), params, locale);
      i = end + 1;
      continue;
    }
    if (ch === '}') throw new IcuSyntaxError('unbalanced_braces');
    out += ch;
    i++;
  }
  return out;
}

/** Formats one ICU message with its parameters. Missing arguments render as empty text. */
export function formatIcu(
  message: string,
  params: IcuParams = {},
  locale: IcuLocale = 'tr',
): string {
  return render(message, params, locale, null);
}
