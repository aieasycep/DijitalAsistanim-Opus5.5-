import { z } from '../zod.ts';
import { TICKET_CATEGORY_VALUES } from '@da/domain/enums';
import { FAQ_KEYS } from '../faq-keys.ts';
import { PLACEMENTS } from '../store-links.ts';
import { WEB_LOCALES } from '../../i18n/locales.ts';

/**
 * Privacy-safe web analytics allow-list (SCREEN_AND_FLOW_MAP Part 5 §0.11, registry R-27;
 * API_CONTRACTS PUB-06 `WebEventInput`). Events carry enums and booleans only: never an email,
 * code, reference, completion code, query string or free text. The server re-validates and stores
 * daily aggregates only.
 */

export const WEB_PAGES = [
  'home',
  'pricing',
  'privacy',
  'terms',
  'support',
  'data_deletion',
  'referral',
  'oauth_done',
  'app_link',
  'not_found',
] as const;
export type WebPage = (typeof WEB_PAGES)[number];

const placement = z.enum(PLACEMENTS);

export const WEB_EVENT_PROPS = {
  web_page_view: z.strictObject({}),
  web_cta_click: z.strictObject({
    cta: z.enum([
      'app_store',
      'play_store',
      'get_started',
      'pricing',
      'faq_all',
      'privacy',
      'support',
      'open_in_app',
    ]),
    placement,
  }),
  web_qr_shown: z.strictObject({ placement }),
  web_nav_click: z.strictObject({
    target: z.enum(['how_it_works', 'features', 'security', 'pricing', 'faq']),
  }),
  web_locale_switch: z.strictObject({ to: z.enum(WEB_LOCALES) }),
  web_faq_toggle: z.strictObject({ faq_id: z.enum(FAQ_KEYS), open: z.boolean() }),
  web_pricing_period: z.strictObject({ period: z.enum(['monthly', 'annual']) }),
  web_support_submit: z.strictObject({
    category: z.enum(TICKET_CATEGORY_VALUES),
    result: z.enum(['ok', 'invalid', 'rate_limited', 'error']),
  }),
  web_deletion_step: z.strictObject({
    step: z.enum([
      'email_submitted',
      'code_sent',
      'request_submitted',
      'request_created',
      'otp_invalid',
      'otp_locked',
      'rate_limited',
      'error',
    ]),
  }),
  web_referral_view: z.strictObject({ valid: z.boolean() }),
  web_oauth_done_view: z.strictObject({
    provider: z.enum(['google', 'microsoft', 'demo', 'unknown']),
    result: z.enum([
      'pending_confirmation',
      'denied',
      'error',
      'expired_state',
      'admin_consent_required',
      'unknown',
    ]),
  }),
  web_app_link_view: z.strictObject({}),
  web_get_redirect: z.strictObject({
    target: z.enum(['app_store', 'play_store', 'web']),
    src: z.enum([...PLACEMENTS, 'web']),
  }),
} as const;

export type WebEventName = keyof typeof WEB_EVENT_PROPS;
export type WebEventProps<E extends WebEventName> = z.infer<(typeof WEB_EVENT_PROPS)[E]>;

export const WebEventInputSchema = z.strictObject({
  event: z.enum(Object.keys(WEB_EVENT_PROPS) as [WebEventName, ...WebEventName[]]),
  page: z.enum(WEB_PAGES),
  locale: z.enum(WEB_LOCALES),
  device_class: z.enum(['mobile', 'tablet', 'desktop']),
  theme: z.enum(['light', 'dark']),
  props: z.record(z.string(), z.union([z.string(), z.boolean()])),
});
export type WebEventInput = z.infer<typeof WebEventInputSchema>;

/** Validates a payload against the envelope and its event's prop allow-list. */
export function isAllowedWebEvent(input: unknown): input is WebEventInput {
  const envelope = WebEventInputSchema.safeParse(input);
  if (!envelope.success) return false;
  return WEB_EVENT_PROPS[envelope.data.event].safeParse(envelope.data.props).success;
}
