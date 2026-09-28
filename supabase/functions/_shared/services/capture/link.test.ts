/**
 * CodeQL js/double-escaping at link.ts:45 (security-nightly, TST-CI-08): the link-preview title is
 * entity-decoded in one pass, so `&amp;lt;` stays the text `&lt;` instead of turning into `<`.
 */
import { assertEquals } from '@std/assert';
import type { DnsResolver } from '../../security/ssrf-fetch.ts';
import { stubFetch } from '../../testing/fetch.ts';
import { decodeTitleEntities, linkPreview } from './link.ts';

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
