/**
 * Content-Security-Policy for the website (SECURITY_AND_PRIVACY_PLAN CTL-3.18; SCREEN_AND_FLOW_MAP
 * Part 5 §0.12).
 *
 * - Routes that accept personal data or read request input (`/support`, `/data-deletion`,
 *   `/r/*`, `/oauth/done`, `/app/*`) render per request with a nonce and `'strict-dynamic'`.
 * - Prerendered marketing and legal pages hold no session and reflect no input; their shell is
 *   built once, so no per-request nonce can exist there and they use `script-src 'self'
 *   'unsafe-inline'` (the documented CTL-3.18 fallback). Every other directive is identical.
 */

export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

export interface CspOptions {
  /** Per-request nonce; omitted for prerendered routes. */
  readonly nonce?: string;
  /** Origin of `public-api` the browser may call (support, deletion, web events). */
  readonly apiOrigin?: string | undefined;
  /** Whether Cloudflare Turnstile is configured (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`). */
  readonly turnstile?: boolean;
  /** `next dev` needs `'unsafe-eval'` for React's development build. */
  readonly development?: boolean;
  /** Only an https site upgrades subresource requests (local http E2E would break otherwise). */
  readonly upgradeInsecure?: boolean;
}

export function buildCsp(options: CspOptions): string {
  const dev = options.development === true ? ["'unsafe-eval'"] : [];
  const turnstile = options.nonce !== undefined && options.turnstile === true;
  const script =
    options.nonce === undefined
      ? ["'self'", "'unsafe-inline'", ...dev]
      : [
          "'self'",
          `'nonce-${options.nonce}'`,
          "'strict-dynamic'",
          ...dev,
          ...(turnstile ? [TURNSTILE_ORIGIN] : []),
        ];
  const connect = ["'self'", ...(options.apiOrigin === undefined ? [] : [options.apiOrigin])];
  const directives: string[] = [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    ...(turnstile ? [`frame-src ${TURNSTILE_ORIGIN}`] : []),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ];
  if (options.upgradeInsecure === true) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function originOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Paths (after locale-prefix removal) rendered per request with a nonce CSP. */
export function isNonceRoute(pathWithoutLocale: string): boolean {
  return (
    pathWithoutLocale === '/support' ||
    pathWithoutLocale === '/data-deletion' ||
    pathWithoutLocale === '/oauth/done' ||
    pathWithoutLocale === '/app' ||
    pathWithoutLocale.startsWith('/app/') ||
    pathWithoutLocale.startsWith('/r/')
  );
}

/** Link-target routes that are locale-neutral and choose their locale per request. */
export function isLinkRoute(path: string): boolean {
  return (
    path === '/oauth/done' || path === '/app' || path.startsWith('/app/') || path.startsWith('/r/')
  );
}

/** Pages that must not leak their URL through the Referer header (Part 5 §0.12). */
export function isNoReferrerRoute(pathWithoutLocale: string): boolean {
  return pathWithoutLocale === '/data-deletion' || isLinkRoute(pathWithoutLocale);
}
