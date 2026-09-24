/**
 * M-GL-11 Not found (`app/+not-found.tsx`): an unknown path or a rejected deep link. Honest copy,
 * one action "Bugün'e Dön" (Today when the app is open to the user, otherwise the entry resolver).
 */
import { NotFoundState } from '@da/ui';
import { usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslations } from 'use-intl';

import { analyticsRoutePattern } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { TODAY_ROUTE, guardSnapshot } from '../../lib/router-guards';

export function NotFoundScreen() {
  const t = useTranslations('states.notFound.route');
  const actions = useTranslations('common.actions');
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    track('not_found_shown', { path_pattern: analyticsRoutePattern(pathname) });
  }, [pathname]);

  return (
    <NotFoundState
      variant="route"
      title={t('title')}
      body={t('body')}
      backAction={{
        label: actions('backToToday'),
        onPress: () => {
          router.replace(guardSnapshot().app ? TODAY_ROUTE : '/');
        },
      }}
      testID="not-found"
    />
  );
}
