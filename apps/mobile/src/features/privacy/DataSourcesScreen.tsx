/**
 * M-SET-32 "AI neye erişiyor?" (`/settings/privacy/data-sources`) and M-SET-33 (consequence sheet):
 * the user-level data classes of `user_preferences.ai_data_access`, enforced server-side before any
 * model call. Turning a class off first states exactly what stops working; turning it on saves at
 * once (queued offline). The never-list is static text; per-account data-source controls live on
 * the account detail screen and are linked here.
 */
import { useBootstrap } from '@da/api-client/react';
import { BottomSheet, Button, ListRow, Text } from '@da/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { useAccounts } from '../integrations/accounts';
import { saveUserPreferences, usePendingSettings } from '../settings/save';
import { Caption, SettingsGroup, SettingsPage } from '../settings/ui';
import { useAccountTitle } from './PrivacyCenterScreen';

export type AiClass = 'mail_body' | 'attachments' | 'calendar' | 'contacts';
const CLASSES: readonly AiClass[] = ['mail_body', 'attachments', 'calendar', 'contacts'];
const TITLE_KEY = {
  mail_body: 'mailBody',
  attachments: 'attachments',
  calendar: 'calendar',
  contacts: 'contacts',
} as const;

export function DataSourcesScreen() {
  const t = useTranslations();
  const router = useRouter();
  const pending = usePendingSettings();
  const bootstrap = useBootstrap();
  const accounts = useAccounts();
  const accountTitle = useAccountTitle();
  const [confirm, setConfirm] = useState<AiClass | null>(null);
  const [saving, setSaving] = useState(false);
  const access = bootstrap.data?.preferences.ai_data_access;

  const save = (key: AiClass, enabled: boolean, confirmed: boolean) => {
    if (access === undefined) return Promise.resolve('failed' as const);
    track('ai_access_toggled', { class: key, enabled, confirmed });
    return saveUserPreferences({ ai_data_access: { ...access, [key]: enabled } });
  };

  return (
    <SettingsPage
      title={t('privacy.aiData.title')}
      subtitle={t('privacy.aiData.subtitle')}
      testID="screen.privacy.dataSources"
    >
      {pending ? <Caption>{t('states.offline.queued')}</Caption> : null}
      <SettingsGroup title={t('privacy.aiData.reads')} testID="dataSources.reads">
        {CLASSES.map((key) => {
          const enabled = access?.[key] ?? true;
          return (
            <ListRow
              key={key}
              title={t(`privacy.aiData.${TITLE_KEY[key]}.title`)}
              subtitle={t(`privacy.aiData.${TITLE_KEY[key]}.meta`)}
              trailing={{ kind: 'switch', value: enabled }}
              disabled={access === undefined}
              onPress={() => {
                if (enabled) setConfirm(key);
                else void save(key, true, true);
              }}
              testID={`dataSources.${key}`}
            />
          );
        })}
      </SettingsGroup>

      <SettingsGroup title={t('privacy.aiData.never')} testID="dataSources.never">
        <ListRow icon="block" title={t('privacy.aiData.neverPasswords')} />
        <ListRow icon="block" title={t('privacy.aiData.neverBank')} />
        <ListRow icon="block" title={t('privacy.aiData.neverMessaging')} />
        <ListRow icon="block" title={t('privacy.aiData.neverLocation')} />
      </SettingsGroup>
      <Caption>{t('privacy.aiData.footnote')}</Caption>

      {(accounts.data?.accounts ?? []).length === 0 ? null : (
        <SettingsGroup title={t('privacy.aiData.perAccount')}>
          {(accounts.data?.accounts ?? []).map((account) => (
            <ListRow
              key={account.id}
              title={accountTitle(account)}
              trailing={{ kind: 'chevron' }}
              onPress={() => {
                router.push(`/settings/accounts/${account.id}`);
              }}
              testID={`dataSources.account.${account.id}`}
            />
          ))}
        </SettingsGroup>
      )}

      <BottomSheet
        visible={confirm !== null}
        onDismiss={() => {
          if (confirm !== null)
            track('ai_access_toggled', { class: confirm, enabled: true, confirmed: false });
          setConfirm(null);
        }}
        dismissible={!saving}
        title={confirm === null ? '' : t(`privacy.sourceOff.${confirm}.title`)}
        testID="sheet.sourceOff"
        footer={
          <View style={styles.buttons}>
            <Button
              label={t('privacy.sourceOff.cta')}
              variant="ink"
              fullWidth
              loading={saving}
              onPress={() => {
                if (confirm === null) return;
                setSaving(true);
                void save(confirm, false, true).then((result) => {
                  setSaving(false);
                  if (result !== 'failed') setConfirm(null);
                });
              }}
              testID="sourceOff.confirm"
            />
            <Button
              label={t('common.actions.nevermind')}
              variant="text"
              fullWidth
              disabled={saving}
              onPress={() => {
                setConfirm(null);
              }}
              testID="sourceOff.cancel"
            />
          </View>
        }
      >
        {confirm === null ? null : (
          <Text variant="body" tone="secondary">
            {t(`privacy.sourceOff.${confirm}.body`)}
          </Text>
        )}
      </BottomSheet>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  buttons: { gap: 8 },
});
