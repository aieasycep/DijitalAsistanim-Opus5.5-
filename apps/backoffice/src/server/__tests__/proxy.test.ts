import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { routeDecision } from '../proxy-routing';
import { preAuthLimiter } from '../rate-limit';

const ORIGIN = 'http://localhost:3100';

beforeAll(() => {
  Object.assign(process.env, {
    APP_ENV: 'e2e',
    API_PUBLIC_BASE_URL: 'http://127.0.0.1:54399',
    ADMIN_BFF_SECRET: 'proxy-test-bff-secret-000000000000000000',
    ADMIN_ORIGIN: ORIGIN,
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54399',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  });
});

beforeEach(() => {
  preAuthLimiter.reset();
});

async function run(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  const { proxy } = await import('@/proxy');
  return proxy(
    new NextRequest(`${ORIGIN}${path}`, {
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
    }),
  );
}

describe('proxy.ts (BACKOFFICE_PLAN §2.4)', () => {
  it('refuses a mutation without Origin with 403 csrf_origin', async () => {
    const response = await run('/dashboard', { method: 'POST', headers: { 'next-action': 'abc' } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'csrf_origin' });
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('refuses a foreign Origin and a cross-site fetch', async () => {
    expect(
      (await run('/login', { method: 'POST', headers: { origin: 'https://evil.example' } })).status,
    ).toBe(403);
    expect(
      (
        await run('/login', {
          method: 'POST',
          headers: { origin: ORIGIN, 'sec-fetch-site': 'cross-site' },
        })
      ).status,
    ).toBe(403);
  });

  it('sends visitors without a session to /login with their return path', async () => {
    const response = await run('/dashboard?range=30d');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      `${ORIGIN}/login?next=%2Fdashboard%3Frange%3D30d`,
    );
  });

  it('treats a tampered or foreign auth cookie as no session', async () => {
    const response = await run('/dashboard', {
      headers: { cookie: '__Host-da_admin=v1.AAAAtamperedAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?next=%2Fdashboard`);
    const plain = await run('/dashboard', {
      headers: { cookie: '__Host-da_admin=base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0' },
    });
    expect(plain.headers.get('location')).toBe(`${ORIGIN}/login?next=%2Fdashboard`);
  });

  it('answers API calls without a session with 401 instead of a redirect', async () => {
    const response = await run('/api/admin/me');
    expect(response.status).toBe(401);
  });

  it('renders public pages with a per-request nonce CSP and the security headers', async () => {
    const first = await run('/login');
    const second = await run('/login');
    const csp = first.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]{20,}' 'strict-dynamic'/);
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(second.headers.get('content-security-policy')).not.toBe(csp);
    expect(first.headers.get('strict-transport-security')).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.headers.get('x-frame-options')).toBe('DENY');
    expect(first.headers.get('x-middleware-request-x-nonce')).toBe(
      /'nonce-([^']+)'/.exec(csp)?.[1],
    );
  });

  it('throttles pre-auth POSTs per IP (30 per 5 minutes)', async () => {
    const headers = { origin: ORIGIN, 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < 30; i += 1) {
      expect((await run('/login', { method: 'POST', headers })).status).not.toBe(429);
    }
    const limited = await run('/login', { method: 'POST', headers });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(
      (
        await run('/login', {
          method: 'POST',
          headers: { ...headers, 'x-forwarded-for': '203.0.113.10' },
        })
      ).status,
    ).not.toBe(429);
  });
});

describe('routeDecision', () => {
  const base = { search: '', method: 'GET' };
  it('sends aal1 sessions to /mfa and signs out identities without the admin claim', () => {
    expect(
      routeDecision({
        ...base,
        pathname: '/dashboard',
        claims: { aal: 'aal1', admin_role: 'support' },
      }),
    ).toEqual({
      kind: 'redirect',
      location: '/mfa',
    });
    expect(routeDecision({ ...base, pathname: '/dashboard', claims: { aal: 'aal2' } })).toEqual({
      kind: 'signout',
      location: '/login?reason=not_admin',
    });
    expect(
      routeDecision({
        ...base,
        pathname: '/dashboard',
        claims: { aal: 'aal2', admin_role: 'support' },
      }),
    ).toEqual({
      kind: 'next',
    });
  });

  it('lets /mfa through for any session and sends a signed-in admin from /login to the dashboard', () => {
    expect(routeDecision({ ...base, pathname: '/mfa', claims: { aal: 'aal1' } })).toEqual({
      kind: 'next',
    });
    expect(routeDecision({ ...base, pathname: '/mfa', claims: null })).toEqual({
      kind: 'redirect',
      location: '/login?next=%2Fmfa',
    });
    expect(
      routeDecision({ ...base, pathname: '/login', claims: { aal: 'aal2', admin_role: 'x' } }),
    ).toEqual({
      kind: 'redirect',
      location: '/dashboard',
    });
  });

  it('signs out locally when /login is reached with a session-ending reason', () => {
    expect(
      routeDecision({
        ...base,
        pathname: '/login',
        search: '?reason=idle',
        claims: { aal: 'aal2', admin_role: 'x' },
      }),
    ).toEqual({ kind: 'signout', location: null });
    expect(
      routeDecision({ ...base, pathname: '/login', search: '?reason=idle', claims: null }),
    ).toEqual({
      kind: 'next',
    });
  });

  it('keeps public routes public and never redirects non-GET requests', () => {
    for (const pathname of ['/invite', '/forbidden', '/api/healthz']) {
      expect(routeDecision({ ...base, pathname, claims: null })).toEqual({ kind: 'next' });
    }
    expect(
      routeDecision({ search: '', method: 'POST', pathname: '/dashboard', claims: null }),
    ).toEqual({
      kind: 'unauthorized',
    });
  });
});
