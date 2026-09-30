import { isIP } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  classifyIp,
  formatIpv6,
  hostEndsInNumber,
  isBlockedIp,
  normalizeIp,
  parseIpv4Loose,
  parseIpv6,
} from '../../src/net/ip-ranges.ts';

describe('UT-SSRF-01 blocked literals', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['::1', 'loopback'],
    ['0.0.0.0', 'this_network'],
    ['10.0.0.5', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['169.254.169.254', 'metadata'],
    ['169.254.1.1', 'link_local'],
    ['100.64.0.1', 'cgnat'],
    ['100.127.255.255', 'cgnat'],
    ['100.100.100.200', 'metadata'],
    ['fc00::1', 'ula'],
    ['fd12:3456::1', 'ula'],
    ['fd00:ec2::254', 'metadata'],
    ['fe80::1', 'link_local'],
    ['fec0::1', 'site_local'],
    ['ff02::1', 'multicast'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
    ['192.0.0.8', 'ietf_reserved'],
    ['192.0.2.10', 'documentation'],
    ['198.51.100.7', 'documentation'],
    ['203.0.113.9', 'documentation'],
    ['192.88.99.1', 'relay_6to4'],
    ['198.18.0.1', 'benchmarking'],
    ['198.19.255.255', 'benchmarking'],
    ['::', 'unspecified'],
    ['100::1', 'discard'],
    ['2001:db8::1', 'documentation'],
    ['2001::1', 'teredo'],
    ['2001:100::1', 'ietf_protocol'],
    ['3fff::1', 'documentation'],
  ])('%s is blocked (%s)', (address, reason) => {
    const result = classifyIp(address);
    expect(result?.blocked).toBe(true);
    expect(result?.reason).toBe(reason);
  });
});

describe('UT-SSRF-02 IPv6 forms that embed IPv4', () => {
  it.each([
    ['::ffff:127.0.0.1', 'loopback', '127.0.0.1'],
    ['::ffff:7f00:1', 'loopback', '127.0.0.1'],
    ['::ffff:169.254.169.254', 'metadata', '169.254.169.254'],
    ['64:ff9b::a00:1', 'private', '10.0.0.1'],
    ['64:ff9b::10.0.0.1', 'private', '10.0.0.1'],
    ['::10.0.0.1', 'private', '10.0.0.1'],
    // Translated/mapped ranges are blocked outright, even around a public IPv4.
    ['::ffff:93.184.215.14', 'ipv4_mapped', '93.184.215.14'],
    ['64:ff9b::5db8:d70e', 'nat64', '93.184.215.14'],
  ])('%s → blocked (%s), embedded %s', (address, reason, embedded) => {
    const result = classifyIp(address);
    expect(result?.blocked).toBe(true);
    expect(result?.reason).toBe(reason);
    expect(result?.embeddedIpv4).toBe(embedded);
  });

  it.each([
    ['2002:0a00:0001::', 'six_to_four'],
    ['2002:5db8:d70e::1', 'six_to_four'],
    ['64:ff9b:1::1', 'nat64'],
  ])('%s is blocked outright (%s)', (address, reason) => {
    expect(classifyIp(address)?.reason).toBe(reason);
  });
});

describe('UT-SSRF-03 decimal, octal and hex IPv4 encodings', () => {
  it.each([
    ['2130706433', '127.0.0.1'],
    ['0177.0.0.1', '127.0.0.1'],
    ['0x7f.0.0.1', '127.0.0.1'],
    ['0x7F000001', '127.0.0.1'],
    ['0x7f.1', '127.0.0.1'],
    ['127.1', '127.0.0.1'],
    ['127.0.1', '127.0.0.1'],
    ['017700000001', '127.0.0.1'],
    ['0x0000007f.0.0.1', '127.0.0.1'],
    ['3232235777', '192.168.1.1'],
    ['0xa9.0xfe.0xa9.0xfe', '169.254.169.254'],
    ['0251.0376.0251.0376', '169.254.169.254'],
    ['2852039166', '169.254.169.254'],
    ['0', '0.0.0.0'],
    ['10.0.0.5.', '10.0.0.5'],
  ])('%s normalises to %s and is blocked', (input, normalized) => {
    expect(normalizeIp(input)).toBe(normalized);
    expect(isBlockedIp(input)).toBe(true);
  });

  it('matches the WHATWG URL host parser for every encoding', () => {
    const inputs = [
      '2130706433',
      '0177.0.0.1',
      '0x7f.0.0.1',
      '127.1',
      '0x7f.1',
      '1.2.3',
      '0x1.0x2.0x3.0x4',
      '010.010.010.010',
      '4294967295',
      '0xffffffff',
      '93.184.215.14',
    ];
    for (const input of inputs) {
      const whatwg = new URL(`https://${input}/`).hostname;
      const value = parseIpv4Loose(input);
      expect(value, input).not.toBeNull();
      expect(normalizeIp(input), input).toBe(whatwg);
    }
  });

  it.each([
    '256.0.0.1',
    '1.2.3.4.5',
    '4294967296',
    '0x100000000',
    '08.0.0.1',
    '1..2.3',
    '0xg.1.1.1',
    '',
  ])('%s is not a valid IPv4 host', (input) => {
    expect(parseIpv4Loose(input)).toBeNull();
  });

  it('recognises hosts that must parse as IPv4 (WHATWG "ends in a number")', () => {
    expect(hostEndsInNumber('example.com')).toBe(false);
    expect(hostEndsInNumber('1.2.3.4')).toBe(true);
    expect(hostEndsInNumber('foo.0x10')).toBe(true);
    expect(hostEndsInNumber('foo.123.')).toBe(true);
    expect(hostEndsInNumber('.')).toBe(false);
  });
});

describe('UT-SSRF-05 public addresses', () => {
  it.each([
    '93.184.215.14',
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700:4700::1111',
    '2a00:1450:4001:80b::200e',
  ])('%s is allowed', (address) => {
    const result = classifyIp(address);
    expect(result?.blocked).toBe(false);
    expect(result?.reason).toBeNull();
  });

  it('returns null for DNS names', () => {
    expect(classifyIp('example.com')).toBeNull();
    expect(isBlockedIp('localhost')).toBe(false);
  });
});

describe('IPv6 parsing and formatting', () => {
  it.each([
    ['::1', '::1'],
    ['[::1]', '::1'],
    ['0:0:0:0:0:0:0:1', '::1'],
    ['2001:DB8:0:0:1:0:0:1', '2001:db8::1:0:0:1'],
    ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'],
    ['fe80:0000:0000:0000:0204:61ff:fe9d:f156', 'fe80::204:61ff:fe9d:f156'],
    ['::ffff:192.168.1.1', '::ffff:c0a8:101'],
    ['64:ff9b::10.0.0.1', '64:ff9b::a00:1'],
    ['1::', '1::'],
  ])('%s formats as %s', (input, expected) => {
    const groups = parseIpv6(input);
    expect(groups).not.toBeNull();
    expect(formatIpv6(groups ?? [])).toBe(expected);
    expect(isIP(expected)).toBe(6);
    expect(new URL(`https://[${input.replace(/^\[|\]$/g, '')}]/`).hostname).toBe(`[${expected}]`);
  });

  it.each([
    ':::',
    '1:2:3:4:5:6:7:8:9',
    '1::2::3',
    'fe80::1%eth0',
    '12345::',
    '::ffff:1.2.3',
    'g::1',
    ':1::',
    '1:2:3:4:5:6:7::8',
  ])('%s is rejected', (input) => {
    expect(parseIpv6(input)).toBeNull();
  });
});
