import { NextResponse, type NextRequest } from 'next/server';

import { serverEnv } from '@/env';
import type { CookieWrite } from '@/server/cookie-seal';
import { SAFE_METHODS, checkSameOrigin } from '@/server/csrf';
import { routeDecision, type SessionClaims } from '@/server/proxy-routing';
import { PRE_AUTH_THROTTLED_PATHS, preAuthLimiter } from '@/server/rate-limit';
import { clientIp } from '@/server/request-meta';
import { DYNAMIC_RESPONSE_HEADERS, buildCsp, createNonce } from '@/server/security-headers';
import { createSealedSupabase } from '@/server/supabase-core';

/*
 * Backoffice proxy (Next 16, Node runtime; BACKOFFICE_PLAN §2.4, SECURITY_AND_PRIVACY_PLAN CTL-3.8):
 * 1. per-request nonce CSP and the security headers (HSTS, noindex, no-store, …);
 * 2. every non-GET/HEAD/OPTIONS request needs `Origin` = ADMIN_ORIGIN (missing or foreign → 403);
 * 3. best-effort throttle of pre-auth POSTs (`/login`, `/mfa`, `/invite`: 30 per 5 min per IP);
 * 4. the sealed Supabase session is verified (`getClaims`, refreshed when due);
 * 5. no session → /login?next=…, aal1 → /mfa, no admin claim → sign out → /login?reason=not_admin.
 */

function withHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set('Content-Security-Policy', csp);
  for (const [name, value] of Object.entries(DYNAMIC_RESPONSE_HEADERS))
    response.headers.set(name, value);
  return response;
}

function applyCookies(response: NextResponse, writes: readonly CookieWrite[]): NextResponse {
  for (const write of writes) response.cookies.set(write.name, write.value, write.options);
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const env = serverEnv();
  const nonce = createNonce();
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV === 'development',
    upgradeInsecureRequests: env.ADMIN_ORIGIN.startsWith('https://'),
  });
  const { pathname, search } = request.nextUrl;
  const method = request.method.toUpperCase();

  if (!SAFE_METHODS.has(method)) {
    const origin = checkSameOrigin(request.headers, env.ADMIN_ORIGIN);
    if (!origin.ok) {
      return withHeaders(NextResponse.json({ error: 'csrf_origin' }, { status: 403 }), csp);
    }
    if (method === 'POST' && PRE_AUTH_THROTTLED_PATHS.has(pathname)) {
      const decision = preAuthLimiter.hit(clientIp(request.headers));
      if (!decision.allowed) {
        const limited = NextResponse.json({ error: 'rate_limited' }, { status: 429 });
        limited.headers.set('Retry-After', String(decision.retryAfter));
        return withHeaders(limited, csp);
      }
    }
  }

  const writes: CookieWrite[] = [];
  const supabase = await createSealedSupabase(
    { read: () => request.cookies.getAll(), write: (out) => writes.push(...out) },
    env,
  );
  let claims: SessionClaims | null = null;
  if (pathname !== '/api/healthz') {
    try {
      const { data } = await supabase.auth.getClaims();
      claims = (data?.claims as SessionClaims | undefined) ?? null;
    } catch {
      claims = null;
    }
  }

  const decision = routeDecision({ pathname, search, method, claims });

  if (decision.kind === 'unauthorized') {
    return applyCookies(
      withHeaders(NextResponse.json({ error: 'unauthenticated' }, { status: 401 }), csp),
      writes,
    );
  }
  if (decision.kind === 'redirect') {
    return applyCookies(
      withHeaders(NextResponse.redirect(new URL(decision.location, request.url)), csp),
      writes,
    );
  }
  if (decision.kind === 'signout') {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // The local session is removed even when Auth cannot be reached.
    }
  }

  // A refreshed (or cleared) session must be visible to this request's Server Components too.
  for (const write of writes) {
    if (write.options.maxAge === 0) request.cookies.delete(write.name);
    else request.cookies.set(write.name, write.value);
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response =
    decision.kind === 'signout' && decision.location !== null
      ? NextResponse.redirect(new URL(decision.location, request.url))
      : NextResponse.next({ request: { headers: requestHeaders } });
  return applyCookies(withHeaders(response, csp), writes);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
