import { describe, expect, it } from 'vitest';

import { capitalizeFirst, foldForSearch, toLower, toUpper } from '../src/case.ts';
import { pushMessageKey } from '../src/keys.ts';
import { INTL_LOCALE, LOCALES, isLocale, resolveLocale } from '../src/locales.ts';
import { NAMESPACES, isNamespace } from '../src/namespaces.ts';

describe('locales', () => {
  it('supports tr (default) and en', () => {
    expect(LOCALES).toEqual(['tr', 'en']);
    expect(INTL_LOCALE).toEqual({ tr: 'tr-TR', en: 'en-US' });
    expect(isLocale('tr')).toBe(true);
    expect(isLocale('de')).toBe(false);
  });

  it('resolves device and header tags to a supported locale', () => {
    expect(resolveLocale('en-GB')).toBe('en');
    expect(resolveLocale('tr_TR')).toBe('tr');
    expect(resolveLocale(['de-DE', 'en-US'])).toBe('en');
    expect(resolveLocale('fr')).toBe('tr');
    expect(resolveLocale(undefined)).toBe('tr');
    expect(resolveLocale('en;q=0.8')).toBe('en');
  });

  it('lists 39 namespaces', () => {
    expect(NAMESPACES).toHaveLength(39);
    expect(isNamespace('push')).toBe(true);
    expect(isNamespace('ani')).toBe(false);
  });
});

describe('Turkish case mapping (kickers and badges)', () => {
  it('upper-cases with dotted İ and dotless I', () => {
    expect(toUpper('Bugünün Öncelikleri', 'tr')).toBe('BUGÜNÜN ÖNCELİKLERİ');
    expect(toUpper('Kişisel', 'tr')).toBe('KİŞİSEL');
    expect(toUpper('Acil', 'tr')).toBe('ACİL');
    expect(toUpper('Son tarih', 'tr')).toBe('SON TARİH');
    expect(toUpper('ılık', 'tr')).toBe('ILIK');
    expect(toUpper('Priorities', 'en')).toBe('PRIORITIES');
  });

  it('lower-cases and capitalises', () => {
    expect(toLower('İSTANBUL', 'tr')).toBe('istanbul');
    expect(toLower('ILIK', 'tr')).toBe('ılık');
    expect(toLower('ILLINOIS', 'en')).toBe('illinois');
    expect(capitalizeFirst('istanbul', 'tr')).toBe('İstanbul');
    expect(capitalizeFirst('', 'tr')).toBe('');
  });

  it('folds for accent- and case-insensitive search', () => {
    expect(foldForSearch('ŞİFRE')).toBe('sifre');
    expect(foldForSearch('Şifre')).toBe(foldForSearch('sifre'));
    expect(foldForSearch('ISTANBUL')).toBe(foldForSearch('İstanbul'));
    expect(foldForSearch('  Görüşme  ')).toBe('gorusme');
  });
});

describe('key builders', () => {
  it('builds push keys', () => {
    expect(pushMessageKey('morning', 'ready', 'title_only', 'body')).toBe(
      'push.morning.ready.title_only.body',
    );
  });
});
