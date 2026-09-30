/**
 * M-SET-40 "Kimliğini doğrula" (sheet used before history and account deletion, R-16): produces a
 * fresh sign-in with the user's own login method — Apple (native on iOS, web on Android; the Apple
 * exchange refreshes the revocation token), Google, Microsoft or a 6-digit e-mail code. The new
 * session must belong to the same user; otherwise the previous session is restored and nothing is
 * deleted. Blocked offline.
 */
import { BottomSheet, Button, Text, TextField } from '@da/ui';
import { useBootstrap } from '@da/api-client/react';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { signInWithAppleNative, signInWithAppleWeb } from '../../lib/auth/apple';
import {
  OTP_LENGTH,
  OTP_RESEND_COOLDOWN_S,
  requestEmailOtp,
  verifyEmailOtp,
} from '../../lib/auth/email-otp';
import { signInWithGoogle } from '../../lib/auth/google';
import { signInWithMicrosoft } from '../../lib/auth/microsoft';
import type { AuthResult } from '../../lib/auth/result';
import { getSupabase } from '../../lib/auth/supabase';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { useUiPrefs } from '../../lib/ui-prefs';
import { deviceLocale } from '../../i18n/I18nProvider';

export type ReauthMethod = 'apple' | 'google' | 'microsoft' | 'email_otp';

export function reauthMethodOf(providers: readonly string[]): ReauthMethod {
  switch (providers[0]) {
    case 'apple':
      return 'apple';
    case 'google':
      return 'google';
    case 'azure':
      return 'microsoft';
    default:
      return 'email_otp';
  }
}

type Outcome = 'ok' | 'cancelled' | 'mismatch' | 'invalid' | 'failed';

/** Runs a sign-in and keeps the session only when it is the same user. */
export async function verifySameUser(
  expectedUserId: string,
  signIn: () => Promise<AuthResult | { readonly ok: false; readonly code: string }>,
): Promise<Outcome> {
  const supabase = getSupabase();
  const previous = (await supabase.auth.getSession()).data.session;
  const result = await signIn();
  if (!result.ok) {
    if (result.code === 'cancelled') return 'cancelled';
    return result.code === 'invalid' ? 'invalid' : 'failed';
  }
  if (result.userId === expectedUserId) return 'ok';
  if (previous !== null) {
    await supabase.auth
      .setSession({ access_token: previous.access_token, refresh_token: previous.refresh_token })
      .catch(() => undefined);
  }
  return 'mismatch';
}

export interface ReauthSheetProps {
  readonly visible: boolean;
  readonly onDismiss: () => void;
  /** Called after a successful same-user sign-in. */
  readonly onVerified: () => void;
  /** Shown above the button (e.g. "Doğrulama süresi doldu, tekrar doğrula."). */
  readonly notice?: string;
}

export function ReauthSheet({ visible, onDismiss, onVerified, notice }: ReauthSheetProps) {
  const t = useTranslations();
  const online = useOnline();
  const prefs = useUiPrefs();
  const bootstrap = useBootstrap();
  const data = bootstrap.data;
  const method = reauthMethodOf(data?.profile.auth_providers ?? []);
  const email = data?.profile.email ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(false);

  const finish = (outcome: Outcome) => {
    track('reauth_completed', {
      method,
      result: outcome === 'ok' ? 'success' : outcome === 'cancelled' ? 'cancelled' : 'error',
    });
    if (outcome === 'ok') onVerified();
    else if (outcome === 'mismatch') setError(t('privacy.reauth.mismatch'));
    else if (outcome === 'invalid') setError(t('privacy.reauth.wrongCode'));
    else if (outcome === 'failed') setError(t('privacy.reauth.failed'));
  };

  const run = (
    signIn: () => Promise<AuthResult | { readonly ok: false; readonly code: string }>,
  ) => {
    if (data === undefined) return;
    setBusy(true);
    setError(null);
    void verifySameUser(data.profile.id, signIn)
      .then(finish)
      .finally(() => {
        setBusy(false);
      });
  };

  const sendCode = () => {
    if (email === null) return;
    setBusy(true);
    setError(null);
    void requestEmailOtp({ email, mode: 'signin', locale: prefs.locale ?? deviceLocale() })
      .then((result) => {
        if (result.ok) {
          setSentAt(Date.now());
          setCooldown(true);
          setTimeout(() => {
            setCooldown(false);
          }, OTP_RESEND_COOLDOWN_S * 1000);
        } else setError(t('privacy.reauth.failed'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const providerButton = () => {
    switch (method) {
      case 'apple':
        return {
          label: t('privacy.reauth.apple'),
          onPress: () => {
            run(() => (Platform.OS === 'ios' ? signInWithAppleNative() : signInWithAppleWeb()));
          },
        };
      case 'google':
        return {
          label: t('privacy.reauth.google'),
          onPress: () => {
            run(() => signInWithGoogle());
          },
        };
      case 'microsoft':
        return {
          label: t('privacy.reauth.microsoft'),
          onPress: () => {
            run(() => signInWithMicrosoft());
          },
        };
      case 'email_otp':
        return null;
    }
  };
  const button = providerButton();

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      dismissible={!busy}
      title={t('privacy.deleteAccount.reauthTitle')}
      testID="sheet.reauth"
    >
      {notice === undefined ? null : (
        <Text variant="bodySm" tone="warning">
          {notice}
        </Text>
      )}
      {online ? null : (
        <Text variant="bodySm" tone="tertiaryStrong" testID="reauth.offline">
          {t('states.offline.blockedReason')}
        </Text>
      )}
      {button !== null ? (
        <Button
          label={button.label}
          variant="ink"
          fullWidth
          loading={busy}
          disabled={!online}
          onPress={button.onPress}
          testID="reauth.provider"
        />
      ) : email === null ? (
        <Text variant="body" tone="secondary">
          {t('privacy.reauth.unavailable')}
        </Text>
      ) : (
        <View style={styles.otp}>
          <Text variant="body" tone="secondary">
            {t('privacy.reauth.emailBody', { email })}
          </Text>
          {sentAt === null ? (
            <Button
              label={t('privacy.reauth.sendCode')}
              variant="ink"
              fullWidth
              loading={busy}
              disabled={!online}
              onPress={sendCode}
              testID="reauth.sendCode"
            />
          ) : (
            <>
              <TextField
                label={t('privacy.reauth.codeLabel')}
                value={code}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={OTP_LENGTH}
                onChangeText={(text) => {
                  setCode(text.replace(/\D/g, ''));
                }}
                testID="reauth.code"
              />
              <Button
                label={t('common.actions.verify')}
                variant="ink"
                fullWidth
                loading={busy}
                disabled={!online || code.length !== OTP_LENGTH}
                onPress={() => {
                  const at = sentAt;
                  run(() => verifyEmailOtp({ email, token: code, sentAt: at }));
                }}
                testID="reauth.verify"
              />
              <Button
                label={t('privacy.reauth.resend')}
                variant="text"
                size="sm"
                disabled={cooldown || busy}
                onPress={sendCode}
                testID="reauth.resend"
              />
            </>
          )}
        </View>
      )}
      {error === null ? null : (
        <Text
          variant="bodySm"
          tone="critical"
          accessibilityLiveRegion="polite"
          testID="reauth.error"
        >
          {error}
        </Text>
      )}
      <Button
        label={t('common.actions.nevermind')}
        variant="text"
        fullWidth
        disabled={busy}
        onPress={onDismiss}
        testID="reauth.cancel"
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  otp: { gap: 10 },
});
