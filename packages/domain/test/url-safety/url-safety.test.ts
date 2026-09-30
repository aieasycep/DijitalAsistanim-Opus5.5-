import { describe, expect, it } from 'vitest';
import {
  CONFERENCING_HOSTS,
  assessLink,
  checkConferencingUrl,
  detectAnchorMismatch,
  displayHost,
  hostInText,
  isAllowedLinkScheme,
  isConferencingHost,
  isConferencingUrl,
  parseLink,
  siteOf,
} from '../../src/url-safety.ts';

/** The `calendar_events.conference_url` check constraint (DATABASE_AND_RLS_PLAN §4.3). */
const DB_CONFERENCE_URL_CHECK =
  /^https:\/\/(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|([a-z0-9-]+\.)?zoom\.us)\//;

describe('scheme allow-list (https:, mailto:)', () => {
  it.each([
    ['https://example.com/', true],
    ['HTTPS://EXAMPLE.COM', true],
    ['mailto:ayse@example.com', true],
    ['MAILTO:ayse@example.com?subject=Merhaba', true],
    ['http://example.com/', false],
    ['javascript:alert(1)', false],
    [' javascript:alert(1)', false],
    ['java\nscript:alert(1)', false],
    ['data:text/html;base64,PHNjcmlwdD4=', false],
    ['file:///etc/passwd', false],
    ['ftp://example.com/', false],
    ['tel:+905551112233', false],
    ['//example.com/path', false],
    ['/relative/path', false],
    ['', false],
  ])('%j → %s', (href, allowed) => {
    expect(isAllowedLinkScheme(href)).toBe(allowed);
  });
});

describe('link parsing matches WHATWG host handling', () => {
  it.each([
    'https://Example.COM/a/b?c=d#e',
    'https://example.com:443/',
    'https://example.com:8443/x',
    'https://user:pw@example.com/',
    'https:\\\\example.com\\path',
    'https:example.com/path',
    'https://ex%61mple.com/',
    'https://0x7f.0.0.1/',
    'https://2130706433/',
    'https://[::FFFF:127.0.0.1]/',
    'https://münchen.de/',
    'https://ışık.com.tr/',
    'https://xn--mnchen-3ya.de/',
    'https://example.com./',
    '  https://example.com/  ',
    'https://exa\tmple.com/',
  ])('%j', (href) => {
    const whatwg = new URL(href);
    const parsed = parseLink(href);
    expect(parsed).not.toBeNull();
    expect(parsed?.scheme).toBe(whatwg.protocol);
    expect(parsed?.host).toBe(whatwg.hostname.replace(/\.$/, ''));
    expect(parsed?.port).toBe(whatwg.port);
    expect(parsed?.hasCredentials).toBe(whatwg.username !== '' || whatwg.password !== '');
  });

  it.each([
    'https://exa mple.com/',
    'https://[::1/',
    'https://example.com:99999/',
    'https://a..b/',
    'no-scheme.example.com',
    'https://1.2.3.4.5/',
  ])('%j is not a valid link', (href) => {
    expect(parseLink(href)).toBeNull();
  });

  it('extracts the mailto recipient', () => {
    expect(parseLink('mailto:Ayse.Kaya@Example.com?subject=x')?.mailtoAddress).toBe(
      'ayse.kaya@example.com',
    );
    expect(parseLink('mailto:?subject=x')?.mailtoAddress).toBeNull();
  });
});

describe('IDN display', () => {
  it.each([
    ['example.com', 'example.com', false, null],
    ['münchen.de', 'münchen.de', false, null],
    ['xn--mnchen-3ya.de', 'münchen.de', false, null],
    ['ışık.com.tr', 'ışık.com.tr', false, null],
    ['çiçeksepeti.com', 'çiçeksepeti.com', false, null],
    // Cyrillic "а" inside a Latin label: classic homograph
    ['аpple.com', 'xn--pple-43d.com', true, 'mixed_script'],
    // whole-script Cyrillic look-alike of "apple"
    ['аррӏе.com', 'xn--80ak6aa92e.com', true, 'non_latin_script'],
    ['дом.рф', 'xn--d1aqf.xn--p1ai', true, 'non_latin_script'],
    ['xn--zz.example', 'xn--zz.example', true, 'invalid_punycode'],
  ])('%s is displayed as %s', (host, display, punycode, reason) => {
    const result = displayHost(host);
    expect(result.display).toBe(display);
    expect(result.shownAsPunycode).toBe(punycode);
    expect(result.reason).toBe(reason);
  });

  it('marks IDN hosts and leaves IP literals untouched', () => {
    expect(displayHost('münchen.de').isIdn).toBe(true);
    expect(displayHost('example.com').isIdn).toBe(false);
    expect(displayHost('[::1]').display).toBe('[::1]');
    expect(displayHost('127.0.0.1').display).toBe('127.0.0.1');
  });
});

describe('anchor text vs href mismatch', () => {
  it.each([
    ['https://www.garanti.com.tr/giris', 'https://garanti-giris.example/login', true],
    ['www.garanti.com.tr', 'https://www.garanti.com.tr/', false],
    ['garanti.com.tr', 'https://internet.garanti.com.tr/giris', false],
    ['https://www.paypal.com', 'https://paypal.com.evil.example/', true],
    ['Hesabınıza giriş yapın: https://www.akbank.com', 'https://akbank-dogrula.example/', true],
    ['<https://trendyol.com>', 'https://www.trendyol.com/siparis', false],
    ['destek@hepsiburada.com', 'mailto:destek@hepsiburada.com', false],
    ['destek@hepsiburada.com', 'mailto:destek@hepsi-burada.example', true],
    ['аpple.com', 'https://apple.com/', true],
    ['Siparişini görüntüle', 'https://tracking.example/abc', false],
    ['Buraya tıklayın.', 'https://example.com/', false],
    ['https://example.com', 'javascript:alert(1)', false],
  ])('%j → %j mismatch=%s', (text, href, mismatch) => {
    expect(detectAnchorMismatch(text, href).mismatch).toBe(mismatch);
  });

  it('extracts the host named by the text', () => {
    expect(hostInText('https://www.garanti.com.tr/giris')).toBe('www.garanti.com.tr');
    expect(hostInText('Detaylar: www.n11.com adresinde')).toBe('n11.com');
    expect(hostInText('Merhaba, 12.05.2026 tarihli faturanız')).toBeNull();
  });

  it('approximates the registrable domain, including Turkish second-level domains', () => {
    expect(siteOf('internet.garanti.com.tr')).toBe('garanti.com.tr');
    expect(siteOf('a.b.example.co.uk')).toBe('example.co.uk');
    expect(siteOf('mail.google.com')).toBe('google.com');
    expect(siteOf('example.com')).toBe('example.com');
    expect(siteOf('10.0.0.1')).toBe('10.0.0.1');
  });
});

describe('assessLink', () => {
  it('combines openability and warnings', () => {
    expect(assessLink('https://example.com/x')).toMatchObject({ openable: true, warnings: [] });
    expect(assessLink('http://example.com/x')).toMatchObject({
      openable: false,
      warnings: ['scheme_not_allowed'],
    });
    expect(assessLink('https://u:p@example.com/')).toMatchObject({
      openable: false,
      warnings: ['credentials'],
    });
    expect(assessLink('https://93.184.215.14/').warnings).toEqual(['ip_host']);
    expect(assessLink('https://аpple.com/').warnings).toEqual(['idn_punycode']);
    expect(assessLink('https://evil.example/', 'https://www.garanti.com.tr').warnings).toEqual([
      'anchor_mismatch',
    ]);
    expect(assessLink('mailto:ayse@example.com')).toMatchObject({ openable: true, warnings: [] });
    expect(assessLink('mailto:')).toMatchObject({ openable: false });
    expect(assessLink('not a link')).toMatchObject({ openable: false, warnings: ['invalid'] });
  });
});

describe('conferencing hand-off allow-list (SREQ-23)', () => {
  it.each([
    ['https://meet.google.com/abc-defg-hij', 'https://meet.google.com/abc-defg-hij'],
    [
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting',
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting',
    ],
    ['https://teams.live.com/meet/9876', 'https://teams.live.com/meet/9876'],
    ['https://us02web.zoom.us/j/1', 'https://us02web.zoom.us/j/1'],
    ['https://zoom.us/j/123?pwd=abc', 'https://zoom.us/j/123?pwd=abc'],
    ['HTTPS://MEET.GOOGLE.COM/abc-defg-hij', 'https://meet.google.com/abc-defg-hij'],
    ['https://meet.google.com', 'https://meet.google.com/'],
    ['https://meet.google.com./abc', 'https://meet.google.com/abc'],
    ['https://meet.google.com:443/abc', 'https://meet.google.com/abc'],
  ])('%s is allowed as %s', (raw, normalized) => {
    const result = checkConferencingUrl(raw);
    expect(result).toMatchObject({ ok: true, url: normalized });
    expect(normalized).toMatch(DB_CONFERENCE_URL_CHECK);
  });

  it.each([
    ['http://meet.google.com/abc', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['https://evil.com/meet.google.com', 'host'],
    ['https://meet.google.com.evil.com/abc', 'host'],
    ['https://evilmeet.google.com/abc', 'host'],
    ['https://a.b.zoom.us/j/1', 'host'],
    ['https://zoom.us.evil.com/j/1', 'host'],
    ['https://notzoom.us/j/1', 'host'],
    ['https://user@meet.google.com/abc', 'credentials'],
    ['https://meet.google.com:8443/abc', 'port'],
    ['meet.google.com/abc', 'invalid'],
  ])('%s is rejected (%s)', (raw, reason) => {
    expect(checkConferencingUrl(raw)).toEqual({ ok: false, reason });
    expect(isConferencingUrl(raw)).toBe(false);
  });

  it('every allow-listed host passes the database check', () => {
    for (const host of CONFERENCING_HOSTS) {
      expect(isConferencingHost(host)).toBe(true);
      expect(`https://${host}/x`).toMatch(DB_CONFERENCE_URL_CHECK);
    }
  });

  it('encodes characters that are unsafe in a stored URL', () => {
    expect(checkConferencingUrl('https://zoom.us/j/1?x=a b"c')).toMatchObject({
      ok: true,
      url: 'https://zoom.us/j/1?x=a%20b%22c',
    });
  });
});
