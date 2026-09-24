import { describe, expect, it } from 'vitest';

import { FAQ_CATEGORIES, FAQ_ITEMS, faqAnchor, faqItemsFor } from '../src/faq.ts';
import { LOCALES, loadMessages, lookupMessage } from '../src/index.ts';

describe('FAQ single source', () => {
  it('has unique keys, known categories and exactly eight featured items', () => {
    const keys = FAQ_ITEMS.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of FAQ_ITEMS) expect(FAQ_CATEGORIES).toContain(item.category);
    expect(FAQ_ITEMS.filter((item) => item.featured)).toHaveLength(8);
  });

  it('has a question and an answer for every item in every locale, and nothing extra', () => {
    for (const locale of LOCALES) {
      const messages = loadMessages(locale);
      for (const item of FAQ_ITEMS) {
        expect(
          lookupMessage(messages, `faq.items.${item.key}.q`),
          `${locale} ${item.key}.q`,
        ).toMatch(/\S/);
        expect(
          lookupMessage(messages, `faq.items.${item.key}.a`),
          `${locale} ${item.key}.a`,
        ).toMatch(/\S/);
      }
      expect(Object.keys(messages.faq.items).sort()).toEqual(
        FAQ_ITEMS.map((item) => item.key).sort(),
      );
      for (const category of FAQ_CATEGORIES) {
        expect(
          lookupMessage(messages, `faq.categories.${category}`),
          `${locale} ${category}`,
        ).toMatch(/\S/);
      }
    }
  });

  it('only uses allow-listed in-app routes', () => {
    const allowed = /^\/(approvals|settings(\/[a-z-]+){0,2})$/;
    for (const item of FAQ_ITEMS)
      if ('appRoute' in item) expect(item.appRoute, item.key).toMatch(allowed);
  });

  it('builds web anchors', () => {
    expect(faqAnchor('admin_consent')).toBe('faq-admin-consent');
    expect(faqItemsFor('web')).toHaveLength(FAQ_ITEMS.length);
    expect(faqItemsFor('ios').length).toBeGreaterThan(0);
  });
});

describe('FAQ answers are truthful to the architecture', () => {
  const tr = loadMessages('tr').faq.items;
  const en = loadMessages('en').faq.items;

  it('states encryption in transit and at rest without an end-to-end claim', () => {
    expect(tr.encryption.a).toContain('Veriler aktarım sırasında ve saklanırken şifrelenir.');
    expect(en.encryption.a).toContain('encrypted in transit and at rest');
    const e2e = new RegExp(['uçtan', 'uca'].join(' '), 'iu');
    const e2eEn = new RegExp(['end', 'to', 'end'].join('.'), 'iu');
    for (const item of Object.values(tr)) expect(item.a).not.toMatch(e2e);
    for (const item of Object.values(en)) expect(item.a).not.toMatch(e2eEn);
  });

  it('states that data is not sold for ads and mail is not used for training', () => {
    expect(tr.ads.a).toContain('Verilerin reklam amacıyla satılmaz');
    expect(tr.training.a).toContain('yapay zekâ modellerini eğitmek için kullanılmaz');
    expect(en.training.a).toContain('never used to train AI models');
  });

  it('states approval before any write and tap-only voice approval (R-03)', () => {
    expect(tr.approval.a).toContain('Yalnızca sen onaylarsan.');
    expect(tr.approval.a).toContain('Sesli komutla onay verilmez');
    expect(en.approval.a).toContain('Voice commands never approve anything');
  });

  it('lists the 30 / 90 / 365 / until-deleted retention options', () => {
    expect(tr.retention.a).toContain('90 gün');
    expect(tr.retention.a).toContain('30 gün');
    expect(tr.retention.a).toContain('1 yıl');
    expect(tr.retention.a).toContain('sen silene kadar');
    expect(en.retention.a).toMatch(/90 days.*30 days, 1 year or until you delete/u);
  });

  it('uses the R-15 storage sentence and Android NI disclosure verbatim', () => {
    const r15 =
      'Mail içeriğinin tamamı saklanmaz; yalnızca özetler, kısa alıntılar ve analiz sonuçları saklama süren boyunca tutulur.';
    expect(tr.storage.a.startsWith(r15)).toBe(true);
    expect(tr.android_notifications.a).toContain(
      'Bildirim içerikleri cihazında işlenir; yalnızca çıkarılan bilgiler (ör. kargo durumu, tutar, tarih) hesabına kaydedilir. Doğrulama kodları ve güvenlik uygulamaları her zaman hariç tutulur.',
    );
  });

  it('never promises unconditional trials or card-free sign-up', () => {
    expect(tr.trial.a).toContain('tanımlıysa ve uygunsan');
    expect(en.trial.a).toContain('If the store offers a trial');
  });
});
