import { describe, expect, it } from 'vitest';
import {
  checkFetchTarget,
  checkResolvedAddresses,
  type FetchTargetParts,
} from '../../src/net/fetch-policy.ts';

/** The fetcher hands the policy the WHATWG URL it parsed; the tests do the same. */
function parts(url: string): FetchTargetParts {
  const u = new URL(url);
  return {
    protocol: u.protocol,
    username: u.username,
    password: u.password,
    hostname: u.hostname,
    port: u.port,
  };
}

const SELF = { selfHosts: ['abcd.supabase.co', 'api.dijitalasistan.app', 'dijitalasistan.app'] };

describe('UT-SSRF-04 URL policy before DNS', () => {
  it.each([
    ['http://example.com/', 'insecure_scheme', 'scheme'],
    ['file:///etc/passwd', 'insecure_scheme', 'scheme'],
    ['ftp://example.com/x', 'insecure_scheme', 'scheme'],
    ['javascript:alert(1)', 'insecure_scheme', 'scheme'],
    ['data:text/html,hi', 'insecure_scheme', 'scheme'],
    ['gopher://example.com/', 'insecure_scheme', 'scheme'],
    ['https://u@example.com/', 'invalid_url', 'credentials'],
    ['https://u:p@example.com/', 'invalid_url', 'credentials'],
    ['https://example.com:8443/', 'invalid_url', 'port'],
    ['https://example.com:80/', 'invalid_url', 'port'],
    ['https://metadata.google.internal/computeMetadata/v1/', 'blocked_address', 'blocked_hostname'],
    ['https://localhost/', 'blocked_address', 'blocked_hostname'],
    ['https://localhost./', 'blocked_address', 'blocked_hostname'],
    ['https://api.localhost/', 'blocked_address', 'blocked_hostname'],
    ['https://printer.local/', 'blocked_address', 'blocked_hostname'],
    ['https://svc.internal/', 'blocked_address', 'blocked_hostname'],
    ['https://router.home.arpa/', 'blocked_address', 'blocked_hostname'],
    ['https://abcd.supabase.co/functions/v1/worker', 'blocked_address', 'self_host'],
    ['https://api.dijitalasistan.app/x', 'blocked_address', 'self_host'],
    ['https://www.dijitalasistan.app/', 'blocked_address', 'self_host'],
    ['https://127.0.0.1/', 'blocked_address', 'ip_blocked'],
    ['https://2130706433/', 'blocked_address', 'ip_blocked'],
    ['https://0177.0.0.1/', 'blocked_address', 'ip_blocked'],
    ['https://0x7f.0.0.1/', 'blocked_address', 'ip_blocked'],
    ['https://[::1]/', 'blocked_address', 'ip_blocked'],
    ['https://[::ffff:169.254.169.254]/', 'blocked_address', 'ip_blocked'],
    ['https://[fd00:ec2::254]/', 'blocked_address', 'ip_blocked'],
    ['https://169.254.169.254/latest/meta-data/', 'blocked_address', 'ip_blocked'],
  ])('%s → %s (%s)', (url, code, detail) => {
    const result = checkFetchTarget(parts(url), SELF);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(code);
      expect(result.detail).toBe(detail);
    }
  });

  it.each([
    ['https://example.com/a?b=1', 'example.com', null],
    ['https://example.com:443/', 'example.com', null],
    ['https://www.trendyol.com/', 'www.trendyol.com', null],
    ['https://münchen.de/', 'xn--mnchen-3ya.de', null],
    ['https://93.184.215.14/', '93.184.215.14', '93.184.215.14'],
    ['https://[2606:4700:4700::1111]/', '[2606:4700:4700::1111]', '2606:4700:4700::1111'],
    ['https://notdijitalasistan.app/', 'notdijitalasistan.app', null],
  ])('%s is allowed (host %s)', (url, host, ip) => {
    expect(checkFetchTarget(parts(url), SELF)).toEqual({ ok: true, host, ip });
  });

  it('re-validates raw host strings defensively (decimal/hex hosts, bad labels, long hosts)', () => {
    const base = { protocol: 'https:', username: '', password: '', port: '' };
    expect(checkFetchTarget({ ...base, hostname: '0x7f000001' })).toMatchObject({
      ok: false,
      code: 'blocked_address',
      ipReason: 'loopback',
    });
    expect(checkFetchTarget({ ...base, hostname: '' })).toMatchObject({
      ok: false,
      detail: 'host_empty',
    });
    expect(checkFetchTarget({ ...base, hostname: 'a..b' })).toMatchObject({
      ok: false,
      detail: 'host_invalid',
    });
    expect(checkFetchTarget({ ...base, hostname: 'bad_host.com' })).toMatchObject({
      ok: false,
      detail: 'host_invalid',
    });
    expect(checkFetchTarget({ ...base, hostname: '1.2.3.4.5' })).toMatchObject({
      ok: false,
      detail: 'host_invalid',
    });
    expect(checkFetchTarget({ ...base, hostname: `${'a'.repeat(250)}.com` })).toMatchObject({
      ok: false,
      detail: 'host_too_long',
    });
    expect(
      checkFetchTarget({ ...base, protocol: 'HTTPS:', hostname: 'example.com' }),
    ).toMatchObject({ ok: true });
  });
});

describe('address vetting after DNS (every A/AAAA record must be allowed)', () => {
  it('picks the first allowed address when all are public', () => {
    expect(
      checkResolvedAddresses(['93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c']),
    ).toEqual({
      ok: true,
      vettedIp: '93.184.215.14',
    });
  });

  it('rejects a host with one private record among public ones (dns_mixed_private)', () => {
    const result = checkResolvedAddresses(['93.184.215.14', '10.0.0.1']);
    expect(result).toMatchObject({ ok: false, code: 'dns_mixed_private' });
  });

  it('rejects a host whose records are all blocked (blocked_address)', () => {
    expect(checkResolvedAddresses(['127.0.0.1', '::1'])).toMatchObject({
      ok: false,
      code: 'blocked_address',
    });
  });

  it('rejects an empty answer and non-IP data', () => {
    expect(checkResolvedAddresses([])).toMatchObject({ ok: false, code: 'unresolvable' });
    expect(checkResolvedAddresses(['example.com'])).toMatchObject({
      ok: false,
      code: 'blocked_address',
      blocked: [{ address: 'example.com', reason: 'not_an_ip' }],
    });
  });
});
