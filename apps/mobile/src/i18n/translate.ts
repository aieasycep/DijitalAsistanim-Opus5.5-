/**
 * Translator for code outside React (OAuth return handling, toasts raised by flows that outlive a
 * screen): the same catalogs, language and time zone as `I18nProvider`.
 */
import { loadMessages } from '@da/i18n';
import { createTranslator } from 'use-intl';

import { getUiPrefs } from '../lib/ui-prefs';
import { deviceLocale, deviceTimeZone } from './I18nProvider';

export function translator() {
  const prefs = getUiPrefs();
  const locale = prefs.locale ?? deviceLocale();
  return createTranslator({
    locale,
    messages: loadMessages(locale),
    timeZone: prefs.timeZone ?? deviceTimeZone(),
  });
}
