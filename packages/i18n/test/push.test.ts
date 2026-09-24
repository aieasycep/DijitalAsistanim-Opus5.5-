import { parse } from '@formatjs/icu-messageformat-parser';
import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';

import { collectArguments } from '../scripts/check-catalogs.ts';
import {
  INTL_LOCALE,
  LOCALES,
  loadMessages,
  lookupMessage,
  pushMessageKey,
  withTrCases,
} from '../src/index.ts';

const CATEGORIES = [
  'morning',
  'midday',
  'evening',
  'critical_email',
  'meeting',
  'deadline',
  'follow_up',
  'life_intel',
  'approval',
  'account',
] as const;

/** Personal-looking sample values; none may appear below the `full` level (C-14). */
const PERSONAL = {
  sender: 'Ahmet Yılmaz',
  vipName: 'Selin Kaya',
  person: 'Mehmet Yılmaz',
  subject: 'Revize teklif',
  meeting: 'Müşteri toplantısı',
  title: 'Başvuru formu',
  commitment: 'Teklifi gönder',
  summary: 'Selin Kaya ile toplantı',
  highlights: 'Ahmet · Mehmet',
  amount: '₺1.842,00',
  issuer: 'Enerjisa',
  seller: 'Trendyol',
  venue: 'Zorlu PSM',
  flight: 'TK2412',
  eventA: 'Ekip',
  eventB: 'Doktor',
  ruleName: 'Kuzey Lojistik',
  expectedAction: 'Bugün 17:00’ye kadar yanıt bekliyor.',
  text: 'Faturayı öde',
  types: 'kargo, ödeme',
};

const NEUTRAL = {
  count: 3,
  minutes: 20,
  hours: 2,
  days: 3,
  important: 5,
  meetings: 4,
  followups: 2,
  partySize: 2,
  time: '17:00',
  timeA: '14:00',
  timeB: '14:30',
  day: 'Yarın',
  date: '10 Eylül',
  from: '14:00',
  to: '18:00',
  gate: 'B12',
  service: 'Gmail',
  plan: 'Pro · Yıllık',
  store: 'App Store',
  reference: 'DA-2026-000123',
  status: 'Çözüldü',
  kind: 'mail',
  state: 'other',
  side: 'referrer',
};

describe.each(LOCALES)('push templates (%s)', (locale) => {
  const messages = loadMessages(locale);
  const push = messages.push as unknown as Record<string, Record<string, unknown>>;

  it('covers every notification category', () => {
    for (const category of CATEGORIES) expect(Object.keys(push), category).toContain(category);
  });

  it('renders every template at every level; generic is identical and neutral', () => {
    const values = withTrCases({ ...PERSONAL, ...NEUTRAL });
    for (const [category, templates] of Object.entries(push)) {
      if (['test', 'ios', 'foreground', 'channels'].includes(category)) continue;
      for (const template of Object.keys(templates)) {
        for (const level of ['full', 'title_only', 'generic'] as const) {
          for (const part of ['title', 'body'] as const) {
            const key = pushMessageKey(category, template, level, part);
            const message = lookupMessage(messages, key);
            expect(message, key).toBeDefined();
            const text = new IntlMessageFormat(message ?? '', INTL_LOCALE[locale]).format(values);
            expect(String(text).length, key).toBeGreaterThan(0);
            if (level !== 'full') {
              for (const personal of Object.values(PERSONAL))
                expect(String(text), key).not.toContain(personal);
            }
            if (level === 'generic') {
              expect(collectArguments(parse(message ?? '')).args.size, key).toBe(0);
              expect(message, key).toBe(
                lookupMessage(messages, `push.morning.ready.generic.${part}`),
              );
            }
          }
        }
      }
    }
  });

  it('names every Android channel (R-12)', () => {
    const channels = [
      'briefings',
      'critical_email',
      'meetings',
      'deadlines',
      'follow_up',
      'life_intel',
      'approvals',
      'reminders',
      'account',
      'phone_digest',
    ];
    for (const channel of channels) {
      expect(lookupMessage(messages, `push.channels.${channel}.name`), channel).toMatch(/\S/);
    }
  });
});

describe('Turkish suffixes inside push copy', () => {
  it('renders {time_loc} with the right suffix', () => {
    const message = lookupMessage(loadMessages('tr'), 'push.deadline.due_soon.full.body') ?? '';
    const format = (time: string) =>
      new IntlMessageFormat(message, 'tr-TR').format(withTrCases({ time }));
    expect(format('17:00')).toBe("Bugün 17:00'de kapanıyor.");
    expect(format('13:00')).toBe("Bugün 13:00'te kapanıyor.");
    expect(format('09:40')).toBe("Bugün 09:40'ta kapanıyor.");
  });
});
