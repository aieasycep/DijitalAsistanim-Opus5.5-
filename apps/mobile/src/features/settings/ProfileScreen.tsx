/**
 * M-SET-03 "Profil" (`/settings/profile`): the display name (1–80 characters, saved on blur or
 * "Bitti", optimistic, queued offline), the read-only sign-in identity, and "Tüm cihazlardan çıkış
 * yap" (`logout({scope:'global'})`: device unregister, RevenueCat log-out, global sign-out, local
 * wipe; blocked offline).
 */
import { useBootstrap } from '@da/api-client/react';
import { BottomSheet, Button, ListRow, Text, TextField } from '@da/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';

import { logout } from '../../lib/auth/logout';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { saveOwnRow, usePendingSettings } from './save';
import { SettingsGroup, SettingsPage } from './ui';

export const NAME_MAX = 80;
const APPLE_RELAY = '@privaterelay.appleid.com';

/** Trimmed display name, or null when it is empty or too long. */
export function validName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > NAME_MAX ? null : trimmed;
}

type Provider = 'apple' | 'google' | 'azure' | 'email';

export function ProfileScreen() {
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const online = useOnline();
  const pending = usePendingSettings();
  const bootstrap = useBootstrap();
  const data = bootstrap.data;
  const saved = data?.profile.display_name ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const name = draft ?? saved;

  const commit = () => {
    if (draft === null) return;
    const next = validName(draft);
    if (next === null) {
      setError(t('settings.profile.nameEmpty'));
      return;
    }
    setError(undefined);
    setDraft(null);
    if (next === saved) return;
    track('profile_name_changed');
    void saveOwnRow('profiles', { display_name: next }, (d) => ({
      ...d,
      profile: { ...d.profile, display_name: next },
    }));
  };

  const email = data?.profile.email ?? null;
  const provider: Provider | undefined = data?.profile.auth_providers[0];
  const providerLabel = (p: Provider) => {
    switch (p) {
      case 'apple':
        return t('common.providers.apple');
      case 'google':
        return t('common.providers.google');
      case 'azure':
        return t('common.providers.microsoft');
      case 'email':
        return t('settings.profile.emailCode');
    }
  };

  return (
    <SettingsPage title={t('settings.profile.title')} testID="screen.settings.profile">
      <SettingsGroup title={t('settings.profile.accountSection')}>
        <View style={styles.field}>
          <TextField
            label={t('settings.profile.name')}
            placeholder={t('settings.profile.nameHint')}
            value={name}
            maxLength={NAME_MAX}
            autoComplete="name"
            textContentType="name"
            returnKeyType="done"
            onChangeText={(text) => {
              setDraft(text);
              if (error !== undefined) setError(undefined);
            }}
            onBlur={commit}
            onSubmitEditing={commit}
            {...(error === undefined ? {} : { error })}
            {...(pending ? { helper: t('states.offline.queued') } : {})}
            testID="profile.name"
          />
        </View>
        <ListRow
          title={t('settings.profile.email')}
          trailing={{
            kind: 'value',
            text:
              email === null
                ? '—'
                : email.endsWith(APPLE_RELAY)
                  ? t('settings.profile.appleRelay')
                  : email,
          }}
          testID="profile.email"
        />
        {provider === undefined ? null : (
          <ListRow
            title={t('settings.profile.signInMethod')}
            trailing={{
              kind: 'value',
              text: t('settings.profile.signInWith', { provider: providerLabel(provider) }),
            }}
            testID="profile.method"
          />
        )}
        {data === undefined ? null : (
          <ListRow
            title={t('settings.profile.memberSince')}
            trailing={{
              kind: 'value',
              text: format.dateTime(new Date(data.profile.created_at), {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }),
            }}
            testID="profile.memberSince"
          />
        )}
      </SettingsGroup>

      <SettingsGroup title={t('settings.profile.sessionSection')}>
        <ListRow
          title={t('settings.signOut.everywhere')}
          subtitle={t('settings.signOut.everywhereMeta')}
          destructive
          disabled={!online}
          {...(online ? {} : { disabledReason: t('states.offline.blockedReason') })}
          onPress={() => {
            setConfirmOpen(true);
          }}
          testID="profile.signOutAll"
        />
        <ListRow
          title={t('privacy.center.deleteAccount')}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            router.push('/settings/privacy/delete-account');
          }}
          testID="profile.deleteAccount"
        />
      </SettingsGroup>
      <Button
        label={t('settings.profile.timezoneNote')}
        variant="text"
        size="sm"
        onPress={() => {
          router.push('/settings/briefings');
        }}
        testID="profile.timezone"
      />

      <BottomSheet
        visible={confirmOpen}
        onDismiss={() => {
          setConfirmOpen(false);
        }}
        dismissible={!signingOut}
        variant="destructive"
        title={t('settings.signOut.everywhereConfirmTitle')}
        testID="sheet.signOutAll"
        footer={
          <View style={styles.buttons}>
            <Button
              label={t('common.actions.signOut')}
              variant="destructive"
              fullWidth
              loading={signingOut}
              onPress={() => {
                setSigningOut(true);
                void logout({ scope: 'global', context: 'settings' })
                  .then((report) => {
                    if (report.failedSteps.includes('sign_out')) {
                      showToast({ message: t('settings.signOut.globalFailed'), kind: 'error' });
                    }
                  })
                  .finally(() => {
                    setSigningOut(false);
                  });
              }}
              testID="signOutAll.confirm"
            />
            <Button
              label={t('common.actions.nevermind')}
              variant="text"
              fullWidth
              disabled={signingOut}
              onPress={() => {
                setConfirmOpen(false);
              }}
            />
          </View>
        }
      >
        <Text variant="body" tone="secondary">
          {t('settings.signOut.everywhereConfirmBody')}
        </Text>
      </BottomSheet>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  field: { paddingHorizontal: 16, paddingVertical: 12 },
  buttons: { gap: 8 },
});
