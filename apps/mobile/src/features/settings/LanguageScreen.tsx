/**
 * M-SET-62 "Dil" (`/settings/language`): Türkçe / English switches the UI at once (MMKV), then
 * writes `profiles.locale` (the AI output language; kept locally and retried on failure) and
 * re-registers the installation (push template language) and the Android channel names. The
 * region rows are information only; the time-zone row opens the briefing settings.
 */
import { useBootstrap } from '@da/api-client/react';
import type { Locale } from '@da/i18n';
import { ListRow } from '@da/ui';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useFormatter, useTranslations } from 'use-intl';

import { installationId } from '../../lib/auth/first-run-purge';
import { getApiClient } from '../../lib/bootstrap';
import { now } from '../../lib/clock';
import { deviceRegisterBody } from '../../lib/device';
import { track } from '../../lib/events';
import { updateUiPrefs, useUiPrefs } from '../../lib/ui-prefs';
import { deviceLocale } from '../../i18n/I18nProvider';
import { ensureAndroidChannels } from '../onboarding/push';
import { refreshWidgetSnapshot } from '../widgets/snapshot';
import { saveOwnRow } from './save';
import { zoneLabel } from './timezones';
import { Caption, SettingsGroup, SettingsPage } from './ui';

const LOCALES: readonly Locale[] = ['tr', 'en'];

export async function changeLanguage(locale: Locale): Promise<void> {
  track('locale_changed', { locale });
  updateUiPrefs({ locale });
  const tag = locale === 'en' ? 'en-US' : 'tr-TR';
  const saved = await saveOwnRow(
    'profiles',
    { locale: tag },
    (data) => ({ ...data, locale: tag }),
    {
      silent: true,
      onFailure: 'keep',
    },
  );
  // The widget text is rendered server-side in the profile locale (T-8.25, M-SET-62).
  if (saved === 'saved') void refreshWidgetSnapshot('settings', { force: true });
  await ensureAndroidChannels();
  const install = installationId();
  if (install === null) return;
  try {
    await getApiClient().call(
      'POST /devices/register',
      { body: await deviceRegisterBody(install) },
      { idempotencyKey: Crypto.randomUUID() },
    );
  } catch {
    // The next foreground registration carries the new locale.
  }
}

export function LanguageScreen() {
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const prefs = useUiPrefs();
  const bootstrap = useBootstrap();
  const active: Locale = prefs.locale ?? deviceLocale();
  const sample = now();
  const zone = bootstrap.data?.preferences.timezone ?? prefs.timeZone;
  return (
    <SettingsPage title={t('settings.language.title')} testID="screen.settings.language">
      <SettingsGroup>
        {LOCALES.map((locale) => (
          <ListRow
            key={locale}
            title={
              locale === 'tr' ? t('settings.language.turkish') : t('settings.language.english')
            }
            trailing={{ kind: 'radio', selected: active === locale }}
            onPress={() => {
              if (active !== locale) void changeLanguage(locale);
            }}
            testID={`language.${locale}`}
          />
        ))}
      </SettingsGroup>
      <Caption>{t('settings.languageScreen.note')}</Caption>
      <SettingsGroup title={t('settings.languageScreen.region')}>
        <ListRow
          title={t('settings.languageScreen.dateFormat')}
          trailing={{
            kind: 'value',
            text: format.dateTime(sample, { day: '2-digit', month: '2-digit', year: 'numeric' }),
          }}
          testID="language.dateFormat"
        />
        <ListRow
          title={t('settings.languageScreen.timeFormat')}
          trailing={{
            kind: 'value',
            text: t('settings.languageScreen.hours24', {
              time: format.dateTime(sample, {
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
              }),
            }),
          }}
          testID="language.timeFormat"
        />
        {zone === null ? null : (
          <ListRow
            title={t('settings.briefings.timezone')}
            trailing={{ kind: 'value', text: zoneLabel(zone, sample), chevron: true }}
            onPress={() => {
              router.push('/settings/briefings');
            }}
            testID="language.timezone"
          />
        )}
      </SettingsGroup>
    </SettingsPage>
  );
}
