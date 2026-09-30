import { expect, test } from '@playwright/test';
import { cspViolations, LOCALIZED_PAGES, recordCspViolations } from './helpers.ts';
import { STUB_ORIGIN, STUB_VALID_REFERRAL, WEB_ORIGIN } from './stub/constants.ts';

const NONCE_PAGES = [
  '/support',
  '/en/data-deletion',
  `/r/${STUB_VALID_REFERRAL}`,
  '/oauth/done?provider=google&result=denied',
  '/app/today',
];

function directives(csp: string): Map<string, string> {
  return new Map(
    csp
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map((part) => {
        const [name = '', ...values] = part.split(/\s+/u);
        return [name, values.join(' ')] as const;
      }),
  );
}

test.describe('security headers (WEB-E2E-14, CTL-3.18)', () => {
  test('every page sends HSTS, nosniff, referrer and permissions policies and a CSP', async ({
    request,
  }) => {
    for (const path of [...LOCALIZED_PAGES, `/r/${STUB_VALID_REFERRAL}`, '/app/today']) {
      const response = await request.get(`${WEB_ORIGIN}${path}`);
      const headers = response.headers();
      expect(headers['strict-transport-security'], path).toBe(
        'max-age=63072000; includeSubDomains; preload',
      );
      expect(headers['x-content-type-options'], path).toBe('nosniff');
      expect(headers['x-frame-options'], path).toBe('DENY');
      expect(headers['referrer-policy'], path).toMatch(
        /^(strict-origin-when-cross-origin|no-referrer)$/u,
      );
      expect(headers['permissions-policy'], path).toContain('camera=()');
      expect(headers['x-powered-by'], path).toBeUndefined();
      const csp = directives(headers['content-security-policy'] ?? '');
      expect(csp.get('frame-ancestors'), path).toBe("'none'");
      expect(csp.get('object-src'), path).toBe("'none'");
      expect(csp.get('base-uri'), path).toBe("'self'");
      expect(csp.get('form-action'), path).toBe("'self'");
      expect(csp.get('connect-src'), path).toBe(`'self' ${STUB_ORIGIN}`);
      expect(csp.get('default-src'), path).toBe("'self'");
    }
  });

  test('per-request pages use a fresh nonce with strict-dynamic on every server-rendered script', async ({
    request,
  }) => {
    const nonceOf = (value: string | undefined): string | undefined =>
      /'nonce-([^']+)'/u.exec(value ?? '')?.[1];
    for (const path of NONCE_PAGES) {
      const first = await request.get(`${WEB_ORIGIN}${path}`);
      const second = await request.get(`${WEB_ORIGIN}${path}`);
      const csp = first.headers()['content-security-policy'] ?? '';
      const nonce = nonceOf(csp);
      expect(nonce, path).toBeTruthy();
      expect(nonceOf(second.headers()['content-security-policy']), path).not.toBe(nonce);
      expect(directives(csp).get('script-src'), path).toBe(
        `'self' 'nonce-${String(nonce)}' 'strict-dynamic'`,
      );
      // Scripts the browser adds later are trusted through 'strict-dynamic'; every script in the
      // HTML itself must carry this response's nonce.
      const html = await first.text();
      const tags = [...html.matchAll(/<script\b[^>]*>/gu)].map((match) => match[0]);
      expect(tags.length, path).toBeGreaterThan(0);
      for (const tag of tags) {
        if (tag.includes('application/ld+json')) continue;
        expect(tag, path).toContain(`nonce="${String(nonce)}"`);
      }
    }
  });

  test('static pages fall back to self + inline scripts (CTL-3.18)', async ({ request }) => {
    const response = await request.get(`${WEB_ORIGIN}/privacy`);
    expect(directives(response.headers()['content-security-policy'] ?? '').get('script-src')).toBe(
      "'self' 'unsafe-inline'",
    );
  });

  test('a full crawl raises zero CSP violations', async ({ page }) => {
    test.setTimeout(120_000);
    await recordCspViolations(page);
    const all: string[] = [];
    for (const path of [...LOCALIZED_PAGES, ...NONCE_PAGES, '/does-not-exist']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      all.push(...(await cspViolations(page)).map((violation) => `${path}: ${violation}`));
    }
    expect(all).toEqual([]);
  });

  test('well-known and metadata routes are not framed or sniffed either', async ({ request }) => {
    for (const path of [
      '/.well-known/assetlinks.json',
      '/sitemap.xml',
      '/robots.txt',
      '/get?src=header',
    ]) {
      const response = await request.get(`${WEB_ORIGIN}${path}`, { maxRedirects: 0 });
      expect(response.headers()['x-content-type-options'], path).toBe('nosniff');
      expect(response.headers()['strict-transport-security'], path).toContain('max-age=');
    }
  });
});
