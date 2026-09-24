/*
 * Feature-flag helpers for the backoffice (BACKOFFICE_PLAN §6.17; R-10): the targeting summary
 * ("%25 · ios · pro · ≥1.4.0") and the cosmetic write rule (admin-api and SQL enforce it):
 * `flags.write` may change every key, `flags.write_ai` only `ai.*` and `voice.*` keys.
 */

export interface TargetingLike {
  readonly rollout_percent: number;
  readonly platforms: readonly string[];
  readonly plans: readonly string[];
  readonly min_version: string | null;
  readonly max_version: string | null;
}

export function targetingSummary(row: TargetingLike): string {
  const parts = [`%${String(row.rollout_percent)}`];
  if (row.platforms.length > 0) parts.push(row.platforms.join('/'));
  if (row.plans.length > 0) parts.push(row.plans.join('/'));
  if (row.min_version !== null) parts.push(`≥${row.min_version}`);
  if (row.max_version !== null) parts.push(`≤${row.max_version}`);
  return parts.join(' · ');
}

export function isAiFlag(key: string): boolean {
  return key.startsWith('ai.') || key.startsWith('voice.');
}

export function canWriteFlagKey(
  permissions: (permission: string) => boolean,
  key: string,
): boolean {
  return permissions('flags.write') || (permissions('flags.write_ai') && isAiFlag(key));
}
