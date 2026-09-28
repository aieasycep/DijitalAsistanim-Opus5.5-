/**
 * Edge cases of the link parser and IDN display rules (SECURITY_AND_PRIVACY_PLAN link safety;
 * TEST_PLAN §16 domain 95/90/95): every non-Latin script is shown as punycode, malformed hosts
 * and ports are rejected, and default ports are stripped the WHATWG way.
 */
import { describe, expect, it } from 'vitest';

import { relevanceScoreFor } from '../../src/notifications/channels.ts';
import { displayHost, hostInText, normalizeLinkHost, parseLink } from '../../src/url-safety.ts';

describe('displayHost: non-Latin scripts are shown as punycode', () => {
  it.each([
    ['greek', 'αβγ.com'],
    ['armenian', 'աբգ.com'],
    ['hebrew', 'אבג.com'],
    ['arabic', 'مثال.com'],
    ['cjk', '例え.com'],
    ['hangul', '한국.com'],
    ['thai', 'ไทย.com'],
    ['devanagari', 'भारत.com'],
    ['georgian', 'საქ.com'],
    ['other (Ethiopic)', 'ሀሁ.com'],
  ])('%s: %s', (_script, host) => {
    const shown = displayHost(host);
    expect(shown.isIdn).toBe(true);
    expect(shown.shownAsPunycode).toBe(true);
    expect(shown.reason).toBe('non_latin_script');
    expect(shown.display.startsWith('xn--')).toBe(true);
  });

  it('flags Latin mixed with Cyrillic, keeps Latin-script IDNs readable', () => {
    expect(displayHost('pаypal.com').reason).toBe('mixed_script');
    const turkish = displayHost('çiçek.com.tr');
    expect(turkish.reason).toBeNull();
    expect(turkish.display).toBe('çiçek.com.tr');
    expect(displayHost('ḃ.com').reason).toBeNull();
  });
});

describe('normalizeLinkHost', () => {
  it('accepts bracketed IPv6 only', () => {
    expect(normalizeLinkHost('[::1]')).toBe('[::1]');
    expect(normalizeLinkHost('[::1')).toBeNull();
    expect(normalizeLinkHost('[127.0.0.1]')).toBeNull();
  });

  it('rejects bad percent-encoding, empty labels and forbidden characters', () => {
    expect(normalizeLinkHost('%zz.com')).toBeNull();
    expect(normalizeLinkHost('a..b.com')).toBeNull();
    expect(normalizeLinkHost('.')).toBeNull();
    expect(normalizeLinkHost('')).toBeNull();
    expect(normalizeLinkHost('ex ample.com')).toBeNull();
  });

  it('decodes percent-encoding and drops the trailing dot', () => {
    expect(normalizeLinkHost('ex%61mple.com.')).toBe('example.com');
  });
});

describe('parseLink edge cases', () => {
  it('rejects an unterminated IPv6 literal and junk after it', () => {
    expect(parseLink('https://[::1/x')).toBeNull();
    expect(parseLink('https://[::1]x/')).toBeNull();
  });

  it('keeps an explicit port after an IPv6 literal', () => {
    expect(parseLink('https://[::1]:8443/')).toMatchObject({ host: '[::1]', port: '8443' });
  });

  it('rejects non-numeric and out-of-range ports, strips default ports', () => {
    expect(parseLink('https://example.com:99999/')).toBeNull();
    expect(parseLink('https://example.com:8a/')).toBeNull();
    expect(parseLink('https://example.com:443/')).toMatchObject({ port: '' });
    expect(parseLink('https://example.com:0080/')).toMatchObject({ port: '80' });
  });

  it('parses a non-special scheme with and without an authority', () => {
    expect(parseLink('ftp2://files.example.com/a')).toMatchObject({ host: 'files.example.com' });
    expect(parseLink('tel:+905551112233')).toMatchObject({ scheme: 'tel:', host: null });
  });

  it('handles mailto without a valid address', () => {
    expect(parseLink('mailto:%zz@example.com')).toBeNull();
    expect(parseLink('mailto:nobody')).toMatchObject({ host: null, mailtoAddress: null });
    expect(parseLink('mailto:ali@Example.COM?subject=x')).toMatchObject({
      host: 'example.com',
      mailtoAddress: 'ali@example.com',
    });
  });

  it('returns null without a scheme', () => {
    expect(parseLink('example.com/path')).toBeNull();
  });
});

describe('hostInText', () => {
  it('needs a top-level domain of two or more letters', () => {
    expect(hostInText('example.c')).toBeNull();
    expect(hostInText('nothing here')).toBeNull();
    expect(hostInText('(example.com)')).toBe('example.com');
  });
});

describe('relevanceScoreFor (iOS summary ordering)', () => {
  it.each([
    ['meeting', 'normal', 0.8],
    ['reminder', 'normal', 0.8],
    ['deadline', 'urgent', 0.8],
    ['deadline', 'today', 0.6],
    ['morning', 'normal', 0.6],
    ['approval', 'normal', 0.6],
    ['account', 'normal', 0.5],
    ['follow_up', 'normal', 0.4],
    ['life_intel', 'normal', 0.4],
    ['evening', 'normal', 0.3],
  ] as const)('%s / %s → %s', (kind, urgency, score) => {
    expect(relevanceScoreFor(kind, urgency)).toBe(score);
  });
});
