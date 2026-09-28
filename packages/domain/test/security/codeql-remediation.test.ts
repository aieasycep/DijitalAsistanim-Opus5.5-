/**
 * Regression tests for the CodeQL findings fixed in @da/domain (security-nightly, TST-CI-08):
 * each ReDoS shape runs at 50 000 repetitions within a generous time budget and still gives the
 * right answer, and every rewritten pattern is compared with the original regex (kept here as the
 * oracle) over seeded random inputs built from the tokens that matter to it.
 */
import { describe, expect, it } from 'vitest';
import { isValidPropValue } from '../../src/analytics/validate.ts';
import { stripQuotedHistory } from '../../src/commitments/detect.ts';
import { parseDeepLink, toUniversalLink } from '../../src/deeplinks.ts';
import { parsePlanLimitRows } from '../../src/entitlements/limits.ts';
import { findPnrs, isPlausiblePnr } from '../../src/extract/pnr.ts';
import { CARRIERS, findTrackingNumbers } from '../../src/extract/tracking.ts';
import {
  dropTagOpeners,
  removeTags,
  stripMarkup,
  unlinkMarkdown,
} from '../../src/grounding/markup.ts';
import {
  guardFreeText,
  guardOutputText,
  prescanInjection,
} from '../../src/grounding/output-guards.ts';
import { unverifiedMessage } from '../../src/grounding/verify.ts';
import { deriveMarker } from '../../src/providers/markers.ts';
import { referralShareUrl } from '../../src/referrals/code.ts';
import { trimEndChars, trimStartChars } from '../../src/strings.ts';
import { hostInText, normalizeLinkHost } from '../../src/url-safety.ts';

const N = 50_000;
/** Generous: the fixed code takes a few ms; the quadratic originals took 2–8 s at this size. */
const BUDGET_MS = 200;
/**
 * For calls through the public guards and extractors, which also run the (linear, but about 1 µs
 * per character) Turkish text normalisation over the whole input: still far below the seconds
 * the original patterns needed, and safe on a loaded CI runner.
 */
const PIPELINE_BUDGET_MS = 1000;

function timed<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

function fast<T>(fn: () => T, budgetMs = BUDGET_MS): T {
  const { value, ms } = timed(fn);
  expect(ms).toBeLessThan(budgetMs);
  return value;
}

function fastPipeline<T>(fn: () => T): T {
  return fast(fn, PIPELINE_BUDGET_MS);
}

/** Deterministic PRNG (mulberry32) so the differential cases are reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` random strings of up to `maxTokens` tokens. */
function samples(seed: number, tokens: readonly string[], count = 3000, maxTokens = 14): string[] {
  const next = prng(seed);
  const out: string[] = [];
  for (let n = 0; n < count; n += 1) {
    let s = '';
    const len = Math.floor(next() * (maxTokens + 1));
    for (let k = 0; k < len; k += 1) s += tokens[Math.floor(next() * tokens.length)] ?? '';
    out.push(s);
  }
  return out;
}

const UUID = '8a4f1c9e-1111-4222-8333-944455556666';

describe('trailing-character trimming (strings.ts)', () => {
  it('matches /[…]+$/ and /^[…]+/ replaces on random input', () => {
    for (const s of samples(1, ['/', 'a', '.', '!', ' ', '//'])) {
      expect(trimEndChars(s, '/')).toBe(s.replace(/\/+$/, ''));
      expect(trimEndChars(s, '.!')).toBe(s.replace(/[.!]+$/, ''));
      expect(trimStartChars(s, '/')).toBe(s.replace(/^\/+/, ''));
    }
  });
});

describe('CodeQL js/polynomial-redos: trailing "/" (deeplinks, markers, referrals)', () => {
  const web = 'https://dijitalasistan.app';

  it('deeplinks.ts:255 parseDeepLink trims a web origin ending in 50 000 "/"', () => {
    const r = fast(() =>
      parseDeepLink(`${web}/app/today`, { webOrigin: `${web}${'/'.repeat(N)}` }),
    );
    expect(r.ok && r.route.pattern).toBe('/today');
    const slow = `${web}${'/'.repeat(N)}x`;
    expect(fast(() => parseDeepLink(`${web}/app/today`, { webOrigin: slow })).ok).toBe(false);
  });

  it('deeplinks.ts:383 toUniversalLink', () => {
    expect(fast(() => toUniversalLink('/today', `${web}${'/'.repeat(N)}`))).toBe(
      `${web}/app/today`,
    );
    const odd = `${web}${'/'.repeat(N)}x`;
    expect(fast(() => toUniversalLink('/today', odd))).toBe(`${odd}/app/today`);
  });

  it('providers/markers.ts:73 deriveMarker deep link', () => {
    const marker = fast(() =>
      deriveMarker(UUID, 'k', { mailDomain: 'mail.example', webUrl: `${web}${'/'.repeat(N)}` }),
    );
    expect(marker.deepLinkUrl).toBe(`${web}/app/approvals/${UUID}`);
  });

  it('referrals/code.ts:119 referralShareUrl', () => {
    expect(fast(() => referralShareUrl(`${web}${'/'.repeat(N)}`, '7K3M9PQ'))).toBe(
      `${web}/r/7K3M9PQ`,
    );
  });
});

describe('CodeQL js/polynomial-redos: analytics/validate.ts:75 e-mail-like values', () => {
  const spec = { type: 'enum', values: ['a'] } as const;

  it('50 000 "!" is checked quickly and is not an address', () => {
    expect(fast(() => isValidPropValue(spec, '!'.repeat(N)))).toBe(false);
    expect(fast(() => isValidPropValue({ type: 'boolean' }, `${'a'.repeat(N)}@`))).toBe(false);
  });

  it('matches the original /[^\\s@]+@[^\\s@]+\\.[^\\s@]+/ on random input', () => {
    const original = /[^\s@]+@[^\s@]+\.[^\s@]+/;
    for (const s of samples(2, ['a', '@', '.', ' ', '\n', 'b.c', 'x@y', '@@', '.@'])) {
      // An enum that lists the value accepts it unless it looks like an address or a URL.
      const contact = original.test(s) || /(?:https?:|www\.|:\/\/)/i.test(s);
      expect(isValidPropValue({ type: 'enum', values: [s] }, s)).toBe(!contact && s.length <= 64);
    }
  });
});

describe('CodeQL js/polynomial-redos: commitments/detect.ts:73 reply headers', () => {
  it('a line of 50 000 × "a tarihinde ş" is scanned quickly', () => {
    // With an "ş" present V8 cannot rule the pattern out up front: 20 000 repetitions took 25 s.
    const line = 'a tarihinde ş'.repeat(N);
    expect(fast(() => stripQuotedHistory(`ilk\n${line}`))).toBe(`ilk\n${line}`);
    expect(fast(() => stripQuotedHistory(`ilk\n${line}x şunu yazdı:\nalıntı`))).toBe('ilk');
  });

  it('still cuts at Turkish and English reply headers', () => {
    const header = '22 Eylül 2026 Salı 10:05 tarihinde Ahmet Yılmaz <a@b.co> şunu yazdı:';
    expect(stripQuotedHistory(`Tamam.\n${header}\nYarın ararım.`)).toBe('Tamam.');
    expect(stripQuotedHistory('a\nOn Mon, Ahmet wrote:\nb')).toBe('a');
    expect(stripQuotedHistory('a\n> alıntı\nb')).toBe('a\nb');
  });

  it('matches the original header regex on random lines', () => {
    const original =
      /^(?:>|-{2,}\s*(?:original message|orijinal ileti|özgün ileti)|on .+ wrote:|.+ tarihinde .+ şunu yazdı:|kimden:|from:)/iu;
    const oracle = (text: string): string => {
      const out: string[] = [];
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (original.test(t)) {
          if (t.startsWith('>')) continue;
          break;
        }
        out.push(line);
      }
      return out.join('\n');
    };
    const tokens = [
      'a',
      ' ',
      ' tarihinde ',
      ' TARIHINDE ',
      ' şunu yazdı:',
      ' ŞUNU YAZDI:',
      ' ',
      '\r',
      '\n',
      '>',
      'x',
      '😀',
    ];
    for (const s of samples(3, tokens)) expect(stripQuotedHistory(s)).toBe(oracle(s));
  });
});

describe('CodeQL js/polynomial-redos: extract/pnr.ts:50 labels followed by spaces', () => {
  it('"pnr" + 50 000 spaces is scanned quickly', () => {
    expect(fast(() => findPnrs(`pnr${' '.repeat(N)}`))).toEqual([]);
    expect(fast(() => findPnrs(`PNR${' '.repeat(N)}: X7K2QA`)).map((p) => p.code)).toEqual([
      'X7K2QA',
    ]);
  });

  it('findPnrs matches the original separator \\s*[:#]?\\s* on random input', () => {
    const original =
      /(?:pnr|rezervasyon\s*(?:kodu|no|numarası|numarasi)|booking\s*(?:reference|code|ref)|confirmation\s*(?:code|number)|record\s*locator)\s*[:#]?\s*([A-Za-z0-9]{6})(?![A-Za-z0-9])/giu;
    const oracle = (text: string) => {
      const out: { code: string; span: readonly [number, number] }[] = [];
      for (const m of text.matchAll(original)) {
        const code = m[1] ?? '';
        if (!isPlausiblePnr(code) || out.some((p) => p.code === code)) continue;
        const start = m.index + m[0].length - code.length;
        out.push({ code, span: [start, start + code.length] });
      }
      return out;
    };
    const tokens = [
      'PNR',
      'pnr',
      ' ',
      ':',
      '#',
      'X7K2QA',
      'AB12CD',
      'ONLINE',
      'x7k2qa',
      'x',
      '\t',
      'booking ref',
      'Rezervasyon No',
    ];
    for (const s of samples(4, tokens)) expect(findPnrs(s)).toEqual(oracle(s));
  });
});

describe('CodeQL js/polynomial-redos: extract/tracking.ts', () => {
  it(':147 "barkod" + 50 000 spaces is scanned quickly (domestic carrier context)', () => {
    const text = `Aras Kargo barkod${' '.repeat(N)}`;
    expect(fastPipeline(() => findTrackingNumbers(text))).toEqual([]);
    const labelled = `Aras Kargo barkod${' '.repeat(N)}# AR12345678`;
    const [t] = fastPipeline(() => findTrackingNumbers(labelled));
    expect(t).toMatchObject({ value: 'AR12345678', kind: 'domestic', carrier: 'aras' });
  });

  it(':154 50 000 × "https://-/" is scanned quickly', () => {
    // The sender domain names the carrier, so the (linear, but slow per character) text
    // normalisation of carrier detection stays out of the measurement.
    const opts = { senderDomain: 'bildirim.yurticikargo.com' };
    const text = 'https://-/'.repeat(N);
    expect(fastPipeline(() => findTrackingNumbers(text, opts))).toEqual([]);
    const withParam = `${text}?code=7301234567 https://www.yurticikargo.com/q?code=7301234567`;
    const found = fastPipeline(() => findTrackingNumbers(withParam, opts));
    expect(found).toEqual([
      expect.objectContaining({ value: '7301234567', kind: 'link_param', carrier: 'yurtici' }),
    ]);
  });

  it('domestic labels match the original separator \\s*[:#]?\\s* on random input', () => {
    const original =
      /(?:kargo\s*takip\s*(?:no|numarası|numarasi|kodu)|gönderi\s*(?:no|kodu|numarası|numarasi)|gonderi\s*(?:no|kodu|numarasi)|takip\s*(?:no|numarası|numarasi|kodu)|barkod(?:\s*no)?|tracking\s*(?:number|no|id))\s*[:#]?\s*([A-Z0-9-]{8,24})(?![A-Z0-9-])/giu;
    const oracle = (text: string) => {
      const out: { value: string; start: number }[] = [];
      for (const m of text.matchAll(original)) {
        const v = m[1] ?? '';
        if (!/\d/.test(v) || out.some((x) => x.value === v)) continue;
        out.push({ value: v, start: m.index + m[0].length - v.length });
      }
      return out;
    };
    const opts = { senderDomain: 'araskargo.com.tr' };
    const tokens = ['barkod', 'Barkod No', 'takip no', ' ', ':', '#', 'AR12345678', 'x', '-', '\n'];
    for (const s of samples(12, tokens)) {
      const actual = findTrackingNumbers(s, opts)
        .filter((t) => t.kind === 'domestic')
        .map((t) => ({ value: t.value, start: t.span[0] }));
      expect(actual).toEqual(oracle(s));
    }
  });

  it('link parameters match the original regex on random input', () => {
    const original =
      /https:\/\/([a-z0-9.-]+)\/[^\s"'<>]*?[?&](?:code|barcode|trackingNumber|takipNo|kargoTakipNo)=([A-Za-z0-9-]{8,30})/g;
    const oracle = (text: string) => {
      const out: { value: string; start: number; carrier: string }[] = [];
      for (const m of text.matchAll(original)) {
        const host = (m[1] ?? '').toLowerCase();
        const carrier = CARRIERS.find((c) =>
          c.domains.some((d) => host === d || host.endsWith(`.${d}`)),
        );
        const value = m[2] ?? '';
        if (!carrier || out.some((x) => x.value === value)) continue;
        out.push({ value, start: m.index + m[0].length - value.length, carrier: carrier.id });
      }
      return out.sort((a, b) => a.start - b.start);
    };
    const tokens = [
      'https://',
      'www.yurticikargo.com',
      'ups.com',
      'evil.example',
      '/',
      '?',
      '&',
      'code=',
      'takipNo=',
      'x=',
      'ABCD1234',
      'ABCDEFGHJKLMNPQRSTUVWXYZ2345678',
      '-',
      ' ',
      '"',
      '<',
      ':',
      'https://-/',
    ];
    for (const s of samples(5, tokens, 4000, 16)) {
      const actual = findTrackingNumbers(s)
        .filter((t) => t.kind === 'link_param')
        .map((t) => ({ value: t.value, start: t.span[0], carrier: t.carrier }));
      expect(actual).toEqual(oracle(s));
    }
  });
});

describe('CodeQL js/polynomial-redos: grounding/output-guards.ts', () => {
  it(':49 mixed-script domains: 50 000 "-" is scanned quickly', () => {
    expect(fastPipeline(() => prescanInjection('-'.repeat(N)).signals)).toEqual([]);
    expect(fastPipeline(() => prescanInjection(`${'-'.repeat(N)} аpple.com`).signals)).toContain(
      'mixed_script_domain',
    );
  });

  it(':49 matches the original dotted-label scan on random input', () => {
    const original = /[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
    const oracle = (text: string): boolean =>
      [...text.matchAll(original)].some((m) =>
        m[0]
          .split('.')
          .some(
            (l) => /\p{Script=Latin}/u.test(l) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(l),
          ),
      );
    for (const s of samples(6, ['a', 'а', 'β', '.', '..', '-', ' ', '1', 'ok'])) {
      expect(prescanInjection(s).signals.includes('mixed_script_domain')).toBe(oracle(s));
    }
  });

  it(':130 a URL ending in 50 000 "!" is trimmed quickly', () => {
    const url = `https://example.com/a${'!'.repeat(N)}`;
    const sources = ['https://example.com/a'];
    const g = fastPipeline(() => guardOutputText(`bak ${url}`, { sources }));
    expect(g.value).toBe(`bak ${url}`);
    const dropped = fastPipeline(() => guardOutputText(`bak ${url}x`, { sources: [] }));
    expect(dropped.droppedUrls).toEqual([`${url}x`]);
  });

  it(':205 proper nouns: 50 000 apostrophes are scanned quickly', () => {
    const r = fastPipeline(() => guardFreeText(`Toplantı Ahmet${"'".repeat(N)}in.`, ['Ahmet']));
    expect(r.removed).toBe(0);
    expect(guardFreeText("Sonra Ayşe'ye ilettim.", ['Ahmet']).removed).toBe(1);
    expect(guardFreeText("Sonra Ayşe'ye ilettim.", ['Ayşe']).removed).toBe(0);
  });

  it('e-mail addresses: 50 000 local-part characters without "@" are scanned quickly', () => {
    const g = fastPipeline(() => guardOutputText('a'.repeat(N), { sources: [] }));
    expect(g.value).toBe('a'.repeat(N));
    const mail = fastPipeline(() =>
      guardOutputText(`${'%'.repeat(N)} yaz: x@evil.com`, { sources: [], maxLength: 10 }),
    );
    expect(mail.droppedEmails).toEqual(['x@evil.com']);
  });

  it('e-mail addresses match the original regex on random input', () => {
    const original = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu;
    const tokens = ['a', 'x', '1', '.', '-', '%', '@', 'b.com', 'co', ' ', '@@', '.x'];
    for (const s of samples(7, tokens)) {
      const expected = s.match(original) ?? [];
      expect(guardOutputText(s, { sources: [] }).droppedEmails).toEqual(expected);
    }
  });
});

describe('CodeQL js/incomplete-multi-character-sanitization: grounding/output-guards.ts:96', () => {
  it.each([
    '<scr<script>ipt>alert(1)</script>',
    '<<script>script>alert(1)<</script>/script>',
    '<script',
    '<<a href=x',
    '<[script](x) alert',
    '<![CDATA[x]]',
    '</style',
    '<?php',
    '<img src=x onerror=alert(1)//',
    'a<b>c</b><',
  ])('%j leaves no tag opener', (payload) => {
    const value = guardOutputText(payload, { sources: [] }).value;
    expect(value).not.toMatch(/<[A-Za-z!/?]/);
  });

  it('keeps plain text and a plain "<"', () => {
    expect(guardOutputText('5 < 10 ve 7 <= 9', { sources: [] }).value).toBe('5 < 10 ve 7 <= 9');
    expect(guardOutputText('<b>teklif</b> hazır', { sources: [] }).value).toBe('teklif hazır');
    expect(stripMarkup('**Önemli**: <b>teklif</b> [link]() hazır')).toBe(
      'Önemli: teklif link hazır',
    );
  });

  it('removeTags matches replace(/<[^>]*>/g, "") and is linear on "<<<<…"', () => {
    for (const s of samples(8, ['<', '>', 'a', '<b>', '</', ' '])) {
      expect(removeTags(s)).toBe(s.replace(/<[^>]*>/g, ''));
    }
    expect(fast(() => removeTags('<'.repeat(N)))).toBe('<'.repeat(N));
  });

  it('unlinkMarkdown matches the markdown-link replace and is linear on "[a](" runs', () => {
    for (const s of samples(9, ['[', ']', '(', ')', 'a', '](', '[a](b)', ' '])) {
      expect(unlinkMarkdown(s)).toBe(s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
    }
    expect(fast(() => unlinkMarkdown('[a]('.repeat(N)))).toBe('[a]('.repeat(N));
    expect(fast(() => unlinkMarkdown('['.repeat(N)))).toBe('['.repeat(N));
  });

  it('dropTagOpeners keeps every "<" that cannot open a tag', () => {
    expect(dropTagOpeners('<<a <b < c <')).toBe('a b < c <');
    expect(dropTagOpeners('x </y <!z <?w')).toBe('x /y !z ?w');
    expect(fast(() => dropTagOpeners(`${'<'.repeat(N)}a`))).toBe('a');
  });
});

describe('CodeQL js/polynomial-redos: url-safety.ts:393 hostInText', () => {
  const LABELS = String.raw`(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?[.。．｡])+\p{L}[\p{L}\p{N}-]*`;
  const originalUrl = new RegExp(
    String.raw`(?:\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s@/]+@)?|\bwww\.)(${LABELS})`,
    'iu',
  );
  const originalWhole = new RegExp(
    String.raw`^(?:[^\s@/]+@)?(${LABELS})(?::[0-9]+)?(?:[/?#]\S*)?$`,
    'iu',
  );
  const originalWrapping = /^[<(["'«“]+|[>)\]"'»”.,;:!?]+$/gu;
  const oracle = (text: string): string | null => {
    const trimmed = text.trim();
    const candidate =
      originalUrl.exec(trimmed)?.[1] ??
      originalWhole.exec(trimmed.replace(originalWrapping, ''))?.[1];
    if (candidate === undefined) return null;
    const ascii = normalizeLinkHost(candidate);
    if (ascii === null) return null;
    return (ascii.split('.').pop() ?? '').length >= 2 ? ascii : null;
  };

  it('50 000 "!" around a host and 25 000 × "a." are scanned quickly', () => {
    expect(fast(() => hostInText(`example.com${'!'.repeat(N)}`))).toBe('example.com');
    expect(fast(() => hostInText(`${'!'.repeat(N)}x`))).toBeNull();
    expect(fast(() => hostInText('a.'.repeat(N / 2)))).toBeNull();
    expect(fast(() => hostInText(`${'a-'.repeat(N / 2)} https://x.example.com`))).toBe(
      'x.example.com',
    );
  });

  it('matches the original regexes on random input', () => {
    const tokens = [
      'a',
      'w',
      'www.',
      'WWW.',
      'https://',
      '://',
      'x.co',
      '.',
      '-',
      '+',
      '1',
      ':',
      '/',
      '@',
      ' ',
      '!',
      '(',
      ')',
      '"',
      '«',
      '_',
      'ſ',
      'K',
      'é',
      'user@',
      ':8080',
      '?q',
    ];
    for (const s of samples(10, tokens, 6000, 12)) expect(hostInText(s)).toBe(oracle(s));
  });
});

describe('CodeQL js/regex/missing-regexp-anchor: grounding/verify.ts:227', () => {
  it.each([
    ['due_at', 'amount', 'explain.unverified.due_at'],
    ['deadline', 'text', 'explain.unverified.due_at'],
    ['meeting_date', 'date', 'explain.unverified.due_at'],
    ['starts_at', 'date', 'explain.unverified.due_at'],
    ['overdue_flag', 'date', 'explain.unverified.due_at'],
    ['at_home', 'date', 'common.provenance.notConfirmed'],
    ['date_note', 'text', 'common.provenance.notConfirmed'],
    ['total_amount', 'text', 'explain.unverified.amount'],
  ] as const)('%s (%s) → %s', (field, kind, key) => {
    expect(unverifiedMessage(field, kind).key).toBe(key);
  });

  it('agrees with /^(due|deadline)/ || (date && /(?:date|due)|at$/) on random names', () => {
    for (const field of samples(11, ['due', 'dead', 'line', 'date', 'at', '_', 'x', 'a', 't'])) {
      const expected = /^(due|deadline)/.test(field) || /(?:date|due)|at$/.test(field);
      expect(unverifiedMessage(field, 'date').key === 'explain.unverified.due_at').toBe(expected);
    }
  });
});

describe('CodeQL js/prototype-polluting-assignment: entitlements/limits.ts:171', () => {
  it('a "__proto__" row is an unknown key and never touches Object.prototype', () => {
    const r = parsePlanLimitRows([{ plan: 'free', key: '__proto__', value: { polluted: true } }]);
    expect(r).toEqual({
      ok: false,
      issues: [{ plan: 'free', key: '__proto__', problem: 'unknown_key' }],
    });
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });
});
