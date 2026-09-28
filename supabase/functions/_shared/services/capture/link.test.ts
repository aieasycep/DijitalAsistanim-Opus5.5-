/**
 * CodeQL js/double-escaping at link.ts:45 (security-nightly, TST-CI-08): the link-preview title is
 * entity-decoded in one pass, so `&amp;lt;` stays the text `&lt;` instead of turning into `<`.
 */
import { assert, assertEquals } from '@std/assert';
import type { DnsResolver } from '../../security/ssrf-fetch.ts';
import { stubFetch } from '../../testing/fetch.ts';
import { decodeTitleEntities, linkPreview, titleOf } from './link.ts';

const resolver: DnsResolver = (_host, type) =>
  Promise.resolve(type === 'A' ? ['93.184.215.14'] : []);

function page(html: string) {
  return stubFetch(() => new Response(html, { headers: { 'Content-Type': 'text/html' } }));
}

Deno.test('CodeQL js/double-escaping: link.ts:45 decodes each title entity once', () => {
  assertEquals(decodeTitleEntities('Fiyat &amp; teslimat'), 'Fiyat & teslimat');
  assertEquals(
    decodeTitleEntities('&quot;Yeni&quot; &#39;sezon&#39; &lt;3 &gt;'),
    `"Yeni" 'sezon' <3 >`,
  );
  assertEquals(decodeTitleEntities('&amp;lt;script&amp;gt;'), '&lt;script&gt;');
  assertEquals(decodeTitleEntities('&amp;amp;quot;'), '&amp;quot;');
  assertEquals(decodeTitleEntities('&nbsp; &copy; &amp'), '&nbsp; &copy; &amp');
});

Deno.test(
  'link preview titles: og:title first, then <title>, decoded once and collapsed',
  async () => {
    const og = page(
      '<html><head><meta property="og:title" content="A &amp;lt;b&amp;gt; &amp; B"><title>x</title></head></html>',
    );
    assertEquals(await linkPreview('https://public.example/a', { fetch: og.fetch, resolver }), {
      title: 'A &lt;b&gt; & B',
      domain: 'public.example',
    });
    const plain = page('<html><head><title>  Kampanya\n  &quot;Ekim&quot;  </title></head></html>');
    assertEquals(await linkPreview('https://public.example/b', { fetch: plain.fetch, resolver }), {
      title: 'Kampanya "Ekim"',
      domain: 'public.example',
    });
  },
);

Deno.test('titleOf: og:title in either attribute order, case-insensitive, else <title>', () => {
  assertEquals(titleOf('<meta content="İçerik önce" property="og:title">'), 'İçerik önce');
  assertEquals(titleOf(`<META PROPERTY='OG:TITLE' CONTENT='Büyük harf'>`), 'Büyük harf');
  assertEquals(titleOf('<meta property=og:title content=Tırnaksız>'), 'Tırnaksız');
  assertEquals(titleOf('<meta name="x" content="y"><title>Yedek</title>'), 'Yedek');
  // An over-long og:title is skipped (as before); the next candidate wins.
  assertEquals(
    titleOf(`<meta property="og:title" content="${'a'.repeat(301)}"><title>Kısa</title>`),
    'Kısa',
  );
  assertEquals(titleOf('<title></title><title>İkinci</title>'), 'İkinci');
  assertEquals(titleOf('<meta property="og:title" content="x"'), null);
  assertEquals(titleOf('<title>açık kaldı'), null);
  assertEquals(titleOf('no markup at all'), null);
});

/**
 * Growth-rate check (the helpers of packages/domain/test/security/codeql-remediation.test.ts): best
 * of three at N / 4 and at N, the two sizes taken in turn so a load spike slows both; a linear scan
 * grows about 4×, the former `<meta[^>]+…` and `<title[^>]*>` regexes grew quadratically on
 * unclosed openers. A run under 100 ms passes outright. Wall-clock time: Deno 2.1 has no per-thread
 * CPU clock without `node:process` (which would add `@types/node` to the frozen lock).
 */
function assertLinear(run: (n: number) => void, n = 16_000): void {
  const timed = (size: number): number => {
    const start = performance.now();
    run(size);
    return performance.now() - start;
  };
  let small = Infinity;
  let large = Infinity;
  for (let i = 0; i < 3; i++) {
    small = Math.min(small, timed(n / 4));
    large = Math.min(large, timed(n));
  }
  assert(
    large < 100 || large < 8 * Math.max(small, 1),
    `${large.toFixed(1)} ms at n vs ${small.toFixed(1)} ms at n / 4`,
  );
}

Deno.test('CodeQL js/polynomial-redos: titleOf is linear on crafted 64 KiB previews', () => {
  // Thousands of unclosed `<meta` openers (the preview cap is 64 KiB).
  assertLinear((n) => assertEquals(titleOf('<meta property="og:title" '.repeat(n / 4)), null));
  // One meta tag with a long attribute-free run, then a real title.
  assertLinear((n) => assertEquals(titleOf(`<meta ${'a'.repeat(n * 4)}><title>T</title>`), 'T'));
  // Unclosed `<title` openers, and titles that never close.
  assertLinear((n) => assertEquals(titleOf('<title'.repeat(n)), null));
  assertLinear((n) => assertEquals(titleOf('<title><'.repeat(n)), null));
  assertLinear((n) => assertEquals(titleOf(`<meta content=${'x'.repeat(n * 4)}`), null));
});
