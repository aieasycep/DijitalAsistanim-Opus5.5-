/**
 * IP address parsing and classification for the SSRF guard (SECURITY_AND_PRIVACY_PLAN CTL-3.10,
 * THR-07; TEST_PLAN UT-SSRF-01..05). Pure TypeScript: no Node `net`, no DNS, no globals.
 *
 * IPv4 host strings follow the WHATWG URL "IPv4 parser": one to four dot-separated parts, each
 * decimal, octal (leading `0`) or hex (`0x`), the last part filling the remaining bytes. So
 * `2130706433`, `0177.0.0.1`, `0x7f.0.0.1` and `127.1` all normalise to `127.0.0.1`.
 *
 * Every address is classified against the blocked-range table below. A single blocked address
 * rejects the whole host (the fetcher validates every A/AAAA record).
 */

export type IpBlockReason =
  | 'this_network'
  | 'private'
  | 'cgnat'
  | 'loopback'
  | 'link_local'
  | 'metadata'
  | 'ietf_reserved'
  | 'documentation'
  | 'relay_6to4'
  | 'benchmarking'
  | 'multicast'
  | 'reserved'
  | 'broadcast'
  | 'unspecified'
  | 'ipv4_mapped'
  | 'ipv4_compatible'
  | 'nat64'
  | 'discard'
  | 'teredo'
  | 'ietf_protocol'
  | 'six_to_four'
  | 'ula'
  | 'site_local';

export interface IpClassification {
  family: 4 | 6;
  /** Canonical text form (dotted quad, or the WHATWG serialisation for IPv6). */
  address: string;
  blocked: boolean;
  reason: IpBlockReason | null;
  /** For IPv4-mapped and NAT64 IPv6 addresses: the embedded IPv4 address. */
  embeddedIpv4: string | null;
}

interface Ipv4Range {
  base: number;
  bits: number;
  reason: IpBlockReason;
}

/** Most specific first: the first matching range gives the reason. */
const IPV4_BLOCKED: readonly Ipv4Range[] = [
  { base: ipv4(169, 254, 169, 254), bits: 32, reason: 'metadata' },
  { base: ipv4(100, 100, 100, 200), bits: 32, reason: 'metadata' },
  { base: ipv4(255, 255, 255, 255), bits: 32, reason: 'broadcast' },
  { base: ipv4(0, 0, 0, 0), bits: 8, reason: 'this_network' },
  { base: ipv4(10, 0, 0, 0), bits: 8, reason: 'private' },
  { base: ipv4(172, 16, 0, 0), bits: 12, reason: 'private' },
  { base: ipv4(192, 168, 0, 0), bits: 16, reason: 'private' },
  { base: ipv4(100, 64, 0, 0), bits: 10, reason: 'cgnat' },
  { base: ipv4(127, 0, 0, 0), bits: 8, reason: 'loopback' },
  { base: ipv4(169, 254, 0, 0), bits: 16, reason: 'link_local' },
  { base: ipv4(192, 0, 0, 0), bits: 24, reason: 'ietf_reserved' },
  { base: ipv4(192, 0, 2, 0), bits: 24, reason: 'documentation' },
  { base: ipv4(198, 51, 100, 0), bits: 24, reason: 'documentation' },
  { base: ipv4(203, 0, 113, 0), bits: 24, reason: 'documentation' },
  { base: ipv4(192, 88, 99, 0), bits: 24, reason: 'relay_6to4' },
  { base: ipv4(198, 18, 0, 0), bits: 15, reason: 'benchmarking' },
  { base: ipv4(224, 0, 0, 0), bits: 4, reason: 'multicast' },
  { base: ipv4(240, 0, 0, 0), bits: 4, reason: 'reserved' },
];

/** IPv6 ranges; `embedded` marks prefixes whose low 32 bits carry an IPv4 address. */
interface Ipv6Range {
  prefix: readonly number[];
  bits: number;
  reason: IpBlockReason;
  embedded?: true;
}

const IPV6_BLOCKED: readonly Ipv6Range[] = [
  { prefix: [0, 0, 0, 0, 0, 0, 0, 0], bits: 128, reason: 'unspecified' },
  { prefix: [0, 0, 0, 0, 0, 0, 0, 1], bits: 128, reason: 'loopback' },
  { prefix: [0, 0, 0, 0, 0, 0xffff, 0, 0], bits: 96, reason: 'ipv4_mapped', embedded: true },
  { prefix: [0, 0, 0, 0, 0, 0, 0, 0], bits: 96, reason: 'ipv4_compatible', embedded: true },
  { prefix: [0x64, 0xff9b, 0, 0, 0, 0, 0, 0], bits: 96, reason: 'nat64', embedded: true },
  { prefix: [0x64, 0xff9b, 1, 0, 0, 0, 0, 0], bits: 48, reason: 'nat64' },
  { prefix: [0x100, 0, 0, 0, 0, 0, 0, 0], bits: 64, reason: 'discard' },
  { prefix: [0x2001, 0xdb8, 0, 0, 0, 0, 0, 0], bits: 32, reason: 'documentation' },
  { prefix: [0x2001, 0, 0, 0, 0, 0, 0, 0], bits: 32, reason: 'teredo' },
  { prefix: [0x2001, 0, 0, 0, 0, 0, 0, 0], bits: 23, reason: 'ietf_protocol' },
  { prefix: [0x2002, 0, 0, 0, 0, 0, 0, 0], bits: 16, reason: 'six_to_four' },
  { prefix: [0x3fff, 0, 0, 0, 0, 0, 0, 0], bits: 20, reason: 'documentation' },
  { prefix: [0xfd00, 0xec2, 0, 0, 0, 0, 0, 0x254], bits: 128, reason: 'metadata' },
  { prefix: [0xfc00, 0, 0, 0, 0, 0, 0, 0], bits: 7, reason: 'ula' },
  { prefix: [0xfe80, 0, 0, 0, 0, 0, 0, 0], bits: 10, reason: 'link_local' },
  { prefix: [0xfec0, 0, 0, 0, 0, 0, 0, 0], bits: 10, reason: 'site_local' },
  { prefix: [0xff00, 0, 0, 0, 0, 0, 0, 0], bits: 8, reason: 'multicast' },
];

function ipv4(a: number, b: number, c: number, d: number): number {
  return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
}

const DECIMAL = /^[0-9]+$/;
const OCTAL = /^[0-7]+$/;
const HEX = /^[0-9a-f]*$/i;

/** One WHATWG IPv4 number part, or null when it is not a number in its radix. */
function parseIpv4Number(part: string): number | null {
  if (part === '') return null;
  let digits = part;
  let radix = 10;
  if (/^0x/i.test(part)) {
    digits = part.slice(2);
    radix = 16;
  } else if (part.length > 1 && part.startsWith('0')) {
    digits = part.slice(1);
    radix = 8;
  }
  if (digits === '') return 0;
  const pattern = radix === 16 ? HEX : radix === 8 ? OCTAL : DECIMAL;
  if (!pattern.test(digits)) return null;
  const significant = digits.replace(/^0+/, '');
  if (significant === '') return 0;
  // Anything longer than 2^32 in its radix is out of range; stop before precision loss.
  const maxLength = radix === 16 ? 8 : radix === 8 ? 11 : 10;
  if (significant.length > maxLength) return Number.POSITIVE_INFINITY;
  return parseInt(significant, radix);
}

/** WHATWG "ends in a number": the host must then parse as IPv4 or it is invalid. */
export function hostEndsInNumber(host: string): boolean {
  const parts = host.split('.');
  if (parts[parts.length - 1] === '') {
    if (parts.length === 1) return false;
    parts.pop();
  }
  const last = parts[parts.length - 1] ?? '';
  if (last !== '' && DECIMAL.test(last)) return true;
  return /^0x[0-9a-f]*$/i.test(last);
}

/**
 * Parses an IPv4 host string with WHATWG semantics (decimal, octal and hex parts; 1–4 parts).
 * Returns the address as an unsigned 32-bit integer, or null when the input is not IPv4.
 */
export function parseIpv4Loose(input: string): number | null {
  const parts = input.split('.');
  if (parts[parts.length - 1] === '' && parts.length > 1) parts.pop();
  if (parts.length === 0 || parts.length > 4) return null;
  const numbers: number[] = [];
  for (const part of parts) {
    const n = parseIpv4Number(part);
    if (n === null) return null;
    numbers.push(n);
  }
  const last = numbers[numbers.length - 1] ?? 0;
  for (let i = 0; i < numbers.length - 1; i++) {
    if ((numbers[i] ?? 0) > 255) return null;
  }
  if (last >= 256 ** (5 - numbers.length)) return null;
  let value = last;
  for (let i = 0; i < numbers.length - 1; i++) {
    value += (numbers[i] ?? 0) * 256 ** (3 - i);
  }
  return value;
}

/** Strict dotted-quad decimal (as used inside IPv6 text); no leading zeros. */
export function parseIpv4Strict(input: string): number | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

export function formatIpv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join('.');
}

/** Parses IPv6 text (optional brackets, `::` compression, dotted IPv4 tail). No zone ids. */
export function parseIpv6(input: string): number[] | null {
  let text = input;
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  if (text === '' || text.includes('%') || !/^[0-9a-f:.]+$/i.test(text)) return null;
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (segment: string, allowIpv4Tail: boolean): number[] | null => {
    if (segment === '') return [];
    const pieces = segment.split(':');
    const groups: number[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i] ?? '';
      if (piece.includes('.')) {
        if (!allowIpv4Tail || i !== pieces.length - 1) return null;
        const v4 = parseIpv4Strict(piece);
        if (v4 === null) return null;
        groups.push(v4 >>> 16, v4 & 0xffff);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null;
        groups.push(parseInt(piece, 16));
      }
    }
    return groups;
  };
  if (halves.length === 1) {
    const groups = parseGroups(text, true);
    return groups?.length === 8 ? groups : null;
  }
  const head = parseGroups(halves[0] ?? '', false);
  const tail = parseGroups(halves[1] ?? '', true);
  if (head === null || tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/**
 * Canonical text as serialised by the WHATWG URL host serializer (the form the fetcher sees):
 * lower-case hex, leading zeros dropped, the first longest run of two or more zero groups
 * compressed to `::`, and no dotted IPv4 tail (so `::ffff:127.0.0.1` → `::ffff:7f00:1`).
 */
export function formatIpv6(groups: readonly number[]): string {
  const g = (i: number): number => groups[i] ?? 0;
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8;) {
    if (g(i) !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && g(j) === 0) j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const hex = (from: number, to: number): string[] => {
    const out: string[] = [];
    for (let i = from; i < to; i++) out.push(g(i).toString(16));
    return out;
  };
  if (bestLength < 2) return hex(0, 8).join(':');
  return `${hex(0, bestStart).join(':')}::${hex(bestStart + bestLength, 8).join(':')}`;
}

function inIpv4Range(value: number, range: Ipv4Range): boolean {
  if (range.bits === 0) return true;
  const shift = 32 - range.bits;
  return value >>> shift === range.base >>> shift;
}

function inIpv6Range(groups: readonly number[], range: Ipv6Range): boolean {
  let remaining = range.bits;
  for (let i = 0; i < 8 && remaining > 0; i++) {
    const take = Math.min(16, remaining);
    const mask = (0xffff << (16 - take)) & 0xffff;
    if (((groups[i] ?? 0) & mask) !== ((range.prefix[i] ?? 0) & mask)) return false;
    remaining -= take;
  }
  return true;
}

export function classifyIpv4Value(value: number): IpBlockReason | null {
  for (const range of IPV4_BLOCKED) {
    if (inIpv4Range(value, range)) return range.reason;
  }
  return null;
}

function classifyIpv6Groups(groups: readonly number[]): IpClassification {
  const address = formatIpv6(groups);
  for (const range of IPV6_BLOCKED) {
    if (!inIpv6Range(groups, range)) continue;
    if (range.embedded) {
      const v4 = (((groups[6] ?? 0) << 16) >>> 0) + (groups[7] ?? 0);
      const embeddedReason = classifyIpv4Value(v4);
      // The translated/mapped range is blocked outright; the embedded IPv4 is classified too
      // and gives the more specific reason when it is itself blocked.
      return {
        family: 6,
        address,
        blocked: true,
        reason: embeddedReason ?? range.reason,
        embeddedIpv4: formatIpv4(v4),
      };
    }
    return { family: 6, address, blocked: true, reason: range.reason, embeddedIpv4: null };
  }
  return { family: 6, address, blocked: false, reason: null, embeddedIpv4: null };
}

/**
 * Classifies an IP literal (IPv4 in any WHATWG encoding, or IPv6 with or without brackets).
 * Returns null when the input is not an IP address (e.g. a DNS name).
 */
export function classifyIp(input: string): IpClassification | null {
  const trimmed = input.trim();
  if (trimmed.includes(':')) {
    const groups = parseIpv6(trimmed);
    return groups === null ? null : classifyIpv6Groups(groups);
  }
  if (!hostEndsInNumber(trimmed)) return null;
  const value = parseIpv4Loose(trimmed);
  if (value === null) return null;
  const reason = classifyIpv4Value(value);
  return {
    family: 4,
    address: formatIpv4(value),
    blocked: reason !== null,
    reason,
    embeddedIpv4: null,
  };
}

/** True when the input is an IP literal inside a blocked range. DNS names return false. */
export function isBlockedIp(input: string): boolean {
  return classifyIp(input)?.blocked ?? false;
}

/** Canonical form of an IP literal, or null for non-IP input. */
export function normalizeIp(input: string): string | null {
  return classifyIp(input)?.address ?? null;
}
