/**
 * CSRF origin check (BACKOFFICE_PLAN §3.10, SECURITY_AND_PRIVACY_PLAN CTL-3.8 `assertSameOrigin()`).
 * Used twice: in `proxy.ts` for every non-GET request and again inside the server-action wrapper
 * (defence in depth, because Next 16 lets a request without `Origin` through with only a warning).
 *
 * Rules: `Origin` MUST be present and equal `ADMIN_ORIGIN`; `Sec-Fetch-Site`, when present, MUST be
 * `same-origin`.
 */

export type OriginRejection = 'origin_missing' | 'origin_mismatch' | 'cross_site';
export type OriginCheck = { ok: true } | { ok: false; reason: OriginRejection };

export interface HeaderSource {
  get(name: string): string | null;
}

/** Methods that never mutate state and therefore skip the Origin requirement. */
export const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

export function checkSameOrigin(headers: HeaderSource, adminOrigin: string): OriginCheck {
  const fetchSite = headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin') return { ok: false, reason: 'cross_site' };
  const origin = headers.get('origin');
  if (origin === null || origin.trim() === '' || origin === 'null') {
    return { ok: false, reason: 'origin_missing' };
  }
  let normalised: string;
  try {
    normalised = new URL(origin).origin;
  } catch {
    return { ok: false, reason: 'origin_mismatch' };
  }
  return normalised === new URL(adminOrigin).origin
    ? { ok: true }
    : { ok: false, reason: 'origin_mismatch' };
}

/** `Sec-Fetch-Site` check alone, for GET route handlers (they carry no `Origin` on navigation). */
export function checkFetchSite(headers: HeaderSource): OriginCheck {
  const fetchSite = headers.get('sec-fetch-site');
  if (fetchSite === null || fetchSite === 'same-origin' || fetchSite === 'none')
    return { ok: true };
  return { ok: false, reason: 'cross_site' };
}
