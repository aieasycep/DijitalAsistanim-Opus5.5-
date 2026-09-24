import { expect, test } from '@playwright/test';

import { APP_ORIGIN } from './fixtures';

/* BO-E2E-07 and CTL-3.18 (contract tier): CSRF origin enforcement, security headers, crawling. */

test.describe('security boundary', () => {
  test('a mutation without Origin, or with a foreign one, is refused with 403', async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext({ baseURL: APP_ORIGIN });
    const missing = await api.post('/login', {
      headers: { 'next-action': 'deadbeef', 'content-type': 'text/plain;charset=UTF-8' },
      data: '[]',
    });
    expect(missing.status()).toBe(403);
    expect(await missing.json()).toEqual({ error: 'csrf_origin' });

    const foreign = await api.post('/dashboard', {
      headers: { origin: 'https://evil.example', 'next-action': 'deadbeef' },
      data: '[]',
    });
    expect(foreign.status()).toBe(403);

    const crossSite = await api.post('/login', {
      headers: { origin: APP_ORIGIN, 'sec-fetch-site': 'cross-site', 'next-action': 'deadbeef' },
      data: '[]',
    });
    expect(crossSite.status()).toBe(403);
    await api.dispose();
  });

  test('pages carry the nonce CSP and the security headers', async ({ request }) => {
    const response = await request.get('/login');
    expect(response.status()).toBe(200);
    const headers = response.headers();
    const csp = headers['content-security-policy'] ?? '';
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(headers['strict-transport-security']).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
    expect(headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cache-control']).toContain('no-store');
    const html = await response.text();
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1] ?? '';
    expect(nonce).not.toBe('');
    expect(html).toContain(`nonce="${nonce}"`);
  });

  test('robots.txt disallows everything; the read proxy needs a session', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(await robots.text()).toMatch(/Disallow: \//);
    expect(robots.headers()['x-robots-tag']).toBe('noindex, nofollow');
    const me = await request.get('/api/admin/me');
    expect(me.status()).toBe(401);
    const health = await request.get('/api/healthz');
    expect(await health.json()).toEqual({ ok: true });
  });
});
