import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { STUB_ORIGIN } from './stub/constants.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every indexable page in both locales. */
export const SITE_PAGES = [
  '/',
  '/pricing',
  '/privacy',
  '/terms',
  '/support',
  '/data-deletion',
] as const;
export const LOCALIZED_PAGES = SITE_PAGES.flatMap((path) => [
  path,
  path === '/' ? '/en' : `/en${path}`,
]);

/**
 * Claims the site must never make (Part 5 §0.5), plus the repository's banned work markers
 * (`scripts/quality-gate/banned-markers.txt`). Written with escapes so this file itself stays
 * clean for the quality gate.
 */
export function bannedClaims(): RegExp[] {
  const markers = readFileSync(
    join(HERE, '..', '..', '..', 'scripts', 'quality-gate', 'banned-markers.txt'),
    'utf8',
  )
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => new RegExp(line, 'iu'));
  return [
    ...markers,
    /s\u0131n\u0131rs\u0131z/iu,
    /unlimi[t]ed/iu,
    /u\u00e7tan uca/iu,
    /end-to-end/iu,
    /(KVKK ve GDPR uyumlu|GDPR compliant)/iu,
    /gerisini siler|deletes the rest/iu,
    /Şu an ücretsiz erişim/iu,
    /\b(zoom|microsoft teams)\b/iu,
    /\d+\s*saniyelik brifing/iu,
    /\d+\s*gün(lük)?\s+ücretsiz/iu,
    /\d+[-\s]day free trial|free trial of \d+/iu,
  ];
}

export async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

export interface StubState {
  requests: {
    method: string;
    path: string;
    origin: string | null;
    bodyKeys: string[];
    body: unknown;
  }[];
  tickets: { reference: string; email: string; message: string; category: string }[];
  events: unknown[];
}

export async function stubState(): Promise<StubState> {
  const response = await fetch(`${STUB_ORIGIN}/__stub/state`);
  return (await response.json()) as StubState;
}

export async function stubOtp(email: string): Promise<string | null> {
  const response = await fetch(`${STUB_ORIGIN}/__stub/otp?email=${encodeURIComponent(email)}`);
  return ((await response.json()) as { code: string | null }).code;
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(
    overflow,
    `horizontal overflow at ${String(page.viewportSize()?.width)}px`,
  ).toBeLessThanOrEqual(0);
}

/** Records CSP violations from the start of the page (headers.spec, crawl). */
export async function recordCspViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __csp: string[] }).__csp.push(
        `${event.violatedDirective} ${event.blockedURI}`,
      );
    });
  });
}

export async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
}

export const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
export const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
