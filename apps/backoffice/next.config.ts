import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { STATIC_SECURITY_HEADERS } from './src/server/security-headers';

/*
 * Backoffice Next config (BACKOFFICE_PLAN §2.2, §2.4). Every page reads cookies, so everything is
 * dynamic (`cacheComponents: false`). Server Actions accept only the admin host; the action wrapper
 * re-checks Origin because Next lets Origin-less requests through with a warning. The nonce CSP is
 * set per request by `src/proxy.ts`; the static headers below also cover what the proxy skips.
 */

const adminHost = (() => {
  const origin = process.env.ADMIN_ORIGIN;
  if (origin === undefined || origin === '') return [];
  try {
    return [new URL(origin).host];
  } catch {
    return [];
  }
})();

const nextConfig: NextConfig = {
  reactCompiler: true,
  cacheComponents: false,
  poweredByHeader: false,
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  transpilePackages: ['@da/i18n', '@da/validation', '@da/domain', '@da/design-tokens'],
  experimental: {
    taint: true,
    serverActions: { allowedOrigins: adminHost, bodySizeLimit: '256kb' },
  },
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: Object.entries(STATIC_SECURITY_HEADERS).map(([key, value]) => ({ key, value })),
      },
    ]);
  },
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
