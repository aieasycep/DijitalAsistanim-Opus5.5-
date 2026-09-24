/**
 * Security headers (BACKOFFICE_PLAN §3.8, SECURITY_AND_PRIVACY_PLAN CTL-3.18). The nonce CSP is
 * built per request in `proxy.ts`; the static set is also applied by `next.config.ts` `headers()` so
 * responses the proxy does not see (`/_next/static`, `/robots.txt`) carry it too.
 */

export const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
};

/** Headers for every dynamic response (all backoffice pages read cookies). */
export const DYNAMIC_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  ...STATIC_SECURITY_HEADERS,
  'Cache-Control': 'no-store',
};

/** 128-bit random nonce, base64. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface CspOptions {
  /** `next dev` needs `'unsafe-eval'` for React's debugging stacks; never in production builds. */
  readonly dev?: boolean;
  /** Plain-HTTP e2e and local runs cannot upgrade requests to https. */
  readonly upgradeInsecureRequests?: boolean;
}

/**
 * `style-src-attr 'unsafe-inline'` is limited to style attributes (Radix positioning and Recharts
 * SVG) and never allows `<style>` elements, which stay nonce-bound.
 */
export function buildCsp(nonce: string, options: CspOptions = {}): string {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.dev === true ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    `style-src-attr 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'none'`,
    `object-src 'none'`,
  ];
  if (options.upgradeInsecureRequests !== false) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
