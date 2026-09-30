/**
 * Startup timing (T-8.28, M§125). The JS start is taken when this module is first evaluated (the
 * root layout imports it first); the startup completes when the root navigator hides the native
 * splash with the session known. The duration is kept for diagnostics and, when Sentry runs,
 * closes the SDK's app-start measurement (`appLoaded`) and records an `app.startup.js` span —
 * preview builds sample every session, so the startup budget is measured there. The plan defines
 * no numeric budget, so none is enforced here.
 *
 * Other performance rules live where they apply: the React Compiler is on (`app.config.ts`
 * `experiments.reactCompiler`), long lists use FlashList, queries are cached and persisted
 * (`meta.persist`), and stale requests are aborted per screen.
 */
import * as Sentry from '@sentry/react-native';

import { isSentryStarted } from './sentry';

const JS_START_MS = Date.now();
let startupMs: number | null = null;

/** Marks the first interactive frame; returns the JS-start-to-interactive time (once). */
export function markStartupComplete(now: number = Date.now()): number | null {
  if (startupMs !== null) return null;
  startupMs = Math.max(0, now - JS_START_MS);
  if (isSentryStarted()) {
    Sentry.appLoaded();
    Sentry.startInactiveSpan({
      name: 'app.startup.js',
      op: 'app.start.js',
      startTime: JS_START_MS / 1000,
    }).end(now / 1000);
  }
  return startupMs;
}

/** The measured startup time, or null before the first interactive frame. */
export function startupDurationMs(): number | null {
  return startupMs;
}

/** Test seam. */
export function resetPerfForTests(): void {
  startupMs = null;
}
