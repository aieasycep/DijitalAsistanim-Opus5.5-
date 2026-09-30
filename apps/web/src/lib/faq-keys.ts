/**
 * The FAQ keys of `@da/i18n` `FAQ_ITEMS`, for client code (analytics allow-list, deep links) that
 * must not import the `@da/i18n` entry point. `test/faq.test.ts` pins this list to `FAQ_ITEMS`.
 */
export const FAQ_KEYS = [
  'what_is',
  'platforms',
  'languages',
  'first_analysis',
  'briefing_time',
  'integrations',
  'login_vs_connect',
  'disconnect',
  'admin_consent',
  'reads_mail',
  'storage',
  'encryption',
  'training',
  'ads',
  'approval',
  'retention',
  'where',
  'android_notifications',
  'security_report',
  'free_vs_pro',
  'billing',
  'trial',
  'restore',
  'refund',
  'referral',
  'pro_ends',
  'export',
  'delete_account',
  'delete_history',
  'reconnect',
  'notifications',
  'wrong_priority',
] as const;
export type FaqKey = (typeof FAQ_KEYS)[number];

/** `faq-admin-consent` (same rule as `@da/i18n` `faqAnchor`). */
export function faqAnchorId(key: string): string {
  return `faq-${key.replaceAll('_', '-')}`;
}
