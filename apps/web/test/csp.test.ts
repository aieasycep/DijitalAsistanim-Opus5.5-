import { describe, expect, it } from 'vitest';
import {
  buildCsp,
  isLinkRoute,
  isNonceRoute,
  isNoReferrerRoute,
  originOf,
  TURNSTILE_ORIGIN,
} from '../src/lib/csp.ts';

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split('; ').map((part) => [part.split(' ')[0] ?? '', part.split(' ').slice(1).join(' ')]),
  );
}

describe('CSP (CTL-3.18)', () => {
  it('uses a nonce with strict-dynamic on per-request routes', () => {
    const csp = directives(
      buildCsp({ nonce: 'abc', apiOrigin: 'https://p.supabase.co', upgradeInsecure: true }),
    );
    expect(csp.get('script-src')).toBe("'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp.get('connect-src')).toBe("'self' https://p.supabase.co");
    expect(csp.get('frame-ancestors')).toBe("'none'");
    expect(csp.get('object-src')).toBe("'none'");
    expect(csp.has('upgrade-insecure-requests')).toBe(true);
    expect(csp.has('frame-src')).toBe(false);
  });

  it('falls back to self + inline on prerendered routes and never allows eval in production', () => {
    const csp = directives(buildCsp({}));
    expect(csp.get('script-src')).toBe("'self' 'unsafe-inline'");
    expect(buildCsp({ nonce: 'n' })).not.toContain('unsafe-eval');
    expect(buildCsp({ development: true })).toContain("'unsafe-eval'");
    expect(csp.has('upgrade-insecure-requests')).toBe(false);
  });

  it('adds Turnstile only when configured and only with a nonce', () => {
    const withTurnstile = directives(buildCsp({ nonce: 'n', turnstile: true }));
    expect(withTurnstile.get('script-src')).toContain(TURNSTILE_ORIGIN);
    expect(withTurnstile.get('frame-src')).toBe(TURNSTILE_ORIGIN);
    expect(buildCsp({ turnstile: true })).not.toContain(TURNSTILE_ORIGIN);
  });

  it('classifies routes', () => {
    for (const path of [
      '/support',
      '/data-deletion',
      '/oauth/done',
      '/app',
      '/app/today',
      '/r/7K2M4QX',
    ]) {
      expect(isNonceRoute(path), path).toBe(true);
    }
    for (const path of ['/', '/pricing', '/privacy', '/terms', '/rx'])
      expect(isNonceRoute(path), path).toBe(false);
    expect(isLinkRoute('/r/ABC')).toBe(true);
    expect(isLinkRoute('/support')).toBe(false);
    expect(isNoReferrerRoute('/data-deletion')).toBe(true);
    expect(isNoReferrerRoute('/privacy')).toBe(false);
    expect(originOf('https://p.supabase.co/functions/v1')).toBe('https://p.supabase.co');
    expect(originOf('not a url')).toBeUndefined();
  });
});
