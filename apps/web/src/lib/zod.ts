import { z } from 'zod';

/**
 * Zod for the web app, with its JIT disabled: the JIT probes `Function('')`, which the pages'
 * CSP (no `'unsafe-eval'`, CTL-3.18) reports as a violation on every page. Jitless parsing is the
 * same API and is fast enough for the small payloads validated here. Import `z` from this module,
 * never from `zod` directly, so the setting is applied before any schema runs.
 */
z.config({ jitless: true });

export { z };
