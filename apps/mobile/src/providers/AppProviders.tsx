/**
 * The provider stack of M-GL-01, outer to inner: `GestureHandlerRootView` → `SafeAreaProvider` →
 * `KeyboardProvider` → `DaUiProvider` (theme from `user_preferences.theme` or the OS, reduce
 * motion, haptics through expo-haptics, locale, toast offset) → `I18nProvider` (bootstrap locale →
 * device → `tr`, user time zone) → `QueryProvider` (persisted cache) → `AuthProvider` (Supabase
 * session), plus the `SheetHost` and `ToastHost` overlays.
 *
 * Before anything renders, `bootApp()` runs the first-run keychain purge, opens the encrypted
 * stores, loads the UI preferences and wires NetInfo; the native splash stays up meanwhile.
 */
import { DaUiProvider, ErrorState, type HapticKind } from '@da/ui';
import * as Haptics from 'expo-haptics';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { I18nProvider } from '../i18n/I18nProvider';
import { prepareSecureStorage } from '../lib/auth/first-run-purge';
import { getSupabase } from '../lib/auth/supabase';
import { flushPendingLinks } from '../lib/deeplinks';
import { bindFocusManager, bindOnlineManager } from '../lib/query/online-manager';
import { isEncryptedStorageOpen } from '../lib/storage';
import { loadUiPrefs, updateUiPrefs, useUiPrefs } from '../lib/ui-prefs';
import { AuthProvider } from './AuthProvider';
import { QueryProvider } from './QueryProvider';
import { SheetHost } from './SheetHost';
import { ToastHost, useToastBottomOffset } from './ToastHost';

/** Maps the kit's haptic kinds to expo-haptics; failures are ignored (no haptics hardware). */
export function playHaptic(kind: HapticKind): void {
  const run = (): Promise<void> => {
    switch (kind) {
      case 'success':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      case 'warning':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      case 'selection':
        return Haptics.selectionAsync();
      case 'light':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };
  void run().catch(() => undefined);
}

let booted = false;

/** First-run purge, encrypted storage, UI preferences, connectivity (idempotent). */
export async function bootApp(): Promise<void> {
  if (booted && isEncryptedStorageOpen()) return;
  await prepareSecureStorage({
    signOutLocal: () => getSupabase().auth.signOut({ scope: 'local' }),
  });
  loadUiPrefs();
  flushPendingLinks();
  bindOnlineManager();
  booted = true;
}

/** Theme, motion, haptics and language from the preference store. */
export function UiShell({ children }: { readonly children: ReactNode }) {
  const prefs = useUiPrefs();
  const toastBottomOffset = useToastBottomOffset();
  return (
    <DaUiProvider
      themePreference={prefs.theme}
      onThemePreferenceChange={(theme) => updateUiPrefs({ theme })}
      reduceMotion={prefs.reduceMotion}
      hapticsEnabled={prefs.hapticsEnabled}
      onHaptic={playHaptic}
      {...(prefs.locale === null ? {} : { locale: prefs.locale })}
      {...(toastBottomOffset === undefined ? {} : { toastBottomOffset })}
    >
      <I18nProvider
        {...(prefs.locale === null ? {} : { locale: prefs.locale })}
        {...(prefs.timeZone === null ? {} : { timeZone: prefs.timeZone })}
      >
        {children}
      </I18nProvider>
    </DaUiProvider>
  );
}

function BootFailed({ onRetry }: { readonly onRetry: () => void }) {
  const t = useTranslations('states.error.fullScreen');
  const actions = useTranslations('common.actions');
  return (
    <ErrorState
      title={t('title')}
      body={t('body')}
      retryAction={{ label: actions('retry'), onPress: onRetry }}
      testID="boot-failed"
    />
  );
}

export interface AppProvidersProps {
  readonly children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  const [state, setState] = useState<'booting' | 'ready' | 'failed'>(() =>
    booted && isEncryptedStorageOpen() ? 'ready' : 'booting',
  );

  useEffect(() => {
    if (state !== 'booting') return;
    let active = true;
    bootApp().then(
      () => {
        if (active) setState('ready');
      },
      () => {
        if (active) setState('failed');
      },
    );
    return () => {
      active = false;
    };
  }, [state]);

  useEffect(() => bindFocusManager(), []);
  useEffect(() => {
    // The root navigator hides the splash once the session is known; a failed boot never gets there.
    if (state === 'failed') void SplashScreen.hideAsync();
  }, [state]);

  if (state === 'booting') return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <UiShell>
            {state === 'failed' ? (
              <BootFailed
                onRetry={() => {
                  setState('booting');
                }}
              />
            ) : (
              <QueryProvider>
                <AuthProvider>
                  {children}
                  <SheetHost />
                  <ToastHost />
                </AuthProvider>
              </QueryProvider>
            )}
          </UiShell>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
