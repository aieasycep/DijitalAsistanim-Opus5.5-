/**
 * M-SET-31 "İzinler" (`/settings/privacy/permissions`): the capabilities each connected account
 * granted (read from `connected_accounts`, never hard-coded) and the real OS permission states,
 * re-read on focus and when the app returns from the system settings. An undetermined permission
 * gets an in-context explanation before the system prompt; a denied one opens the system settings.
 * No Photos, Contacts or Location rows: the app never asks for them.
 */
import {
  BottomSheet,
  Button,
  ListRow,
  SkeletonBlock,
  StatusPill,
  Text,
  type StatusTone,
} from '@da/ui';
import * as Notifications from 'expo-notifications';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { isNiSupported, niCall } from '../android-ni/native';
import { useAccounts } from '../integrations/accounts';
import { SettingsGroup, SettingsPage } from '../settings/ui';
import { useAccountTitle, useScopeLabels } from './PrivacyCenterScreen';

export type OsPermissionKey = 'notifications' | 'calendar' | 'microphone' | 'speech' | 'camera';
export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'limited' | 'unknown';

interface Probe {
  readonly state: PermissionState;
  readonly canAskAgain: boolean;
}

interface PermissionResponseLike {
  readonly status: string;
  readonly granted?: boolean;
  readonly canAskAgain?: boolean;
  readonly accessPrivileges?: string;
}

function toProbe(response: PermissionResponseLike): Probe {
  const canAskAgain = response.canAskAgain !== false;
  if (response.accessPrivileges === 'limited') return { state: 'limited', canAskAgain };
  if (response.status === 'granted' || response.granted === true) {
    return { state: 'granted', canAskAgain };
  }
  if (response.status === 'undetermined') return { state: 'undetermined', canAskAgain };
  return { state: 'denied', canAskAgain };
}

interface Api {
  readonly get: () => Promise<PermissionResponseLike>;
  readonly request: () => Promise<PermissionResponseLike>;
}

/** The permission modules, loaded lazily so a missing native module reads as "Bilinmiyor". */
async function apiFor(key: OsPermissionKey): Promise<Api> {
  switch (key) {
    case 'notifications':
      return {
        get: () => Notifications.getPermissionsAsync(),
        request: () => Notifications.requestPermissionsAsync(),
      };
    case 'calendar': {
      const Calendar = await import('expo-calendar/legacy');
      return {
        get: () => Calendar.getCalendarPermissionsAsync(),
        request: () => Calendar.requestCalendarPermissionsAsync(),
      };
    }
    case 'microphone': {
      const Audio = await import('expo-audio');
      return {
        get: () => Audio.getRecordingPermissionsAsync(),
        request: () => Audio.requestRecordingPermissionsAsync(),
      };
    }
    case 'speech': {
      const { ExpoSpeechRecognitionModule } = await import('expo-speech-recognition');
      return {
        get: () => ExpoSpeechRecognitionModule.getPermissionsAsync(),
        request: () => ExpoSpeechRecognitionModule.requestPermissionsAsync(),
      };
    }
    case 'camera': {
      const ImagePicker = await import('expo-image-picker');
      return {
        get: () => ImagePicker.getCameraPermissionsAsync(),
        request: () => ImagePicker.requestCameraPermissionsAsync(),
      };
    }
  }
}

export async function probePermission(key: OsPermissionKey): Promise<Probe> {
  try {
    return toProbe(await (await apiFor(key)).get());
  } catch {
    return { state: 'unknown', canAskAgain: false };
  }
}

export async function requestPermission(key: OsPermissionKey): Promise<Probe> {
  try {
    return toProbe(await (await apiFor(key)).request());
  } catch {
    return { state: 'unknown', canAskAgain: false };
  }
}

const TONE: Readonly<Record<PermissionState, StatusTone>> = {
  granted: 'success',
  denied: 'warning',
  undetermined: 'neutral',
  limited: 'neutral',
  unknown: 'neutral',
};

const I18N_KEY: Readonly<
  Record<OsPermissionKey, 'notifications' | 'calendar' | 'microphone' | 'speech' | 'camera'>
> = {
  notifications: 'notifications',
  calendar: 'calendar',
  microphone: 'microphone',
  speech: 'speech',
  camera: 'camera',
};

export function PermissionsScreen() {
  const t = useTranslations();
  const router = useRouter();
  const accounts = useAccounts();
  const accountTitle = useAccountTitle();
  const scopeLabels = useScopeLabels();
  const list = accounts.data?.accounts ?? [];
  const hasDeviceCalendar = list.some(
    (a) => a.provider === 'apple_device' || a.provider === 'android_device',
  );
  const keys: readonly OsPermissionKey[] = [
    'notifications',
    ...(hasDeviceCalendar ? (['calendar'] as const) : []),
    'microphone',
    ...(Platform.OS === 'ios' ? (['speech'] as const) : []),
    'camera',
  ];
  const [states, setStates] = useState<Partial<Record<OsPermissionKey, Probe>>>({});
  const [explain, setExplain] = useState<OsPermissionKey | null>(null);
  // Android: the notification-listener grant (T-8.26), read from the NI module.
  const [niGranted, setNiGranted] = useState<boolean | null>(null);

  const refresh = useCallback(() => {
    let alive = true;
    setNiGranted(isNiSupported() ? niCall(false, (ni) => ni.isGranted()) : null);
    const all: OsPermissionKey[] = ['notifications', 'calendar', 'microphone', 'speech', 'camera'];
    void Promise.all(all.map(async (key) => [key, await probePermission(key)] as const)).then(
      (entries) => {
        if (alive) setStates(Object.fromEntries(entries));
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  useFocusEffect(refresh);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      sub.remove();
    };
  }, [refresh]);

  const analyticsState = (state: PermissionState) => (state === 'unknown' ? 'undetermined' : state);

  const onRow = (key: OsPermissionKey) => {
    const probe = states[key];
    if (probe === undefined) return;
    track('permission_row_tapped', { permission: key, state: analyticsState(probe.state) });
    if (probe.state === 'undetermined') setExplain(key);
    else void Linking.openSettings();
  };

  const request = (key: OsPermissionKey) => {
    setExplain(null);
    void requestPermission(key).then((probe) => {
      track('permission_requested', {
        permission: key,
        result:
          probe.state === 'granted' || probe.state === 'limited'
            ? probe.state
            : probe.canAskAgain
              ? 'denied'
              : 'blocked',
      });
      setStates((current) => ({ ...current, [key]: probe }));
    });
  };

  return (
    <SettingsPage
      title={t('privacy.permissions.title')}
      testID="screen.privacy.permissions"
      footer={
        <Button
          label={t('common.actions.openSystemSettings')}
          variant="tonal"
          fullWidth
          onPress={() => {
            void Linking.openSettings();
          }}
          testID="permissions.systemSettings"
        />
      }
    >
      <SettingsGroup title={t('privacy.permissions.accountSection')} testID="permissions.accounts">
        {list.length === 0 ? (
          <ListRow
            title={t('privacy.permissionsScreen.noAccount')}
            trailing={{ kind: 'link', text: t('privacy.center.noAccount') }}
            onPress={() => {
              router.push('/settings/accounts');
            }}
            testID="permissions.connect"
          />
        ) : (
          list.map((account) => (
            <ListRow
              key={account.id}
              title={accountTitle(account)}
              subtitle={scopeLabels(account.capabilities_granted).join('\n')}
              trailing={{ kind: 'link', text: t('common.actions.manage') }}
              onPress={() => {
                router.push(`/settings/accounts/${account.id}`);
              }}
              testID={`permissions.account.${account.id}`}
            />
          ))
        )}
      </SettingsGroup>

      <SettingsGroup title={t('privacy.permissions.phoneSection')} testID="permissions.os">
        {keys.map((key) => {
          const probe = states[key];
          const title = t(`privacy.permissions.os.${I18N_KEY[key]}.title`);
          const statusLabel =
            probe === undefined
              ? ''
              : probe.state === 'unknown'
                ? t('privacy.permissionsScreen.unknown')
                : t(`privacy.permissions.status.${probe.state}`);
          return (
            <ListRow
              key={key}
              title={title}
              subtitle={t(`privacy.permissions.os.${I18N_KEY[key]}.meta`)}
              trailing={{
                kind: 'custom',
                node:
                  probe === undefined ? (
                    <SkeletonBlock width={72} height={20} radius={10} />
                  ) : (
                    <StatusPill label={statusLabel} tone={TONE[probe.state]} />
                  ),
              }}
              accessibilityLabel={`${title}, ${statusLabel}`}
              onPress={() => {
                onRow(key);
              }}
              testID={`permissions.os.${key}`}
            />
          );
        })}
        {niGranted === null ? null : (
          <ListRow
            title={t('privacy.permissions.os.notificationAccess.title')}
            subtitle={t('privacy.permissions.os.notificationAccess.meta')}
            trailing={{
              kind: 'custom',
              node: (
                <StatusPill
                  label={niGranted ? t('android_ni.status.on') : t('android_ni.status.off')}
                  tone={niGranted ? 'success' : 'neutral'}
                />
              ),
            }}
            accessibilityLabel={`${t('privacy.permissions.os.notificationAccess.title')}, ${
              niGranted ? t('android_ni.status.on') : t('android_ni.status.off')
            }`}
            onPress={() => {
              router.push('/settings/android-notifications');
            }}
            testID="permissions.os.notificationAccess"
          />
        )}
      </SettingsGroup>

      <BottomSheet
        visible={explain !== null}
        onDismiss={() => {
          setExplain(null);
        }}
        title={
          explain === null
            ? ''
            : t('privacy.permissions.whyTitle', {
                permission: t(`privacy.permissions.os.${I18N_KEY[explain]}.title`),
              })
        }
        testID="sheet.permissionWhy"
        footer={
          <View style={styles.buttons}>
            <Button
              label={t('common.actions.allow')}
              variant="ink"
              fullWidth
              onPress={() => {
                if (explain !== null) request(explain);
              }}
              testID="permissionWhy.allow"
            />
            <Button
              label={t('common.actions.notNow')}
              variant="text"
              fullWidth
              onPress={() => {
                setExplain(null);
              }}
            />
          </View>
        }
      >
        {explain === null ? null : (
          <Text variant="body" tone="secondary">
            {t(`privacy.permissions.os.${I18N_KEY[explain]}.meta`)}
          </Text>
        )}
      </BottomSheet>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  buttons: { gap: 8 },
});
