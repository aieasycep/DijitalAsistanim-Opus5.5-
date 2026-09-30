import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { parseClientEnv, parseServerEnv } from './src/env/schema.ts';

/**
 * apps/web (ADR-52; SCREEN_AND_FLOW_MAP Part 5 §0.2): Cache Components (static shells + cached
 * data), React Compiler, next-intl, and the security headers every response carries
 * (SECURITY_AND_PRIVACY_PLAN CTL-3.18). The page CSP is set per request in `src/proxy.ts`.
 *
 * The environment is validated here, so an invalid or incomplete production configuration fails
 * the build instead of a request.
 */
const serverEnv = parseServerEnv(process.env);
parseClientEnv(process.env);

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  ...(serverEnv.indexable ? [] : [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]),
];

const config: NextConfig = {
  reactCompiler: true,
  cacheComponents: true,
  poweredByHeader: false,
  transpilePackages: ['@da/i18n', '@da/design-tokens', '@da/domain'],
  experimental: {
    globalNotFound: true,
  },
  headers: () =>
    Promise.resolve([
      { source: '/:path*', headers: SECURITY_HEADERS },
      {
        source: '/.well-known/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }],
      },
    ]),
  rewrites: () =>
    Promise.resolve({
      // Served by route handlers under app/well-known; a rewrite, never a redirect (Apple
      // rejects redirected AASA files).
      beforeFiles: [{ source: '/.well-known/:file', destination: '/well-known/:file' }],
      afterFiles: [],
      fallback: [],
    }),
};

export default withNextIntl(config);
