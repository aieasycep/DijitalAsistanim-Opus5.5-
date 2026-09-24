/*
 * System health rules (BACKOFFICE_PLAN §11, §6.21; M§67): a probe older than 10 minutes counts as
 * `unknown` ("Bilinmiyor"), never green; the overall header is "Kesinti var" when anything is down,
 * "Kısmi sorun" when anything is degraded or unknown (or, in production, a required service lacks
 * its credential), and "Tüm sistemler çalışıyor" only with fresh healthy probes. Pure.
 */

export type HealthStatusValue =
  'healthy' | 'degraded' | 'down' | 'external_credential_required' | 'unknown';

export interface ProbeResult {
  readonly component: string;
  readonly status: HealthStatusValue;
  readonly checked_at: string;
}

export const STALE_AFTER_MS = 10 * 60_000;
/** Probes whose missing credential does not degrade production (fallback-only, §11). */
const OPTIONAL_IN_PRODUCTION = new Set(['ai_openai']);

export function isStale(checkedAt: string, now: number): boolean {
  return now - Date.parse(checkedAt) > STALE_AFTER_MS;
}

export function effectiveStatus(probe: ProbeResult, now: number): HealthStatusValue {
  if (probe.status === 'external_credential_required') return probe.status;
  return isStale(probe.checked_at, now) ? 'unknown' : probe.status;
}

export type OverallHealth = 'outage' | 'partial' | 'operational' | 'unknown';

export function overallHealth(
  probes: readonly ProbeResult[],
  now: number,
  production: boolean,
): OverallHealth {
  const configured = probes.filter((p) => p.status !== 'external_credential_required');
  const statuses = configured.map((p) => effectiveStatus(p, now));
  if (statuses.includes('down')) return 'outage';
  if (statuses.includes('degraded') || statuses.includes('unknown')) return 'partial';
  const missingRequired = probes.some(
    (p) => p.status === 'external_credential_required' && !OPTIONAL_IN_PRODUCTION.has(p.component),
  );
  if (production && missingRequired) return 'partial';
  if (statuses.length === 0) return 'unknown';
  return 'operational';
}
