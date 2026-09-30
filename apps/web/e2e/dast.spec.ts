import { expect, test } from '@playwright/test';
import { zapBaseline } from '../../../scripts/security/zap.ts';
import { WEB_ORIGIN } from './stub/constants.ts';

/**
 * TST-CI-08 (security-nightly, `DA_DAST=1`): the OWASP ZAP baseline scan against the production
 * `next start` build Playwright serves for the E2E suite; no high-risk alert may remain.
 */
test('TST-CI-08 web: the ZAP baseline scan finds no high-risk alert', () => {
  test.setTimeout(25 * 60_000);
  const verdict = zapBaseline({ url: WEB_ORIGIN, target: 'web' });
  expect(verdict.blocking, verdict.summary).toEqual([]);
  expect(verdict.expired, verdict.summary).toEqual([]);
});
