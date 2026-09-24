/**
 * M-ON-05E / M-ON-05V e-mail code (`app/(auth)/email-otp.tsx?step=email|code&mode=signup|signin`).
 * The address stays in this screen's state (never in the URL or on disk); `step=code` without a sent
 * code falls back to the address step. Six cells sit over one hidden input (`oneTimeCode`
 * autofill) and the code submits itself at 6 digits. Resend waits 60 s. Wrong and expired codes,
 * unknown addresses in sign-in mode ("Hesap Oluştur" switches to sign-up and resends) and rate
 * limits get their own copy.
 */
import {
  Button,
  DetailHeader,
  ErrorCard,
  Text,
  TextAction,
  TextField,
  useHaptic,
  useTheme,
} from '@da/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useLocale, useTranslations } from 'use-intl';

import {
  OTP_LENGTH,
  OTP_RESEND_COOLDOWN_S,
  isValidEmail,
  requestEmailOtp,
  verifyEmailOtp,
  type AuthMode,
  type OtpRequestFailure,
  type OtpVerifyFailure,
} from '../../lib/auth/email-otp';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { analyticsMode, completeSignIn } from './completeSignIn';

/** `75` → `1:15`. */
export function formatCooldown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

const REQUEST_ERROR_CODE: Readonly<Record<OtpRequestFailure, string>> = {
  no_account: 'NOT_FOUND',
  rate_limited: 'RATE_LIMITED',
  network: 'SERVICE_UNAVAILABLE',
  provider: 'INTERNAL_ERROR',
};

function CodeCells({
  code,
  focused,
  invalid,
  onPress,
}: {
  readonly code: string;
  readonly focused: boolean;
  readonly invalid: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={styles.cells}
    >
      {Array.from({ length: OTP_LENGTH }, (_, i) => {
        const active = focused && i === Math.min(code.length, OTP_LENGTH - 1);
        const ring = invalid
          ? theme.elevation('errorRing')
          : active
            ? theme.elevation('focusRing')
            : theme.elevation('s1');
        return (
          <View
            key={`cell-${String(i)}`}
            style={[
              styles.cell,
              { backgroundColor: theme.color.surface, borderRadius: theme.radius.list },
              ring,
            ]}
          >
            <Text variant="h2" numeric align="center">
              {code[i] ?? ''}
            </Text>
          </View>
        );
      })}
    </Pressable>
  );
}

export function EmailOtpScreen() {
  const params = useLocalSearchParams<{ step?: string; mode?: string }>();
  const mode: AuthMode = params.mode === 'signin' ? 'signin' : 'signup';
  const t = useTranslations('auth');
  const locale = useLocale();
  const theme = useTheme();
  const haptic = useHaptic();
  const router = useRouter();
  const online = useOnline();
  const codeInput = useRef<TextInput>(null);

  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [requestError, setRequestError] = useState<OtpRequestFailure | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [code, setCode] = useState('');
  const [codeFocused, setCodeFocused] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<OtpVerifyFailure | null>(null);

  const step = params.step === 'code' && sentAt !== null ? 'code' : 'email';
  const emailValid = isValidEmail(email);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => {
      setCooldown((c) => c - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [cooldown]);

  const send = async (sendMode: AuthMode, resend: boolean) => {
    setSending(true);
    setRequestError(null);
    const result = await requestEmailOtp({
      email,
      mode: sendMode,
      locale: locale === 'en' ? 'en' : 'tr',
    });
    setSending(false);
    if (!result.ok) {
      setRequestError(result.code);
      track('auth_otp_request_failed', { code: REQUEST_ERROR_CODE[result.code] });
      return;
    }
    if (resend) track('auth_otp_resent', {});
    else track('auth_otp_requested', { mode: analyticsMode(sendMode) });
    setSentAt(Date.now());
    setCooldown(OTP_RESEND_COOLDOWN_S);
    setCode('');
    setVerifyError(null);
    router.setParams({ step: 'code', mode: sendMode });
  };

  const verify = async (token: string) => {
    if (sentAt === null || verifying) return;
    setVerifying(true);
    setVerifyError(null);
    const result = await verifyEmailOtp({ email, token, sentAt });
    if (!result.ok) {
      setVerifying(false);
      const failure = result.code;
      if (failure === 'invalid' || failure === 'expired' || failure === 'rate_limited') {
        track('auth_otp_failed', { code: failure });
        setVerifyError(failure);
      } else if (failure === 'network' || failure === 'provider') {
        track('auth_failed', { method: 'email_otp', code: failure });
        setVerifyError(failure);
      } else {
        setVerifyError('provider');
      }
      haptic('warning');
      setCode('');
      return;
    }
    track('auth_otp_verified', { mode: analyticsMode(mode), is_new_user: result.isNewUser });
    await completeSignIn(result, 'email_otp', mode);
    setVerifying(false);
  };

  const requestErrorText =
    requestError === 'no_account'
      ? t('email.noAccount')
      : requestError === 'rate_limited'
        ? t('email.tooMany')
        : requestError === null
          ? null
          : t('errors.failedBody');

  const verifyErrorText =
    verifyError === 'invalid'
      ? t('verify.wrong')
      : verifyError === 'expired'
        ? t('verify.expired')
        : verifyError === 'rate_limited'
          ? t('email.tooMany')
          : verifyError === null
            ? null
            : t('errors.failedBody');

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !verifying }} />
      <KeyboardAwareScrollView
        style={{ backgroundColor: theme.color.bg }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        testID={`auth.emailOtp.${step}`}
      >
        <DetailHeader
          onLeadingPress={() => {
            if (step === 'code') router.setParams({ step: 'email' });
            else router.back();
          }}
        />
        <View style={[styles.body, { paddingHorizontal: theme.layout.onboardingX }]}>
          {step === 'email' ? (
            <>
              <Text variant="display" heading>
                {t('email.title')}
              </Text>
              <Text variant="body" tone="secondary">
                {t('email.body')}
              </Text>
              <TextField
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  setRequestError(null);
                }}
                onBlur={() => {
                  setTouched(true);
                }}
                accessibilityLabel={t('email.fieldLabel')}
                placeholder={t('email.hint')}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect={false}
                disabled={sending}
                returnKeyType="send"
                onSubmitEditing={() => {
                  if (emailValid && online && !sending) void send(mode, false);
                }}
                {...(touched && email !== '' && !emailValid ? { error: t('email.invalid') } : {})}
                testID="auth.email.field"
              />
              {requestErrorText === null ? null : (
                <ErrorCard
                  icon="error"
                  tone={requestError === 'no_account' ? 'neutral' : 'critical'}
                  title={requestErrorText}
                  {...(requestError === 'no_account'
                    ? {
                        primaryAction: {
                          label: t('email.createAccount'),
                          onPress: () => {
                            router.setParams({ mode: 'signup' });
                            void send('signup', false);
                          },
                        },
                      }
                    : {})}
                  testID="auth.email.error"
                />
              )}
              <Button
                label={t('email.cta')}
                fullWidth
                size="lg"
                loading={sending}
                disabled={!emailValid || !online}
                onPress={() => {
                  void send(mode, false);
                }}
                testID="auth.email.send"
              />
              {!online ? (
                <Text variant="secondary" tone="secondary">
                  {t('errors.offline')}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Text variant="display" heading>
                {t('verify.title')}
              </Text>
              <Text variant="body" tone="secondary">
                {t('verify.body', { email })}
              </Text>
              <CodeCells
                code={code}
                focused={codeFocused}
                invalid={verifyError === 'invalid' || verifyError === 'expired'}
                onPress={() => {
                  codeInput.current?.focus();
                }}
              />
              <TextInput
                ref={codeInput}
                value={code}
                onChangeText={(value) => {
                  const digits = value.replace(/\D/g, '').slice(0, OTP_LENGTH);
                  setCode(digits);
                  setVerifyError(null);
                  if (digits.length === OTP_LENGTH) void verify(digits);
                }}
                onFocus={() => {
                  setCodeFocused(true);
                }}
                onBlur={() => {
                  setCodeFocused(false);
                }}
                autoFocus
                editable={!verifying}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={OTP_LENGTH}
                accessibilityLabel={t('verify.a11y', { count: code.length })}
                {...(verifyErrorText === null ? {} : { accessibilityHint: verifyErrorText })}
                style={styles.hiddenInput}
                testID="auth.code.input"
              />
              {verifyErrorText === null ? null : (
                <Text
                  variant="secondary"
                  tone="critical"
                  accessibilityLiveRegion="polite"
                  testID="auth.code.error"
                >
                  {verifyErrorText}
                </Text>
              )}
              <Button
                label={t('verify.cta')}
                fullWidth
                size="lg"
                loading={verifying}
                disabled={code.length !== OTP_LENGTH || !online}
                onPress={() => {
                  void verify(code);
                }}
                testID="auth.code.verify"
              />
              <View style={styles.row}>
                {cooldown > 0 ? (
                  <Text variant="secondary" tone="tertiaryStrong" testID="auth.code.cooldown">
                    {t('verify.cooldown', { remaining: formatCooldown(cooldown) })}
                  </Text>
                ) : (
                  <TextAction
                    label={t('verify.resend')}
                    loading={sending}
                    disabled={!online}
                    onPress={() => {
                      void send(mode, true);
                    }}
                    testID="auth.code.resend"
                  />
                )}
                <TextAction
                  label={t('verify.changeEmail')}
                  emphasis="secondary"
                  onPress={() => {
                    setCode('');
                    setVerifyError(null);
                    router.setParams({ step: 'email' });
                  }}
                  testID="auth.code.changeEmail"
                />
              </View>
            </>
          )}
        </View>
      </KeyboardAwareScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 32 },
  body: { gap: 14, paddingTop: 24 },
  cells: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  cell: { flex: 1, height: 52, alignItems: 'center', justifyContent: 'center' },
  hiddenInput: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
