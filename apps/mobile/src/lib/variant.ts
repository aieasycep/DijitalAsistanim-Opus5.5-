/**
 * Build-variant naming rules (INTEGRATION_PLAN §0.5, M§108), shared by `app.config.ts` (native
 * identifiers at build time) and `env.ts` (the scheme the running app links back to). Pure
 * functions of their arguments: no environment access here.
 */
import type { AppEnv } from '@da/validation/env';

/** Identifier suffix per variant; production has none. */
export const VARIANT_SUFFIX: Readonly<Record<AppEnv, string>> = {
  development: 'dev',
  preview: 'preview',
  e2e: 'e2e',
  production: '',
};

/** `com.dijitalasistan.app` → `com.dijitalasistan.app.dev` (bundle ID, package, App Group). */
export function variantIdentifier(base: string, appEnv: AppEnv): string {
  const suffix = VARIANT_SUFFIX[appEnv];
  return suffix === '' ? base : `${base}.${suffix}`;
}

/**
 * `dijitalasistan` → `dijitalasistan-dev`. The suffix is appended once, so a base scheme (the
 * `.env.example` default) and an already-suffixed per-profile scheme (`eas.json`) agree.
 */
export function variantScheme(base: string, appEnv: AppEnv): string {
  const suffix = VARIANT_SUFFIX[appEnv];
  return suffix === '' || base.endsWith(`-${suffix}`) ? base : `${base}-${suffix}`;
}
