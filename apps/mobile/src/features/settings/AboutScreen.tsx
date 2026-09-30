/**
 * M-SET-73 "Hakkında" (`/settings/about`) and M-SET-74 open-source licenses (sheet): version and
 * build from `expo-application`, the truthful privacy summary (R-15, no-training), the legal pages
 * on the web (blocked offline), the store listing and review, support and the security address;
 * a demo-build notice when bootstrap reports `demo_mode`. The license list is the bundled
 * `assets/licenses.json` (generated from the production dependency graph).
 */
import { useBootstrap } from '@da/api-client/react';
import { BottomSheet, Button, ListRow, SearchField, Text } from '@da/ui';
import * as StoreReview from 'expo-store-review';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Linking, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { appVersion, buildNumber } from '../../lib/device';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { SECURITY_EMAIL, openMail, openWebPage, requestStoreReview } from './links';
import { Caption, SettingsGroup, SettingsPage } from './ui';

export interface LicenseEntry {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly repository?: string;
  readonly kind: 'package' | 'font' | 'icons';
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LICENSES = require('../../../assets/licenses.json') as readonly LicenseEntry[];

export function licenses(): readonly LicenseEntry[] {
  return LICENSES;
}

export function LicensesSheet({
  visible,
  onDismiss,
}: {
  readonly visible: boolean;
  readonly onDismiss: () => void;
}) {
  const t = useTranslations();
  const online = useOnline();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<LicenseEntry | null>(null);
  useEffect(() => {
    if (visible) track('licenses_viewed');
  }, [visible]);
  const needle = query.trim().toLowerCase();
  const packages = LICENSES.filter(
    (entry) =>
      entry.kind === 'package' && (needle === '' || entry.name.toLowerCase().includes(needle)),
  );
  const fonts = LICENSES.filter((entry) => entry.kind !== 'package');
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={t('settings.licenses.title')}
      subtitle={t('settings.licenses.subtitle')}
      testID="sheet.licenses"
      footer={
        <Button label={t('common.actions.close')} variant="text" fullWidth onPress={onDismiss} />
      }
    >
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder={t('settings.licenses.searchHint')}
        accessibilityLabel={t('settings.licenses.searchHint')}
        testID="licenses.search"
      />
      {needle === '' ? (
        <SettingsGroup title={t('settings.licenses.fontsSection')}>
          {fonts.map((entry) => (
            <ListRow key={entry.name} title={`${entry.name} · ${entry.license}`} />
          ))}
        </SettingsGroup>
      ) : null}
      <Text variant="kicker" tone="secondary">
        {t('settings.licenses.packagesSection')}
      </Text>
      {packages.length === 0 ? (
        <Text variant="body" tone="secondary" testID="licenses.empty">
          {t('settings.licenses.empty')}
        </Text>
      ) : (
        <FlatList
          data={packages}
          style={styles.list}
          keyExtractor={(entry) => entry.name}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <ListRow
              title={`${item.name} · ${item.version}`}
              subtitle={item.license}
              onPress={() => {
                setSelected(item);
              }}
              testID={`licenses.row.${item.name}`}
            />
          )}
        />
      )}
      {selected === null ? null : (
        <View style={styles.detail} testID="licenses.detail">
          <Text variant="rowTitle">{[selected.name, selected.version].join(' ')}</Text>
          <Text variant="mono" selectable>
            {t('settings.licensesScreen.licensed', { license: selected.license })}
          </Text>
          {selected.repository === undefined ? null : (
            <Button
              label={t('settings.licenses.openSource')}
              variant="text"
              size="sm"
              disabled={!online}
              onPress={() => {
                const url = selected.repository;
                if (url !== undefined) void Linking.openURL(url);
              }}
              testID="licenses.openSource"
            />
          )}
        </View>
      )}
    </BottomSheet>
  );
}

export function AboutScreen() {
  const t = useTranslations();
  const router = useRouter();
  const bootstrap = useBootstrap();
  const [licensesOpen, setLicensesOpen] = useState(false);
  const storeUrl = StoreReview.storeUrl();

  useEffect(() => {
    track('about_opened');
  }, []);

  const web = (link: 'terms' | 'privacy' | 'website', path: `/${string}`) => {
    track('about_link_opened', { link });
    void openWebPage(path);
  };

  return (
    <SettingsPage title={t('settings.about.title')} testID="screen.settings.about">
      <View style={styles.header}>
        <Text variant="titleLg" heading>
          {t('common.app.name')}
        </Text>
        <Text
          variant="secondary"
          tone="tertiaryStrong"
          accessibilityLabel={t('settings.about.versionA11y', {
            version: appVersion(),
            build: buildNumber(),
          })}
          testID="about.version"
        >
          {t('settings.aboutScreen.version', { version: appVersion(), build: buildNumber() })}
        </Text>
        <Text variant="body" tone="secondary" align="center">
          {t('settings.aboutScreen.tagline')}
        </Text>
      </View>

      <SettingsGroup title={t('settings.about.privacySummary')}>
        <ListRow title={t('privacy.storage.canonical')} />
        <ListRow title={t('privacy.promises.trainingLong')} />
        <ListRow
          title={t('settings.about.privacyCenter')}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            router.push('/settings/privacy');
          }}
          testID="about.privacyCenter"
        />
      </SettingsGroup>

      <SettingsGroup title={t('settings.about.legal')}>
        <ListRow
          title={t('settings.about.terms')}
          trailing={{ kind: 'chevron' }}
          accessibilityHint={t('common.a11y.opensInBrowser')}
          onPress={() => {
            web('terms', '/terms');
          }}
          testID="about.terms"
        />
        <ListRow
          title={t('settings.about.privacyPolicy')}
          trailing={{ kind: 'chevron' }}
          accessibilityHint={t('common.a11y.opensInBrowser')}
          onPress={() => {
            web('privacy', '/privacy');
          }}
          testID="about.privacy"
        />
        <ListRow
          title={t('settings.about.dataDeletion')}
          subtitle={t('settings.about.dataDeletionMeta')}
          trailing={{ kind: 'chevron' }}
          accessibilityHint={t('common.a11y.opensInBrowser')}
          onPress={() => {
            web('website', '/data-deletion');
          }}
          testID="about.dataDeletion"
        />
        <ListRow
          title={t('settings.about.licenses')}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            track('about_link_opened', { link: 'licenses' });
            setLicensesOpen(true);
          }}
          testID="about.licenses"
        />
      </SettingsGroup>

      <SettingsGroup title={t('settings.hub.groups.app')}>
        {storeUrl === null ? null : (
          <ListRow
            title={t('settings.about.releaseNotes')}
            trailing={{ kind: 'chevron' }}
            onPress={() => {
              track('about_link_opened', { link: 'release_notes' });
              void Linking.openURL(storeUrl);
            }}
            testID="about.releaseNotes"
          />
        )}
        <ListRow
          title={t('settings.about.rate')}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            track('about_link_opened', { link: 'store' });
            void requestStoreReview();
          }}
          testID="about.rate"
        />
        <ListRow
          title={t('settings.about.support')}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            track('about_link_opened', { link: 'support' });
            router.push('/settings/help');
          }}
          testID="about.support"
        />
        <ListRow
          title={t('settings.about.securityReport')}
          subtitle={SECURITY_EMAIL}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            void openMail(SECURITY_EMAIL);
          }}
          testID="about.security"
        />
      </SettingsGroup>

      {bootstrap.data?.demo_mode === true ? (
        <ListRow icon="info" title={t('settings.aboutScreen.demo')} testID="about.demo" />
      ) : null}
      <Caption testID="about.copyright">
        {t('settings.aboutScreen.copyright', { year: now().getFullYear() })}
      </Caption>
      {licensesOpen ? (
        <LicensesSheet
          visible
          onDismiss={() => {
            setLicensesOpen(false);
          }}
        />
      ) : null}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: 6, paddingVertical: 12 },
  list: { maxHeight: 360 },
  detail: { gap: 6, paddingTop: 8 },
});
