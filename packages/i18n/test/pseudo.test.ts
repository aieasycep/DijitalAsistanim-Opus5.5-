import {
  isLiteralElement,
  isPluralElement,
  isSelectElement,
  isTagElement,
  parse,
  type MessageFormatElement,
} from '@formatjs/icu-messageformat-parser';
import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';

import { collectArguments } from '../scripts/check-catalogs.ts';
import { LOCALES, loadMessages } from '../src/index.ts';
import { PSEUDO_EXPANSION, pseudoLocalize, pseudoLocalizeMessages } from '../src/pseudo.ts';

function literalLength(elements: readonly MessageFormatElement[]): number {
  let total = 0;
  for (const el of elements) {
    if (isLiteralElement(el)) total += el.value.length;
    else if (isPluralElement(el) || isSelectElement(el)) {
      for (const option of Object.values(el.options)) total += literalLength(option.value);
    } else if (isTagElement(el)) total += literalLength(el.children);
  }
  return total;
}

function flatten(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatten(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('pseudoLocalize', () => {
  it('accents, pads and brackets plain text', () => {
    expect(pseudoLocalize('Onayla')).toBe('[Ôñáýļá~~~]');
    expect(pseudoLocalize('Approve')).toBe('[Áṗṗŕôṽé~~~]');
  });

  it('keeps ICU arguments, plural branches, # and tags intact', () => {
    const message = 'Bugün {count, plural, one {# şey} other {# şey}} var, <b>{name}</b>.';
    const pseudo = pseudoLocalize(message);
    expect(pseudo).toContain('{count, plural, one {#');
    expect(pseudo).toContain('<b>{name}</b>');
    const formatted = new IntlMessageFormat(pseudo, 'tr-TR').format({
      count: 2,
      name: 'Ayşe',
      b: (chunks: unknown[]) => chunks.join(''),
    });
    expect(formatted).toMatch(/^\[Ɓûĝüñ~+ 2 şéý~+ ṽáŕ,~+ Ayşe\.~+\]$/u);
  });

  it('keeps Turkish apostrophes and quoted ICU literals working', () => {
    const pseudo = pseudoLocalize("Ahmet'e '{'gönder'}'");
    expect(new IntlMessageFormat(pseudo, 'tr-TR').format()).toMatch(/^\[Áĥṁéŧ'é \{ĝöñďéŕ\}~+\]$/u);
  });

  it('leaves whitespace-only runs between arguments untouched', () => {
    expect(pseudoLocalize('{a} {b}', { brackets: false })).toBe('{a} {b}');
  });

  it('supports a custom expansion without brackets', () => {
    expect(pseudoLocalize('abcdefghij', { expansion: 1, brackets: false })).toBe(
      'áƀċďéƒĝĥîĵ~~~~~~~~~~',
    );
  });
});

describe.each(LOCALES)('pseudo-locale over the %s catalog', (locale) => {
  const pairs = flatten(loadMessages(locale));

  it(`grows every message by at least ${PSEUDO_EXPANSION * 100}% and keeps its arguments`, () => {
    for (const [key, message] of pairs) {
      const pseudo = pseudoLocalize(message);
      const before = parse(message);
      const after = parse(pseudo);
      expect(literalLength(after), key).toBeGreaterThanOrEqual(
        literalLength(before) * (1 + PSEUDO_EXPANSION),
      );
      const a = collectArguments(before);
      const b = collectArguments(after);
      expect([...b.args].sort(), key).toEqual([...a.args].sort());
      expect([...b.tags].sort(), key).toEqual([...a.tags].sort());
    }
  });

  it('keeps the catalog shape and every pseudo message formats', () => {
    const pseudo = pseudoLocalizeMessages(loadMessages(locale));
    const pseudoPairs = flatten(pseudo);
    expect(pseudoPairs.map(([key]) => key)).toEqual(pairs.map(([key]) => key));
    for (const [key, message] of pseudoPairs) {
      expect(() => new IntlMessageFormat(message, locale), key).not.toThrow();
    }
  });
});
