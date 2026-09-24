/** Dashboard ranges (BACKOFFICE_PLAN §6.1; `@da/validation` `MetricsRange`). */
export const RANGES = ['24h', '7d', '30d', '90d'] as const;
export type Range = (typeof RANGES)[number];
