/**
 * T0 search query parser (IMPLEMENTATION_PLAN T-5.07; API-SRCH-01): Turkish date ranges ("dün",
 * "bu hafta", "geçen ay", "son 7 gün", "ekim", "2025"), result-type words ("mail", "toplantı",
 * "fatura", "söz" …) and person hints ("Mehmet'in teklif maili", "Ayşe ile") are lifted out of the
 * text; the rest goes to full-text search. Parsing is folded (ı/i, ş/s …) so "gecen ay" matches too.
 * A query that would become empty keeps its original text.
 */
import {
  addDaysToLocalDate,
  endOfMonthLocalDate,
  foldTR,
  isoWeekStart,
  localDate,
  normalizeTR,
  startOfLocalDay,
} from '@da/domain';

export type SearchType =
  | 'email'
  | 'person'
  | 'event'
  | 'task'
  | 'commitment'
  | 'life_event'
  | 'memory'
  | 'capture';

export interface ParsedQuery {
  /** Text for FTS and the query embedding (date / type words removed). */
  readonly text: string;
  readonly from: Date | null;
  readonly to: Date | null;
  readonly types: readonly SearchType[];
  /** Capitalised names in the query ("Mehmet"), matched against contacts by the route. */
  readonly personHints: readonly string[];
}

const MONTHS = [
  'ocak',
  'subat',
  'mart',
  'nisan',
  'mayis',
  'haziran',
  'temmuz',
  'agustos',
  'eylul',
  'ekim',
  'kasim',
  'aralik',
];

const TYPE_WORDS: readonly (readonly [RegExp, readonly SearchType[]])[] = [
  [/^(mail|mailler|maili|mailleri|e-?posta\p{L}*|eposta\p{L}*)$/u, ['email']],
  [/^(toplanti\p{L}*|etkinli\p{L}*|randevu\p{L}*|takvim\p{L}*)$/u, ['event']],
  [/^(gorev\p{L}*|yapilacak\p{L}*)$/u, ['task']],
  [/^(soz|sozu|sozler\p{L}*|sozum\p{L}*|taahhut\p{L}*)$/u, ['commitment']],
  [/^(kargo\p{L}*|ucus\p{L}*|bilet\p{L}*|fatura\p{L}*|odeme\p{L}*|rezervasyon\p{L}*|abonelik\p{L}*|siparis\p{L}*)$/u, ['life_event']],
  [/^(kisi|kisiler|kisiyi)$/u, ['person']],
  [/^(not|notlar\p{L}*|hafiza\p{L}*)$/u, ['memory']],
];

/** Words that keep their content meaning for FTS even when they select a type. */
const KEEP_FOR_TEXT = /^(kargo|ucus|bilet|fatura|odeme|rezervasyon|abonelik|siparis)/u;

interface Range {
  readonly from: Date;
  readonly to: Date;
}

function dayRange(start: string, endInclusive: string, tz: string): Range {
  return { from: startOfLocalDay(start, tz), to: startOfLocalDay(addDaysToLocalDate(endInclusive, 1), tz) };
}

function monthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** Date phrases on the folded text; returns the range and the matched span. */
function dateRange(folded: string, now: Date, tz: string): { range: Range; match: string } | null {
  const today = localDate(now, tz);
  const [y, m] = today.split('-').map(Number) as [number, number];
  const rules: readonly [RegExp, (hit: RegExpExecArray) => Range][] = [
    [/(?<!\p{L})bugun(?:ku)?(?!\p{L})/u, () => dayRange(today, today, tz)],
    [/(?<!\p{L})dun(?:ku)?(?!\p{L})/u, () => dayRange(addDaysToLocalDate(today, -1), addDaysToLocalDate(today, -1), tz)],
    [/(?<!\p{L})(?:son|gecen)\s+(\d{1,3})\s+gun(?:de)?(?!\p{L})/u, (hit) => {
      const n = Number(hit[1] ?? '7');
      return dayRange(addDaysToLocalDate(today, -Math.min(n, 365)), today, tz);
    }],
    [/(?<!\p{L})bu\s+hafta(?:ki)?(?!\p{L})/u, () => dayRange(isoWeekStart(today), addDaysToLocalDate(isoWeekStart(today), 6), tz)],
    [/(?<!\p{L})gecen\s+hafta(?:ki)?(?!\p{L})/u, () => {
      const start = addDaysToLocalDate(isoWeekStart(today), -7);
      return dayRange(start, addDaysToLocalDate(start, 6), tz);
    }],
    [/(?<!\p{L})bu\s+ay(?:ki)?(?!\p{L})/u, () => dayRange(monthStart(y, m), endOfMonthLocalDate(today), tz)],
    [/(?<!\p{L})gecen\s+ay(?:ki)?(?!\p{L})/u, () => {
      const start = m === 1 ? monthStart(y - 1, 12) : monthStart(y, m - 1);
      return dayRange(start, endOfMonthLocalDate(start), tz);
    }],
    [/(?<!\p{L})bu\s+yil(?:ki)?(?!\p{L})/u, () => dayRange(`${y}-01-01`, `${y}-12-31`, tz)],
    [/(?<!\p{L})gecen\s+yil(?:ki)?(?!\p{L})/u, () => dayRange(`${y - 1}-01-01`, `${y - 1}-12-31`, tz)],
  ];
  for (const [re, make] of rules) {
    const hit = re.exec(folded);
    if (hit !== null) return { range: make(hit), match: hit[0] };
  }
  const month = new RegExp(`(?<!\\p{L})(${MONTHS.join('|')})(?:\\p{L}*)(?:\\s+(20\\d{2}))?(?!\\p{L})`, 'u').exec(folded);
  if (month !== null) {
    const index = MONTHS.indexOf(month[1]!) + 1;
    const year = month[2] !== undefined ? Number(month[2]) : index > m ? y - 1 : y;
    const start = monthStart(year, index);
    return { range: dayRange(start, endOfMonthLocalDate(start), tz), match: month[0] };
  }
  const year = /(?<!\d)(20\d{2})(?!\d)/.exec(folded);
  if (year !== null) {
    const yy = Number(year[1]);
    return { range: dayRange(`${yy}-01-01`, `${yy}-12-31`, tz), match: year[0] };
  }
  return null;
}

/** Capitalised words with an optional possessive / "ile" ("Mehmet'in", "Ayşe ile"). */
function personHints(original: string): string[] {
  const out: string[] = [];
  const re = /(?<!\p{L})(\p{Lu}\p{Ll}{1,30})(?:['’](?:in|ın|un|ün|nin|nın|nun|nün|e|a|ye|ya|den|dan|ten|tan|le|la))?(?!\p{L})/gu;
  for (const m of original.matchAll(re)) {
    const name = m[1]!;
    if (m.index === 0 && !/['’]/.test(m[0]) && !/\s+ile(?!\p{L})/u.test(original.slice(m.index + m[0].length, m.index + m[0].length + 5))) {
      // A capitalised first word is usually sentence case, not a name.
      continue;
    }
    out.push(name);
  }
  return [...new Set(out)].slice(0, 3);
}

export function parseSearchQuery(q: string, now: Date, timeZone: string): ParsedQuery {
  const original = normalizeTR(q).trim();
  const folded = foldTR(original);
  const date = dateRange(folded, now, timeZone);
  const words = original.split(/\s+/).filter((w) => w !== '');
  const types = new Set<SearchType>();
  const kept: string[] = [];
  const dateWords = new Set((date?.match ?? '').split(/\s+/).filter((w) => w !== ''));
  for (const word of words) {
    const f = foldTR(word).replace(/['’].*$/u, '').replace(/[^\p{L}\p{N}-]/gu, '');
    if (dateWords.has(foldTR(word)) || dateWords.has(f)) continue;
    const typed = TYPE_WORDS.find(([re]) => re.test(f));
    if (typed !== undefined) {
      for (const t of typed[1]) types.add(t);
      if (KEEP_FOR_TEXT.test(f)) kept.push(word);
      continue;
    }
    kept.push(word);
  }
  const text = kept.join(' ').trim();
  return {
    text: text.length >= 2 ? text : original,
    from: date?.range.from ?? null,
    to: date?.range.to ?? null,
    types: [...types],
    personHints: personHints(original),
  };
}
