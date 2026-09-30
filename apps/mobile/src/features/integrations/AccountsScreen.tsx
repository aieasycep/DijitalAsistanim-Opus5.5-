/**
 * M-SET-10 "Bağlantılar" (`/settings/accounts`): the data connections, separate from app login.
 * Groups MAİL / TAKVİM / GÖREVLER list connected rows (status pill, status meta or last sync,
 * "Yönet") with the per-status inline action (Yeniden Bağlan, İzin Ver, Şimdi Dene), then the
 * providers still to connect ("Bağla", or "PRO" beyond the Free limit). Polled while an account is
 * connecting or syncing (R-19); `?add=<provider>` opens that provider's explainer.
 */
import { qk } from '@da/api-client';
import { useBootstrap } from '@da/api-client/react';
import {
  Button,
  DetailHeader,
  EmptyState,
  ErrorCard,
  GroupedList,
  ListRow,
  OfflineBanner,
  SectionHeader,
  StatusPill,
  StickyCTABar,
  Text,
  useTheme,
} from '@da/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFormatter, useTranslations } from 'use-intl';

import { getApiClient } from '../../lib/bootstrap';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { isPro, openProGate } from '../pro-gate/ProGate';
import { useAccounts, type AccountRow } from './accounts';
import { connectCloud } from './flow';
import { groupOf, providerOptions, providesOption, type ProviderGroup } from './providers';
import { needsPro, openAddAccount, openOptionExplainer } from './sheets/AddAccountSheet';
import { providerNameKey, statusToneOf } from './status';
import { ListSkeleton } from '../common/ListSkeleton';

const GROUPS: readonly ProviderGroup[] = ['mail', 'calendar', 'tasks'];

export function useSyncNow() {
  const t = useTranslations('settings.accounts');
  const queryClient = useQueryClient();
  return async (account: AccountRow) => {
    track('account_sync_requested', { provider: account.provider });
    try {
      await getApiClient().call('POST /integrations/:accountId/sync', {
        params: { accountId: account.id },
        body: {},
      });
      showToast({ message: t('syncStarted') });
    } catch (error) {
      // A 429 means a sync just ran: the data is fresh (M-TD-01 pull-to-refresh rule).
      const rateLimited =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'RATE_LIMITED';
      showToast(
        rateLimited ? { message: t('syncFresh') } : { message: t('syncFailed'), kind: 'error' },
      );
    }
    void queryClient.invalidateQueries({ queryKey: qk.integrations.all });
  };
}

export function AccountsScreen() {
  const t = useTranslations('settings.accounts');
  const common = useTranslations('common');
  const states = useTranslations('states');
  const format = useFormatter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const params = useLocalSearchParams<{ add?: string }>();
  const bootstrap = useBootstrap();
  const query = useAccounts();
  const syncNow = useSyncNow();
  const accounts = query.data?.accounts ?? [];
  const pro = isPro();

  useEffect(() => {
    track('accounts_opened');
  }, []);

  useEffect(() => {
    const add = params.add;
    if (add === undefined || query.data === undefined) return;
    const option = providerOptions().find(
      (o) => o.provider === add && !accounts.some((a) => providesOption(a, o)),
    );
    if (option !== undefined) openOptionExplainer(option, accounts);
    // Opened once per deep link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.add, query.data === undefined]);

  const metaOf = (account: AccountRow): string => {
    switch (account.status) {
      case 'syncing':
        return t('meta.syncing');
      case 'partial':
        return t('meta.partial');
      case 'needs_reauth':
        return t('meta.needsReauth', {
          identityProvider: common(
            `providers.${account.provider === 'microsoft' ? 'microsoft' : 'google'}`,
          ),
        });
      case 'admin_consent_required':
        return states('error.oauthExpired.adminConsent.body');
      case 'error':
        return t('meta.error');
      default:
        return account.last_sync_at === null
          ? t('meta.firstSync')
          : t('meta.lastSync', {
              time: format.dateTime(new Date(account.last_sync_at), {
                hour: '2-digit',
                minute: '2-digit',
              }),
            });
    }
  };

  const inlineAction = (account: AccountRow) => {
    const provider = account.provider;
    if (provider !== 'google' && provider !== 'microsoft' && provider !== 'demo') return undefined;
    if (account.status === 'needs_reauth') {
      return {
        label: common('actions.reconnect'),
        run: () => {
          void connectCloud({
            provider,
            capability: account.capabilities_granted.includes('mail_read')
              ? 'mail_read'
              : 'calendar_read',
            returnTo: 'settings_accounts',
            reconnect: account,
          });
        },
      };
    }
    if (account.status === 'error') {
      return {
        label: common('actions.tryNow'),
        run: () => {
          track('account_retry_sync', { provider });
          void syncNow(account);
        },
      };
    }
    return undefined;
  };

  const rowsFor = (group: ProviderGroup) => {
    const connected = accounts.filter((a) => groupOf(a).includes(group));
    const open = providerOptions().filter(
      (o) => o.group === group && !accounts.some((a) => providesOption(a, o)),
    );
    return (
      <View key={group} style={styles.group}>
        <SectionHeader title={t(`groups.${group}`)} />
        <GroupedList testID={`accounts.group.${group}`}>
          {connected.map((account) => {
            const action = inlineAction(account);
            const name = common(`providers.${providerNameKey(account.provider, group)}`);
            const title =
              account.account_email === null
                ? name
                : t('rowTitle', { service: name, email: account.account_email });
            return (
              <ListRow
                key={`${group}.${account.id}`}
                title={title}
                subtitle={metaOf(account)}
                density="twoLineTrailing"
                trailing={
                  action === undefined
                    ? {
                        kind: 'custom',
                        node: (
                          <StatusPill
                            label={t(`status.${account.status}`)}
                            tone={statusToneOf(account.status)}
                            busy={account.status === 'syncing' || account.status === 'connecting'}
                          />
                        ),
                      }
                    : { kind: 'link', text: action.label }
                }
                onPress={() => {
                  if (action !== undefined && online) action.run();
                  else router.push(`/settings/accounts/${account.id}`);
                }}
                accessibilityLabel={t('rowA11y', {
                  title,
                  status: t(`status.${account.status}`),
                  meta: metaOf(account),
                })}
                testID={`accounts.row.${group}.${account.id}`}
              />
            );
          })}
          {open.map((option) => {
            const locked = needsPro(option, accounts, pro);
            const configured =
              (option.provider !== 'google' && option.provider !== 'microsoft') ||
              bootstrap.data === undefined ||
              bootstrap.data.service_status.unavailable_features.every(
                (f) => f.feature !== `integrations.${option.provider}`,
              );
            return (
              <ListRow
                key={option.key}
                title={common(`providers.${option.key}`)}
                {...(configured ? {} : { subtitle: t('notConfigured') })}
                trailing={
                  locked
                    ? { kind: 'value', text: common('badges.pro') }
                    : { kind: 'link', text: common('actions.connect') }
                }
                disabled={!configured}
                onPress={() => {
                  if (locked) openProGate('multi_account');
                  else openOptionExplainer(option, accounts);
                }}
                testID={`accounts.connect.${option.key}`}
              />
            );
          })}
        </GroupedList>
      </View>
    );
  };

  let body;
  if (query.isPending) {
    body = <ListSkeleton rows={3} accessibilityLabel={common('a11y.loading')} />;
  } else if (query.isError && query.data === undefined) {
    body = (
      <ErrorCard
        icon="cloud_off"
        tone="neutral"
        title={states('error.loadFailed.title', { screen: t('title') })}
        body={states('error.loadFailed.body')}
        primaryAction={{
          label: common('actions.retry'),
          onPress: () => {
            void query.refetch();
          },
        }}
        testID="accounts.error"
      />
    );
  } else if (accounts.length === 0) {
    body = (
      <EmptyState
        icon="mail"
        tone="primary"
        title={states('empty.noAccount.title')}
        body={states('empty.noAccount.body')}
        action={{
          label: states('empty.noAccount.cta'),
          onPress: () => {
            openAddAccount({ accounts, bootstrap: bootstrap.data, pro });
          },
        }}
        testID="accounts.empty"
      />
    );
  } else {
    body = GROUPS.map(rowsFor);
  }

  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
      testID="screen.accounts"
    >
      <DetailHeader
        leading="back"
        onLeadingPress={() => {
          router.back();
        }}
        leadingAccessibilityLabel={common('actions.back')}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenX }]}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => {
              void query.refetch();
            }}
            tintColor={theme.color.brand.primary}
          />
        }
      >
        {online ? null : (
          <OfflineBanner
            message={states('offline.blockedReason')}
            refreshLabel={states('offline.refresh')}
            onRefresh={() => {
              void query.refetch();
            }}
          />
        )}
        <Text variant="h1" heading>
          {t('title')}
        </Text>
        <Text variant="body" tone="secondary">
          {t('subtitle')}
        </Text>
        {body}
        <Text variant="secondary" tone="tertiaryStrong">
          {t('footer')}
        </Text>
      </ScrollView>
      {accounts.length > 0 ? (
        <StickyCTABar
          style={{
            paddingBottom: Math.max(insets.bottom, 12),
            paddingHorizontal: theme.layout.screenX,
          }}
        >
          <Button
            label={t('addAccount')}
            variant="tonal"
            fullWidth
            onPress={() => {
              openAddAccount({ accounts, bootstrap: bootstrap.data, pro });
            }}
            testID="accounts.add"
          />
        </StickyCTABar>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 12, paddingBottom: 32 },
  group: { gap: 8, marginTop: 8 },
});
