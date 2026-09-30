/**
 * CodeQL findings in the design copy extractor (security-nightly, TST-CI-08):
 * - js/double-escaping at extract-copy.ts:14: entities are decoded in one pass;
 * - js/incomplete-multi-character-sanitization at extract-copy.ts:28: style blocks are removed
 *   until none is left, so a block assembled by the removal itself goes too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, withoutStyleBlocks } from '../extract-copy.ts';

test('CodeQL js/double-escaping: extract-copy.ts:14 decodes each entity once', () => {
  assert.equal(decodeEntities('Fiyat &amp; teslimat'), 'Fiyat & teslimat');
  assert.equal(decodeEntities('&lt;b&gt;&nbsp;x'), '<b> x');
  assert.equal(decodeEntities('&amp;lt;script&amp;gt;'), '&lt;script&gt;');
  assert.equal(decodeEntities('&amp;amp;'), '&amp;');
  assert.equal(decodeEntities('&copy; &ampx'), '&copy; &ampx');
});

test('CodeQL js/incomplete-multi-character-sanitization: extract-copy.ts:28 leaves no <style', () => {
  assert.equal(withoutStyleBlocks('<p>a</p><style>p{}</style><p>b</p>'), '<p>a</p><p>b</p>');
  assert.equal(withoutStyleBlocks('<sty<style></style>le>x{}</style><p>b</p>'), '<p>b</p>');
  assert.equal(withoutStyleBlocks('<p>a</p><style>p{color:red}'), '<p>a</p>');
  assert.equal(withoutStyleBlocks('<<style></style>style>a</style>b'), 'b');
  for (const html of ['<sty<style></style>le>', '<style<style></style>></style>x', '<style']) {
    assert.ok(!withoutStyleBlocks(html).includes('<style'), html);
  }
});

test('style removal matches the single-pass regex on well-formed templates', () => {
  const html = '<div><style>.a{}</style><span>Metin</span><style media="x">.b{}</style></div>';
  assert.equal(withoutStyleBlocks(html), html.replace(/<style[\s\S]*?<\/style>/g, ''));
});
