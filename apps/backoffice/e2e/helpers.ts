import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { ADMIN_EMAIL, EMAIL_CODE, MFA_CODE, MOCK_ORIGIN } from './fixtures';

/**
 * Resets the mock (no factor = first sign-in with enrolment; `enrolled` = TOTP challenge) and its
 * dataset; `role` picks the signed-in admin's role (default `operations`).
 */
export async function resetMock(
  request: APIRequestContext,
  options: { enrolled?: boolean; role?: string } = {},
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
  query: Record<string, string>;
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

/**
 * A documentation-range client address per test (RFC 5737), so the per-IP pre-auth limiter
 * (30 POSTs / 5 min, BACKOFFICE_PLAN §2.4) sees each test as its own client, as in production.
 */
function testClientIp(): string {
  let hash = 0;
  for (const char of test.info().testId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const ranges = ['192.0.2', '198.51.100', '203.0.113'];
  return `${ranges[hash % 3] ?? '192.0.2'}.${String(1 + ((hash >>> 2) % 254))}`;
}

/** Email code → TOTP (enrol or challenge) → recovery codes when shown → dashboard. */
export async function signIn(page: Page, options: { enrolled?: boolean } = {}): Promise<void> {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': testClientIp() });
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

/** Resets the mock for `role`, then signs in as an enrolled admin. */
export async function signInAs(
  page: Page,
  request: APIRequestContext,
  role = 'operations',
): Promise<void> {
  await resetMock(request, { enrolled: true, role });
  await signIn(page, { enrolled: true });
}

/** The audit rows the mock has written, newest last. */
export async function mockAudit(
  request: APIRequestContext,
): Promise<{ action: string; result: string; reason: string | null; target_id: string | null }[]> {
  const response = await request.get(`${MOCK_ORIGIN}/__mock/state`);
  return (
    (await response.json()) as {
      audit: { action: string; result: string; reason: string | null; target_id: string | null }[];
    }
  ).audit;
}

/** Fills the reason (and the typed confirmation, when asked) and confirms an open dialog. */
export async function confirmDialog(
  page: Page,
  name: string | RegExp,
  options: { reason?: string; typed?: string | true; stepUp?: boolean } = {},
): Promise<void> {
  const dialog = page.getByRole('dialog', { name });
  await expect(dialog).toBeVisible();
  if (options.reason !== undefined) await dialog.getByLabel('Gerekçe').fill(options.reason);
  if (options.typed !== undefined) {
    // `true` types the token the dialog asks for ("Onaylamak için <strong>token</strong> yaz").
    const token =
      options.typed === true ? await dialog.locator('label strong').innerText() : options.typed;
    await dialog.getByLabel(/^Onaylamak için/).fill(token);
  }
  if (options.stepUp === true) await dialog.getByLabel('Doğrulama kodu').fill(MFA_CODE);
  await dialog.locator('button[type="submit"]').click();
}
