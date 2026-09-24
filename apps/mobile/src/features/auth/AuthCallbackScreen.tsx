/**
 * `app/auth/callback` (M-GL-07 rule 4): the PKCE redirect of Microsoft and Android Apple sign-in
 * when it arrives as a link instead of inside the auth session (the session was lost or the app
 * was restarted). The code is exchanged once (`exchangeAuthCode` shares an exchange already in
 * flight), the sign-in completes, and the entry resolver takes over at `/`.
 */
import { ErrorState } from '@da/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';

import {
  claimCompletion,
  exchangeAuthCode,
  takeBrowserSignInIntent,
} from '../../lib/auth/browser-oauth';
import { LaunchScreen } from '../launch/LaunchScreen';
import { completeSignIn } from './completeSignIn';

export function AuthCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string; error?: string }>();
  const t = useTranslations('auth.errors');
  const actions = useTranslations('common.actions');
  const router = useRouter();
  const code = typeof params.code === 'string' && params.code !== '' ? params.code : null;
  const [failed, setFailed] = useState(code === null);

  useEffect(() => {
    if (code === null) return;
    let active = true;
    void exchangeAuthCode(code).then(async (result) => {
      if (!active) return;
      if (!result.ok) {
        setFailed(true);
        return;
      }
      if (claimCompletion(code)) {
        const intent = takeBrowserSignInIntent();
        await completeSignIn(result, intent?.method ?? 'microsoft', intent?.mode ?? 'signin');
      }
      router.replace('/');
    });
    return () => {
      active = false;
    };
  }, [code, router]);

  if (!failed) return <LaunchScreen busy />;
  return (
    <ErrorState
      title={t('failedTitle')}
      body={t('failedBody')}
      retryAction={{
        label: actions('retry'),
        onPress: () => {
          router.replace('/sign-in?mode=signin');
        },
      }}
      testID="auth.callback.failed"
    />
  );
}
