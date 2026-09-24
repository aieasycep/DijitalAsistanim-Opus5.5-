import { isLoginReason } from '@/lib/error-copy';

/*
 * Routing decisions of `proxy.ts` (BACKOFFICE_PLAN §2.4 steps 4–6), kept pure for unit tests.
 * The JWT `admin_role` claim is a fast gate only; admin-api and SQL are authoritative (§4.3).
 */

export interface SessionClaims {
  readonly aal?: unknown;
  readonly admin_role?: unknown;
}

export type RouteDecision =
  | { readonly kind: 'next' }
  | { readonly kind: 'redirect'; readonly location: string }
  /** Sign out locally (clear the sealed cookies), then continue or redirect. */
  | { readonly kind: 'signout'; readonly location: string | null }
  | { readonly kind: 'unauthorized' };

/** Pages anyone may load: sign-in, invitation, the static forbidden page, liveness. */
const PUBLIC_PATHS = new Set(['/login', '/invite', '/forbidden', '/api/healthz']);

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

export function routeDecision(input: {
  pathname: string;
  search: string;
  method: string;
  claims: SessionClaims | null;
}): RouteDecision {
  const { pathname, claims } = input;
  const navigation = input.method === 'GET' || input.method === 'HEAD';
  const aal2 = claims !== null && claims.aal === 'aal2';
  const isAdmin = typeof claims?.admin_role === 'string' && claims.admin_role !== '';

  if (pathname === '/login') {
    const reason = new URLSearchParams(input.search).get('reason');
    // Arriving with a sign-out reason ends whatever is left of the session on this device.
    if (claims !== null && isLoginReason(reason) && navigation)
      return { kind: 'signout', location: null };
    if (aal2 && isAdmin && navigation && reason === null)
      return { kind: 'redirect', location: '/dashboard' };
    return { kind: 'next' };
  }
  if (PUBLIC_PATHS.has(pathname)) return { kind: 'next' };

  if (claims === null) {
    if (isApiPath(pathname) || !navigation) return { kind: 'unauthorized' };
    const next = `${pathname}${input.search}`;
    return {
      kind: 'redirect',
      location: pathname === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`,
    };
  }

  if (pathname === '/mfa') return { kind: 'next' };

  if (!aal2) {
    if (isApiPath(pathname) || !navigation) return { kind: 'unauthorized' };
    return { kind: 'redirect', location: '/mfa' };
  }
  if (!isAdmin) return { kind: 'signout', location: '/login?reason=not_admin' };
  return { kind: 'next' };
}
