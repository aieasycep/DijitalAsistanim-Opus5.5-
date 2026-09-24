/**
 * M-GL-10 error boundary: "Bir şeyler ters gitti." with "Tekrar Dene" (`retry()`) and "Bugün'e Dön".
 * The session is never touched. The footnote shows the request correlation id when the error is an
 * `ApiError` (the Sentry event id joins with T-8.28); nothing else about the error is displayed.
 * `RootErrorBoundary` wraps its own minimal providers because the root layout itself failed;
 * `RouteErrorBoundary` is exported by the tab layouts, inside the app providers.
 */
import { isApiError } from '@da/api-client';
import { ErrorState } from '@da/ui';
import { router, usePathname, type ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { analyticsRoutePattern } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { TODAY_ROUTE, guardSnapshot } from '../../lib/router-guards';
import { UiShell } from '../../providers/AppProviders';

function errorClass(error: Error): 'render' | 'network' | 'chunk_load' | 'unknown' {
  if (isApiError(error))
    return error.kind === 'network' || error.kind === 'offline' ? 'network' : 'unknown';
  if (/chunk|bundle|module/i.test(error.name)) return 'chunk_load';
  return error.name === 'Error' || error.name === 'TypeError' ? 'render' : 'unknown';
}

function ErrorContent({ error, retry }: ErrorBoundaryProps) {
  const t = useTranslations('states.error.fullScreen');
  const actions = useTranslations('common.actions');
  const pathname = usePathname();
  const correlation = isApiError(error) ? error.correlationId : null;

  useEffect(() => {
    track('error_boundary_shown', {
      route_pattern: analyticsRoutePattern(pathname),
      error_class: errorClass(error),
    });
  }, [error, pathname]);

  return (
    <ErrorState
      icon="cloud_off"
      title={t('title')}
      body={t('body')}
      retryAction={{
        label: actions('retry'),
        onPress: () => {
          void retry();
        },
      }}
      homeAction={{
        label: actions('backToToday'),
        onPress: () => {
          router.replace(guardSnapshot().app ? TODAY_ROUTE : '/');
        },
      }}
      {...(correlation === null
        ? {}
        : { errorCodeText: t('errorCode', { code: correlation.slice(0, 8) }) })}
      testID="error-boundary"
    />
  );
}

export function RootErrorBoundary(props: ErrorBoundaryProps) {
  return (
    <SafeAreaProvider>
      <UiShell>
        <ErrorContent {...props} />
      </UiShell>
    </SafeAreaProvider>
  );
}

export function RouteErrorBoundary(props: ErrorBoundaryProps) {
  return <ErrorContent {...props} />;
}
