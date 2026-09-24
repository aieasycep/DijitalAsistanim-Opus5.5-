/**
 * Shared fixtures for the mock admin-api / Auth server and the Playwright specs. Values are synthetic
 * (no real account, no real credential); the BFF secret exists only in this test process.
 */
import { randomUUID } from 'node:crypto';

import { ROLE_PERMISSIONS } from '@da/domain';

export const MOCK_PORT = Number(process.env.MOCK_PORT ?? 54_329);
export const APP_PORT = Number(process.env.APP_PORT ?? 3_100);
export const APP_ORIGIN = `http://localhost:${String(APP_PORT)}`;
export const MOCK_ORIGIN = `http://127.0.0.1:${String(MOCK_PORT)}`;
/** Test-only BFF key shared by the app under test and the mock (never a deployed value). */
export const BFF_SECRET = 'e2e-only-bff-key-000000000000000000000000';

export const ADMIN_ID = '0190f5e0-0000-7000-8000-000000000001';
export const ADMIN_EMAIL = 'ops@dijitalasistan.app';
export const EMAIL_CODE = '123456';
export const MFA_CODE = '654321';
export const RECOVERY_CODES = [
  'ABCD-EFGH-JK',
  'MNPQ-RSTV-WX',
  'Y234-5678-9A',
  'BCDE-FGHJ-KM',
  'NPQR-STVW-XY',
  'Z234-5679-AB',
  'CDEF-GHJK-MN',
  'PQRS-TVWX-YZ',
  '2345-6789-AB',
  'CDEF-GHJK-PQ',
];

export function operationsPermissions(): string[] {
  return [...ROLE_PERMISSIONS.operations];
}

export function meta(nowMs: number = Date.now()): {
  correlation_id: string;
  request_id: string;
  server_time: string;
} {
  return {
    correlation_id: randomUUID(),
    request_id: randomUUID(),
    server_time: new Date(nowMs).toISOString(),
  };
}

const KPI_VALUES: Record<string, { value: number; delta: number | null }> = {
  total_users: { value: 12_480, delta: 0.042 },
  active_users: { value: 4_318, delta: 0.018 },
  new_users: { value: 612, delta: -0.031 },
  pro_users: { value: 1_204, delta: 0.056 },
  trials: { value: 238, delta: null },
  connected_emails: { value: 9_870, delta: 0.012 },
  connected_calendars: { value: 7_455, delta: 0 },
  ai_requests: { value: 186_220, delta: 0.094 },
  ai_cost_usd: { value: 412.37, delta: 0.081 },
  briefings_generated: { value: 28_905, delta: 0.021 },
  push_sent: { value: 51_302, delta: -0.004 },
  ai_cost_per_active_user: { value: 0.0955, delta: 0.06 },
  classification_rate: { value: 0.97, delta: 0.001 },
  briefing_success_rate: { value: 0.992, delta: 0 },
  suppression_rate: { value: 0.41, delta: -0.02 },
  approval_conversion: { value: 0.38, delta: 0.03 },
  sync_success_rate: { value: 0.985, delta: 0.002 },
  reconnect_rate: { value: 0.012, delta: -0.1 },
};

export function dashboardMetrics(): typeof KPI_VALUES {
  return KPI_VALUES;
}

export function chartPoints(series: string): { t: string; value: number }[] {
  const base = series === 'ai_costs' ? 55 : series === 'sync_failures' ? 12 : 1_700;
  const day = 86_400_000;
  const start = Date.UTC(2026, 8, 17);
  return Array.from({ length: 7 }, (_, i) => ({
    t: new Date(start + i * day).toISOString(),
    value: Math.round(base * (1 + i / 20) * 100) / 100,
  }));
}

export function searchResults(
  q: string,
): { type: 'user'; id: string; label: string; route: string }[] {
  if (q.trim().length < 3) return [];
  return [
    {
      type: 'user',
      id: '0190f5e0-1111-7000-8000-00000000abcd',
      label: 'yu***@gmail.com',
      route: '/users/0190f5e0-1111-7000-8000-00000000abcd',
    },
  ];
}
