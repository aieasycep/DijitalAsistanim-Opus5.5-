import { expect, test } from '@playwright/test';
import { zapBaseline } from '../../../scripts/security/zap.ts';
import { APP_ORIGIN } from './fixtures';

/**
 * TST-CI-08 (security-nightly, `DA_DAST=1`): the OWASP ZAP baseline scan against the production
 * backoffice build Playwright serves with the admin-api contract mock; unauthenticated, so it covers
 * the sign-in, MFA and redirect surface and the security headers of every reachable response.
 */
test('TST-CI-08 backoffice: the ZAP baseline scan finds no high-risk alert', () => {
  test.setTimeout(25 * 60_000);
  const verdict = zapBaseline({ url: APP_ORIGIN, target: 'backoffice' });
  expect(verdict.blocking, verdict.summary).toEqual([]);
  expect(verdict.expired, verdict.summary).toEqual([]);
});
