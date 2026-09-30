/**
 * M-MAIL-03 "Orijinal Mail" text projection. CodeQL js/incomplete-multi-character-sanitization at
 * EmailDetailScreen.tsx:84 and :87 (security-nightly, TST-CI-08): the regex tag stripping became a
 * one-pass tokenizer, so nested payloads never reassemble into tags, script/style contents are
 * skipped and entities are decoded once. The body renders as text only.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { decodeEntities, originalToText } from '../src/features/mail/original-text';

const N = 50_000;

/**
 * Growth-rate check rather than a wall-clock budget (a fixed 200 ms budget failed on a loaded CI
 * runner): `fn(n)` runs at N / 4 and at N, best of ROUNDS each, the two sizes taking turns so a
 * load spike slows both rather than only one. A linear scan grows about 4×; the quadratic
 * originals grow about 16× and took seconds at N. A run under FLOOR_MS passes outright.
 */
/** Each growth check runs its input 2 × ROUNDS times, over jest's 5 s default on a CI runner. */
jest.setTimeout(30_000);

const FLOOR_MS = 100;
const MAX_GROWTH = 8;
const ROUNDS = 3;
/** For an input built outside the call (fixed size): best of three within a generous budget. */
const BOUNDED_MS = 1000;

/**
 * Thread CPU time rather than wall-clock: on a busy runner a long run is preempted far more often
 * than a short one, which inflated the ratio of a linear scan past MAX_GROWTH.
 */
function timedRun<T>(fn: () => T): { value: T; ms: number } {
  const start = process.threadCpuUsage();
  const value = fn();
  const used = process.threadCpuUsage(start);
  return { value, ms: (used.user + used.system) / 1000 };
}

function best<T>(fn: () => T): { value: T; ms: number } {
  let run = timedRun(fn);
  for (let i = 0; i < 2; i++) {
    const next = timedRun(fn);
    if (next.ms < run.ms) run = next;
  }
  return run;
}

function linear<T>(fn: (n: number) => T): T {
  let small = timedRun(() => fn(N / 4)).ms;
  let large = timedRun(() => fn(N));
  for (let i = 1; i < ROUNDS; i++) {
    small = Math.min(small, timedRun(() => fn(N / 4)).ms);
    const next = timedRun(() => fn(N));
    if (next.ms < large.ms) large = next;
  }
  const ok = large.ms < FLOOR_MS || large.ms < MAX_GROWTH * Math.max(small, 1);
  expect(ok ? 'linear' : `${large.ms.toFixed(1)} ms at N vs ${small.toFixed(1)} ms at N / 4`).toBe(
    'linear',
  );
  return large.value;
}

function bounded<T>(fn: () => T): T {
  const run = best(fn);
  expect(run.ms).toBeLessThan(BOUNDED_MS);
  return run.value;
}
const TAG_OPENER = /<[A-Za-z!/?]/;

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
    expect(linear((N) => originalToText('html_sanitized', '<'.repeat(N)).text)).toBe('<'.repeat(N));
    expect(linear((N) => originalToText('html_sanitized', '<a '.repeat(N)).text)).toBe('');
    expect(linear((N) => originalToText('html_sanitized', '<p>a</p>'.repeat(N)).text)).toBe(
      Array.from({ length: N }, () => 'a').join('\n'),
    );
    const anchors = '<a data-href="https://x.example">x</a>'.repeat(N / 10);
    expect(bounded(() => originalToText('html_sanitized', anchors).links)).toHaveLength(N / 10);
    expect(linear((N) => originalToText('html_sanitized', `<script>${'<'.repeat(N)}`).text)).toBe(
      '',
    );
  });
});
