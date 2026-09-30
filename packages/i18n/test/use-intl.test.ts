import { createTranslator } from 'use-intl/core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Messages as AppMessages } from 'use-intl';

import {
  DEFAULT_LOCALE,
  errorMessageKey,
  loadMessages,
  withTrCases,
  type Locale,
  type MessageKey,
  type Messages,
} from '../src/index.ts';
import type {} from '../src/use-intl.ts';

function translator(locale: Locale) {
  return createTranslator({
    locale,
    messages: loadMessages(locale),
    timeZone: 'Europe/Istanbul',
    onError: (error) => {
      throw error;
    },
  });
}

describe('use-intl integration', () => {
  it('defaults to Turkish', () => {
    expect(DEFAULT_LOCALE).toBe('tr');
  });

  it('augments use-intl AppConfig with the catalog type (typed keys)', () => {
    expectTypeOf<AppMessages>().toEqualTypeOf<Messages>();
    expectTypeOf<'common.actions.approve'>().toExtend<MessageKey>();
    expectTypeOf<'common.actions.nope'>().not.toExtend<MessageKey>();
  });

  it('rejects unknown keys at compile time', () => {
    const t = translator('tr');
    // @ts-expect-error — unknown keys are a type error (ADR-24).
    const unknownKey = () => t('common.actions.doesNotExist');
    expect(typeof unknownKey).toBe('function');
  });

  it('formats messages in both locales', () => {
    expect(translator('tr')('common.actions.approve')).toBe('Onayla');
    expect(translator('en')('common.actions.approve')).toBe('Approve');
    expect(translator('tr')('common.actions.listenFor', { minutes: 2 })).toBe('Dinle · 2 dk');
    expect(translator('en')('common.actions.listenFor', { minutes: 2 })).toBe('Listen · 2 min');
  });

  it('applies ICU plurals in English and plain counts in Turkish', () => {
    expect(translator('en')('today.hero.morningReady.title', { count: 1 })).toBe(
      'There is 1 thing you need to know today.',
    );
    expect(translator('en')('today.hero.morningReady.title', { count: 5 })).toBe(
      'There are 5 things you need to know today.',
    );
    expect(translator('tr')('today.hero.morningReady.title', { count: 5 })).toBe(
      'Bugün bilmen gereken 5 şey var.',
    );
  });

  it('renders Turkish case variants from withTrCases while English uses the base value', () => {
    const values = withTrCases({ time: '09:40' });
    expect(translator('tr')('states.offline.banner', values)).toBe(
      "Çevrimdışısın. Son analiz 09:40'tan gösteriliyor.",
    );
    expect(translator('en')('states.offline.banner', values)).toBe(
      "You're offline. Showing your last analysis from 09:40.",
    );
    const provider = withTrCases({ identityProvider: 'Google' });
    expect(translator('tr')('states.error.oauthExpired.waiting', provider)).toBe(
      "Google'da izin bekleniyor…",
    );
    const microsoft = withTrCases({ identityProvider: 'Microsoft' });
    expect(translator('tr')('states.error.oauthExpired.waiting', microsoft)).toBe(
      "Microsoft'ta izin bekleniyor…",
    );
  });

  it('renders rich-text tags', () => {
    const text = translator('en').markup('faq.items.retention.a', {
      privacy: (chunks) => `[${chunks}]`,
    });
    expect(text).toContain('[Privacy Policy]');
  });

  it('resolves API error message keys', () => {
    const key = errorMessageKey('AI_UNAVAILABLE');
    expect(key).toBe('errors.ai_unavailable');
    expect(translator('tr')(key)).toBe('Asistan şu an yanıt veremiyor.');
  });
});
