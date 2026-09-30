/**
 * Pre-DNS URL policy and post-DNS address vetting for the SSRF-safe fetcher
 * (`supabase/functions/_shared/security/ssrf-fetch.ts`; SECURITY_AND_PRIVACY_PLAN CTL-3.10 steps
 * 2–5; R-11; TEST_PLAN UT-SSRF-04).
 *
 * The policy takes the components of an already-parsed URL (the WHATWG `URL` object the fetcher
 * builds satisfies `FetchTargetParts`), so this module and the fetcher never disagree on how a
 * string parses. Hostnames are re-checked defensively: IPv4 in decimal/octal/hex form, bracketed
 * IPv6 and Unicode hosts are normalised here as well.
 */
import { classifyIp, hostEndsInNumber, type IpBlockReason } from './ip-ranges.ts';
import { toAsciiHost } from './punycode.ts';

export interface FetchTargetParts {
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  port: string;
}

export interface FetchPolicyOptions {
  /**
   * Our own hosts (`SUPABASE_PROJECT_HOST`, `API_CUSTOM_DOMAIN`, `WEB_DOMAIN`): no self-calls.
   * Subdomains of these hosts are refused as well.
   */
  selfHosts?: readonly string[];
}

/** Error codes as listed in CTL-3.10 (`blocked_address`, `insecure_scheme`) plus `invalid_url`. */
export type FetchPolicyCode = 'insecure_scheme' | 'invalid_url' | 'blocked_address';

export type FetchPolicyDetail =
  | 'scheme'
  | 'credentials'
  | 'port'
  | 'host_empty'
  | 'host_too_long'
  | 'host_invalid'
  | 'blocked_hostname'
  | 'self_host'
  | 'ip_blocked';

export type FetchTargetCheck =
  | { ok: true; host: string; ip: string | null }
  | { ok: false; code: FetchPolicyCode; detail: FetchPolicyDetail; ipReason: IpBlockReason | null };

/** Exact names and suffixes refused before any DNS lookup (step 3). */
export const BLOCKED_HOSTNAMES: readonly string[] = ['localhost', 'metadata.google.internal'];
export const BLOCKED_HOSTNAME_SUFFIXES: readonly string[] = [
  'localhost',
  'local',
  'internal',
  'home.arpa',
];

const MAX_HOST_LENGTH = 253;
const LDH_HOST = /^[a-z0-9.-]+$/;

function reject(
  code: FetchPolicyCode,
  detail: FetchPolicyDetail,
  ipReason: IpBlockReason | null = null,
): FetchTargetCheck {
  return { ok: false, code, detail, ipReason };
}

function matchesHostOrSubdomain(host: string, base: string): boolean {
  const b = base.toLowerCase().replace(/\.$/, '');
  return b !== '' && (host === b || host.endsWith(`.${b}`));
}

/** Steps 2–4 of CTL-3.10: everything that can be decided before DNS. */
export function checkFetchTarget(
  parts: FetchTargetParts,
  options: FetchPolicyOptions = {},
): FetchTargetCheck {
  if (parts.protocol.toLowerCase() !== 'https:') return reject('insecure_scheme', 'scheme');
  if (parts.username !== '' || parts.password !== '') return reject('invalid_url', 'credentials');
  if (parts.port !== '' && parts.port !== '443') return reject('invalid_url', 'port');

  const rawHost = parts.hostname.trim();
  if (rawHost === '') return reject('invalid_url', 'host_empty');

  if (rawHost.startsWith('[') || rawHost.includes(':')) {
    const ip = classifyIp(rawHost);
    if (ip?.family !== 6) return reject('invalid_url', 'host_invalid');
    if (ip.blocked) return reject('blocked_address', 'ip_blocked', ip.reason);
    return { ok: true, host: `[${ip.address}]`, ip: ip.address };
  }

  const ascii = toAsciiHost(rawHost);
  if (ascii === null) return reject('invalid_url', 'host_invalid');
  const host = ascii.endsWith('.') ? ascii.slice(0, -1) : ascii;
  if (host === '') return reject('invalid_url', 'host_empty');
  if (host.length > MAX_HOST_LENGTH) return reject('invalid_url', 'host_too_long');
  if (!LDH_HOST.test(host) || host.split('.').some((label) => label === '')) {
    return reject('invalid_url', 'host_invalid');
  }

  if (hostEndsInNumber(host)) {
    const ip = classifyIp(host);
    if (ip === null) return reject('invalid_url', 'host_invalid');
    if (ip.blocked) return reject('blocked_address', 'ip_blocked', ip.reason);
    return { ok: true, host: ip.address, ip: ip.address };
  }

  if (
    BLOCKED_HOSTNAMES.includes(host) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(`.${suffix}`) || host === suffix)
  ) {
    return reject('blocked_address', 'blocked_hostname');
  }
  if ((options.selfHosts ?? []).some((self) => matchesHostOrSubdomain(host, self))) {
    return reject('blocked_address', 'self_host');
  }
  return { ok: true, host, ip: null };
}

export type ResolvedAddressCheck =
  | { ok: true; vettedIp: string }
  | {
      ok: false;
      code: 'blocked_address' | 'dns_mixed_private' | 'unresolvable';
      blocked: readonly { address: string; reason: IpBlockReason | 'not_an_ip' }[];
    };

/**
 * Step 5: every resolved A/AAAA address must be allowed. One blocked address among allowed ones
 * rejects the host (`dns_mixed_private`); the first allowed address is the one to connect to.
 */
export function checkResolvedAddresses(addresses: readonly string[]): ResolvedAddressCheck {
  if (addresses.length === 0) return { ok: false, code: 'unresolvable', blocked: [] };
  const blocked: { address: string; reason: IpBlockReason | 'not_an_ip' }[] = [];
  let vetted: string | null = null;
  for (const address of addresses) {
    const ip = classifyIp(address);
    if (ip === null) {
      blocked.push({ address, reason: 'not_an_ip' });
    } else if (ip.blocked) {
      blocked.push({ address: ip.address, reason: ip.reason ?? 'reserved' });
    } else {
      vetted ??= ip.address;
    }
  }
  if (blocked.length === 0 && vetted !== null) return { ok: true, vettedIp: vetted };
  return {
    ok: false,
    code: vetted === null ? 'blocked_address' : 'dns_mixed_private',
    blocked,
  };
}
