import { TICKET_CATEGORY_VALUES } from '@da/domain/enums';
import { FAQ_ITEMS, faqAnchor, LOCALES } from '@da/i18n';
import { describe, expect, it } from 'vitest';
import enWebPages from '../messages/en/webPages.json';
import trWebPages from '../messages/tr/webPages.json';
import { WEB_LOCALES } from '../src/i18n/locales.ts';
import { loadWebMessages } from '../src/i18n/messages.ts';
import { FAQ_KEYS, faqAnchorId } from '../src/lib/faq-keys.ts';

interface Tree {
  readonly [key: string]: string | Tree;
}

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

/** ICU argument names and rich-text tags used by a message (`{count, plural, …}`, `<terms>`). */
function placeholders(message: string): string[] {
  const args = [...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/gu)].map(
    (match) => `{${match[1] ?? ''}}`,
  );
  const tags = [...message.matchAll(/<([a-z]+)>/gu)].map((match) => `<${match[1] ?? ''}>`);
  return [...new Set([...args, ...tags])].sort();
}

const tr = flatten(trWebPages);
const en = flatten(enWebPages);

describe('webPages catalogs (apps/web/messages)', () => {
  it('Turkish and English have the same keys', () => {
    expect([...en.keys()].sort()).toEqual([...tr.keys()].sort());
  });

  it('every message is non-empty and uses the same arguments and tags in both locales', () => {
    for (const [key, trMessage] of tr) {
      const enMessage = en.get(key) ?? '';
      expect(trMessage.trim(), `tr ${key}`).not.toBe('');
      expect(enMessage.trim(), `en ${key}`).not.toBe('');
      // Plural selectors may differ in shape, but the named arguments and tags must match.
      expect(placeholders(enMessage), key).toEqual(placeholders(trMessage));
    }
  });

  it('English copy has no Turkish text beyond proper nouns', () => {
    const allowed = /Türkçe|Türkiye|İstanbul|VERBİS|KVKK|SİL|’ye geç|'ye geç/gu;
    for (const [key, message] of en) {
      expect(message.replace(allowed, ''), key).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/u);
    }
  });

  it('the web catalog adds webPages to the shared @da/i18n catalog', () => {
    for (const locale of WEB_LOCALES) {
      const messages = loadWebMessages(locale);
      expect(Object.keys(messages)).toEqual(
        expect.arrayContaining(['web', 'legal', 'faq', 'common', 'paywall', 'webPages']),
      );
    }
  });

  it('never promises "unlimited" or uses banned claims', () => {
    for (const [key, message] of [...tr, ...en]) {
      expect(message, key).not.toMatch(
        /s\u0131n\u0131rs\u0131z|unlimited|kredi kart\u0131 gerekmez|no credit card|u\u00e7tan uca|end-to-end/iu,
      );
    }
  });
});

describe('shared keys stay in sync with @da/i18n and @da/domain', () => {
  it('web locales are the product locales', () => {
    expect([...WEB_LOCALES]).toEqual([...LOCALES]);
  });

  it('the local FAQ key list mirrors FAQ_ITEMS (client bundles avoid the full catalog)', () => {
    expect([...FAQ_KEYS].sort()).toEqual(FAQ_ITEMS.map((item) => item.key).sort());
    for (const key of FAQ_KEYS) expect(faqAnchorId(key)).toBe(faqAnchor(key));
  });

  it('support topics cover every ticket category (M§62)', () => {
    expect(Object.keys(trWebPages.support.form.topics).sort()).toEqual(
      [...TICKET_CATEGORY_VALUES].sort(),
    );
  });

  it('every OG route and page has SEO copy in both locales', () => {
    for (const route of [
      'home',
      'pricing',
      'privacy',
      'terms',
      'support',
      'deletion',
      'referral',
    ]) {
      for (const catalog of [tr, en]) {
        expect(catalog.get(`og.${route}.headline`), route).toBeTruthy();
        expect(catalog.get(`og.${route}.sub`), route).toBeTruthy();
      }
    }
    for (const page of [
      'home',
      'pricing',
      'privacy',
      'terms',
      'support',
      'deletion',
      'referral',
      'oauthDone',
      'appLink',
      'notFound',
    ]) {
      expect(tr.get(`seo.${page}.title`), page).toBeTruthy();
      expect(tr.get(`seo.${page}.description`), page).toBeTruthy();
    }
  });

  it('the hero states the M§73 promise verbatim', () => {
    expect(trWebPages.home.hero.title).toBe('Bugün bilmen gerekenleri, sen sormadan söyler.');
    expect(trWebPages.home.hero.lead).toBe(
      'Dijital Asistan mailini, takvimini ve açık işlerini anlayıp her gün sana kısa bir brifing hazırlar.',
    );
  });
});
