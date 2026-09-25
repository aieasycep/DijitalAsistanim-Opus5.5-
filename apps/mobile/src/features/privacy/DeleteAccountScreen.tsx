/**
 * M-SET-39 "Hesabımı sil" (`/settings/privacy/delete-account`): consequences (with the store
 * billing notice and acknowledgement, the Microsoft and Apple notes) → re-auth (M-SET-40, R-16) →
 * type-to-confirm (SİL / DELETE) → `POST /privacy/delete-account` [IK] → an honest status. The UI
 * never shows "silindi" before the server reports it: after 202 it polls `supabase.auth.getUser()`
 * every 3 s for at most 60 s; "Tamam" then wipes this device and signs out. A `deletion_pending`
 * account lands here from the entry resolver and sees the queued status.
 */
import { isApiError } from '@da/api-client';
import { deleteAccountMutationOptions, useBootstrap } from '@da/api-client/react';
import { DELETE_CONFIRM_TOKENS } from '@da/validation/api/privacy';
import { AISpinner, Button, ListRow, SuccessState, Text, TextField } from '@da/ui';
import { useMutation } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { logout } from '../../lib/auth/logout';
import { getSupabase } from '../../lib/auth/supabase';
import { getApiClient } from '../../lib/bootstrap';
import { track } from '../../lib/events';
import { logOutPurchases, showManageSubscriptions } from '../../lib/purchases';
import { clearWidgetSnapshot } from '../widgets/snapshot';
import { useOnline } from '../../lib/query/online-manager';
import { useUiPrefs } from '../../lib/ui-prefs';
import { deviceLocale } from '../../i18n/I18nProvider';
import { hasStoreSubscription } from '../subscription/state';
import { Caption, SettingsGroup, SettingsPage } from '../settings/ui';
import { needsReauth } from './reauth';
import { ReauthSheet, reauthMethodOf } from './ReauthSheet';

export type DeleteStep = 'consequences' | 'reauth' | 'confirm' | 'status';
export const STATUS_POLL_MS = 3_000;
export const STATUS_TIMEOUT_MS = 60_000;

/** Whether the typed word confirms (case-insensitive with Turkish upper-casing; "SIL" accepted). */
export function confirmMatches(input: string, locale: 'tr' | 'en'): boolean {
  const upper = input.trim().toLocaleUpperCase(locale === 'tr' ? 'tr-TR' : 'en-US');
  if (locale === 'en') return upper === DELETE_CONFIRM_TOKENS.en;
  return upper === DELETE_CONFIRM_TOKENS.tr || upper === 'SIL';
}

async function accountGone(): Promise<boolean> {
  try {
    const { error } = await getSupabase().auth.getUser();
    if (error === null) return false;
    const status = (error as { status?: number }).status;
    return status === 404 || status === 403 || /not.?found/i.test(error.message);
  } catch {
    return false;
  }
}

export function DeleteAccountScreen() {
  const t = useTranslations();
  const router = useRouter();
  const online = useOnline();
  const prefs = useUiPrefs();
  const locale = prefs.locale ?? deviceLocale();
  const bootstrap = useBootstrap();
  const data = bootstrap.data;
  const pending = data?.account_state === 'deletion_pending';
  const [step, setStep] = useState<DeleteStep>(pending ? 'status' : 'consequences');
  const [ack, setAck] = useState(false);
  const [ackError, setAckError] = useState(false);
  const [word, setWord] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reauthNotice, setReauthNotice] = useState<string | undefined>(undefined);
  const [key] = useState(() => Crypto.randomUUID());
  const [outcome, setOutcome] = useState<'waiting' | 'completed' | 'timeout'>('waiting');
  const [signingOut, setSigningOut] = useState(false);
  const mutation = useMutation(deleteAccountMutationOptions(getApiClient()));

  const store = data?.entitlement.store;
  const storeSub = data !== undefined && hasStoreSubscription(data.entitlement);
  const microsoft = (data?.accounts ?? []).some((a) => a.provider === 'microsoft');
  const method = reauthMethodOf(data?.profile.auth_providers ?? []);

  useEffect(() => {
    track('account_delete_step', { step: step === 'status' ? 'submitted' : step });
  }, [step]);

  // After 202: poll until the auth user is gone (completed) or 60 s pass (still queued).
  useEffect(() => {
    if (step !== 'status' || outcome !== 'waiting') return;
    const started = Date.now();
    const timer = setInterval(() => {
      void accountGone().then((gone) => {
        if (gone) setOutcome('completed');
        else if (Date.now() - started >= STATUS_TIMEOUT_MS) setOutcome('timeout');
      });
    }, STATUS_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [step, outcome]);

  const cancel = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  };

  const next = () => {
    if (storeSub && !ack) {
      setAckError(true);
      return;
    }
    void needsReauth().then((stale) => {
      setStep(stale ? 'reauth' : 'confirm');
    });
  };

  const submit = () => {
    setError(null);
    mutation.mutate(
      {
        body: {
          confirm_text: locale === 'en' ? DELETE_CONFIRM_TOKENS.en : DELETE_CONFIRM_TOKENS.tr,
          acknowledge_subscription: ack,
        },
        idempotencyKey: key,
      },
      {
        onSuccess: () => {
          track('account_delete_requested', {
            had_store_subscription: storeSub,
            login_method: method,
          });
          // Nothing on this device may keep acting for the account being deleted.
          void logOutPurchases();
          void Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
          void clearWidgetSnapshot();
          setStep('status');
        },
        onError: (failure) => {
          if (isApiError(failure) && failure.code === 'REAUTH_REQUIRED') {
            setReauthNotice(t('privacy.deleteAccountScreen.reauthExpired'));
            setStep('reauth');
          } else if (isApiError(failure) && failure.code === 'STATE_CONFLICT') {
            setStep('status');
          } else if (isApiError(failure) && failure.code === 'VALIDATION_FAILED') {
            setAckError(true);
            setStep('consequences');
          } else {
            setError(t('privacy.deleteAccountScreen.submitFailed'));
          }
        },
      },
    );
  };

  const finish = () => {
    setSigningOut(true);
    void logout({ scope: 'local', context: 'settings' }).finally(() => {
      setSigningOut(false);
    });
  };

  if (step === 'status') {
    return (
      <SettingsPage
        title={t('privacy.deleteAccount.queuedTitle')}
        leading="close"
        onLeadingPress={finish}
        testID="screen.privacy.deleteAccount"
      >
        {outcome === 'waiting' ? (
          <View
            style={styles.status}
            accessibilityLiveRegion="polite"
            testID="deleteAccount.queued"
          >
            <AISpinner label={t('privacy.deleteAccount.queuedTitle')} />
            <Text variant="body" tone="secondary">
              {t('privacy.deleteAccount.queuedBody')}
            </Text>
          </View>
        ) : outcome === 'completed' ? (
          <SuccessState
            title={t('privacy.deleteAccount.completedTitle')}
            body={t('privacy.deleteAccountScreen.completedBody')}
            action={{ label: t('common.actions.ok'), onPress: finish, loading: signingOut }}
            testID="deleteAccount.completed"
          />
        ) : (
          <Text variant="body" tone="secondary" testID="deleteAccount.timeout">
            {t('privacy.deleteAccountScreen.timeoutBody')}
          </Text>
        )}
        {outcome === 'completed' ? null : (
          <Button
            label={t('common.actions.ok')}
            variant="ink"
            fullWidth
            loading={signingOut}
            onPress={finish}
            testID="deleteAccount.done"
          />
        )}
      </SettingsPage>
    );
  }

  if (step === 'confirm') {
    const matches = confirmMatches(word, locale);
    return (
      <SettingsPage
        title={t('privacy.deleteAccountScreen.confirmTitle')}
        testID="screen.privacy.deleteAccount"
        onLeadingPress={() => {
          setStep('consequences');
        }}
        footer={
          <View style={styles.buttons}>
            <Button
              label={t('privacy.deleteAccount.confirmCta')}
              variant="destructive"
              fullWidth
              loading={mutation.isPending}
              disabled={!matches || !online}
              onPress={submit}
              testID="deleteAccount.submit"
            />
            <Button
              label={t('common.actions.nevermind')}
              variant="text"
              fullWidth
              onPress={cancel}
            />
          </View>
        }
      >
        <TextField
          label={t('privacy.deleteAccountScreen.confirmPrompt')}
          accessibilityLabel={t('privacy.deleteAccountScreen.confirmA11y')}
          value={word}
          autoCapitalize="characters"
          autoCorrect={false}
          onChangeText={setWord}
          testID="deleteAccount.word"
        />
        {error === null ? null : (
          <Text
            variant="bodySm"
            tone="critical"
            accessibilityLiveRegion="assertive"
            testID="deleteAccount.error"
          >
            {error}
          </Text>
        )}
        {online ? null : <Caption>{t('states.offline.blockedReason')}</Caption>}
      </SettingsPage>
    );
  }

  return (
    <SettingsPage
      title={t('privacy.deleteAccount.title')}
      testID="screen.privacy.deleteAccount"
      footer={
        <View style={styles.buttons}>
          <Button
            label={t('common.actions.continue')}
            variant="destructive"
            fullWidth
            onPress={next}
            testID="deleteAccount.continue"
          />
          <Button label={t('common.actions.nevermind')} variant="text" fullWidth onPress={cancel} />
        </View>
      }
    >
      <SettingsGroup title={t('privacy.deleteAccount.deletedSection')}>
        <ListRow icon="remove_circle" title={t('privacy.deleteAccount.deleted.profile')} />
        <ListRow icon="remove_circle" title={t('privacy.deleteAccount.deleted.analysis')} />
        <ListRow icon="remove_circle" title={t('privacy.deleteAccount.deleted.connections')} />
        <ListRow icon="remove_circle" title={t('privacy.deleteAccount.deleted.files')} />
        <ListRow icon="remove_circle" title={t('privacy.deleteAccount.deleted.referral')} />
      </SettingsGroup>
      <SettingsGroup title={t('privacy.deleteAccount.unaffectedSection')}>
        <ListRow icon="check" title={t('privacy.deleteAccount.unaffected.original')} />
        <ListRow icon="check" title={t('privacy.deleteAccount.unaffected.sent')} />
      </SettingsGroup>

      {storeSub && store !== undefined ? (
        <View style={styles.warning} testID="deleteAccount.subscription">
          <Text variant="body" tone="warning">
            {t('privacy.deleteAccount.subscriptionWarning', {
              store:
                store.store === 'play_store'
                  ? t('common.providers.googlePlay')
                  : t('common.providers.appStore'),
            })}
          </Text>
          <Button
            label={t('privacy.deleteAccount.manageSubscription')}
            variant="tonal"
            size="sm"
            onPress={() => {
              void showManageSubscriptions().catch(() => {
                if (store.management_url !== null) void Linking.openURL(store.management_url);
              });
            }}
            testID="deleteAccount.manage"
          />
          <ListRow
            title={t('privacy.deleteAccount.ackSubscription')}
            trailing={{ kind: 'check', checked: ack }}
            onPress={() => {
              setAck(!ack);
              setAckError(false);
            }}
            testID="deleteAccount.ack"
          />
          {ackError ? (
            <Text variant="bodySm" tone="critical" testID="deleteAccount.ackError">
              {t('privacy.deleteAccountScreen.ackRequired')}
            </Text>
          ) : null}
        </View>
      ) : null}
      {microsoft ? (
        <Text variant="bodySm" tone="warning" testID="deleteAccount.microsoft">
          {t('privacy.deleteAccount.microsoftWarning')}
        </Text>
      ) : null}
      {method === 'apple' ? (
        <Text variant="bodySm" tone="secondary" testID="deleteAccount.apple">
          {t('privacy.deleteAccount.appleNote')}
        </Text>
      ) : null}
      <Button
        label={t('privacy.deleteAccount.exportFirst')}
        variant="text"
        size="sm"
        onPress={() => {
          router.push('/settings/privacy/export');
        }}
        testID="deleteAccount.exportFirst"
      />
      {step === 'reauth' ? (
        <ReauthSheet
          visible
          {...(reauthNotice === undefined ? {} : { notice: reauthNotice })}
          onDismiss={() => {
            setStep('consequences');
          }}
          onVerified={() => {
            setStep('confirm');
          }}
        />
      ) : null}
      {Platform.OS === 'android' && method === 'apple' ? (
        <Caption>{t('privacy.deleteAccountScreen.appleAndroid')}</Caption>
      ) : null}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  status: { gap: 12, paddingVertical: 12 },
  buttons: { gap: 8 },
  warning: { gap: 8, marginTop: 8 },
});
