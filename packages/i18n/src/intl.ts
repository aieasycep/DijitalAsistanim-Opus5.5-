/**
 * Hermes `Intl` gaps (KNOWN_PLATFORM_LIMITATIONS KPL-27). `ensureIntl()` runs once at app start,
 * before any message or date is formatted, and repairs the two engine features the app relies on:
 *
 * - `Intl.PluralRules` (ICU plurals in use-intl messages). Probed with Turkish and English cardinal
 *   cases and English ordinals; when it is missing or answers wrongly, a Turkish/English
 *   implementation of the CLDR plural rules is installed (the app formats only these two locales).
 * - Time zones in `Intl.DateTimeFormat`. `@date-fns/tz` reads zone offsets through
 *   `timeZoneName: 'longOffset'`. The probe formats fixed instants (Europe/Istanbul +03:00 all
 *   year; Europe/Berlin +01:00 in January and +02:00 in July). When the engine renders wall-clock
 *   time in a zone correctly but lacks `longOffset`, a wrapper derives the offset from
 *   `formatToParts`; when the engine has no zone data at all the report says `unsupported` and the
 *   app tags its error reports, since there is no data to derive the offset from.
 *
 * Relative time never uses `Intl.RelativeTimeFormat` (date-fns, `relative-time.ts`), and the mobile
 * lint config bans the `Intl` constructors Hermes lacks.
 */
import { DEFAULT_LOCALE } from './locales.ts';

export type PluralSupport = 'native' | 'polyfilled';
export type TimeZoneSupport = 'native' | 'offset_shim' | 'unsupported';

export interface IntlReport {
  readonly pluralRules: PluralSupport;
  readonly timeZones: TimeZoneSupport;
}

type PluralLanguage = 'tr' | 'en';
type PluralType = 'cardinal' | 'ordinal';
interface IntlScope {
  Intl?: typeof Intl;
}

const JANUARY = Date.UTC(2026, 0, 15, 12, 0, 0);
const JULY = Date.UTC(2026, 6, 15, 12, 0, 0);

/** Zone, instant and the offset in minutes east of UTC that a correct engine reports. */
export const OFFSET_PROBES: readonly (readonly [string, number, number])[] = [
  ['Europe/Istanbul', JANUARY, 180],
  ['Europe/Berlin', JANUARY, 60],
  ['Europe/Berlin', JULY, 120],
];

const CATEGORIES: Readonly<Record<PluralLanguage, Readonly<Record<PluralType, string[]>>>> = {
  tr: { cardinal: ['one', 'other'], ordinal: ['other'] },
  en: { cardinal: ['one', 'other'], ordinal: ['one', 'two', 'few', 'other'] },
};

function localeList(locales: string | readonly string[] | undefined): readonly string[] {
  if (locales === undefined) return [];
  return typeof locales === 'string' ? [locales] : locales;
}

function pluralLanguageOf(locale: string): PluralLanguage | null {
  const base = locale.toLowerCase().split(/[-_]/)[0];
  return base === 'tr' || base === 'en' ? base : null;
}

/** The first requested Turkish or English locale; the app default otherwise. */
function resolvePluralLanguage(locales: string | readonly string[] | undefined): PluralLanguage {
  for (const locale of localeList(locales)) {
    const language = pluralLanguageOf(locale);
    if (language !== null) return language;
  }
  return DEFAULT_LOCALE;
}

/**
 * CLDR plural category for a number. Turkish: cardinal `one` for 1, ordinals are all `other`.
 * English: cardinal `one` for 1; ordinal `one` (…1 but not …11), `two` (…2 but not …12), `few`
 * (…3 but not …13), else `other`.
 */
export function selectPlural(
  language: PluralLanguage,
  type: PluralType,
  value: number,
): Intl.LDMLPluralRule {
  const n = Math.abs(value);
  if (!Number.isFinite(n)) return 'other';
  if (type === 'cardinal') return n === 1 ? 'one' : 'other';
  if (language === 'tr' || !Number.isInteger(n)) return 'other';
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 === 2 && mod100 !== 12) return 'two';
  if (mod10 === 3 && mod100 !== 13) return 'few';
  return 'other';
}

/** `Intl.PluralRules` for Turkish and English, installed when the engine lacks it. */
export class TrEnPluralRules {
  readonly language: PluralLanguage;
  readonly type: PluralType;

  constructor(locales?: string | readonly string[], options?: { type?: PluralType }) {
    this.language = resolvePluralLanguage(locales);
    this.type = options?.type ?? 'cardinal';
  }

  select(value: number): Intl.LDMLPluralRule {
    return selectPlural(this.language, this.type, value);
  }

  resolvedOptions() {
    return {
      locale: this.language,
      type: this.type,
      pluralCategories: [...CATEGORIES[this.language][this.type]],
      minimumIntegerDigits: 1,
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    };
  }

  static supportedLocalesOf(locales?: string | readonly string[]): string[] {
    return localeList(locales).filter((locale) => pluralLanguageOf(locale) !== null);
  }
}

/** Whether the engine's `Intl.PluralRules` answers the Turkish and English cases correctly. */
export function probePluralRules(intl: typeof Intl): boolean {
  try {
    const tr = new intl.PluralRules('tr');
    const en = new intl.PluralRules('en');
    const ordinal = new intl.PluralRules('en', { type: 'ordinal' });
    return (
      tr.select(1) === 'one' &&
      tr.select(2) === 'other' &&
      en.select(1) === 'one' &&
      en.select(0) === 'other' &&
      ordinal.select(2) === 'two' &&
      ordinal.select(13) === 'other'
    );
  } catch {
    return false;
  }
}

/** Minutes east of UTC in a `longOffset` string ("1/15/2026, GMT+03:00"; bare "GMT" is 0). */
export function parseGmtOffset(text: string): number | null {
  const match = /GMT(?:([+-])(\d{1,2})(?::?(\d{2}))?)?/.exec(text);
  if (match === null) return null;
  if (match[1] === undefined) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? '0');
  return match[1] === '-' ? -minutes : minutes;
}

/** The `longOffset` text for minutes east of UTC ("GMT+03:00", "GMT-02:30", "GMT"). */
export function formatGmtOffset(minutes: number): string {
  if (minutes === 0) return 'GMT';
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const rest = String(abs % 60).padStart(2, '0');
  return `GMT${sign}${hours}:${rest}`;
}

function longOffsetMinutes(intl: typeof Intl, timeZone: string, at: number): number | null {
  try {
    const text = new intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).format(
      at,
    );
    return parseGmtOffset(text);
  } catch {
    return null;
  }
}

/** Minutes east of UTC derived from the zone's wall-clock date and time at `at`, or null. */
export function wallClockOffset(
  Format: typeof Intl.DateTimeFormat,
  timeZone: string,
  at: number,
): number | null {
  try {
    const parts = new Format('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(at);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value);
    const wall = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour') % 24,
      part('minute'),
      part('second'),
    );
    if (Number.isNaN(wall)) return null;
    return Math.round((wall - Math.floor(at / 1000) * 1000) / 60_000);
  } catch {
    return null;
  }
}

/** How the engine handles the zones the app formats in. */
export function probeTimeZones(intl: typeof Intl): TimeZoneSupport {
  if (OFFSET_PROBES.every(([zone, at, want]) => longOffsetMinutes(intl, zone, at) === want)) {
    return 'native';
  }
  const Format = intl.DateTimeFormat as typeof Intl.DateTimeFormat | undefined;
  if (Format === undefined) return 'unsupported';
  return OFFSET_PROBES.every(([zone, at, want]) => wallClockOffset(Format, zone, at) === want)
    ? 'offset_shim'
    : 'unsupported';
}

function install(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, configurable: true });
}

/**
 * Wraps `Intl.DateTimeFormat` so `timeZoneName: 'longOffset'` formatters answer "GMT±HH:MM" from
 * the wall-clock parts; every other formatter is the engine's own.
 */
export function installOffsetShim(intl: typeof Intl): void {
  const Native = intl.DateTimeFormat;
  function DateTimeFormat(
    locales?: string | readonly string[],
    options?: Intl.DateTimeFormatOptions,
  ): unknown {
    if (options?.timeZoneName !== 'longOffset') {
      return new Native(locales as string | string[] | undefined, options);
    }
    const timeZone = options.timeZone ?? new Native().resolvedOptions().timeZone;
    const format = (date?: Date | number) => {
      const at = date === undefined ? Date.now() : typeof date === 'number' ? date : date.getTime();
      const minutes = wallClockOffset(Native, timeZone, at);
      if (minutes === null) throw new RangeError(`Unsupported time zone: ${timeZone}`);
      return formatGmtOffset(minutes);
    };
    return {
      format,
      formatToParts: (date?: Date | number) => [{ type: 'timeZoneName', value: format(date) }],
      resolvedOptions: () => ({ ...new Native('en-US', { timeZone }).resolvedOptions() }),
    };
  }
  DateTimeFormat.prototype = Native.prototype;
  DateTimeFormat.supportedLocalesOf = Native.supportedLocalesOf.bind(Native);
  install(intl, 'DateTimeFormat', DateTimeFormat);
}

const reports = new WeakMap<object, IntlReport>();

/**
 * Probes and repairs the engine's `Intl` once per scope (the global object by default) and
 * returns what it found; later calls return the first report.
 */
export function ensureIntl(scope: IntlScope = globalThis): IntlReport {
  let intl = scope.Intl;
  if (intl === undefined) {
    const created = {} as typeof Intl;
    install(scope, 'Intl', created);
    intl = created;
  }
  const known = reports.get(intl);
  if (known !== undefined) return known;
  let pluralRules: PluralSupport = 'native';
  if (!probePluralRules(intl)) {
    install(intl, 'PluralRules', TrEnPluralRules);
    pluralRules = 'polyfilled';
  }
  const timeZones = probeTimeZones(intl);
  if (timeZones === 'offset_shim') installOffsetShim(intl);
  const report: IntlReport = { pluralRules, timeZones };
  reports.set(intl, report);
  return report;
}

/** Whether the report used any fallback (`pluralRules` shim, offset shim, missing zones). */
export function intlFallbacks(report: IntlReport): string | null {
  const used = [
    report.pluralRules === 'polyfilled' ? 'plural_rules' : null,
    report.timeZones === 'native' ? null : `tz_${report.timeZones}`,
  ].filter((item): item is string => item !== null);
  return used.length === 0 ? null : used.join(',');
}
