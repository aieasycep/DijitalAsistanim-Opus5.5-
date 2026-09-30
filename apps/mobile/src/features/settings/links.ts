/**
 * Outbound links of the settings screens: web pages in the in-app browser (blocked offline with the
 * offline reason; `Linking` fallback), `mailto:` with a clipboard fallback ("Adres kopyalandı"), and
 * the store listing / review (`expo-store-review`).
 */
import * as Clipboard from 'expo-clipboard';
import * as StoreReview from 'expo-store-review';
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import { translator } from '../../i18n/translate';
import { webPage } from '../../lib/env';
import { track } from '../../lib/events';
import { isOffline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';

export const SUPPORT_EMAIL = 'destek@dijitalasistan.app';
export const SECURITY_EMAIL = 'guvenlik@dijitalasistan.app';

/** Opens `https://<web-domain>{path}`; false when blocked offline. */
export async function openWebPage(path: `/${string}`): Promise<boolean> {
  if (isOffline()) {
    showToast({ message: translator()('states.offline.blockedToast'), kind: 'offline' });
    return false;
  }
  const url = webPage(path);
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    await Linking.openURL(url).catch(() => undefined);
  }
  return true;
}

/** `mailto:`; without a mail client the address is copied instead. */
export async function openMail(address: string): Promise<'opened' | 'copied'> {
  const url = `mailto:${address}`;
  const can = await Linking.canOpenURL(url).catch(() => false);
  if (can) {
    await Linking.openURL(url).catch(() => undefined);
    return 'opened';
  }
  await Clipboard.setStringAsync(address);
  showToast({ message: translator()('settings.common.addressCopied') });
  return 'copied';
}

/** The system review prompt when available, otherwise the store page (no rating gate). */
export async function requestStoreReview(): Promise<void> {
  const available = await StoreReview.isAvailableAsync().catch(() => false);
  track('store_review_requested', { available });
  if (available) {
    await StoreReview.requestReview().catch(() => undefined);
    return;
  }
  const url = StoreReview.storeUrl();
  if (url !== null) await Linking.openURL(url).catch(() => undefined);
}

/** "a***@example.com" (the reply address shown after a ticket, never the full relay address). */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (domain === '') return email;
  return `${local.slice(0, 1)}***@${domain}`;
}
