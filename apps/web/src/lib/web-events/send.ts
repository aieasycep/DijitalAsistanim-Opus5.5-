import { clientEnv } from '../../env/client.ts';
import type { Locale } from '../../i18n/locales.ts';
import { PUBLIC_API_PATH } from '../site.ts';
import {
  isAllowedWebEvent,
  type WebEventInput,
  type WebEventName,
  type WebEventProps,
  type WebPage,
} from './schema.ts';

/**
 * Sends one content-free event to `public-api` `POST /web-events` (PUB-06). Nothing is sent when
 * analytics is disabled, when no API base is configured, or when the browser signals Global
 * Privacy Control / Do Not Track. `keepalive` lets the event survive navigation;
 * `credentials: 'omit'` keeps it cookieless.
 */

interface PrivacySignals {
  readonly globalPrivacyControl?: boolean;
  readonly doNotTrack?: string | null;
}

export function trackingAllowed(nav: PrivacySignals | undefined): boolean {
  if (!clientEnv.NEXT_PUBLIC_ANALYTICS_ENABLED) return false;
  if (clientEnv.NEXT_PUBLIC_SUPABASE_URL === undefined) return false;
  if (nav === undefined) return false;
  if (nav.globalPrivacyControl === true) return false;
  if (nav.doNotTrack === '1') return false;
  return true;
}

export function deviceClass(width: number): WebEventInput['device_class'] {
  if (width < 768) return 'mobile';
  if (width < 1200) return 'tablet';
  return 'desktop';
}

export function sendWebEvent<E extends WebEventName>(
  event: E,
  context: { readonly page: WebPage; readonly locale: Locale },
  props: WebEventProps<E>,
): void {
  if (typeof window === 'undefined') return;
  const nav = window.navigator as Navigator & PrivacySignals;
  if (!trackingAllowed(nav)) return;
  const payload: WebEventInput = {
    event,
    page: context.page,
    locale: context.locale,
    device_class: deviceClass(window.innerWidth),
    theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    props: props,
  };
  if (!isAllowedWebEvent(payload)) return;
  const url = `${String(clientEnv.NEXT_PUBLIC_SUPABASE_URL)}${PUBLIC_API_PATH}/web-events`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY !== undefined) {
    headers.apikey = clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  }
  void fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    keepalive: true,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  }).catch(() => undefined);
}
