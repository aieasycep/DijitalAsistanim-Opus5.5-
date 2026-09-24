/**
 * Server-side copy (ADR-14): user-facing text the pipeline persists (insight titles, briefing hero
 * lines, share texts, approval cards) comes only from the `@da/i18n` catalogs. Turkish case suffixes
 * are passed pre-inflected (`time_loc`, `name_dat` …, built with {@link withCases}), so messages
 * never contain an apostrophe that would start an ICU quote.
 *
 * The formatter implements the ICU subset the catalogs use: `{arg}`, `{arg, number}`,
 * `{arg, plural, =0 {…} one {…} other {…}}` with `#`, and `{arg, select, key {…} other {…}}`.
 */
import { trSuffix } from '@da/i18n/tr-suffix';
import trBriefing from '@da/i18n/messages/tr/briefing.json' with { type: 'json' };
import enBriefing from '@da/i18n/messages/en/briefing.json' with { type: 'json' };
import trToday from '@da/i18n/messages/tr/today.json' with { type: 'json' };
import enToday from '@da/i18n/messages/en/today.json' with { type: 'json' };
import trFlow from '@da/i18n/messages/tr/flow.json' with { type: 'json' };
import enFlow from '@da/i18n/messages/en/flow.json' with { type: 'json' };
import trLife from '@da/i18n/messages/tr/life.json' with { type: 'json' };
import enLife from '@da/i18n/messages/en/life.json' with { type: 'json' };
import trSearch from '@da/i18n/messages/tr/search.json' with { type: 'json' };
import enSearch from '@da/i18n/messages/en/search.json' with { type: 'json' };
import trCommitments from '@da/i18n/messages/tr/commitments.json' with { type: 'json' };
import enCommitments from '@da/i18n/messages/en/commitments.json' with { type: 'json' };
import trCommon from '@da/i18n/messages/tr/common.json' with { type: 'json' };
import enCommon from '@da/i18n/messages/en/common.json' with { type: 'json' };
import trStates from '@da/i18n/messages/tr/states.json' with { type: 'json' };
import enStates from '@da/i18n/messages/en/states.json' with { type: 'json' };

export type CopyLocale = 'tr' | 'en';
export type CopyValue = string | number;
export type CopyParams = Readonly<Record<string, CopyValue>>;

type Catalog = Readonly<Record<string, unknown>>;

const CATALOGS: Readonly<Record<CopyLocale, Readonly<Record<string, Catalog>>>> = {
  tr: {
    briefing: trBriefing,
    today: trToday,
    flow: trFlow,
    life: trLife,
    search: trSearch,
    commitments: trCommitments,
    common: trCommon,
    states: trStates,
  },
  en: {
    briefing: enBriefing,
    today: enToday,
    flow: enFlow,
    life: enLife,
    search: enSearch,
    commitments: enCommitments,
    common: enCommon,
    states: enStates,
  },
};

/** `profiles.locale` (`tr-TR` | `en-US`) → catalog locale; Turkish by default. */
export function copyLocale(locale: string | null | undefined): CopyLocale {
  return locale?.toLowerCase().startsWith('en') === true ? 'en' : 'tr';
}

/** The raw ICU message at `namespace.path`; throws for a missing key (a programming error). */
export function message(locale: CopyLocale, key: string): string {
  const [namespace, ...path] = key.split('.');
  let node: unknown = CATALOGS[locale][namespace ?? ''];
  for (const segment of path) {
    node = typeof node === 'object' && node !== null ? (node as Catalog)[segment] : undefined;
  }
  if (typeof node !== 'string') throw new Error(`copy_key_missing:${locale}:${key}`);
  return node;
}

/** Formats `key` with ICU params. */
export function copy(locale: CopyLocale, key: string, params: CopyParams = {}): string {
  return formatIcu(message(locale, key), params, locale);
}

/** Adds the Turkish case variants of `values` (`time` → `time_dat`, `time_loc`, …). */
export function withCases(values: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = { ...values };
  const cases = [
    ['dative', 'dat'],
    ['accusative', 'acc'],
    ['locative', 'loc'],
    ['ablative', 'abl'],
    ['genitive', 'gen'],
  ] as const;
  for (const [key, value] of Object.entries(values)) {
    for (const [grammaticalCase, suffix] of cases) {
      out[`${key}_${suffix}`] = value.trim() === '' ? '' : trSuffix(value, grammaticalCase);
    }
  }
  return out;
}

// ── ICU subset ───────────────────────────────────────────────────────────────

/** Index of the brace that closes the one opened at `open`. */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error('icu_unbalanced');
}

/** `key {text} key2 {text2}` → map. */
function parseOptions(body: string): Map<string, string> {
  const options = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i] ?? '')) i++;
    if (i >= body.length) break;
    const open = body.indexOf('{', i);
    if (open === -1) break;
    const key = body.slice(i, open).trim();
    const close = closingBrace(body, open);
    options.set(key, body.slice(open + 1, close));
    i = close + 1;
  }
  return options;
}

function formatNumber(value: number, locale: CopyLocale): string {
  return new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-GB').format(value);
}

function formatArgument(
  inner: string,
  params: CopyParams,
  locale: CopyLocale,
  pound: number | null,
): string {
  const first = inner.indexOf(',');
  const name = (first === -1 ? inner : inner.slice(0, first)).trim();
  const value = params[name];
  if (first === -1) {
    if (value === undefined) throw new Error(`icu_param_missing:${name}`);
    return typeof value === 'number' ? formatNumber(value, locale) : value;
  }
  const rest = inner.slice(first + 1);
  const second = rest.indexOf(',');
  const type = (second === -1 ? rest : rest.slice(0, second)).trim();
  const body = second === -1 ? '' : rest.slice(second + 1);
  if (value === undefined) throw new Error(`icu_param_missing:${name}`);
  if (type === 'number') {
    return formatNumber(Number(value), locale);
  }
  const options = parseOptions(body);
  if (type === 'plural') {
    const n = Number(value);
    const exact = options.get(`=${n}`);
    const category = new Intl.PluralRules(locale === 'tr' ? 'tr-TR' : 'en-GB').select(n);
    const chosen = exact ?? options.get(category) ?? options.get('other') ?? '';
    return formatIcu(chosen, params, locale, n);
  }
  if (type === 'select') {
    const chosen = options.get(String(value)) ?? options.get('other') ?? '';
    return formatIcu(chosen, params, locale, pound);
  }
  throw new Error(`icu_type_unsupported:${type}`);
}

export function formatIcu(
  text: string,
  params: CopyParams,
  locale: CopyLocale = 'tr',
  pound: number | null = null,
): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (ch === '{') {
      const close = closingBrace(text, i);
      out += formatArgument(text.slice(i + 1, close), params, locale, pound);
      i = close + 1;
      continue;
    }
    if (ch === '#' && pound !== null) {
      out += formatNumber(pound, locale);
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Truncates to `max` characters on a word boundary (DB length checks). */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const INTL_LOCALE: Readonly<Record<CopyLocale, string>> = { tr: 'tr-TR', en: 'en-US' };

const asDate = (at: Date | string): Date => (typeof at === 'string' ? new Date(at) : at);

/** "25 Eylül" / "September 25" in the user's zone. */
export function formatDay(locale: CopyLocale, at: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(asDate(at));
}

/** "Cuma" / "Friday" in the user's zone. */
export function formatWeekday(locale: CopyLocale, at: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: 'long', timeZone }).format(
    asDate(at),
  );
}

/** "14:30" (24 h) in the user's zone. */
export function formatTime(at: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(asDate(at));
}

/** "25 Eylül 14:30", or the day alone for date-only values. */
export function formatDue(
  locale: CopyLocale,
  at: Date | string,
  timeZone: string,
  dateOnly: boolean,
): string {
  const day = formatDay(locale, at, timeZone);
  return dateOnly ? day : `${day} ${formatTime(at, timeZone)}`;
}
