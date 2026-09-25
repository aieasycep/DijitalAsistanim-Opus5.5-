/** Dashboard ranges (BACKOFFICE_PLAN §6.1; `@da/validation` `MetricsRange`). */
export const RANGES = ['24h', '7d', '30d', '90d'] as const;
export type Range = (typeof RANGES)[number];

/** Platform filter of the user, active-user and push KPIs (§6.1 "Tümü/iOS/Android"). */
export const PLATFORMS = ['all', 'ios', 'android'] as const;
export type Platform = (typeof PLATFORMS)[number];
