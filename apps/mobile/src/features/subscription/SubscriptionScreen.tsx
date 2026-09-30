/**
 * M-SUB-01 "Abonelik" (`/settings/subscription`): the real entitlement from `GET /me/entitlements`
 * (store subscription and/or grants, server authoritative) as a status hero, the sources list, and
 * Manage (store UI, `managementURL` fallback), Change plan (paywall `mode=change`) and Restore
 * (store restore → `POST /purchases/sync`). Offline shows the cached state "{time} itibarıyla"
 * with store actions blocked.
 */
import { entitlementsQueryOptions } from '@da/api-client/react';
import { Button, ErrorCard, ListRow, SkeletonBlock, StatusPill, Text, useTheme } from '@da/ui';
import type { EntitlementState } from '@da/validation/api/common';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';

import { getApiClient } from '../../lib/bootstrap';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import {
  canMakePayments,
  hasProEntitlement,
  isPurchasesConfigured,
  restore,
  showManageSubscriptions,
  syncPurchases,
} from '../../lib/purchases';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { Caption, SettingsGroup, SettingsPage } from '../settings/ui';
import { analyticsStateOf, hasStoreSubscription, heroKindOf, latestGrant, periodOf } from './state';

export function SubscriptionScreen() {
  const t = useTranslations();
  const format = useFormatter();
  const theme = useTheme();
  const router = useRouter();
  const online = useOnline();
  const query = useQuery(entitlementsQueryOptions(getApiClient()));
  const [restoring, setRestoring] = useState(false);
  const [allowed, setAllowed] = useState(true);
  const entitlement = query.data?.entitlement;

  const opened = entitlement === undefined ? null : analyticsStateOf(entitlement);
  useEffect(() => {
    if (opened !== null) track('subscription_opened', { state: opened });
    // Once per visit, when the state is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened === null]);

  useEffect(() => {
    let alive = true;
    if (isPurchasesConfigured()) {
      void canMakePayments().then((value) => {
        if (alive) setAllowed(value);
      });
    }
    return () => {
      alive = false;
    };
  }, []);

  const date = (iso: string | null) =>
    iso === null
      ? ''
      : format.dateTime(new Date(iso), { day: 'numeric', month: 'long', year: 'numeric' });

  const hero = (e: EntitlementState) => {
    const kind = heroKindOf(e);
    const period = periodOf(e.store.product_id);
    const plan = period === 'monthly' ? t('paywall.periods.monthly') : t('paywall.periods.annual');
    switch (kind) {
      case 'free':
        return {
          title: t('subscription.hero.freeTitle'),
          body: t('subscription.hero.freeBody'),
        };
      case 'trial':
        return {
          title: t('subscription.statuses.trial'),
          body: e.store.will_renew
            ? t('subscription.hero.trialRenews', { date: date(e.store.expires_at), plan })
            : t('subscription.hero.trialEnds', { date: date(e.store.expires_at) }),
        };
      case 'active':
        return {
          title: t('subscription.hero.activeTitle', { plan }),
          body: e.store.will_renew
            ? t('subscription.hero.renews', { date: date(e.store.expires_at) })
            : t('subscription.ends', { date: date(e.store.expires_at) }),
        };
      case 'billing_issue':
        return {
          title: t('subscription.statuses.billing_issue'),
          body: t('subscription.hero.billingIssue', {
            store:
              e.store.store === 'play_store'
                ? t('common.providers.googlePlay')
                : t('common.providers.appStore'),
          }),
          warning: true,
        };
      case 'grant': {
        const grant = latestGrant(e);
        return {
          title: t('subscription.hero.grantTitle', {
            source: t(`subscription.grantSources.${grant?.source ?? 'admin'}`),
          }),
          body: t('subscription.hero.until', { date: date(grant?.ends_at ?? e.active_until) }),
        };
      }
    }
  };

  const manage = () => {
    if (entitlement === undefined) return;
    track('manage_subscription_opened', { store: entitlement.store.store ?? 'app_store' });
    void showManageSubscriptions().catch(() => {
      const url = entitlement.store.management_url;
      if (url !== null) void Linking.openURL(url);
    });
  };

  const doRestore = () => {
    setRestoring(true);
    track('restore_started');
    void restore()
      .then(async (info) => {
        const found = hasProEntitlement(info);
        track('restore_completed', { found });
        if (found) {
          await syncPurchases('restore').catch(() => undefined);
          showToast({ message: t('subscription.restored'), kind: 'success' });
        } else {
          showToast({ message: t('subscription.nothingToRestore') });
        }
      })
      .catch(() => {
        showToast({ message: t('paywall.storeUnreachable'), kind: 'error' });
      })
      .finally(() => {
        setRestoring(false);
        void query.refetch();
      });
  };

  const paywall = isScreenAvailable('/paywall');
  const storeActions = online && isPurchasesConfigured();

  let body;
  if (entitlement === undefined) {
    body = query.isPending ? (
      <SkeletonBlock width="100%" height={120} radius={20} />
    ) : (
      <ErrorCard
        icon="cloud_off"
        tone="neutral"
        title={t('states.error.refreshFailed')}
        primaryAction={{
          label: t('common.actions.retry'),
          onPress: () => {
            void query.refetch();
          },
        }}
        testID="subscription.error"
      />
    );
  } else {
    const h = hero(entitlement);
    const storeSub = hasStoreSubscription(entitlement);
    body = (
      <>
        <View
          style={[styles.hero, { backgroundColor: theme.color.surface }]}
          accessible
          accessibilityLabel={`${h.title}. ${h.body}`}
          testID={`subscription.hero.${heroKindOf(entitlement)}`}
        >
          {h.warning === true ? (
            <StatusPill label={h.title} tone="warning" size="md" />
          ) : (
            <Text variant="h2">{h.title}</Text>
          )}
          <Text variant="body" tone="secondary">
            {h.body}
          </Text>
          {heroKindOf(entitlement) === 'free' && paywall ? (
            <Button
              label={t('subscription.upgrade')}
              fullWidth
              disabled={!allowed}
              onPress={() => {
                router.push('/paywall?source=subscription');
              }}
              testID="subscription.upgrade"
            />
          ) : null}
          {allowed ? null : (
            <Text variant="bodySm" tone="warning">
              {t('paywall.restricted')}
            </Text>
          )}
        </View>
        {query.isError ? (
          <ListRow
            title={t('states.error.refreshFailed')}
            trailing={{ kind: 'link', text: t('common.actions.retry') }}
            onPress={() => {
              void query.refetch();
            }}
          />
        ) : null}
        {storeSub || entitlement.grants.length > 0 ? (
          <SettingsGroup title={t('subscription.sources')} testID="subscription.sources">
            {storeSub ? (
              <ListRow
                title={t('subscription.storeSource', {
                  store:
                    entitlement.store.store === 'play_store'
                      ? t('common.providers.googlePlay')
                      : t('common.providers.appStore'),
                  plan:
                    periodOf(entitlement.store.product_id) === 'monthly'
                      ? t('paywall.periods.monthly')
                      : t('paywall.periods.annual'),
                })}
              />
            ) : null}
            {entitlement.grants.map((grant) => (
              <ListRow
                key={grant.id}
                title={t(`subscription.grantSources.${grant.source}`)}
                subtitle={t('subscription.grantRange', {
                  start: date(grant.starts_at),
                  end: date(grant.ends_at),
                })}
              />
            ))}
          </SettingsGroup>
        ) : null}
        <SettingsGroup>
          {storeSub ? (
            <ListRow
              title={t('subscription.manage')}
              trailing={{ kind: 'chevron' }}
              disabled={!storeActions}
              onPress={manage}
              testID="subscription.manage"
            />
          ) : null}
          {storeSub && paywall ? (
            <ListRow
              title={t('subscription.changePlan')}
              trailing={{ kind: 'chevron' }}
              disabled={!storeActions || !allowed}
              onPress={() => {
                router.push('/paywall?mode=change&source=subscription');
              }}
              testID="subscription.change"
            />
          ) : null}
          {isPurchasesConfigured() ? (
            <ListRow
              title={t('subscription.restore')}
              trailing={
                restoring
                  ? { kind: 'value', text: t('subscription.restoring') }
                  : { kind: 'chevron' }
              }
              disabled={!storeActions || restoring}
              onPress={doRestore}
              testID="subscription.restore"
            />
          ) : (
            <ListRow title={t('states.unavailable.credential.purchases')} />
          )}
        </SettingsGroup>
        <Caption>{t('subscription.grantNote')}</Caption>
        <Caption>{t('subscription.dataKept')}</Caption>
      </>
    );
  }

  return (
    <SettingsPage
      title={t('subscription.title')}
      refreshing={query.isRefetching}
      onRefresh={() => {
        void query.refetch();
      }}
      testID="screen.settings.subscription"
    >
      {online || query.dataUpdatedAt === 0 ? null : (
        <Caption testID="subscription.asOf">
          {t('common.time.asOf', {
            time: format.dateTime(new Date(query.dataUpdatedAt), {
              hour: '2-digit',
              minute: '2-digit',
            }),
          })}
        </Caption>
      )}
      {body}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 20, padding: 18, gap: 10 },
});
