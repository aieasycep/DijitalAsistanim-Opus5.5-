/**
 * Crash-free rates per app version from the Sentry sessions API (BACKOFFICE_PLAN §6.22, M§110).
 * Needs `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` (INTEGRATION_PLAN §15 names); without
 * them the report is `external_credential_required` (names only) and no number is shown. The
 * project slug is resolved to its id once, then `GET /api/0/organizations/{org}/sessions/` is read
 * grouped by release (`com.dijitalasistan.app@{version}+{build}`); builds of one version keep the
 * lowest rate. A failed call is `unavailable` (the other app-version columns still render). A
 * successful result is cached for 10 minutes per range.
 */
import type { RawEnv } from '../../_shared/env.ts';

export const SENTRY_CREDENTIAL_KEYS = [
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
] as const;
const SENTRY_API = 'https://sentry.io/api/0';
const CACHE_MS = 10 * 60_000;
const TIMEOUT_MS = 5_000;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RELEASE_VERSION = /@(\d+\.\d+\.\d+)(?:\+|$)/;

export interface CrashFree {
  readonly sessions: number | null;
  readonly users: number | null;
}

export type CrashReport =
  | {
      readonly status: 'external_credential_required';
      readonly missing: readonly string[];
    }
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'configured';
      readonly byVersion: ReadonlyMap<string, CrashFree>;
    };

const cache = new Map<string, { readonly at: number; readonly report: CrashReport }>();

/** Test hook: forget cached reports. */
export function resetSentryCache(): void {
  cache.clear();
}

function rate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function lower(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

async function getJson(fetchImpl: typeof fetch, url: string, token: string): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`sentry_http_${String(response.status)}`);
  return await response.json();
}

/** Parses the sessions API body: `{groups:[{by:{release}, totals:{'crash_free_rate(…)': n}}]}`. */
export function crashFreeFromSessions(body: unknown): Map<string, CrashFree> {
  const out = new Map<string, CrashFree>();
  const groups = (body as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups)) return out;
  for (const group of groups as {
    by?: { release?: unknown };
    totals?: Record<string, unknown>;
  }[]) {
    const release = typeof group.by?.release === 'string' ? group.by.release : '';
    const version = RELEASE_VERSION.exec(release)?.[1];
    if (version === undefined) continue;
    const sessions = rate(group.totals?.['crash_free_rate(session)']);
    const users = rate(group.totals?.['crash_free_rate(user)']);
    const prev = out.get(version);
    out.set(version, {
      sessions: prev === undefined ? sessions : lower(prev.sessions, sessions),
      users: prev === undefined ? users : lower(prev.users, users),
    });
  }
  return out;
}

export async function crashFreeByVersion(
  env: RawEnv,
  range: '24h' | '7d' | '30d' | '90d',
  fetchImpl: typeof fetch,
  now: number,
): Promise<CrashReport> {
  const missing = SENTRY_CREDENTIAL_KEYS.filter((key) => (env[key] ?? '').trim() === '');
  if (missing.length > 0) {
    return { status: 'external_credential_required', missing };
  }
  const token = (env.SENTRY_AUTH_TOKEN ?? '').trim();
  const org = (env.SENTRY_ORG ?? '').trim();
  const project = (env.SENTRY_PROJECT ?? '').trim();
  if (!SLUG.test(org) || !SLUG.test(project)) return { status: 'unavailable' };
  const key = `${org}/${project}/${range}`;
  const hit = cache.get(key);
  if (hit !== undefined && now - hit.at < CACHE_MS) return hit.report;
  let report: CrashReport;
  try {
    const info = (await getJson(fetchImpl, `${SENTRY_API}/projects/${org}/${project}/`, token)) as {
      id?: unknown;
    } | null;
    const id = typeof info?.id === 'string' || typeof info?.id === 'number' ? String(info.id) : '';
    if (!/^\d+$/.test(id)) throw new Error('sentry_project_id');
    const query = new URLSearchParams([
      ['project', id],
      ['field', 'crash_free_rate(session)'],
      ['field', 'crash_free_rate(user)'],
      ['groupBy', 'release'],
      ['statsPeriod', range],
      ['interval', '1d'],
    ]);
    const body = await getJson(
      fetchImpl,
      `${SENTRY_API}/organizations/${org}/sessions/?${query.toString()}`,
      token,
    );
    report = { status: 'configured', byVersion: crashFreeFromSessions(body) };
  } catch {
    report = { status: 'unavailable' };
  }
  if (report.status === 'configured') cache.set(key, { at: now, report });
  return report;
}
