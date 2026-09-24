/**
 * Tab roots of the app shell (M-GL-03/04). Each tab shows the root header (date kicker, tab title,
 * the self avatar that opens `/settings` once that screen exists) and a truthful state driven by
 * `GET /me/bootstrap` until the tab's feature screen replaces this body (T-8.08 Today, T-8.10 Flow,
 * T-8.13 Plan, T-8.15 Assistant):
 * - loading: the tab's M-STATE-01 skeleton;
 * - failure without data: M-STATE-11 error card (M-STATE-03 offline copy when offline) + retry;
 * - no connected source: the "connect" empty state (its CTA only when the accounts screen exists);
 * - otherwise the tab's documented empty state; CTAs only to routes that exist (R-24).
 * Pull-to-refresh refetches bootstrap; re-tapping the tab scrolls this root to the top.
 */
import { useBootstrap } from '@da/api-client/react';
import {
  ChatStreamingSkeleton,
  EmptyState,
  ErrorCard,
  ExternalCredentialRequired,
  FeedSkeleton,
  RootHeader,
  TimelineSkeleton,
  TodaySkeleton,
  useTheme,
  type EmptyStateProps,
} from '@da/ui';
import type { BootstrapData } from '@da/validation/api/bootstrap';
import { useRouter, useScrollToTop } from 'expo-router';
import { useRef, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';

import { hasCapability, unavailableReason } from '../../lib/bootstrap';
import { now } from '../../lib/clock';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import type { TabKey } from './ShellTabBar';

const ACCOUNTS_ROUTE = '/settings/accounts';
const SETTINGS_ROUTE = '/settings';

function Loading({ tab }: { readonly tab: TabKey }) {
  const t = useTranslations('states.loading');
  const label = t('label');
  switch (tab) {
    case 'today':
      return <TodaySkeleton kicker={label} accessibilityLabel={label} testID="tab.loading" />;
    case 'flow':
      return <FeedSkeleton accessibilityLabel={label} testID="tab.loading" />;
    case 'plan':
      return <TimelineSkeleton accessibilityLabel={label} testID="tab.loading" />;
    case 'assistant':
      return <ChatStreamingSkeleton accessibilityLabel={label} testID="tab.loading" />;
  }
}

function useConnectAction(): EmptyStateProps['action'] {
  const t = useTranslations('states.empty.noAccount');
  const router = useRouter();
  if (!isScreenAvailable(ACCOUNTS_ROUTE)) return undefined;
  return {
    label: t('cta'),
    onPress: () => {
      router.push(ACCOUNTS_ROUTE);
    },
  };
}

function TodayBody({ data }: { readonly data: BootstrapData }) {
  const t = useTranslations('states.empty');
  const router = useRouter();
  const connect = useConnectAction();
  if (data.accounts.length === 0) {
    return (
      <EmptyState
        icon="mail"
        tone="primary"
        title={t('noAccount.title')}
        body={t('noAccount.body')}
        {...(connect === undefined ? {} : { action: connect })}
        testID="tab.today.noAccount"
      />
    );
  }
  return (
    <EmptyState
      icon="check_circle"
      tone="success"
      title={t('today.title')}
      body={t('today.body')}
      action={{
        label: t('today.cta'),
        onPress: () => {
          router.navigate('/flow');
        },
      }}
      testID="tab.today.empty"
    />
  );
}

function FlowBody({ data }: { readonly data: BootstrapData }) {
  const t = useTranslations();
  const connect = useConnectAction();
  if (!hasCapability(data, 'mail_read')) {
    return (
      <EmptyState
        icon="mail"
        tone="primary"
        title={t('states.empty.noAccount.title')}
        body={t('states.empty.noAccount.body')}
        {...(connect === undefined ? {} : { action: connect })}
        testID="tab.flow.noAccount"
      />
    );
  }
  return (
    <EmptyState
      icon="dynamic_feed"
      tone="neutral"
      title={t('flow.empty.title')}
      body={t('flow.empty.body')}
      testID="tab.flow.empty"
    />
  );
}

function PlanBody({ data }: { readonly data: BootstrapData }) {
  const t = useTranslations('states.empty');
  const router = useRouter();
  if (!hasCapability(data, 'calendar_read')) {
    const canConnect = isScreenAvailable(ACCOUNTS_ROUTE);
    return (
      <EmptyState
        icon="calendar_today"
        tone="primary"
        title={t('noCalendar.title')}
        body={t('noCalendar.body')}
        {...(canConnect
          ? {
              action: {
                label: t('noCalendar.cta'),
                onPress: () => {
                  router.push(ACCOUNTS_ROUTE);
                },
              },
            }
          : {})}
        testID="tab.plan.noCalendar"
      />
    );
  }
  return (
    <EmptyState
      icon="calendar_today"
      tone="primary"
      title={t('plan.title')}
      body={t('plan.body')}
      testID="tab.plan.empty"
    />
  );
}

function AssistantBody({ data }: { readonly data: BootstrapData }) {
  const t = useTranslations();
  const reason = unavailableReason(data, 'assistant');
  return (
    <View style={styles.stack}>
      {reason === null ? null : (
        <ExternalCredentialRequired
          reason={
            reason === 'external_credential_required'
              ? 'credential'
              : reason === 'feature_disabled'
                ? 'disabled'
                : 'outage'
          }
          message={
            reason === 'external_credential_required'
              ? t('states.unavailable.credential.generic')
              : t('states.unavailable.featureDisabled')
          }
          testID="tab.assistant.unavailable"
        />
      )}
      <EmptyState
        icon="auto_awesome"
        tone="primary"
        title={
          data.accounts.length === 0
            ? t('assistant.summaryNoAccounts')
            : t('assistant.summaryFallback')
        }
        testID="tab.assistant.empty"
      />
    </View>
  );
}

function Body({ tab, data }: { readonly tab: TabKey; readonly data: BootstrapData }) {
  switch (tab) {
    case 'today':
      return <TodayBody data={data} />;
    case 'flow':
      return <FlowBody data={data} />;
    case 'plan':
      return <PlanBody data={data} />;
    case 'assistant':
      return <AssistantBody data={data} />;
  }
}

export function TabRoot({ tab }: { readonly tab: TabKey }) {
  const theme = useTheme();
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const online = useOnline();
  const bootstrap = useBootstrap();
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  const title = t(`common.tabs.${tab}`);
  const kicker = format.dateTime(now(), { day: 'numeric', month: 'long', weekday: 'long' });
  const name = bootstrap.data?.profile.display_name ?? bootstrap.data?.profile.email ?? title;

  let body: ReactNode;
  if (bootstrap.data !== undefined) {
    body = <Body tab={tab} data={bootstrap.data} />;
  } else if (bootstrap.isError) {
    body = (
      <ErrorCard
        icon={online ? 'cloud_off' : 'wifi_off'}
        tone="neutral"
        title={
          online
            ? t('states.error.loadFailed.title', { screen: title })
            : t('states.offline.noCache.title')
        }
        body={online ? t('states.error.loadFailed.body') : t('states.offline.noCache.body')}
        primaryAction={{
          label: t('common.actions.retry'),
          onPress: () => {
            void bootstrap.refetch();
          },
          loading: bootstrap.isFetching,
        }}
        testID="tab.error"
      />
    );
  } else {
    body = <Loading tab={tab} />;
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={{ backgroundColor: theme.color.bg }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={bootstrap.isRefetching}
          onRefresh={() => {
            void bootstrap.refetch();
          }}
          tintColor={theme.color.brand.primary}
          colors={[theme.color.brand.primary]}
        />
      }
      testID={`tab.${tab}`}
    >
      <RootHeader
        kicker={kicker}
        title={title}
        {...(isScreenAvailable(SETTINGS_ROUTE)
          ? {
              avatar: {
                name,
                accessibilityLabel: t('today.header.profileA11y'),
                onPress: () => {
                  track('avatar_tapped');
                  router.push(SETTINGS_ROUTE);
                },
              },
            }
          : {})}
      />
      <View style={[styles.body, { paddingHorizontal: theme.layout.screenX }]}>{body}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 24 },
  body: { flex: 1, justifyContent: 'center', paddingTop: 24 },
  stack: { gap: 16 },
});
