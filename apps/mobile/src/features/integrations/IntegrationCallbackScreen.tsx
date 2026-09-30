/**
 * `app/integrations/callback` (M-GL-07 rule 3, R-07/D-31): the `oauth` function's redirect after
 * a Google / Microsoft / demo consent, also reached from the web fallback `/oauth/done`. Parameters
 * are validated with `@da/domain` `parseOAuthCallback`. The redirect never connects anything by
 * itself: with `result=pending_confirmation` the connect flow (T-8.07) finishes it through
 * `POST /integrations/oauth/complete {completion_code, device_nonce}` — it registers that step with
 * `registerOAuthCompletionHandler` and returns the route to open (the account screen or the
 * onboarding step), opened at once when the app is reachable, else replayed by the entry resolver
 * once it is. Every other outcome, and a pending confirmation that no handler can finish on
 * this device, shows the documented error state; nothing is marked connected. The SecureStore
 * entry `da.oauth.pending` is removed after every outcome handled here.
 */
import { parseOAuthCallback, type OAuthCallback } from '@da/domain/deeplinks';
import { ErrorState } from '@da/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';

import { savePendingLink } from '../../lib/deeplinks';
import { SECURE_KEYS, SECURE_STORE_OPTIONS } from '../../lib/storage';
import { ONBOARDING_STEP_ROUTES, TODAY_ROUTE, guardSnapshot } from '../../lib/router-guards';
import { LaunchScreen } from '../launch/LaunchScreen';

export type OAuthCompletionResult = { readonly href: string } | { readonly failed: true };
export type OAuthCompletionHandler = (callback: OAuthCallback) => Promise<OAuthCompletionResult>;

let completionHandler: OAuthCompletionHandler | null = null;

/** T-8.07 registers the `POST /integrations/oauth/complete` step here. */
export function registerOAuthCompletionHandler(handler: OAuthCompletionHandler | null): void {
  completionHandler = handler;
}

function firstValues(params: Readonly<Record<string, string | string[] | undefined>>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) out[key] = first;
  }
  return out;
}

/** Whether the guards let the route open now (the app, or an onboarding step while onboarding). */
function isReachableNow(href: string): boolean {
  const snapshot = guardSnapshot();
  if (snapshot.app) return true;
  const path = href.split('?')[0] ?? href;
  return snapshot.onboarding && Object.values(ONBOARDING_STEP_ROUTES).includes(path);
}

function clearPending(): void {
  void SecureStore.deleteItemAsync(SECURE_KEYS.oauthPending, SECURE_STORE_OPTIONS).catch(
    () => undefined,
  );
}

export function IntegrationCallbackScreen() {
  const params = useLocalSearchParams();
  const t = useTranslations('states.error');
  const providers = useTranslations('common.providers');
  const actions = useTranslations('common.actions');
  const router = useRouter();
  const callback = useMemo(() => parseOAuthCallback(firstValues(params)), [params]);
  const pending = callback?.result === 'pending_confirmation' && completionHandler !== null;
  const [failed, setFailed] = useState(!pending);

  useEffect(() => {
    if (callback?.result !== 'pending_confirmation') {
      clearPending();
      return;
    }
    const handler = completionHandler;
    if (handler === null) {
      clearPending();
      return;
    }
    let active = true;
    void handler(callback).then(
      (result) => {
        if (!active) return;
        if (!('href' in result)) {
          setFailed(true);
          return;
        }
        if (isReachableNow(result.href)) {
          router.replace(result.href);
          return;
        }
        // Session or bootstrap still restoring: the entry resolver replays it once Today is reached.
        savePendingLink(result.href);
        router.replace('/');
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [callback, router]);

  if (!failed) return <LaunchScreen busy />;

  const leave = {
    label: actions('goBack'),
    onPress: () => {
      router.replace(guardSnapshot().app ? TODAY_ROUTE : '/');
    },
  };
  const identityProvider =
    callback?.provider === 'microsoft'
      ? providers('microsoft')
      : callback?.provider === 'demo'
        ? providers('demo')
        : providers('google');

  if (callback?.result === 'denied') {
    return (
      <ErrorState
        icon="block"
        title={t('oauthExpired.declined.title')}
        body={t('oauthExpired.declined.body', { identityProvider })}
        retryAction={leave}
        testID="integrations.callback.denied"
      />
    );
  }
  if (callback?.result === 'admin_consent_required') {
    const consentUrl = callback.adminConsentUrl;
    return (
      <ErrorState
        icon="admin_panel_settings"
        title={t('oauthExpired.adminConsent.title')}
        body={t('oauthExpired.adminConsent.body')}
        {...(consentUrl === null
          ? { retryAction: leave }
          : {
              retryAction: {
                label: t('oauthExpired.adminConsent.cta'),
                onPress: () => {
                  void WebBrowser.openBrowserAsync(consentUrl);
                },
              },
              homeAction: leave,
            })}
        testID="integrations.callback.adminConsent"
      />
    );
  }
  return (
    <ErrorState
      icon="link_off"
      title={t('oauthFailed.title')}
      body={t('oauthFailed.body')}
      retryAction={leave}
      testID="integrations.callback.failed"
    />
  );
}
