/**
 * Turkish date expression parser (AI_PIPELINE_PLAN §6.9.1; TEST_PLAN §2.3). "Model locates, code
 * computes": the LLM returns a verbatim quote and this parser resolves it against an explicit
 * anchor (mail `Date` in the user's zone, capture time, event end) — never against a hidden clock.
 *
 * Matching runs on `foldTR(normTR(text))` with Unicode letter boundaries, so Turkish spellings,
 * upper case ("PAZARTESİ") and ASCII-folded input ("carsamba") resolve identically. Overlapping
 * candidates are resolved longest-first ("Cumartesi" never yields "Cuma").
 */
import {
  addDaysToLocalDate,
  atLocalTime,
  endOfMonthLocalDate,
  formatLocalDate,
  type Instant,
  isoWeekdayOf,
  isoWeekStart,
  localDate,
  localDateDiffDays,
  localParts,
  parseLocalDate,
  toDate,
  zonedWallTimeToInstant,
} from '../time/zone.ts';
import { foldTR, LB, normTR, originalSpan, RB } from './normalize-tr.ts';
import { findTimeTokens, type TimeToken } from './time-tr.ts';

export type DatePrecision = 'datetime' | 'day' | 'week' | 'month';

export type DateRuleId =
  | 'R_ISO'
  | 'R_DMY_NUM'
  | 'R_DMY_NAME'
  | 'R_REL_DAY'
  | 'R_REL_N'
  | 'R_REL_HOURS'
  | 'R_WEEKDAY'
  | 'R_THIS_WEEKDAY'
  | 'R_NEXT_WEEKDAY'
  | 'R_HAFTAYA'
  | 'R_HAFTAYA_BUGUN'
  | 'R_NEXT_WEEK'
  | 'R_WEEKEND'
  | 'R_WEEKEND_BY'
  | 'R_MONTH_END'
  | 'R_DOM'
  | 'R_EOD'
  | 'R_TIME_ONLY';

export interface DateResolution {
  readonly ruleId: DateRuleId;
  /** Matched text in the original input. */
  readonly text: string;
  /** [start, end) in the original input. */
  readonly span: readonly [number, number];
  readonly precision: DatePrecision;
  /** First local date covered. */
  readonly localDate: string;
  /** Last local date covered (inclusive) for week/weekend/month ranges. */
  readonly endLocalDate: string;
  /** `HH:mm` when precision is `datetime`. */
  readonly localTime: string | null;
  /** Range end `HH:mm` ("14:00–18:00"). */
  readonly endLocalTime: string | null;
  /** Start instant (00:00 local for day/week/month precision). */
  readonly start: Date;
  /** Exclusive end instant of the covered interval. */
  readonly end: Date;
  /** Deadline semantics ("kadar", "en geç", "son gün", "-e dek"). */
  readonly by: boolean;
  readonly ambiguous: boolean;
  /** Resolves before the anchor ("dün", an already-passed "10 Eylül"). */
  readonly past: boolean;
  /** Year was not written and was inferred (rolled to next year when > 60 days past). */
  readonly yearInferred: boolean;
}

export interface DateParseOptions {
  /** Resolution anchor (mail Date header, capture time, event end). */
  readonly anchor: Instant;
  /** User time zone (IANA). */
  readonly timeZone: string;
  /** Local time used for day-precision deadlines (default 18:00). */
  readonly deadlineTime?: string;
}

const MONTHS: readonly (readonly string[])[] = [
  ['ocak', 'oca'],
  ['subat', 'sub'],
  ['mart', 'mar'],
  ['nisan', 'nis'],
  ['mayis', 'may'],
  ['haziran', 'haz'],
  ['temmuz', 'tem'],
  ['agustos', 'agu'],
  ['eylul', 'eyl'],
  ['ekim', 'eki'],
  ['kasim', 'kas'],
  ['aralik', 'ara'],
];
const MONTH_INDEX = new Map<string, number>();
MONTHS.forEach((names, i) => {
  for (const n of names) MONTH_INDEX.set(n, i + 1);
});
const MONTH_ALT = [...MONTH_INDEX.keys()].sort((a, b) => b.length - a.length).join('|');

/** Longest first so "cumartesi" wins over "cuma". */
const WEEKDAYS: readonly [string, number][] = [
  ['cumartesi', 6],
  ['pazartesi', 1],
  ['carsamba', 3],
  ['persembe', 4],
  ['cuma', 5],
  ['sali', 2],
  ['pazar', 7],
];
const WEEKDAY_INDEX = new Map(WEEKDAYS);
const WEEKDAY_ALT = WEEKDAYS.map(([w]) => w).join('|');
/** Case endings after a weekday / relative word ("Cuma'ya", "Pazartesiye", "yarına"). */
const CASE = "(?:'?(?:ya|ye|a|e|da|de|ta|te|dan|den|tan|ten|yi|yu|i|u|ki))?";
const BY_TAIL = '(\\s+(?:kadar|dek|degin))?';
const DAY_TAIL = '(?:\\s+gunu)?';

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  bir: 1,
  iki: 2,
  uc: 3,
  dort: 4,
  bes: 5,
  alti: 6,
  yedi: 7,
  sekiz: 8,
  dokuz: 9,
  on: 10,
};
const NUMWORD_ALT = Object.keys(NUMBER_WORDS).join('|');

function rx(source: string): RegExp {
  return new RegExp(source, 'gu');
}

interface RuleDef {
  readonly id: DateRuleId;
  readonly re: RegExp;
}

const RULES: readonly RuleDef[] = [
  { id: 'R_ISO', re: rx('(?<![\\d./-])(\\d{4})-(\\d{2})-(\\d{2})(?![\\d])') },
  {
    id: 'R_DMY_NUM',
    re: rx(
      '(?<![\\d./-])(0?[1-9]|[12]\\d|3[01])([./-])(0?[1-9]|1[0-2])(?:\\2(\\d{4}|\\d{2}))?(?![\\d]|[.,]\\d)',
    ),
  },
  {
    id: 'R_DMY_NAME',
    re: rx(`(?<![\\d.])(\\d{1,2})\\s*(${MONTH_ALT})\\.?(?:'\\p{L}+)?${RB}(?:\\s+(\\d{4}))?`),
  },
  { id: 'R_HAFTAYA_BUGUN', re: rx(`${LB}haftaya bugun${RB}`) },
  {
    id: 'R_NEXT_WEEKDAY',
    re: rx(
      `${LB}(?:haftaya|gelecek hafta|onumuzdeki hafta|gelecek haftanin|onumuzdeki haftanin)\\s+(${WEEKDAY_ALT})${CASE}${DAY_TAIL}${BY_TAIL}${RB}`,
    ),
  },
  {
    id: 'R_THIS_WEEKDAY',
    re: rx(`${LB}(bu|gelecek|onumuzdeki)\\s+(${WEEKDAY_ALT})${CASE}${DAY_TAIL}${BY_TAIL}${RB}`),
  },
  { id: 'R_WEEKDAY', re: rx(`${LB}(${WEEKDAY_ALT})${CASE}${DAY_TAIL}${BY_TAIL}${RB}`) },
  { id: 'R_WEEKEND_BY', re: rx(`${LB}hafta sonuna (?:kadar|dek)${RB}`) },
  { id: 'R_WEEKEND', re: rx(`${LB}hafta sonu(?:nda)?${RB}`) },
  {
    id: 'R_NEXT_WEEK',
    re: rx(`${LB}(?:(gelecek|onumuzdeki) hafta(?:ya)?|haftaya)(\\s+(?:kadar|dek))?${RB}`),
  },
  {
    id: 'R_MONTH_END',
    re: rx(`${LB}(?:ay sonu|ayin sonu)(?:na|nda)?(\\s+(?:kadar|dek))?${RB}`),
  },
  {
    id: 'R_DOM',
    re: rx(
      `${LB}(?:ayin\\s+(\\d{1,2})(?:'?(?:si|su|i|u|nda|nde|inda|inde|unda|una|une|ine|sine|suna))?${BY_TAIL}${RB}|(?<![\\d.])(\\d{1,2})'?(ine|una|une|sine|suna)\\s+(?:kadar|dek)${RB})`,
    ),
  },
  {
    id: 'R_REL_N',
    re: rx(
      `${LB}(\\d{1,3}|${NUMWORD_ALT})\\s*(gun|hafta)\\s*(icinde|icerisinde|sonra|sonraya)${RB}`,
    ),
  },
  {
    id: 'R_REL_HOURS',
    re: rx(`${LB}(\\d{1,2}|${NUMWORD_ALT})\\s*saat\\s*(icinde|icerisinde|sonra)${RB}`),
  },
  {
    id: 'R_REL_DAY',
    re: rx(`${LB}(bugun|yarin|obur gun|oburgun|ertesi gun|dun)${CASE}${BY_TAIL}${RB}`),
  },
];

/** Rule preference when two candidates have the same length (lower wins). */
const RULE_RANK: Readonly<Partial<Record<DateRuleId, number>>> = {
  R_NEXT_WEEKDAY: 0,
  R_HAFTAYA_BUGUN: 0,
  R_THIS_WEEKDAY: 1,
  R_WEEKEND_BY: 1,
  R_ISO: 1,
  R_DMY_NAME: 2,
  R_DMY_NUM: 3,
};

interface Candidate {
  readonly id: DateRuleId;
  readonly from: number;
  readonly to: number;
  readonly m: RegExpMatchArray;
}

interface DateCore {
  precision: DatePrecision;
  localDate: string;
  endLocalDate: string;
  time: { hour: number; minute: number } | null;
  by: boolean;
  ambiguous: boolean;
  past: boolean;
  yearInferred: boolean;
}

function dayCore(date: string, extra: Partial<DateCore> = {}): DateCore {
  return {
    precision: 'day',
    localDate: date,
    endLocalDate: date,
    time: null,
    by: false,
    ambiguous: false,
    past: false,
    yearInferred: false,
    ...extra,
  };
}

function numberValue(token: string): number {
  return NUMBER_WORDS[token] ?? Number(token);
}

function validYmd(year: number, month: number, day: number): string | null {
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return formatLocalDate(year, month, day);
}

/** Year inference: nearest occurrence; more than 60 days in the past rolls to next year. */
function inferYear(
  anchorDate: string,
  month: number,
  day: number,
): { date: string; rolled: boolean } | null {
  const { year } = parseLocalDate(anchorDate);
  const thisYear = validYmd(year, month, day);
  if (!thisYear) {
    const next = validYmd(year + 1, month, day); // 29 Şubat
    return next ? { date: next, rolled: true } : null;
  }
  const diff = localDateDiffDays(anchorDate, thisYear);
  if (diff < -60) {
    const next = validYmd(year + 1, month, day);
    return next ? { date: next, rolled: true } : null;
  }
  return { date: thisYear, rolled: false };
}

function hasBy(m: RegExpMatchArray, group: number): boolean {
  return m[group] !== undefined && m[group] !== '';
}

function resolveCandidate(c: Candidate, anchorDate: string): DateCore | null {
  const m = c.m;
  const anchorDow = isoWeekdayOf(anchorDate);
  switch (c.id) {
    case 'R_ISO': {
      const date = validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
      return date ? dayCore(date, { past: date < anchorDate }) : null;
    }
    case 'R_DMY_NUM': {
      const day = Number(m[1]);
      const month = Number(m[3]);
      const yText = m[4];
      if (yText !== undefined) {
        const year = yText.length === 2 ? 2000 + Number(yText) : Number(yText);
        const date = validYmd(year, month, day);
        return date ? dayCore(date, { past: date < anchorDate }) : null;
      }
      const inferred = inferYear(anchorDate, month, day);
      return inferred
        ? dayCore(inferred.date, { past: inferred.date < anchorDate, yearInferred: true })
        : null;
    }
    case 'R_DMY_NAME': {
      const day = Number(m[1]);
      const month = MONTH_INDEX.get(m[2] ?? '') ?? 0;
      if (m[3] !== undefined) {
        const date = validYmd(Number(m[3]), month, day);
        return date ? dayCore(date, { past: date < anchorDate }) : null;
      }
      const inferred = inferYear(anchorDate, month, day);
      return inferred
        ? dayCore(inferred.date, { past: inferred.date < anchorDate, yearInferred: true })
        : null;
    }
    case 'R_REL_DAY': {
      const REL: Readonly<Record<string, number>> = {
        bugun: 0,
        dun: -1,
        yarin: 1,
        'ertesi gun': 1,
        'obur gun': 2,
        oburgun: 2,
      };
      const offset = REL[m[1] ?? ''] ?? 0;
      return dayCore(addDaysToLocalDate(anchorDate, offset), { by: hasBy(m, 2), past: offset < 0 });
    }
    case 'R_REL_N': {
      const n = numberValue(m[1] ?? '');
      if (!Number.isFinite(n) || n < 1 || n > 365) return null;
      const within = (m[3] ?? '').startsWith('ic');
      if (m[2] === 'hafta') {
        const date = addDaysToLocalDate(anchorDate, 7 * n);
        return dayCore(date, { precision: 'week', by: within });
      }
      return dayCore(addDaysToLocalDate(anchorDate, n), { by: within });
    }
    case 'R_REL_HOURS':
      return null; // resolved with the anchor instant in parseDatesTR
    case 'R_WEEKDAY': {
      const target = WEEKDAY_INDEX.get(m[1] ?? '') ?? 0;
      let delta = (target - anchorDow + 7) % 7;
      const same = delta === 0;
      if (same) delta = 7;
      return dayCore(addDaysToLocalDate(anchorDate, delta), { by: hasBy(m, 2), ambiguous: same });
    }
    case 'R_THIS_WEEKDAY': {
      const target = WEEKDAY_INDEX.get(m[2] ?? '') ?? 0;
      if (m[1] === 'bu') {
        const date = addDaysToLocalDate(isoWeekStart(anchorDate), target - 1);
        const past = date < anchorDate;
        return dayCore(date, { by: hasBy(m, 3), past, ambiguous: past });
      }
      // "gelecek/önümüzdeki Cuma": the next occurrence; may also mean next week's → ambiguous
      let delta = (target - anchorDow + 7) % 7;
      if (delta === 0) delta = 7;
      return dayCore(addDaysToLocalDate(anchorDate, delta), { by: hasBy(m, 3), ambiguous: true });
    }
    case 'R_NEXT_WEEKDAY': {
      const target = WEEKDAY_INDEX.get(m[1] ?? '') ?? 0;
      const nextMonday = addDaysToLocalDate(isoWeekStart(anchorDate), 7);
      return dayCore(addDaysToLocalDate(nextMonday, target - 1), { by: hasBy(m, 2) });
    }
    case 'R_HAFTAYA_BUGUN':
      return dayCore(addDaysToLocalDate(anchorDate, 7));
    case 'R_NEXT_WEEK': {
      const nextMonday = addDaysToLocalDate(isoWeekStart(anchorDate), 7);
      const kadar = hasBy(m, 2);
      if (m[1] === undefined && !kadar) {
        // "haftaya" alone: anchor + 7, week precision, ambiguous (UT-DATE-06)
        return dayCore(addDaysToLocalDate(anchorDate, 7), { precision: 'week', ambiguous: true });
      }
      if (kadar) {
        // "haftaya kadar" / "gelecek haftaya kadar": business deadline Friday 18:00
        return {
          ...dayCore(addDaysToLocalDate(nextMonday, 4)),
          precision: 'datetime',
          time: { hour: 18, minute: 0 },
          by: true,
          ambiguous: true,
        };
      }
      return dayCore(nextMonday, {
        precision: 'week',
        endLocalDate: addDaysToLocalDate(nextMonday, 6),
      });
    }
    case 'R_WEEKEND': {
      const delta = anchorDow === 7 ? 6 : 6 - anchorDow;
      const saturday = addDaysToLocalDate(anchorDate, delta);
      return dayCore(saturday, { endLocalDate: addDaysToLocalDate(saturday, 1) });
    }
    case 'R_WEEKEND_BY': {
      const delta = (5 - anchorDow + 7) % 7;
      return {
        ...dayCore(addDaysToLocalDate(anchorDate, delta)),
        precision: 'datetime',
        time: { hour: 18, minute: 0 },
        by: true,
        ambiguous: true,
      };
    }
    case 'R_MONTH_END':
      return dayCore(endOfMonthLocalDate(anchorDate), { by: hasBy(m, 1) });
    case 'R_DOM': {
      const day = Number(m[1] ?? m[3]);
      const by = hasBy(m, 2) || m[3] !== undefined;
      const { year, month } = parseLocalDate(anchorDate);
      let date = validYmd(year, month, day);
      if (!date || date < anchorDate) {
        const nm = month === 12 ? 1 : month + 1;
        const ny = month === 12 ? year + 1 : year;
        date = validYmd(ny, nm, day);
      }
      return date ? dayCore(date, { by }) : null;
    }
    case 'R_HAFTAYA':
    case 'R_EOD':
    case 'R_TIME_ONLY':
      return null;
  }
}

const DEADLINE_BEFORE =
  /(?:en gec|son gun|son tarih(?:i)?|son teslim(?: tarihi)?|deadline)\s*[:：-]?\s*$/u;
const DEADLINE_AFTER = /^\s*(?:'?(?:e|a|ye|ya))?\s*(?:kadar|dek|degin)(?!\p{L})/u;

interface Merged {
  from: number;
  to: number;
  id: DateRuleId;
  core: DateCore;
  timeToken: TimeToken | null;
}

const GAP_OK = /^[\s,]*(?:saat\s*)?$/u;

/**
 * All date/time expressions in `text`, resolved against the anchor. Date and adjacent time
 * expressions merge into one `datetime` resolution ("bugün 17:00'ye kadar", "Cuma akşamı").
 */
export function parseDatesTR(text: string, opts: DateParseOptions): DateResolution[] {
  const norm = normTR(text);
  const folded = foldTR(norm.text);
  const anchor = toDate(opts.anchor);
  const anchorDate = localDate(anchor, opts.timeZone);
  const anchorParts = localParts(anchor, opts.timeZone);

  const times = findTimeTokens(folded);
  const blockedByTime = (from: number, to: number): boolean =>
    times.some((t) =>
      t.ruleId === 'T_CLOCK' || t.ruleId === 'T_RANGE' ? from < t.to && t.from < to : false,
    );

  // 1. collect date candidates
  const candidates: Candidate[] = [];
  for (const rule of RULES) {
    for (const m of folded.matchAll(rule.re)) {
      const from = m.index;
      const to = from + m[0].length;
      if ((rule.id === 'R_DMY_NUM' || rule.id === 'R_ISO') && blockedByTime(from, to)) continue;
      candidates.push({ id: rule.id, from, to, m });
    }
  }
  candidates.sort(
    (a, b) =>
      b.to - b.from - (a.to - a.from) ||
      (RULE_RANK[a.id] ?? 5) - (RULE_RANK[b.id] ?? 5) ||
      a.from - b.from,
  );
  const chosen: Candidate[] = [];
  for (const c of candidates) {
    if (chosen.some((x) => c.from < x.to && x.from < c.to)) continue;
    // date words inside a time token (e.g. "gün sonu") belong to the time
    if (times.some((t) => t.ruleId === 'T_EOD' && c.from < t.to && t.from < c.to)) continue;
    chosen.push(c);
  }
  chosen.sort((a, b) => a.from - b.from);

  // 2. resolve date cores
  const merged: Merged[] = [];
  for (const c of chosen) {
    if (c.id === 'R_REL_HOURS') {
      const n = numberValue(c.m[1] ?? '');
      if (!Number.isFinite(n) || n < 1 || n > 72) continue;
      const at = new Date(anchor.getTime() + n * 3_600_000);
      const p = localParts(at, opts.timeZone);
      merged.push({
        from: c.from,
        to: c.to,
        id: c.id,
        core: {
          ...dayCore(localDate(at, opts.timeZone)),
          precision: 'datetime',
          time: { hour: p.hour, minute: p.minute },
          by: (c.m[2] ?? '').startsWith('ic'),
        },
        timeToken: null,
      });
      continue;
    }
    const core = resolveCandidate(c, anchorDate);
    // "haftaya" alone is reported as R_HAFTAYA (same regex as R_NEXT_WEEK)
    const id: DateRuleId =
      c.id === 'R_NEXT_WEEK' && c.m[1] === undefined && !hasBy(c.m, 2) ? 'R_HAFTAYA' : c.id;
    if (core) merged.push({ from: c.from, to: c.to, id, core, timeToken: null });
  }

  // 3. attach time tokens to adjacent dates, or to the anchor date
  const usedTimes = new Set<TimeToken>();
  for (const d of merged) {
    if (d.core.time !== null) continue;
    const after = times.find(
      (t) =>
        !usedTimes.has(t) &&
        t.from >= d.to &&
        GAP_OK.test(folded.slice(d.to, t.from)) &&
        t.from - d.to <= 8,
    );
    const before = times.find(
      (t) =>
        !usedTimes.has(t) &&
        t.to <= d.from &&
        GAP_OK.test(folded.slice(t.to, d.from)) &&
        d.from - t.to <= 3,
    );
    const t = after ?? before;
    if (!t) continue;
    usedTimes.add(t);
    d.timeToken = t;
    d.from = Math.min(d.from, t.from);
    d.to = Math.max(d.to, t.to);
    d.core = {
      ...d.core,
      precision: 'datetime',
      endLocalDate: d.core.localDate,
      time: { hour: t.hour, minute: t.minute },
      by: d.core.by || t.by,
      ambiguous: d.core.ambiguous || t.ambiguous,
    };
  }
  for (const t of times) {
    if (usedTimes.has(t)) continue;
    const isEod = t.ruleId === 'T_EOD';
    const core: DateCore = {
      ...dayCore(anchorDate),
      precision: 'datetime',
      time: { hour: t.hour, minute: t.minute },
      by: t.by,
      ambiguous: t.ambiguous,
    };
    const minutesNow = anchorParts.hour * 60 + anchorParts.minute;
    core.past = t.hour * 60 + t.minute < minutesNow;
    merged.push({
      from: t.from,
      to: t.to,
      id: isEod ? 'R_EOD' : 'R_TIME_ONLY',
      core,
      timeToken: t,
    });
  }
  merged.sort((a, b) => a.from - b.from);

  // 4. deadline markers around the expression and final shaping
  return merged.map((d) => {
    const before = folded.slice(Math.max(0, d.from - 24), d.from);
    const after = folded.slice(d.to, d.to + 16);
    const by = d.core.by || DEADLINE_BEFORE.test(before) || DEADLINE_AFTER.test(after);
    const shaped = shape(d, { ...d.core, by }, norm, opts, anchorDate, anchor);
    return { ...shaped, text: text.slice(shaped.span[0], shaped.span[1]) };
  });
}

function shape(
  d: Merged,
  core: DateCore,
  norm: ReturnType<typeof normTR>,
  opts: DateParseOptions,
  anchorDate: string,
  anchor: Date,
): DateResolution {
  const tz = opts.timeZone;
  const pad = (n: number): string => String(n).padStart(2, '0');
  const localTime = core.time ? `${pad(core.time.hour)}:${pad(core.time.minute)}` : null;
  const t = d.timeToken;
  const endLocalTime =
    t?.endHour !== undefined && t.endMinute !== undefined
      ? `${pad(t.endHour)}:${pad(t.endMinute)}`
      : null;
  const start = localTime
    ? zonedWallTimeToInstant(core.localDate, localTime, tz)
    : zonedWallTimeToInstant(core.localDate, '00:00', tz);
  let end: Date;
  if (endLocalTime) end = zonedWallTimeToInstant(core.localDate, endLocalTime, tz);
  else if (localTime) end = start;
  else end = zonedWallTimeToInstant(addDaysToLocalDate(core.endLocalDate, 1), '00:00', tz);
  const past =
    core.past ||
    (localTime !== null && start.getTime() < anchor.getTime() && core.localDate <= anchorDate);
  const [s, e] = originalSpan(norm, d.from, d.to);
  return {
    ruleId: d.id,
    text: '',
    span: [s, e],
    precision: core.precision,
    localDate: core.localDate,
    endLocalDate: core.endLocalDate,
    localTime,
    endLocalTime,
    start,
    end,
    by: core.by,
    ambiguous: core.ambiguous,
    past,
    yearInferred: core.yearInferred,
  };
}

export type SingleDateResult =
  | { readonly status: 'none' }
  | { readonly status: 'one'; readonly value: DateResolution }
  | { readonly status: 'ambiguous'; readonly values: readonly DateResolution[] };

function sameValue(a: DateResolution, b: DateResolution): boolean {
  return a.start.getTime() === b.start.getTime() && a.precision === b.precision;
}

/**
 * `resolveDateTR(quote, anchor)`: the grounding verifier's re-derivation (§6.4). It must yield
 * exactly one value; several different values are `ambiguous` (the field is then dropped).
 */
export function resolveDateTR(quote: string, opts: DateParseOptions): SingleDateResult {
  const all = parseDatesTR(quote, opts);
  if (all.length === 0) return { status: 'none' };
  const first = all[0];
  if (first && all.every((r) => sameValue(r, first))) return { status: 'one', value: first };
  return { status: 'ambiguous', values: all };
}

/**
 * The instant a resolution is due: its own time for `datetime`; otherwise 18:00 local on the last
 * day of the covered range (a day-precision deadline is due 18:00, §6.9.1). Weeks end on Friday.
 */
export function dueInstant(r: DateResolution, timeZone: string, deadlineTime = '18:00'): Date {
  if (r.precision === 'datetime') return r.start;
  let day = r.endLocalDate;
  if (r.precision === 'week' && r.endLocalDate !== r.localDate) {
    day = addDaysToLocalDate(r.localDate, 4);
  }
  return atLocalTime(day, deadlineTime, timeZone);
}
