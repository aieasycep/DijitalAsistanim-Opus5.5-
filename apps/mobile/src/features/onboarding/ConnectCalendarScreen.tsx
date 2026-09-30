/**
 * M-ON-07 connect calendar (step 1 · TAKVİM): Google Takvim, Outlook Takvim, then Apple Takvim on
 * iOS or "Cihaz takvimi" on Android (C-35). Cloud calendars reuse the provider's mail account with
 * an incremental upgrade when it exists (API-INT-02), otherwise `/start`; device calendars ask the
 * OS only after the explainer, then pick calendars and upload a snapshot. "Devam" needs any
 * connected source (D-03); skipping with none sets the zero-source path (C-17).
 */
import type { Provider } from '@da/domain/enums';
import { useBootstrap } from '@da/api-client/react';
import { Button, TrustLine } from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { useTranslations } from 'use-intl';

import { unavailableReason } from '../../lib/bootstrap';
import { sheets } from '../../providers/SheetHost';
import { isPro, openProGate } from '../pro-gate/ProGate';
import {
  calendarAccounts,
  calendarsOf,
  mailAccounts,
  useAccounts,
  type AccountRow,
} from '../integrations/accounts';
import { devicePermission, deviceProvider } from '../integrations/device-calendar';
import { INTEGRATION_ACCOUNT_SHEET } from '../integrations/sheets/AccountSheet';
import { ADMIN_CONSENT_SHEET } from '../integrations/sheets/AdminConsentSheet';
import { CALENDAR_DENIED_SHEET } from '../integrations/sheets/CalendarDeniedSheet';
import { CALENDAR_PICKER_SHEET } from '../integrations/sheets/CalendarPickerSheet';
import {
  INTEGRATION_EXPLAINER_SHEET,
  type CalendarChip,
} from '../integrations/sheets/ExplainerSheet';
import type { OnboardingPill } from '../integrations/status';
import { ConnectRow } from './ConnectRow';
import { OnboardingFrame } from './OnboardingFrame';
import { enterStep, nextStep, routeOf, skipStep, stepContext } from './steps';
import { updateOnboardingState } from './store';
import { ListSkeleton } from '../common/ListSkeleton';

interface Row {
  readonly chip: CalendarChip;
  readonly provider: Provider;
}

function rowsForPlatform(demo: boolean): readonly Row[] {
  const device: Row =
    Platform.OS === 'ios'
      ? { chip: 'apple', provider: 'apple_device' }
      : { chip: 'device', provider: 'android_device' };
  return [
    { chip: 'google', provider: 'google' },
    { chip: 'microsoft', provider: 'microsoft' },
    device,
    ...(demo ? [{ chip: 'google' as const, provider: 'demo' as const }] : []),
  ];
}

export function ConnectCalendarScreen() {
  const t = useTranslations('onboarding');
  const common = useTranslations('common');
  const router = useRouter();
  const bootstrap = useBootstrap();
  const accountsQuery = useAccounts();
  const permission = useQuery({
    queryKey: ['device-calendar-permission'],
    queryFn: devicePermission,
  });
  const accounts = accountsQuery.data?.accounts ?? [];
  const connectedCount = accounts.filter(
    (a) => a.status !== 'connecting' && a.status !== 'error' && a.status !== 'disconnected',
  ).length;
  const calendarConnected = calendarAccounts(accountsQuery.data).length;

  useEffect(() => {
    enterStep('connect_calendar');
    // The permission may change in Settings; re-check when the app becomes active.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void permission.refetch();
    });
    return () => {
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accountFor = (row: Row): AccountRow | undefined =>
    row.provider === 'apple_device' || row.provider === 'android_device'
      ? accounts.find((a) => a.provider === row.provider)
      : accounts.find(
          (a) =>
            a.provider === row.provider &&
            (a.capabilities_granted.includes('calendar_read') || a.status === 'connecting'),
        );

  const onAction = (row: Row, account: AccountRow | undefined, pill: OnboardingPill) => {
    const device = row.provider === 'apple_device' || row.provider === 'android_device';
    if (pill === 'connected' && account !== undefined) {
      sheets.open(INTEGRATION_ACCOUNT_SHEET, { accountId: account.id });
      return;
    }
    if (pill === 'adminConsent') {
      sheets.open(ADMIN_CONSENT_SHEET, { url: null });
      return;
    }
    if (pill === 'connect' && !isPro() && calendarConnected >= 1) {
      openProGate('multi_account');
      return;
    }
    if (device && permission.data === 'blocked') {
      sheets.open(CALENDAR_DENIED_SHEET, { blocked: true });
      return;
    }
    sheets.open(INTEGRATION_EXPLAINER_SHEET, {
      kind: 'calendar',
      chip: row.chip,
      returnTo: 'onboarding',
      accounts,
      ...(account !== undefined && (pill === 'reauth' || pill === 'retry')
        ? { reconnect: account }
        : {}),
    });
  };

  const metaFor = (row: Row, account: AccountRow | undefined): string | undefined => {
    if (account === undefined) {
      if (row.provider === 'apple_device') return t('calendar.appleMeta');
      if (row.provider === 'android_device') return t('calendar.deviceMeta');
      return undefined;
    }
    const calendars = calendarsOf(accountsQuery.data, account.id).filter((c) => c.selected);
    if (calendars.length === 0) return account.account_email ?? undefined;
    return t('calendar.pickedMeta', {
      count: calendars.length,
      names: calendars.map((c) => c.name).join(', '),
    });
  };

  const continueTo = (skipped: boolean) => {
    const none = connectedCount === 0;
    if (skipped) skipStep('connect_calendar');
    updateOnboardingState({ skippedAllSources: none });
    const next = nextStep('connect_calendar', {
      ...stepContext(mailAccounts(accountsQuery.data).length > 0),
      skippedAllSources: none,
    });
    router.push(next === 'done' ? '/today' : routeOf(next));
  };

  const deviceRowDenied = (row: Row) =>
    (row.provider === 'apple_device' || row.provider === 'android_device') &&
    (permission.data === 'denied' || permission.data === 'blocked');

  return (
    <OnboardingFrame
      kicker={t('steps.calendar')}
      title={t('calendar.title')}
      subtitle={t('calendar.body')}
      onBack={() => {
        router.back();
      }}
      testID="onboarding.connectCalendar"
      footer={
        <>
          <Button
            label={
              connectedCount > 0
                ? t('connect.cta', { count: connectedCount })
                : t('calendar.ctaNone')
            }
            fullWidth
            disabled={connectedCount === 0}
            onPress={() => {
              continueTo(false);
            }}
            testID="connectCalendar.continue"
          />
          <Button
            label={common('actions.skipForNow')}
            variant="text"
            fullWidth
            onPress={() => {
              continueTo(true);
            }}
            testID="connectCalendar.skip"
          />
        </>
      }
    >
      {accountsQuery.isPending ? (
        <ListSkeleton rows={3} accessibilityLabel={common('a11y.loading')} />
      ) : (
        rowsForPlatform(bootstrap.data?.demo_mode === true).map((row) => {
          const account = accountFor(row);
          const meta = metaFor(row, account);
          const name =
            row.provider === 'demo'
              ? common('providers.demo')
              : common(
                  `providers.${row.chip === 'google' ? 'googleCalendar' : row.chip === 'microsoft' ? 'outlookCalendar' : row.chip === 'apple' ? 'appleCalendar' : 'deviceCalendar'}`,
                );
          return (
            <ConnectRow
              key={row.provider}
              provider={row.provider}
              name={name}
              status={account?.status ?? null}
              {...(deviceRowDenied(row) && account === undefined
                ? { meta: t('calendar.deniedMeta') }
                : meta === undefined
                  ? {}
                  : { meta })}
              notConfigured={
                (row.provider === 'google' || row.provider === 'microsoft') &&
                unavailableReason(bootstrap.data, `integrations.${row.provider}`) !== null
              }
              onAction={(pill) => {
                onAction(row, account, pill);
              }}
              testID={`connectCalendar.row.${row.provider}`}
            />
          );
        })
      )}
      {accounts.some((a) => a.provider === deviceProvider()) ? (
        <Button
          label={t('calendar.chooseDevice')}
          variant="text"
          onPress={() => {
            sheets.open(CALENDAR_PICKER_SHEET, { kind: 'device' });
          }}
          testID="connectCalendar.pickDevice"
        />
      ) : null}
      <TrustLine text={t('explainer.trustCalendar')} />
    </OnboardingFrame>
  );
}
