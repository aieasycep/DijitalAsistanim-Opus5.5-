/**
 * M-GL-02 entry resolver (`app/index.tsx`): shows the launch view while the session and bootstrap
 * resolve, then replaces itself with the resolved route; a signed-in, onboarded user lands on
 * Today and a link stored while a guard blocked it is replayed on top. Targets without a route
 * render in place: offline without a cached bootstrap, a bootstrap failure (after the query's own
 * retries), a disabled account, or a pending deletion.
 */
import { ErrorState, OfflineScreen } from '@da/ui';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';

import { logout } from '../../lib/auth/logout';
import { takePendingLink } from '../../lib/deeplinks';
import { webPage } from '../../lib/env';
import { track } from '../../lib/events';
import { entryAnalyticsTarget, type EntryTarget } from '../../lib/router-guards';
import { LaunchScreen } from '../launch/LaunchScreen';
import { useShell } from './useShell';

/** The launch view shows its spinner after this long (M-GL-02). */
export const SLOW_LAUNCH_MS = 3_000;

function hrefOf(target: EntryTarget): string | null {
  return 'href' in target ? target.href : null;
}

function AccountStateScreen({ kind }: { readonly kind: 'disabled' | 'deletion_pending' }) {
  const errors = useTranslations('errors');
  const states = useTranslations('states.error.accountDisabled');
  const actions = useTranslations('common.actions');
  const [signingOut, setSigningOut] = useState(false);
  const signOut = {
    label: actions('signOut'),
    loading: signingOut,
    onPress: () => {
      setSigningOut(true);
      void logout({ context: 'settings' }).finally(() => {
        setSigningOut(false);
      });
    },
  };
  if (kind === 'disabled') {
    return (
      <ErrorState
        icon="block"
        title={errors('account_disabled')}
        retryAction={{
          label: states('cta'),
          onPress: () => {
            void WebBrowser.openBrowserAsync(webPage('/support'));
          },
        }}
        homeAction={signOut}
        testID="entry.accountDisabled"
      />
    );
  }
  return (
    <ErrorState
      icon="block"
      title={errors('account_deletion_pending')}
      retryAction={signOut}
      testID="entry.deletionPending"
    />
  );
}

export function EntryScreen() {
  const { target, refetchBootstrap, bootstrapFetching } = useShell();
  const router = useRouter();
  const t = useTranslations('states');
  const actions = useTranslations('common.actions');
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSlow(true);
    }, SLOW_LAUNCH_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  const analyticsTarget = entryAnalyticsTarget(target);
  const step = target.kind === 'onboarding_step' ? target.step : undefined;
  useEffect(() => {
    if (analyticsTarget === null) return;
    track('entry_resolved', { target: analyticsTarget, ...(step === undefined ? {} : { step }) });
  }, [analyticsTarget, step]);

  const href = hrefOf(target);
  useEffect(() => {
    if (href === null) return;
    // The guard change that makes `href` reachable is applied by the navigator in the same commit
    // (a layout-phase update); navigating on the next tick lets that update land first.
    const timer = setTimeout(() => {
      router.replace(href);
      if (target.kind === 'today') {
        const pending = takePendingLink();
        if (pending !== null) router.push(pending);
      }
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [href, router, target.kind]);

  switch (target.kind) {
    case 'offline':
      return (
        <OfflineScreen
          title={t('offline.noCache.title')}
          body={t('offline.noCache.body')}
          retryAction={{
            label: t('offline.noCache.cta'),
            onPress: refetchBootstrap,
            loading: bootstrapFetching,
          }}
          testID="entry.offline"
        />
      );
    case 'bootstrap_error':
      return (
        <ErrorState
          title={t('error.fullScreen.title')}
          body={t('error.fullScreen.body')}
          retryAction={{
            label: actions('retry'),
            onPress: refetchBootstrap,
            loading: bootstrapFetching,
          }}
          testID="entry.bootstrapError"
        />
      );
    case 'account_disabled':
      return <AccountStateScreen kind="disabled" />;
    case 'deletion_pending':
      return href === null ? <AccountStateScreen kind="deletion_pending" /> : <LaunchScreen />;
    default:
      return <LaunchScreen busy={slow} />;
  }
}
