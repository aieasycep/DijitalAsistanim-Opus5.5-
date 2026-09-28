import { tzOffset } from '@date-fns/tz';
import { describe, expect, it } from 'vitest';

import {
  OFFSET_PROBES,
  TrEnPluralRules,
  ensureIntl,
  formatGmtOffset,
  installOffsetShim,
  intlFallbacks,
  parseGmtOffset,
  probePluralRules,
  probeTimeZones,
  selectPlural,
  wallClockOffset,
} from '../src/intl.ts';

const JANUARY = Date.UTC(2026, 0, 15, 12, 0, 0);
const NativeFormat = Intl.DateTimeFormat;

interface FakeOptions {
  readonly plural?: boolean;
  readonly longOffset?: boolean;
  readonly zones?: boolean;
  readonly dateTimeFormat?: boolean;
}

/** An `Intl` namespace shaped like an engine with the given gaps (Node's own data underneath). */
function fakeIntl({
  plural = true,
  longOffset = true,
  zones = true,
  dateTimeFormat = true,
}: FakeOptions = {}): typeof Intl {
  function DateTimeFormat(locales?: string, options?: Intl.DateTimeFormatOptions) {
    if (options?.timeZoneName === 'longOffset' && !longOffset) throw new RangeError('longOffset');
    return new NativeFormat(locales, zones ? options : { ...options, timeZone: 'UTC' });
  }
  DateTimeFormat.prototype = NativeFormat.prototype;
  DateTimeFormat.supportedLocalesOf = NativeFormat.supportedLocalesOf.bind(NativeFormat);
  const intl: Record<string, unknown> = {};
  if (dateTimeFormat) intl.DateTimeFormat = DateTimeFormat;
  if (plural) intl.PluralRules = Intl.PluralRules;
  return intl as unknown as typeof Intl;
}

describe('selectPlural (CLDR tr/en)', () => {
  const values = [...Array.from({ length: 230 }, (_, i) => i), 1011, 1.5, 0.5, 2.25, -1, -2, -3];

  it('matches the full-ICU engine for every tr/en cardinal and ordinal case', () => {
    for (const language of ['tr', 'en'] as const) {
      for (const type of ['cardinal', 'ordinal'] as const) {
        const reference = new Intl.PluralRules(language, { type });
        for (const value of values) {
          expect([language, type, value, selectPlural(language, type, value)]).toEqual([
            language,
            type,
            value,
            reference.select(value),
          ]);
        }
      }
    }
  });

  it('answers other for non-finite numbers', () => {
    expect(selectPlural('en', 'cardinal', Number.NaN)).toBe('other');
    expect(selectPlural('tr', 'ordinal', Number.POSITIVE_INFINITY)).toBe('other');
  });
});

describe('TrEnPluralRules', () => {
  it('resolves the first Turkish or English locale, else the app default', () => {
    expect(new TrEnPluralRules(['de-DE', 'en-GB']).resolvedOptions().locale).toBe('en');
    expect(new TrEnPluralRules('tr_TR').resolvedOptions().locale).toBe('tr');
    expect(new TrEnPluralRules().resolvedOptions().locale).toBe('tr');
    expect(new TrEnPluralRules('fr').resolvedOptions().locale).toBe('tr');
  });

  it('selects by type and exposes the categories', () => {
    const ordinal = new TrEnPluralRules('en', { type: 'ordinal' });
    expect([1, 2, 3, 4, 11, 22].map((n) => ordinal.select(n))).toEqual([
      'one',
      'two',
      'few',
      'other',
      'other',
      'two',
    ]);
    expect(ordinal.resolvedOptions()).toMatchObject({
      type: 'ordinal',
      pluralCategories: ['one', 'two', 'few', 'other'],
      minimumIntegerDigits: 1,
    });
    const tr = new TrEnPluralRules('tr');
    expect([tr.select(1), tr.select(5)]).toEqual(['one', 'other']);
    expect(tr.resolvedOptions().pluralCategories).toEqual(['one', 'other']);
  });

  it('lists only Turkish and English as supported', () => {
    expect(TrEnPluralRules.supportedLocalesOf(['tr-TR', 'de', 'en'])).toEqual(['tr-TR', 'en']);
    expect(TrEnPluralRules.supportedLocalesOf('en-US')).toEqual(['en-US']);
    expect(TrEnPluralRules.supportedLocalesOf()).toEqual([]);
  });
});

describe('probePluralRules', () => {
  it('accepts a correct engine and the shim', () => {
    expect(probePluralRules(Intl)).toBe(true);
    expect(probePluralRules({ PluralRules: TrEnPluralRules } as unknown as typeof Intl)).toBe(true);
  });

  it('rejects a missing or wrong implementation', () => {
    expect(probePluralRules(fakeIntl({ plural: false }))).toBe(false);
    class AlwaysOther {
      select() {
        return 'other';
      }
    }
    expect(probePluralRules({ PluralRules: AlwaysOther } as unknown as typeof Intl)).toBe(false);
  });
});

describe('GMT offsets', () => {
  it('parses longOffset text', () => {
    expect(parseGmtOffset('1/15/2026, GMT+03:00')).toBe(180);
    expect(parseGmtOffset('GMT-02:30')).toBe(-150);
    expect(parseGmtOffset('GMT+5')).toBe(300);
    expect(parseGmtOffset('1/15/2026, GMT')).toBe(0);
    expect(parseGmtOffset('UTC')).toBeNull();
  });

  it('formats minutes the way engines do', () => {
    expect(formatGmtOffset(180)).toBe('GMT+03:00');
    expect(formatGmtOffset(-150)).toBe('GMT-02:30');
    expect(formatGmtOffset(330)).toBe('GMT+05:30');
    expect(formatGmtOffset(0)).toBe('GMT');
  });

  it('derives offsets from wall-clock parts', () => {
    for (const [zone, at, want] of OFFSET_PROBES) {
      expect(wallClockOffset(NativeFormat, zone, at)).toBe(want);
    }
    expect(wallClockOffset(NativeFormat, 'America/New_York', JANUARY + 123)).toBe(-300);
    expect(wallClockOffset(NativeFormat, 'Not/AZone', JANUARY)).toBeNull();
  });

  it('returns null when the parts are unusable', () => {
    const Broken = function Broken() {
      return { formatToParts: () => [{ type: 'literal', value: '?' }] };
    } as unknown as typeof Intl.DateTimeFormat;
    expect(wallClockOffset(Broken, 'Europe/Istanbul', JANUARY)).toBeNull();
  });
});

describe('probeTimeZones', () => {
  it('reports native longOffset support', () => {
    expect(probeTimeZones(Intl)).toBe('native');
  });

  it('falls back to the offset shim when only longOffset is missing', () => {
    expect(probeTimeZones(fakeIntl({ longOffset: false }))).toBe('offset_shim');
  });

  it('reports engines without zone data or without DateTimeFormat', () => {
    expect(probeTimeZones(fakeIntl({ longOffset: false, zones: false }))).toBe('unsupported');
    expect(probeTimeZones(fakeIntl({ dateTimeFormat: false }))).toBe('unsupported');
  });
});

describe('installOffsetShim', () => {
  it('answers longOffset formatters from wall-clock parts and leaves the others native', () => {
    const intl = fakeIntl({ longOffset: false });
    installOffsetShim(intl);
    const offset = new intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Istanbul',
      timeZoneName: 'longOffset',
    });
    expect(offset.format(JANUARY)).toBe('GMT+03:00');
    expect(offset.format(new Date(JANUARY))).toBe('GMT+03:00');
    expect(offset.format()).toBe('GMT+03:00');
    expect(offset.formatToParts(JANUARY)).toEqual([{ type: 'timeZoneName', value: 'GMT+03:00' }]);
    expect(offset.resolvedOptions().timeZone).toBe('Europe/Istanbul');
    const time = new intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(time.format(JANUARY)).toBe('13:00');
    expect(time).toBeInstanceOf(intl.DateTimeFormat);
    expect(intl.DateTimeFormat.supportedLocalesOf(['en-US'])).toEqual(['en-US']);
    // No zone: the engine's default zone.
    const local = new intl.DateTimeFormat('en-US', { timeZoneName: 'longOffset' });
    expect(parseGmtOffset(local.format(JANUARY))).not.toBeNull();
  });

  it('throws for an instant or zone the engine cannot render', () => {
    const intl = fakeIntl({ longOffset: false });
    installOffsetShim(intl);
    const offset = new intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Istanbul',
      timeZoneName: 'longOffset',
    });
    expect(() => offset.format(Number.NaN)).toThrow(RangeError);
  });

  it('gives @date-fns/tz correct offsets on an engine without longOffset', () => {
    const intl = fakeIntl({ longOffset: false });
    installOffsetShim(intl);
    const original = globalThis.Intl.DateTimeFormat;
    Object.defineProperty(globalThis.Intl, 'DateTimeFormat', {
      value: intl.DateTimeFormat,
      writable: true,
      configurable: true,
    });
    try {
      // Zones no other test formats, so @date-fns/tz builds its formatter through the shim.
      expect(tzOffset('Asia/Kolkata', new Date(JANUARY))).toBe(330);
      expect(tzOffset('America/St_Johns', new Date(Date.UTC(2026, 6, 1)))).toBe(-150);
    } finally {
      Object.defineProperty(globalThis.Intl, 'DateTimeFormat', {
        value: original,
        writable: true,
        configurable: true,
      });
    }
  });
});

describe('ensureIntl', () => {
  it('keeps a complete engine as it is', () => {
    const intl = fakeIntl();
    const before = intl.DateTimeFormat;
    expect(ensureIntl({ Intl: intl })).toEqual({ pluralRules: 'native', timeZones: 'native' });
    expect(intl.DateTimeFormat).toBe(before);
    expect(intl.PluralRules).toBe(Intl.PluralRules);
  });

  it('installs the plural rules and the offset shim where the engine lacks them', () => {
    const intl = fakeIntl({ plural: false, longOffset: false });
    const scope = { Intl: intl };
    const report = ensureIntl(scope);
    expect(report).toEqual({ pluralRules: 'polyfilled', timeZones: 'offset_shim' });
    expect(new intl.PluralRules('tr').select(1)).toBe('one');
    expect(
      new intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Berlin',
        timeZoneName: 'longOffset',
      }).format(JANUARY),
    ).toBe('GMT+01:00');
    // Once per scope: the second call returns the first report.
    expect(ensureIntl(scope)).toBe(report);
  });

  it('reports an engine without zone data', () => {
    expect(ensureIntl({ Intl: fakeIntl({ longOffset: false, zones: false }) })).toEqual({
      pluralRules: 'native',
      timeZones: 'unsupported',
    });
  });

  it('creates the namespace when the engine has no Intl at all', () => {
    const scope: { Intl?: typeof Intl } = {};
    expect(ensureIntl(scope)).toEqual({ pluralRules: 'polyfilled', timeZones: 'unsupported' });
    const created = scope.Intl;
    if (created === undefined) throw new Error('ensureIntl did not create Intl');
    expect(new created.PluralRules('en').select(1)).toBe('one');
  });

  it('runs against the global object by default', () => {
    expect(ensureIntl()).toEqual({ pluralRules: 'native', timeZones: 'native' });
  });
});

describe('intlFallbacks', () => {
  it('names the fallbacks in use', () => {
    expect(intlFallbacks({ pluralRules: 'native', timeZones: 'native' })).toBeNull();
    expect(intlFallbacks({ pluralRules: 'polyfilled', timeZones: 'offset_shim' })).toBe(
      'plural_rules,tz_offset_shim',
    );
    expect(intlFallbacks({ pluralRules: 'native', timeZones: 'unsupported' })).toBe(
      'tz_unsupported',
    );
  });
});
