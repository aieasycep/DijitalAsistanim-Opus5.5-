/**
 * The single FAQ source (SREQ-70; SCREEN_AND_FLOW_MAP Part 4 §10 and Part 5 §5.2). The web
 * `/support` page, the home and pricing FAQ blocks and the in-app Help screen render these items;
 * the copy lives in the `faq` namespace (`faq.items.<key>.q` / `.a`), the metadata here.
 *
 * ICU values: `{mail}`, `{cal}`, `{n}` from `plan_limits` (`max_mail_accounts`, `max_calendars`,
 * `ai_daily_budget_units`); `{window}`, `{days}`, `{cap}` from the referral config. Rich tags
 * (`<privacy>`, `<adminConsent>`) are rendered with `t.rich`.
 */

export const FAQ_CATEGORIES = [
  'start',
  'accounts',
  'privacy',
  'billing',
  'data',
  'trouble',
] as const;
export type FaqCategory = (typeof FAQ_CATEGORIES)[number];

export type FaqPlatforms = 'all' | 'ios' | 'android';

export interface FaqItem {
  key: string;
  category: FaqCategory;
  /** Shown in the Help "Öne çıkanlar" block and on the web home page (exactly eight). */
  featured: boolean;
  /** Allow-listed in-app route for the "Ayara git" button. */
  appRoute?: string;
  platforms: FaqPlatforms;
  /** ICU arguments the answer needs. */
  params?: readonly string[];
  /** ICU rich-text tags the answer uses. */
  tags?: readonly string[];
}

export const FAQ_ITEMS = [
  { key: 'what_is', category: 'start', featured: true, platforms: 'all' },
  { key: 'platforms', category: 'start', featured: false, platforms: 'all' },
  { key: 'languages', category: 'start', featured: false, platforms: 'all' },
  { key: 'first_analysis', category: 'start', featured: false, platforms: 'all' },
  {
    key: 'briefing_time',
    category: 'start',
    featured: false,
    platforms: 'all',
    appRoute: '/settings/briefings',
  },
  {
    key: 'integrations',
    category: 'accounts',
    featured: true,
    platforms: 'all',
    params: ['mail', 'cal'],
  },
  { key: 'login_vs_connect', category: 'accounts', featured: false, platforms: 'all' },
  {
    key: 'disconnect',
    category: 'accounts',
    featured: false,
    platforms: 'all',
    appRoute: '/settings/accounts',
  },
  {
    key: 'admin_consent',
    category: 'accounts',
    featured: false,
    platforms: 'all',
    tags: ['adminConsent'],
  },
  { key: 'reads_mail', category: 'privacy', featured: false, platforms: 'all' },
  { key: 'storage', category: 'privacy', featured: true, platforms: 'all' },
  { key: 'encryption', category: 'privacy', featured: false, platforms: 'all' },
  { key: 'training', category: 'privacy', featured: true, platforms: 'all' },
  { key: 'ads', category: 'privacy', featured: false, platforms: 'all' },
  {
    key: 'approval',
    category: 'privacy',
    featured: true,
    platforms: 'all',
    appRoute: '/approvals',
  },
  {
    key: 'retention',
    category: 'privacy',
    featured: false,
    platforms: 'all',
    appRoute: '/settings/privacy/retention',
    tags: ['privacy'],
  },
  { key: 'where', category: 'privacy', featured: false, platforms: 'all' },
  { key: 'android_notifications', category: 'privacy', featured: false, platforms: 'all' },
  { key: 'security_report', category: 'privacy', featured: false, platforms: 'all' },
  {
    key: 'free_vs_pro',
    category: 'billing',
    featured: true,
    platforms: 'all',
    params: ['mail', 'cal', 'n'],
  },
  {
    key: 'billing',
    category: 'billing',
    featured: false,
    platforms: 'all',
    appRoute: '/settings/subscription',
  },
  { key: 'trial', category: 'billing', featured: true, platforms: 'all' },
  {
    key: 'restore',
    category: 'billing',
    featured: false,
    platforms: 'all',
    appRoute: '/settings/subscription',
  },
  { key: 'refund', category: 'billing', featured: false, platforms: 'all' },
  {
    key: 'referral',
    category: 'billing',
    featured: false,
    platforms: 'all',
    appRoute: '/settings/referral',
    params: ['window', 'days', 'cap'],
  },
  { key: 'pro_ends', category: 'billing', featured: false, platforms: 'all' },
  {
    key: 'export',
    category: 'data',
    featured: false,
    platforms: 'all',
    appRoute: '/settings/privacy/export',
  },
  {
    key: 'delete_account',
    category: 'data',
    featured: true,
    platforms: 'all',
    appRoute: '/settings/privacy/delete-account',
  },
  {
    key: 'delete_history',
    category: 'data',
    featured: false,
    platforms: 'all',
    appRoute: '/settings/privacy/history',
  },
  {
    key: 'reconnect',
    category: 'trouble',
    featured: false,
    platforms: 'all',
    appRoute: '/settings/accounts',
  },
  {
    key: 'notifications',
    category: 'trouble',
    featured: false,
    platforms: 'all',
    appRoute: '/settings/notifications',
  },
  {
    key: 'wrong_priority',
    category: 'trouble',
    featured: false,
    platforms: 'all',
    appRoute: '/settings/priority-rules',
  },
] as const satisfies readonly FaqItem[];

export type FaqKey = (typeof FAQ_ITEMS)[number]['key'];

/** The web anchor id for an item: `faq-admin-consent`. */
export function faqAnchor(key: string): string {
  return `faq-${key.replaceAll('_', '-')}`;
}

/** Items visible on a platform; the web shows every item. */
export function faqItemsFor(platform: 'ios' | 'android' | 'web'): readonly FaqItem[] {
  return FAQ_ITEMS.filter(
    (item: FaqItem) =>
      platform === 'web' || item.platforms === 'all' || item.platforms === platform,
  );
}
