/**
 * M-SET-12 account detail (`/settings/accounts/{id}`): status with its repair action ("Yeniden
 * Bağlan" re-consents through OAuth, "İzin Ver" upgrades a missing read capability, "Şimdi Dene"
 * syncs), last sync per resource with "Şimdi eşitle", the granted scopes in plain language
 * (progressive write scopes as "Henüz istenmedi"), the Data Source Controls, calendar selection
 * (Free: the primary calendar only) and "Bağlantıyı kaldır" with honest consequences (M-SET-13).
 */
import { qk } from '@da/api-client';
import type { Capability } from '@da/domain/enums';
import {
  DetailHeader,
  ErrorCard,
  GroupedList,
  ListRow,
  NotFoundState,
  PermissionCard,
  ReconnectCard,
  SectionHeader,
  StatusPill,
  Text,
  useTheme,
} from '@da/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFormatter, useTranslations } from 'use-intl';

import { getApiClient } from '../../lib/bootstrap';
import { track } from '../../lib/events';
import { entitlementFeatureOf } from '../../lib/postgrest';
import { sheets } from '../../providers/SheetHost';
import { showToast } from '../../providers/ToastHost';
import { isPro, openProGate } from '../pro-gate/ProGate';
import { calendarsOf, useAccounts, type AccountRow, type CalendarRow } from './accounts';
import { useSyncNow } from './AccountsScreen';
import { DataSourceControls } from './DataSourceControls';
import { devicePermission, openSystemSettings } from './device-calendar';
import { connectCloud } from './flow';
import { DISCONNECT_SHEET } from './sheets/DisconnectSheet';
import { ADMIN_CONSENT_SHEET } from './sheets/AdminConsentSheet';
import { ProviderLogo, providerNameKey, statusToneOf } from './status';
import { ListSkeleton } from '../common/ListSkeleton';

const SCOPES: readonly Capability[] = [
  'mail_read',
  'mail_send',
  'calendar_read',
  'calendar_write',
  'tasks_read',
  'tasks_write',
];
const PROGRESSIVE: Readonly<Partial<Record<Capability, Capability>>> = {
  mail_send: 'mail_read',
  calendar_write: 'calendar_read',
  tasks_write: 'tasks_read',
};

function missingRead(account: AccountRow): 'mail_read' | 'calendar_read' | null {
  if (account.status !== 'partial') return null;
  if (!account.capabilities_granted.includes('mail_read')) return 'mail_read';
  if (!account.capabilities_granted.includes('calendar_read')) return 'calendar_read';
  return null;
}

function CalendarsCard({
  account,
  calendars,
}: {
  readonly account: AccountRow;
  readonly calendars: readonly CalendarRow[];
}) {
  const t = useTranslations('settings.accounts');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const pro = isPro();
  const [busy, setBusy] = useState<string | null>(null);
  if (calendars.length === 0) {
    return (
      <Text variant="secondary" tone="tertiaryStrong">
        {t('noCalendars')}
      </Text>
    );
  }
  const selectedCount = calendars.filter((c) => c.selected).length;
  const toggle = async (calendar: CalendarRow) => {
    const next = !calendar.selected;
    if (next && !pro && selectedCount >= 1) {
      openProGate('multi_account');
      return;
    }
    setBusy(calendar.id);
    try {
      await getApiClient().call('PATCH /integrations/:accountId/data-sources', {
        params: { accountId: account.id },
        body: {
          calendars: [{ calendar_id: calendar.id, selected: next }],
          expected_updated_at: account.updated_at,
        },
      });
      track('calendar_selection_changed', { count: selectedCount + (next ? 1 : -1) });
      void queryClient.invalidateQueries({ queryKey: qk.integrations.all });
    } catch (error) {
      if (entitlementFeatureOf(error) !== null) openProGate('multi_account');
      else showToast({ message: common('toast.saveFailed'), kind: 'error' });
    } finally {
      setBusy(null);
    }
  };
  return (
    <GroupedList testID="account.calendars">
      {calendars.map((calendar) => {
        const locked = !pro && !calendar.selected && selectedCount >= 1;
        return (
          <ListRow
            key={calendar.id}
            title={calendar.name}
            trailing={
              locked
                ? { kind: 'value', text: common('badges.pro') }
                : { kind: 'check', checked: calendar.selected }
            }
            disabled={busy === calendar.id}
            onPress={() => {
              void toggle(calendar);
            }}
            testID={`account.calendar.${calendar.id}`}
          />
        );
      })}
    </GroupedList>
  );
}

export function AccountDetailScreen() {
  const t = useTranslations('settings.accounts');
  const common = useTranslations('common');
  const states = useTranslations('states');
  const scopes = useTranslations('privacy.permissions');
  const format = useFormatter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useAccounts();
  const syncNow = useSyncNow();
  const [statusHidden, setStatusHidden] = useState(false);
  const account = query.data?.accounts.find((a) => a.id === id);
  const device = account?.provider === 'apple_device' || account?.provider === 'android_device';
  const permission = useQuery({
    queryKey: ['device-calendar-permission'],
    queryFn: devicePermission,
    enabled: device,
  });
  const opened = useRef(false);

  useEffect(() => {
    if (account === undefined || opened.current) return;
    opened.current = true;
    track('account_detail_opened', { provider: account.provider, status: account.status });
  }, [account]);

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings/accounts');
  };

  const header = (
    <DetailHeader
      leading="back"
      onLeadingPress={back}
      leadingAccessibilityLabel={common('actions.back')}
    />
  );

  if (query.isPending) {
    return (
      <View style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}>
        {header}
        <View style={{ paddingHorizontal: theme.layout.screenX }}>
          <ListSkeleton rows={6} accessibilityLabel={common('a11y.loading')} />
        </View>
      </View>
    );
  }
  if (account === undefined) {
    return (
      <View style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}>
        {header}
        {query.isError ? (
          <ErrorCard
            icon="cloud_off"
            tone="neutral"
            title={states('error.loadFailed.title', { screen: t('title') })}
            primaryAction={{
              label: common('actions.retry'),
              onPress: () => {
                void query.refetch();
              },
            }}
          />
        ) : (
          <NotFoundState
            variant="entity"
            title={states('notFound.account.title')}
            backAction={{
              label: states('notFound.account.cta'),
              onPress: () => {
                router.replace('/settings/accounts');
              },
            }}
            testID="account.notFound"
          />
        )}
      </View>
    );
  }

  const cloud =
    account.provider === 'google' || account.provider === 'microsoft' || account.provider === 'demo'
      ? account.provider
      : null;
  const mail = account.capabilities_granted.includes('mail_read');
  const service = common(
    `providers.${providerNameKey(account.provider, mail ? 'mail' : 'calendar')}`,
  );
  const identityProvider = common(
    `providers.${account.provider === 'microsoft' ? 'microsoft' : 'google'}`,
  );
  const missing = missingRead(account);
  const syncStates = (query.data?.syncStates ?? []).filter(
    (s) => s.connected_account_id === account.id,
  );
  const calendars = calendarsOf(query.data, account.id);

  const reconnect = () => {
    if (cloud === null) return;
    void connectCloud({
      provider: cloud,
      capability: mail ? 'mail_read' : 'calendar_read',
      returnTo: 'settings_accounts',
      reconnect: account,
    });
  };

  let statusCard = null;
  if (!statusHidden) {
    if (account.status === 'needs_reauth') {
      statusCard = (
        <ReconnectCard
          title={states('error.oauthExpired.title', { service })}
          body={
            mail
              ? states('error.oauthExpired.bodyMail', { identityProvider })
              : states('error.oauthExpired.bodyCalendar', { identityProvider })
          }
          reconnectAction={{ label: common('actions.reconnect'), onPress: reconnect }}
          laterAction={{
            label: common('actions.later'),
            onPress: () => {
              setStatusHidden(true);
            },
          }}
          testID="account.reconnect"
        />
      );
    } else if (missing !== null && cloud !== null) {
      statusCard = (
        <PermissionCard
          icon="lock_open"
          title={t('partialTitle')}
          body={missing === 'calendar_read' ? t('partialCalendar') : t('partialMail')}
          primaryAction={{
            label: common('actions.allow'),
            onPress: () => {
              void connectCloud({
                provider: cloud,
                capability: missing,
                returnTo: 'settings_accounts',
                accounts: query.data?.accounts ?? [],
              });
            },
          }}
          testID="account.partial"
        />
      );
    } else if (account.status === 'admin_consent_required') {
      statusCard = (
        <ErrorCard
          icon="admin_panel_settings"
          tone="warning"
          title={states('error.oauthExpired.adminConsent.title')}
          body={states('error.oauthExpired.adminConsent.body')}
          primaryAction={{
            label: common('actions.howTo'),
            onPress: () => {
              sheets.open(ADMIN_CONSENT_SHEET, { url: null });
            },
          }}
          testID="account.adminConsent"
        />
      );
    } else if (account.status === 'error') {
      statusCard = (
        <ErrorCard
          icon="sync_problem"
          tone="critical"
          title={t('status.error')}
          body={t('meta.error')}
          primaryAction={{
            label: common('actions.tryNow'),
            onPress: () => {
              void syncNow(account);
            },
          }}
          testID="account.error"
        />
      );
    }
  }

  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
      testID="screen.accountDetail"
    >
      {header}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenX }]}
      >
        <View style={styles.titleRow}>
          <ProviderLogo provider={account.provider} />
          <View style={styles.flex}>
            <Text variant="h2" heading>
              {service}
            </Text>
            {account.account_email === null ? null : (
              <Text variant="secondary" tone="secondary">
                {account.account_email}
              </Text>
            )}
          </View>
          <StatusPill label={t(`status.${account.status}`)} tone={statusToneOf(account.status)} />
        </View>
        <View accessibilityLiveRegion="polite">{statusCard}</View>

        <SectionHeader title={t('lastSync')} />
        <GroupedList testID="account.sync">
          {syncStates.map((state) => (
            <ListRow
              key={state.resource}
              title={t('lastSyncRow', {
                resource: t(
                  `resources.${state.resource === 'calendar' ? 'calendar' : state.resource === 'tasks' ? 'tasks' : 'mail'}`,
                ),
                time:
                  state.last_success_at === null
                    ? t('never')
                    : format.dateTime(new Date(state.last_success_at), {
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
              })}
            />
          ))}
          {cloud !== null ? (
            <ListRow
              title={common('actions.syncNow')}
              icon="sync"
              trailing={{ kind: 'chevron' }}
              onPress={() => {
                void syncNow(account);
              }}
              testID="account.syncNow"
            />
          ) : null}
        </GroupedList>

        <SectionHeader title={t('permissionsSection')} />
        <GroupedList testID="account.scopes">
          {device ? (
            <ListRow
              title={scopes('os.calendar.title')}
              subtitle={
                permission.data === 'granted'
                  ? scopes('status.granted')
                  : permission.data === 'undetermined'
                    ? scopes('status.undetermined')
                    : scopes('status.denied')
              }
              {...(permission.data === 'granted'
                ? {}
                : {
                    trailing: { kind: 'link' as const, text: common('actions.openSettings') },
                    onPress: openSystemSettings,
                  })}
            />
          ) : (
            SCOPES.filter((scope) => {
              const base = PROGRESSIVE[scope];
              return (
                account.capabilities_granted.includes(scope) ||
                (base !== undefined && account.capabilities_granted.includes(base))
              );
            }).map((scope) => (
              <ListRow
                key={scope}
                title={scopes(`scopes.${scope}`)}
                {...(account.capabilities_granted.includes(scope)
                  ? {}
                  : { subtitle: scopes('scopes.notRequested') })}
                icon={account.capabilities_granted.includes(scope) ? 'check' : 'schedule'}
                iconStyle="bare"
              />
            ))
          )}
        </GroupedList>

        {device ? null : (
          <>
            <SectionHeader title={t('dataSourceSection')} />
            <DataSourceControls account={account} />
            <Text variant="secondary" tone="tertiaryStrong">
              {t('toggleNote')}
            </Text>
          </>
        )}

        {account.capabilities_granted.includes('calendar_read') && !device ? (
          <>
            <SectionHeader title={t('calendarsSection')} />
            <CalendarsCard account={account} calendars={calendars} />
          </>
        ) : null}

        <GroupedList>
          <ListRow
            title={t('disconnect.cta')}
            icon="link_off"
            destructive
            onPress={() => {
              sheets.open(DISCONNECT_SHEET, {
                accountId: account.id,
                provider: account.provider,
                mail,
                context: 'settings',
              });
            }}
            testID="account.disconnect"
          />
        </GroupedList>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 12, paddingBottom: 40 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
});
