/**
 * M-SET-30 "Gizlilik ve Güvenlik" (`/settings/privacy`): the promise card (M§40 statements +
 * no-training), the connected accounts with their granted capabilities, and the VERİ hub —
 * permissions, AI-accessible data, retention, personalization, export, delete history, delete
 * account — each row showing its live value. The footer states exactly what the architecture
 * does (R-15: encrypted in transit and at rest; never an end-to-end claim).
 */
import { useBootstrap } from '@da/api-client/react';
import type { Capability } from '@da/domain';
import { Button, InkCallout, ListRow, Text } from '@da/ui';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { useAccounts, type AccountRow } from '../integrations/accounts';
import { groupOf } from '../integrations/providers';
import { providerNameKey } from '../integrations/status';
import { openWebPage } from '../settings/links';
import { SettingsGroup, SettingsPage } from '../settings/ui';
import { useLatestExport } from './data';

const AI_CLASSES = ['mail_body', 'attachments', 'calendar', 'contacts'] as const;

export function useAccountTitle() {
  const t = useTranslations();
  return (account: AccountRow) => {
    const service = t(`common.providers.${providerNameKey(account.provider, groupOf(account)[0])}`);
    return account.account_email === null
      ? service
      : t('settings.accounts.rowTitle', { service, email: account.account_email });
  };
}

export function useScopeLabels() {
  const t = useTranslations();
  return (capabilities: readonly Capability[]) =>
    capabilities.map((capability) => t(`privacy.permissions.scopes.${capability}`));
}

export function PrivacyCenterScreen() {
  const t = useTranslations();
  const router = useRouter();
  const bootstrap = useBootstrap();
  const accounts = useAccounts();
  const latestExport = useLatestExport();
  const accountTitle = useAccountTitle();
  const scopeLabels = useScopeLabels();
  const prefs = bootstrap.data?.preferences;
  const list = accounts.data?.accounts ?? [];

  useEffect(() => {
    track('privacy_center_opened');
  }, []);

  const exportValue = (() => {
    const row = latestExport.data;
    if (row === null || row === undefined) return undefined;
    if (row.status === 'ready') return t('privacy.center.exportReady');
    if (row.status === 'requested' || row.status === 'processing') {
      return t('privacy.center.exportPreparing');
    }
    return undefined;
  })();

  return (
    <SettingsPage
      title={t('privacy.center.title')}
      subtitle={t('privacy.center.subtitle')}
      refreshing={accounts.isRefetching}
      onRefresh={() => {
        void accounts.refetch();
        void latestExport.refetch();
        void bootstrap.refetch();
      }}
      testID="screen.privacy"
    >
      <InkCallout
        variant="promise"
        title={t('privacy.center.promiseTitle')}
        rows={[
          t('privacy.promises.ads'),
          t('privacy.promises.approval'),
          t('privacy.promises.training'),
          t('privacy.promises.deletable'),
        ]}
        testID="privacy.promises"
      />

      <SettingsGroup
        title={t('privacy.center.connectedAccounts', { count: list.length })}
        testID="privacy.accounts"
      >
        {list.length === 0 ? (
          <ListRow
            icon="link"
            title={t('privacy.center.noAccount')}
            trailing={{ kind: 'chevron' }}
            onPress={() => {
              router.push('/settings/accounts');
            }}
            testID="privacy.connect"
          />
        ) : (
          list.map((account) => (
            <ListRow
              key={account.id}
              title={accountTitle(account)}
              subtitle={scopeLabels(account.capabilities_granted).join(' · ')}
              trailing={{ kind: 'link', text: t('common.actions.manage') }}
              onPress={() => {
                router.push(`/settings/accounts/${account.id}`);
              }}
              testID={`privacy.account.${account.id}`}
            />
          ))
        )}
      </SettingsGroup>

      <SettingsGroup title={t('privacy.center.dataSection')}>
        <ListRow
          icon="lock_open"
          title={t('privacy.center.permissions')}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            router.push('/settings/privacy/permissions');
          }}
          testID="privacy.row.permissions"
        />
        <ListRow
          icon="visibility"
          title={t('privacy.center.aiData')}
          trailing={
            prefs === undefined
              ? { kind: 'chevron' }
              : {
                  kind: 'value',
                  text: t('privacy.center.aiDataMeta', {
                    count: AI_CLASSES.filter((c) => prefs.ai_data_access[c]).length,
                  }),
                  chevron: true,
                }
          }
          onPress={() => {
            router.push('/settings/privacy/data-sources');
          }}
          testID="privacy.row.aiData"
        />
        <ListRow
          icon="history"
          title={t('privacy.center.retention')}
          trailing={
            prefs === undefined
              ? { kind: 'chevron' }
              : {
                  kind: 'value',
                  text: t(`privacy.retention.options.${prefs.retention_policy}`),
                  chevron: true,
                }
          }
          onPress={() => {
            router.push('/settings/privacy/retention');
          }}
          testID="privacy.row.retention"
        />
        <ListRow
          icon="psychology"
          title={t('privacy.center.personalization')}
          trailing={
            prefs === undefined
              ? { kind: 'chevron' }
              : {
                  kind: 'value',
                  text: prefs.learn_from_interactions
                    ? t('privacy.center.on')
                    : t('privacy.center.off'),
                  chevron: true,
                }
          }
          onPress={() => {
            router.push('/settings/personalization');
          }}
          testID="privacy.row.personalization"
        />
        <ListRow
          icon="download"
          title={t('privacy.center.export')}
          trailing={
            exportValue === undefined
              ? { kind: 'chevron' }
              : { kind: 'value', text: exportValue, chevron: true }
          }
          onPress={() => {
            router.push('/settings/privacy/export');
          }}
          testID="privacy.row.export"
        />
        <ListRow
          icon="delete_sweep"
          title={t('privacy.center.deleteHistory')}
          destructive
          accessibilityLabel={t('settings.hub.dangerA11y', {
            title: t('privacy.center.deleteHistory'),
          })}
          onPress={() => {
            router.push('/settings/privacy/history');
          }}
          testID="privacy.row.history"
        />
        <ListRow
          icon="person_remove"
          title={t('privacy.center.deleteAccount')}
          destructive
          accessibilityLabel={t('settings.hub.dangerA11y', {
            title: t('privacy.center.deleteAccount'),
          })}
          onPress={() => {
            router.push('/settings/privacy/delete-account');
          }}
          testID="privacy.row.deleteAccount"
        />
      </SettingsGroup>

      <View style={styles.footer} testID="privacy.footer">
        <Text variant="secondary" tone="tertiaryStrong">
          {t('privacy.promises.encrypted')}
        </Text>
        <Button
          label={t('privacy.center.policyLink')}
          variant="text"
          size="sm"
          onPress={() => {
            void openWebPage('/privacy');
          }}
          testID="privacy.policy"
        />
      </View>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  footer: { gap: 4, marginTop: 8 },
});
