import { z } from 'zod';
import { IsoDateTime, Uuid } from '../api/common.ts';
import { MetricsRange, Success } from './common.ts';

/* ADM-01 · Dashboard (§12.3): read-only aggregates, users counted never listed. */

export const DashboardMetricsQuery = z.strictObject({ range: MetricsRange.default('7d') });
const Metric = z.object({ value: z.number(), delta: z.number().nullable() });
export const DASHBOARD_METRIC_KEYS = [
  'total_users',
  'active_users',
  'new_users',
  'pro_users',
  'trials',
  'connected_emails',
  'connected_calendars',
  'ai_requests',
  'ai_cost_usd',
  'briefings_generated',
  'push_sent',
  'ai_cost_per_active_user',
  'classification_rate',
  'briefing_success_rate',
  'suppression_rate',
  'approval_conversion',
  'sync_success_rate',
  'reconnect_rate',
] as const;
export const DashboardMetricsResponse = Success(
  z.object(
    Object.fromEntries(DASHBOARD_METRIC_KEYS.map((key) => [key, Metric])) as Record<
      (typeof DASHBOARD_METRIC_KEYS)[number],
      typeof Metric
    >,
  ),
);

export const DashboardChartsQuery = z.strictObject({
  range: MetricsRange.default('7d'),
  series: z.enum(['user_growth', 'active_usage', 'ai_costs', 'subscriptions', 'sync_failures']),
});
export const ChartPoints = z.object({
  points: z.array(
    z.object({
      t: IsoDateTime,
      value: z.number(),
      breakdown: z.record(z.string(), z.number()).optional(),
    }),
  ),
});
export const DashboardChartsResponse = Success(ChartPoints);

/** `GET /metrics/ops`, `GET /metrics/product`: named aggregate groups (counts and rates only). */
export const MetricsGroupsResponse = Success(
  z.object({
    range: MetricsRange,
    groups: z.record(z.string(), z.record(z.string(), z.number())),
  }),
);

export const SecurityEventsResponse = Success(
  z.object({
    range: MetricsRange,
    login_failures: z.int().min(0),
    lockouts: z.int().min(0),
    recovery_codes_used: z.int().min(0),
    permission_denials: z.int().min(0),
    webhook_signature_failures: z.int().min(0),
    by_admin: z.array(z.object({ admin_id: Uuid, count: z.int().min(0) })),
  }),
);
