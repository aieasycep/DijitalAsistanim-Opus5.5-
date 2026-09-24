import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

import { APP_ORIGIN, APP_PORT, BFF_SECRET, MOCK_ORIGIN, MOCK_PORT } from './e2e/fixtures';

/*
 * Playwright, project `bo-contract` (BACKOFFICE_PLAN §13.4): the production build of the backoffice
 * against the contract-validated mock admin-api + Auth (`e2e/mock-server.ts`), so the suite runs in
 * the container without Supabase. Chromium comes from PLAYWRIGHT_CHROMIUM_EXECUTABLE or the
 * preinstalled `/opt/pw-browsers` build (never `playwright install`).
 */

const PREINSTALLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync(PREINSTALLED) ? PREINSTALLED : undefined);

const appEnv = {
  APP_ENV: 'e2e',
  API_PUBLIC_BASE_URL: MOCK_ORIGIN,
  NEXT_PUBLIC_SUPABASE_URL: MOCK_ORIGIN,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_mock',
  ADMIN_BFF_SECRET: BFF_SECRET,
  ADMIN_ORIGIN: APP_ORIGIN,
  NEXT_TELEMETRY_DISABLED: '1',
};

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: process.env.CI !== undefined,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: APP_ORIGIN,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    trace: 'retain-on-failure',
    ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
  },
  projects: [
    {
      name: 'bo-contract',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      command: 'node e2e/mock-server.ts',
      url: `${MOCK_ORIGIN}/__mock/health`,
      env: { MOCK_PORT: String(MOCK_PORT) },
      reuseExistingServer: false,
      timeout: 30_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      // Reuses the `next build` output (C-BO builds first); builds once when it is missing. `exec`
      // makes Next the server process itself so shutdown reaches it.
      command: `sh -c 'test -f .next/BUILD_ID || node node_modules/next/dist/bin/next build; exec node node_modules/next/dist/bin/next start --port ${String(APP_PORT)}'`,
      url: `${APP_ORIGIN}/api/healthz`,
      env: appEnv,
      reuseExistingServer: false,
      timeout: 300_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
});
