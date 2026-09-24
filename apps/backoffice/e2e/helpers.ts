import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { ADMIN_EMAIL, EMAIL_CODE, MFA_CODE, MOCK_ORIGIN } from './fixtures';

/** Resets the mock (no factor = first sign-in with enrolment; `enrolled` = TOTP challenge). */
export async function resetMock(
  request: APIRequestContext,
  options: { enrolled?: boolean } = {},
): Promise<void> {
  const response = await request.post(`${MOCK_ORIGIN}/__mock/reset`, { data: options });
  expect(response.ok()).toBe(true);
}

/** Moves the mock server's session clock and the browser's fake clock forward together. */
export async function advanceClocks(
  page: Page,
  request: APIRequestContext,
  ms: number,
): Promise<void> {
  const response = await request.post(`${MOCK_ORIGIN}/__mock/advance`, { data: { ms } });
  expect(response.ok()).toBe(true);
  await page.clock.fastForward(ms);
}

export interface MockCall {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: unknown;
}

export async function mockCalls(request: APIRequestContext): Promise<MockCall[]> {
  const response = await request.get(`${MOCK_ORIGIN}/__mock/calls`);
  return ((await response.json()) as { calls: MockCall[] }).calls;
}

/**
 * Records CSP violations; every spec asserts none happened (SECURITY_AND_PRIVACY_PLAN CTL-3.18:
 * "Playwright fails on any securitypolicyviolation event").
 */
export async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const store: string[] = [];
    Object.defineProperty(window, '__cspViolations', { value: store });
    document.addEventListener('securitypolicyviolation', (event) => {
      store.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  const consoleViolations: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|Refused to/.test(message.text())) {
      consoleViolations.push(message.text());
    }
  });
  return async () => {
    const inPage = await page
      .evaluate(() => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [])
      .catch(() => []);
    return [...inPage, ...consoleViolations];
  };
}

/** Email code → TOTP (enrol or challenge) → recovery codes when shown → dashboard. */
export async function signIn(page: Page, options: { enrolled?: boolean } = {}): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-posta').fill(ADMIN_EMAIL);
  await page.getByRole('button', { name: 'Kod gönder' }).click();
  await expect(page).toHaveURL(/\/login\?step=code$/);
  await page.getByLabel('E-posta kodu').fill(EMAIL_CODE);
  await page.getByRole('button', { name: 'Doğrula', exact: true }).click();
  await expect(page).toHaveURL(/\/mfa$/);
  await expect(
    page.getByRole('heading', {
      name: options.enrolled === true ? 'İki adımlı doğrulama' : 'İki adımlı doğrulamayı kur',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel('Doğrulama kodu').fill(MFA_CODE);
  await page.getByRole('button', { name: 'Doğrula', exact: true }).click();
  if (options.enrolled !== true) {
    await expect(page.getByRole('heading', { name: 'Kurtarma kodların' })).toBeVisible();
    const proceed = page.getByRole('button', { name: 'Devam et' });
    await expect(proceed).toBeDisabled();
    await page.getByLabel('Kodları güvenli bir yere kaydettim').check();
    await proceed.click();
  }
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Pano' })).toBeVisible();
}
