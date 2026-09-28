/**
 * M-MAIL-03 "Orijinal Mail" text projection. CodeQL js/incomplete-multi-character-sanitization at
 * EmailDetailScreen.tsx:84 and :87 (security-nightly, TST-CI-08): the regex tag stripping became a
 * one-pass tokenizer, so nested payloads never reassemble into tags, script/style contents are
 * skipped and entities are decoded once. The body renders as text only.
 */
import { describe, expect, it } from '@jest/globals';

import { decodeEntities, originalToText } from '../src/features/mail/original-text';

const N = 50_000;
/**
 * Generous for a coverage-instrumented Jest run next to other suites; the tokenizer is linear,
 * while the regexes it replaced needed about 2 s for 50 000 "<" without instrumentation.
 */
const BUDGET_MS = 1000;
const TAG_OPENER = /<[A-Za-z!/?]/;

function fast<T>(fn: () => T): T {
  const start = performance.now();
  const value = fn();
  expect(performance.now() - start).toBeLessThan(BUDGET_MS);
  return value;
}

describe('originalToText: sanitised mail as text', () => {
  it('reads the sanitiser output: blocks become lines, links come from data-href', () => {
    const html =
      '<p>Merhaba <b>Ahmet</b>,</p><p>Teklif: <a href="da-link:0" data-href="https://example.com/t?a=1&amp;b=2" rel="noopener noreferrer nofollow">Teklifi gör</a></p>' +
      '<div>Fiyat &lt;100&gt; &amp; KDV&nbsp;dahil</div><ul><li>bir</li><li>iki</li></ul>satır<br>sonu';
    expect(originalToText('html_sanitized', html)).toEqual({
      text: 'Merhaba Ahmet,\nTeklif: Teklifi gör\nFiyat <100> & KDV dahil\nbir\niki\nsatır\nsonu',
      links: [{ href: 'https://example.com/t?a=1&b=2', text: 'Teklifi gör' }],
    });
  });

  it('keeps plain-text bodies as they are', () => {
    expect(originalToText('text', '<b>ham</b> metin')).toEqual({
      text: '<b>ham</b> metin',
      links: [],
    });
  });

  it('falls back to href, uses the target as the label, and skips anchors without a target', () => {
    const html =
      '<a href=\'https://a.example/x\'></a> <a href=https://b.example>B</a> <a name=x>C</a> <a data-href="https://c.example">&quot;C&quot;</a>';
    expect(originalToText('html_sanitized', html).links).toEqual([
      { href: 'https://a.example/x', text: 'https://a.example/x' },
      { href: 'https://b.example', text: 'B' },
      { href: 'https://c.example', text: '"C"' },
    ]);
  });

  it('an anchor left open at the end is not a link; a new anchor closes the previous one', () => {
    expect(originalToText('html_sanitized', 'a <a href="https://x.example">x').links).toEqual([]);
    expect(
      originalToText(
        'html_sanitized',
        '<a href="https://1.example">bir<a href="https://2.example">iki</a>',
      ).links,
    ).toEqual([
      { href: 'https://1.example', text: 'bir' },
      { href: 'https://2.example', text: 'iki' },
    ]);
  });

  it('collapses runs of blank lines', () => {
    expect(originalToText('html_sanitized', '<p>a</p><p></p><p></p><p></p><p>b</p>').text).toBe(
      'a\n\nb',
    );
  });
});

describe('CodeQL js/incomplete-multi-character-sanitization: EmailDetailScreen.tsx:84/:87', () => {
  it.each([
    ['<scr<script>ipt>alert(1)</script>', 'ipt>alert(1)'],
    ['<script>alert(1)</script>sonra', 'sonra'],
    ['<SCRIPT type="x">alert(1)</SCRIPT >sonra', 'sonra'],
    ['<style>p{color:red}</style>metin', 'metin'],
    ['<sty<style>le>p{}</style>metin', 'le>p{}metin'],
    ['<!-- <script>alert(1)</script> -->yorum', 'yorum'],
    ['önce<!-- açık yorum', 'önce'],
    ['<<script>script>alert(1)<</script>/script>', '/script>'],
    ['<<b>/b>x', '/b>x'],
    ['metin <img src=x onerror=alert(1)', 'metin'],
    ['<iframe src="https://x.example"><p>içerik</p></iframe>son', 'son'],
    ['<svg><script>alert(1)</script></svg>son', 'son'],
    ['<textarea><b>x</b></textarea>son', 'son'],
    ['a < b ve c<3', 'a < b ve c<3'],
  ])('%j → %j', (html, text) => {
    const out = originalToText('html_sanitized', html).text;
    expect(out).toBe(text);
    expect(out).not.toMatch(TAG_OPENER);
  });

  it('escaped markup in the mail stays text: decoded once, never parsed', () => {
    expect(originalToText('html_sanitized', '&lt;script&gt;alert(1)&lt;/script&gt;').text).toBe(
      '<script>alert(1)</script>',
    );
    expect(decodeEntities('&amp;lt;b&amp;gt; &amp;amp; &#39;x&#39; &quot;y&quot; &copy;')).toBe(
      '&lt;b&gt; &amp; \'x\' "y" &copy;',
    );
  });

  it('link labels never carry markup', () => {
    const html = '<a data-href="https://x.example"><scr<script>ipt>Tıkla</script></a>';
    expect(originalToText('html_sanitized', html).links).toEqual([
      { href: 'https://x.example', text: 'ipt>Tıkla' },
    ]);
  });

  it('is linear on long runs of "<", unterminated tags and many elements', () => {
    expect(fast(() => originalToText('html_sanitized', '<'.repeat(N)).text)).toBe('<'.repeat(N));
    expect(fast(() => originalToText('html_sanitized', '<a '.repeat(N)).text)).toBe('');
    expect(fast(() => originalToText('html_sanitized', '<p>a</p>'.repeat(N)).text)).toBe(
      Array.from({ length: N }, () => 'a').join('\n'),
    );
    const anchors = '<a data-href="https://x.example">x</a>'.repeat(N / 10);
    expect(fast(() => originalToText('html_sanitized', anchors).links)).toHaveLength(N / 10);
    expect(fast(() => originalToText('html_sanitized', `<script>${'<'.repeat(N)}`).text)).toBe('');
  });
});
