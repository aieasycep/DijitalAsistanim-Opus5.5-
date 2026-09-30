/**
 * M-ON-05 Account / sign-in (`app/(auth)/sign-in.tsx?mode=signup|signin`, default signup).
 * App login is separate from integrations (M§88). Button order (D-04): iOS — native Apple button,
 * Google, Microsoft; Android — Google, Microsoft, Apple through the web flow (only when the project
 * enables the Apple provider); then "veya" and E-posta. A provider the environment has not
 * configured is a disabled "Harici kimlik bilgisi gerekli" row, never a failing button. While one
 * method runs, it shows a spinner and the others are disabled; cancellations are silent; failures
 * show the inline error card with "Tekrar Dene". Offline disables every method.
 */
import { AuthProviderButton, DetailHeader, ErrorCard, Text, useTheme, type Theme } from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState, type ReactNode } from 'react';
import { Image, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import brandTile from '../../../assets/splash.png';
import { signInWithAppleNative, signInWithAppleWeb } from '../../lib/auth/apple';
import type { AuthMode } from '../../lib/auth/email-otp';
import { isGoogleConfigured, signInWithGoogle } from '../../lib/auth/google';
import { signInWithMicrosoft } from '../../lib/auth/microsoft';
import {
  ASSUME_AVAILABLE,
  fetchProviderAvailability,
  type ProviderAvailability,
} from '../../lib/auth/providers';
import type { AuthFailureCode, AuthMethod, AuthResult } from '../../lib/auth/result';
import { webPage } from '../../lib/env';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { analyticsMode, completeSignIn } from './completeSignIn';
import { AppleMark, GoogleMark, MicrosoftMark } from './ProviderLogos';

export const PROVIDER_AVAILABILITY_KEY = ['auth', 'providers'] as const;

type Provider = 'apple' | 'google' | 'microsoft';

/** D-04 order per platform (email always follows the "veya" divider). */
export function providerOrder(os: string, availability: ProviderAvailability): Provider[] {
  if (os === 'ios') return ['apple', 'google', 'microsoft'];
  return availability.apple ? ['google', 'microsoft', 'apple'] : ['google', 'microsoft'];
}

function methodOf(provider: Provider): AuthMethod {
  return provider;
}

function NotConfiguredRow({ label, logo }: { readonly label: string; readonly logo: ReactNode }) {
  const theme = useTheme();
  const t = useTranslations('states.unavailable.credential');
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${t('rowMeta')}`}
      accessibilityState={{ disabled: true }}
      style={[styles.notConfigured, notConfiguredColors(theme)]}
      testID="auth.notConfigured"
    >
      {logo}
      <View style={styles.flex}>
        <Text variant="label" tone="disabled">
          {label}
        </Text>
        <Text variant="meta" tone="tertiaryStrong">
          {t('rowMeta')}
        </Text>
      </View>
    </View>
  );
}

function notConfiguredColors(theme: Theme) {
  return { backgroundColor: theme.color.surfaceSunken, borderRadius: theme.radius.list };
}

export function SignInScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode: AuthMode = params.mode === 'signin' ? 'signin' : 'signup';
  const t = useTranslations('auth');
  const actions = useTranslations('common.actions');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const [busy, setBusy] = useState<AuthMethod | null>(null);
  const [failure, setFailure] = useState<{
    readonly method: AuthMethod;
    readonly code: AuthFailureCode;
    readonly retry: () => void;
  } | null>(null);

  const providers = useQuery({
    queryKey: PROVIDER_AVAILABILITY_KEY,
    queryFn: () => fetchProviderAvailability(),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const availability: ProviderAvailability = providers.data ?? {
    ...ASSUME_AVAILABLE,
    google: isGoogleConfigured(),
  };

  useEffect(() => {
    track('auth_screen_viewed', { mode: analyticsMode(mode) });
  }, [mode]);

  const run = async (method: AuthMethod, action: () => Promise<AuthResult>) => {
    track('auth_method_selected', { method, mode: analyticsMode(mode) });
    setFailure(null);
    setBusy(method);
    const result = await action();
    if (!result.ok) {
      setBusy(null);
      track('auth_failed', { method, code: result.code });
      if (result.code !== 'cancelled') {
        setFailure({
          method,
          code: result.code,
          retry: () => {
            void run(method, action);
          },
        });
      }
      return;
    }
    await completeSignIn(result, method, mode);
    setBusy(null);
  };

  const disabled = busy !== null || !online;
  const signInActions: Record<Provider, () => Promise<AuthResult>> = {
    apple:
      Platform.OS === 'ios'
        ? () => signInWithAppleNative()
        : () => signInWithAppleWeb({ intent: { method: 'apple', mode } }),
    google: () => signInWithGoogle(),
    microsoft: () => signInWithMicrosoft({ intent: { method: 'microsoft', mode } }),
  };
  const logos: Record<Provider, ReactNode> = {
    apple: <AppleMark />,
    google: <GoogleMark />,
    microsoft: <MicrosoftMark />,
  };

  const renderProvider = (provider: Provider) => {
    const label = t(`providers.${provider}`);
    if (!availability[provider]) {
      return <NotConfiguredRow key={provider} label={label} logo={logos[provider]} />;
    }
    const onPress = () => {
      void run(methodOf(provider), signInActions[provider]);
    };
    if (provider === 'apple' && Platform.OS === 'ios') {
      return (
        <View
          key={provider}
          pointerEvents={disabled ? 'none' : 'auto'}
          style={disabled && busy !== 'apple' ? styles.dimmed : undefined}
          testID="auth.provider.apple"
        >
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={
              theme.isDark
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={16}
            style={styles.appleButton}
            onPress={onPress}
          />
        </View>
      );
    }
    return (
      <AuthProviderButton
        key={provider}
        kind="brand"
        label={label}
        logo={logos[provider]}
        loading={busy === provider}
        disabled={disabled && busy !== provider}
        onPress={onPress}
        testID={`auth.provider.${provider}`}
      />
    );
  };

  const failureBody =
    failure?.code === 'play_services'
      ? t('errors.playServices')
      : failure?.code === 'not_configured'
        ? undefined
        : t('errors.failedBody');

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: busy === null }} />
      <ScrollView
        style={{ backgroundColor: theme.color.bg }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        testID="auth.signIn"
      >
        {router.canGoBack() ? (
          <DetailHeader
            onLeadingPress={() => {
              router.back();
            }}
          />
        ) : (
          <View style={{ height: insets.top + theme.layout.contentTopRoot }} />
        )}
        <View style={[styles.body, { paddingHorizontal: theme.layout.onboardingX }]}>
          <Image
            source={brandTile}
            style={styles.tile}
            accessible={false}
            accessibilityIgnoresInvertColors
          />
          <Text variant="display" heading>
            {t(mode === 'signin' ? 'signIn.title' : 'signUp.title')}
          </Text>
          <Text variant="body" tone="secondary">
            {t(mode === 'signin' ? 'signIn.body' : 'signUp.body')}
          </Text>
          <View style={styles.buttons}>
            {providerOrder(Platform.OS, availability).map(renderProvider)}
            <View style={styles.divider} accessibilityRole="none">
              <View style={[styles.rule, { backgroundColor: theme.color.border.hairline }]} />
              <Text variant="meta" tone="tertiaryStrong">
                {t('providers.or')}
              </Text>
              <View style={[styles.rule, { backgroundColor: theme.color.border.hairline }]} />
            </View>
            {availability.email ? (
              <AuthProviderButton
                kind="email"
                label={t('providers.email')}
                disabled={disabled}
                onPress={() => {
                  track('auth_method_selected', { method: 'email_otp', mode: analyticsMode(mode) });
                  router.push(`/email-otp?step=email&mode=${mode}`);
                }}
                testID="auth.provider.email"
              />
            ) : (
              <NotConfiguredRow label={t('providers.email')} logo={null} />
            )}
          </View>
          {!online ? (
            <Text variant="secondary" tone="secondary" testID="auth.offline">
              {t('errors.offline')}
            </Text>
          ) : null}
          {failure === null ? null : (
            <ErrorCard
              icon="error"
              tone="critical"
              title={t('errors.failedTitle')}
              {...(failureBody === undefined ? {} : { body: failureBody })}
              primaryAction={{ label: actions('retry'), onPress: failure.retry }}
              testID="auth.error"
            />
          )}
          <Text variant="secondary" tone="secondary" align="center">
            {t.rich(mode === 'signin' ? 'signIn.toggle' : 'signUp.toggle', {
              signIn: (chunks) => (
                <Text
                  variant="secondary"
                  tone="link"
                  accessibilityRole="link"
                  onPress={() => {
                    router.setParams({ mode: 'signin' });
                  }}
                >
                  {chunks}
                </Text>
              ),
              signUp: (chunks) => (
                <Text
                  variant="secondary"
                  tone="link"
                  accessibilityRole="link"
                  onPress={() => {
                    router.setParams({ mode: 'signup' });
                  }}
                >
                  {chunks}
                </Text>
              ),
            })}
          </Text>
          <Text variant="meta" tone="tertiaryStrong" align="center">
            {t.rich('legal', {
              terms: (chunks) => (
                <Text
                  variant="meta"
                  tone="link"
                  accessibilityRole="link"
                  onPress={() => {
                    void WebBrowser.openBrowserAsync(webPage('/terms'));
                  }}
                >
                  {chunks}
                </Text>
              ),
              privacy: (chunks) => (
                <Text
                  variant="meta"
                  tone="link"
                  accessibilityRole="link"
                  onPress={() => {
                    void WebBrowser.openBrowserAsync(webPage('/privacy'));
                  }}
                >
                  {chunks}
                </Text>
              ),
            })}
          </Text>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  body: { gap: 12, paddingTop: 24 },
  tile: { width: 56, height: 56, borderRadius: 18, marginBottom: 12 },
  buttons: { gap: 10, marginTop: 20, marginBottom: 8 },
  appleButton: { height: 52, width: '100%' },
  dimmed: { opacity: 0.4 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
  rule: { flex: 1, height: 1 },
  flex: { flex: 1 },
  notConfigured: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});
