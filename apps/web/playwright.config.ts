import { defineConfig, devices } from '@playwright/test';
import { E2E_ENV, STUB_ORIGIN, STUB_PORT, WEB_ORIGIN, WEB_PORT } from './e2e/stub/constants.ts';

/**
 * Web E2E (TEST_PLAN §11, M§104; SCREEN_AND_FLOW_MAP Part 5 §16). Runs against a production
 * `next build` + `next start` and the `public-api` contract stub (tier C). In this container the
 * preinstalled Chromium is used through `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; CI can point it at Chrome
 * for Testing or leave it unset for Playwright's own browser.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  workers: process.env.CI === undefined ? 4 : 2,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI === undefined ? [['list']] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_ORIGIN,
    locale: 'tr-TR',
    trace: 'retain-on-failure',
    ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
      },
    },
  ],
  webServer: [
    {
      command: 'exec node e2e/stub/public-api.ts',
      url: `${STUB_ORIGIN}/__stub/state`,
      reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
      env: { PORT: String(STUB_PORT), STUB_ALLOWED_ORIGIN: WEB_ORIGIN },
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // The server is started with `exec` (no pnpm wrapper), so Playwright stops the Next.js
      // process itself at teardown instead of leaving it holding the output pipe.
      command: `node_modules/.bin/next build && exec node_modules/.bin/next start --port ${String(WEB_PORT)}`,
      url: WEB_ORIGIN,
      timeout: 300_000,
      reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
      env: { ...E2E_ENV },
      stdout: 'ignore',
      stderr: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
  ],
});
