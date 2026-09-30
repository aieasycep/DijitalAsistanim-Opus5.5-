/**
 * KNOWN_PLATFORM_LIMITATIONS KPL-27: probes and repairs the engine's `Intl` (plural rules, zone
 * offsets) before any module formats a message or a date. `index.ts` imports this module ahead of
 * the router entry; `lib/sentry.ts` tags error events when a fallback is in use.
 */
import { ensureIntl, type IntlReport } from '@da/i18n';

export const intlReport: IntlReport = ensureIntl();
