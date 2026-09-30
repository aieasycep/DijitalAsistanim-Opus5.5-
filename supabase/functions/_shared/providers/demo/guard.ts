/**
 * Demo-mode guard (M§89, ADR-07, SECURITY_AND_PRIVACY_PLAN CTL-3.6, IMPLEMENTATION_PLAN T-3.08).
 *
 * `DEMO_MODE=true` enables deterministic demo providers and fixtures. In production
 * (`APP_ENV=production`) it is refused unless `ALLOW_DEMO_IN_PRODUCTION=true`: every function except
 * `health` calls `assertDemoAllowed()` at module init and refuses to start; `health` reports the
 * condition as `down` with detail code `demo_mode_forbidden` instead of starting a demo stack.
 */
import type { RawEnv } from '../../env.ts';

export type DemoModeState = 'off' | 'on' | 'forbidden';

export class DemoModeForbiddenError extends Error {
  constructor() {
    super('demo_mode_forbidden');
    this.name = 'DemoModeForbiddenError';
  }
}

function flag(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === 'true' || v === '1';
}

export function demoModeState(raw: RawEnv): DemoModeState {
  if (!flag(raw.DEMO_MODE)) return 'off';
  const production = raw.APP_ENV?.trim() === 'production';
  if (production && !flag(raw.ALLOW_DEMO_IN_PRODUCTION)) return 'forbidden';
  return 'on';
}

/** Throws `DemoModeForbiddenError` for demo mode in production without the allowance. */
export function assertDemoAllowed(raw: RawEnv): DemoModeState {
  const state = demoModeState(raw);
  if (state === 'forbidden') throw new DemoModeForbiddenError();
  return state;
}

export function isDemoEnabled(raw: RawEnv): boolean {
  return demoModeState(raw) === 'on';
}
