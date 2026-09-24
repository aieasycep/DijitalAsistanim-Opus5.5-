import { domainToASCII, domainToUnicode } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  decodeLabel,
  punycodeDecode,
  punycodeEncode,
  toAsciiHost,
  toUnicodeHost,
} from '../../src/net/punycode.ts';

describe('RFC 3492 punycode', () => {
  it.each([
    ['bücher', 'bcher-kva'],
    ['münchen', 'mnchen-3ya'],
    ['他们为什么不说中文', 'ihqwcrb4cv8a8dqg056pqjye'],
    ['ليهمابتكلموشعربي؟', 'egbpdaj6bu4bxfgehfvwxn'],
    ['Pročprostěnemluvíčesky', 'Proprostnemluvesky-uyb24dma41a'],
    ['abc', 'abc-'],
  ])('%s ↔ %s', (unicode, encoded) => {
    expect(punycodeEncode(unicode)).toBe(encoded);
    expect(punycodeDecode(encoded)).toBe(unicode);
  });

  it.each(['a9', '99999999999999999', 'ü-abc'])('rejects malformed input %s', (input) => {
    expect(() => punycodeDecode(input)).toThrow(RangeError);
  });
});

describe('host conversion matches Node (WHATWG/UTS #46) for common hosts', () => {
  const hosts = [
    'example.com',
    'EXAMPLE.com',
    'münchen.de',
    'ışık.com.tr',
    'çiçek.com',
    'şeker.net',
    'göğüs.org.tr',
    'дом.рф',
    'аpple.com',
    'παράδειγμα.δοκιμή',
    '例え.jp',
    'xn--bcher-kva.example',
  ];
  it.each(hosts)('%s', (host) => {
    expect(toAsciiHost(host)).toBe(domainToASCII(host));
    const ascii = domainToASCII(host);
    expect(toUnicodeHost(ascii)).toBe(domainToUnicode(ascii));
  });

  it('maps ideographic full stops to dots', () => {
    expect(toAsciiHost('münchen。de')).toBe('xn--mnchen-3ya.de');
  });

  it('rejects non-canonical or malformed xn-- labels', () => {
    expect(decodeLabel('xn--abc')).toBeNull();
    expect(decodeLabel('xn--')).toBeNull();
    expect(toAsciiHost('xn--zz.example')).toBeNull();
    expect(toUnicodeHost('xn--zz.example')).toBeNull();
    expect(decodeLabel('plain')).toBe('plain');
    expect(toAsciiHost('bad\u0085label.com')).toBeNull();
    expect(toAsciiHost('a b.com')).toBeNull();
  });
});
