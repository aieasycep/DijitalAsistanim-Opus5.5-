/**
 * Turkish time-of-day expressions (AI_PIPELINE_PLAN §6.9.2). Runs on `foldTR(normTR(text))`, so
 * "öğlen" and "oglen" are the same. Returns tokens with spans in the folded text; the date parser
 * merges them with nearby date expressions.
 */
import { LB, RB } from './normalize-tr.ts';

export type TimeRuleId = 'T_CLOCK' | 'T_RANGE' | 'T_PART' | 'T_BARE_HOUR' | 'T_SAAT_HOUR' | 'T_EOD';

export interface TimeToken {
  readonly ruleId: TimeRuleId;
  /** [from, to) in the folded text. */
  readonly from: number;
  readonly to: number;
  readonly hour: number;
  readonly minute: number;
  /** Range end (T_RANGE only). */
  readonly endHour?: number;
  readonly endMinute?: number;
  /** "kadar", "dek", end-of-day forms: a deadline. */
  readonly by: boolean;
  readonly ambiguous: boolean;
  /** Only a part of day ("sabah", "akşam") without a clock value. */
  readonly partOfDayOnly: boolean;
}

/** Locative/dative/ablative case endings after a time ("17:00'de", "09:40'tan", "17:00'ye"). */
const SUFFIX = "(?:'?(?:de|da|te|ta|ye|ya|e|a|den|dan|ten|tan))";
const BY_TAIL = '(?:\\s*(?:kadar|dek|degin))';

function mk(re: string): RegExp {
  return new RegExp(re, 'gu');
}

const RANGE = mk(
  '(?<![\\d.:])(?:saat\\s*)?([01]?\\d|2[0-3])[:.]([0-5]\\d)\\s*(?:-|ile|ve)\\s*([01]?\\d|2[0-3])[:.]([0-5]\\d)(?:\\s*(?:arasinda|arasi))?(?![\\d])',
);
const CLOCK = mk(
  `(?<![\\d.:/-])(saat\\s*)?([01]?\\d|2[0-3])([:.])([0-5]\\d)(?![\\d])(${SUFFIX}${RB})?(${BY_TAIL}${RB})?`,
);
const PART = mk(
  `${LB}(sabahleyin|sabahi|sabaha|sabah|ogleden sonra|ogleyin|ogleni|oglene|oglen|ogle|aksamustu|aksamleyin|aksami|aksama|aksam|geceleyin|gece)${RB}(?:\\s+(?:saat\\s*)?(\\d{1,2})(?:[:.]([0-5]\\d))?${SUFFIX}?${RB})?(${BY_TAIL}${RB})?`,
);
const BARE_HOUR = mk(`(?<![\\d.:,])(\\d{1,2})'(de|da|te|ta|e|a|ye|ya)${RB}(${BY_TAIL}${RB})?`);
const SAAT_HOUR = mk(`${LB}saat\\s*(\\d{1,2})(?![\\d:.])${SUFFIX}?${RB}(${BY_TAIL}${RB})?`);
const EOD = mk(
  `${LB}(mesai bitimine kadar|mesai bitimine|mesai bitiminde|mesai sonuna kadar|mesai sonuna|gun sonuna kadar|gun sonuna|gun sonu|eod)${RB}`,
);
/** A date word right before "14.10" makes it a time (§6.9.2: preceding date within 12 chars). */
const DATE_CONTEXT_BEFORE =
  /(?:ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|oca|sub|mar|nis|haz|tem|agu|eyl|eki|kas|ara|pazartesi|sali|carsamba|persembe|cumartesi|cuma|pazar|gunu|bugun|yarin|\d{4})\.?[\s,]*$/u;

/** Business-hours reading of a bare hour: 1–7 → afternoon, 8–12 as is (UT-DATE-17). */
export function businessHour(h: number): number {
  return h >= 1 && h <= 7 ? h + 12 : h;
}

type PartBase = 'sabah' | 'oglen' | 'ogleden' | 'aksamustu' | 'aksam' | 'gece';

function partBase(word: string): PartBase {
  if (word.startsWith('sabah')) return 'sabah';
  if (word === 'ogleden sonra') return 'ogleden';
  if (word.startsWith('ogle')) return 'oglen';
  if (word === 'aksamustu') return 'aksamustu';
  if (word.startsWith('aksam')) return 'aksam';
  return 'gece';
}

const PART_DEFAULTS: Readonly<Record<PartBase, { hour: number; ambiguous: boolean }>> = {
  sabah: { hour: 9, ambiguous: false },
  oglen: { hour: 12, ambiguous: false },
  ogleden: { hour: 14, ambiguous: true },
  aksamustu: { hour: 17, ambiguous: true },
  aksam: { hour: 19, ambiguous: false },
  gece: { hour: 23, ambiguous: true },
};

function partTime(
  word: string,
  hourText: string | undefined,
  minuteText: string | undefined,
): { hour: number; minute: number; ambiguous: boolean; partOnly: boolean } | null {
  const base = partBase(word);
  const minute = minuteText ? Number(minuteText) : 0;
  if (hourText === undefined) {
    const d = PART_DEFAULTS[base];
    return { hour: d.hour, minute: 0, ambiguous: d.ambiguous, partOnly: true };
  }
  const h = Number(hourText);
  if (h > 23) return null;
  switch (base) {
    case 'sabah':
      return h <= 12 ? { hour: h === 12 ? 0 : h, minute, ambiguous: false, partOnly: false } : null;
    case 'oglen':
      return { hour: h <= 5 ? h + 12 : h, minute, ambiguous: false, partOnly: false };
    case 'ogleden':
    case 'aksamustu':
    case 'aksam':
      return { hour: h <= 11 ? h + 12 : h, minute, ambiguous: false, partOnly: false };
    case 'gece':
      if (h >= 7 && h <= 11) return { hour: h + 12, minute, ambiguous: false, partOnly: false };
      return { hour: h === 12 ? 0 : h, minute, ambiguous: h <= 4 || h === 12, partOnly: false };
  }
}

const validDayMonth = (d: number, m: number): boolean => d >= 1 && d <= 31 && m >= 1 && m <= 12;

/**
 * All time tokens in folded text. `HH.MM` without context ("17.09") is left to the date parser
 * when it is also a valid day.month (UT-DATE-18 / §6.9.2).
 */
export function findTimeTokens(folded: string): TimeToken[] {
  const tokens: TimeToken[] = [];
  const push = (t: TimeToken): void => {
    if (tokens.some((x) => t.from < x.to && x.from < t.to)) return;
    tokens.push(t);
  };
  const base = { by: false, ambiguous: false, partOfDayOnly: false } as const;

  for (const m of folded.matchAll(RANGE)) {
    push({
      ...base,
      ruleId: 'T_RANGE',
      from: m.index,
      to: m.index + m[0].length,
      hour: Number(m[1]),
      minute: Number(m[2]),
      endHour: Number(m[3]),
      endMinute: Number(m[4]),
    });
  }

  for (const m of folded.matchAll(EOD)) {
    push({
      ...base,
      ruleId: 'T_EOD',
      from: m.index,
      to: m.index + m[0].length,
      hour: 18,
      minute: 0,
      by: true,
    });
  }

  for (const m of folded.matchAll(PART)) {
    const t = partTime(m[1] ?? '', m[2], m[3]);
    if (!t) continue;
    push({
      ruleId: 'T_PART',
      from: m.index,
      to: m.index + m[0].length,
      hour: t.hour,
      minute: t.minute,
      by: m[4] !== undefined,
      ambiguous: t.ambiguous,
      partOfDayOnly: t.partOnly,
    });
  }

  for (const m of folded.matchAll(CLOCK)) {
    const from = m.index;
    const saat = m[1] !== undefined;
    const hour = Number(m[2]);
    const minute = Number(m[4]);
    const suffix = m[5] !== undefined;
    const afterDate = DATE_CONTEXT_BEFORE.test(folded.slice(Math.max(0, from - 14), from));
    const isTime = m[3] === ':' || saat || suffix || afterDate || !validDayMonth(hour, minute);
    if (!isTime) continue;
    // "17.10.2026": a trailing ".yyyy" means a date
    if (m[3] === '.' && !saat && /^\.\d{2,4}/.test(folded.slice(from + m[0].length))) continue;
    push({
      ...base,
      ruleId: 'T_CLOCK',
      from,
      to: from + m[0].length,
      hour,
      minute,
      by: m[6] !== undefined,
    });
  }

  for (const m of folded.matchAll(SAAT_HOUR)) {
    const h = Number(m[1]);
    if (h > 23) continue;
    push({
      ...base,
      ruleId: 'T_SAAT_HOUR',
      from: m.index,
      to: m.index + m[0].length,
      hour: businessHour(h),
      minute: 0,
      by: m[2] !== undefined,
      ambiguous: h >= 1 && h <= 12,
    });
  }

  for (const m of folded.matchAll(BARE_HOUR)) {
    const h = Number(m[1]);
    const suffix = m[2] ?? '';
    const by = m[3] !== undefined;
    if (h > 23) continue;
    // a dative on a bare number is a time only with a deadline tail ("5'e kadar")
    if (!['de', 'da', 'te', 'ta'].includes(suffix) && !by) continue;
    push({
      ...base,
      ruleId: 'T_BARE_HOUR',
      from: m.index,
      to: m.index + m[0].length,
      hour: businessHour(h),
      minute: 0,
      by,
      ambiguous: h >= 1 && h <= 12,
    });
  }

  return tokens.sort((a, b) => a.from - b.from);
}
