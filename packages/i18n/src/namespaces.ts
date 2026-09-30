/**
 * Message namespaces. Each one is a JSON file per locale under `messages/<locale>/<namespace>.json`
 * and a top-level key of the merged catalog (`t('today.hero.…')`). Keep this list, the files on disk
 * and `src/messages.ts` in sync; `scripts/check-catalogs.ts` verifies it.
 */
export const NAMESPACES = [
  'common',
  'states',
  'errors',
  'onboarding',
  'auth',
  'today',
  'briefing',
  'flow',
  'mail',
  'reply',
  'waiting',
  'followups',
  'commitments',
  'life',
  'plan',
  'meeting',
  'assistant',
  'voice',
  'memory',
  'search',
  'person',
  'capture',
  'reminder',
  'approvals',
  'explain',
  'correction',
  'settings',
  'privacy',
  'notifications',
  'push',
  'subscription',
  'paywall',
  'referral',
  'android_ni',
  'widgets',
  'web',
  'legal',
  'faq',
  'backoffice',
  'backoffice_email',
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export function isNamespace(value: unknown): value is Namespace {
  return typeof value === 'string' && (NAMESPACES as readonly string[]).includes(value);
}
