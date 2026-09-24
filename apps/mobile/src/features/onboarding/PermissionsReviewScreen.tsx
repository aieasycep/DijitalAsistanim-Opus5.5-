/**
 * M-ON-08 permissions review (step 1 · İZİNLER, C-01 step 8): what each connection can read in
 * plain language, the per-account Data Source Controls (enforced server-side), the device
 * calendar permission with a real Settings handoff, and the R-15 storage promise.
 */
import {
  AssuranceBox,
  Button,
  EmptyState,
  ListRow,
  GroupedList,
  SectionHeader,
  Text,
} from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { DataSourceControls } from '../integrations/DataSourceControls';
import { mailAccounts, useAccounts } from '../integrations/accounts';
import {
  devicePermission,
  openSystemSettings,
  requestDevicePermission,
} from '../integrations/device-calendar';
import { OnboardingFrame } from './OnboardingFrame';
import { enterStep, nextStep, routeOf, stepContext } from './steps';

export function PermissionsReviewScreen() {
  const t = useTranslations('onboarding.permissions');
  const onb = useTranslations('onboarding');
  const privacy = useTranslations('privacy');
  const common = useTranslations('common');
  const router = useRouter();
  const accountsQuery = useAccounts();
  const permission = useQuery({
    queryKey: ['device-calendar-permission'],
    queryFn: devicePermission,
  });
  const accounts = (accountsQuery.data?.accounts ?? []).filter(
    (a) => a.provider !== 'apple_device' && a.provider !== 'android_device',
  );

  useEffect(() => {
    enterStep('permissions');
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void permission.refetch();
    });
    return () => {
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = permission.data ?? 'undetermined';
  const calendarRow =
    status === 'granted' ? (
      <ListRow
        title={privacy('permissions.os.calendar.title')}
        trailing={{ kind: 'value', text: privacy('permissions.status.granted') }}
        testID="permissions.calendar"
      />
    ) : status === 'undetermined' ? (
      <ListRow
        title={privacy('permissions.os.calendar.title')}
        subtitle={privacy('permissions.status.undetermined')}
        trailing={{ kind: 'link', text: common('actions.allow') }}
        onPress={() => {
          void requestDevicePermission().then((next) => {
            track('calendar_os_permission_result', {
              status: next === 'granted' ? 'granted' : next === 'blocked' ? 'blocked' : 'denied',
            });
            void permission.refetch();
          });
        }}
        testID="permissions.calendar"
      />
    ) : (
      <ListRow
        title={privacy('permissions.os.calendar.title')}
        subtitle={privacy('permissions.status.denied')}
        trailing={{ kind: 'link', text: common('actions.openSettings') }}
        onPress={openSystemSettings}
        testID="permissions.calendar"
      />
    );

  return (
    <OnboardingFrame
      kicker={onb('steps.permissions')}
      title={t('reviewTitle')}
      subtitle={t('reviewBody')}
      onBack={() => {
        router.back();
      }}
      testID="onboarding.permissions"
      footer={
        <Button
          label={common('actions.continue')}
          fullWidth
          onPress={() => {
            const next = nextStep(
              'permissions',
              stepContext(mailAccounts(accountsQuery.data).length > 0),
            );
            router.push(next === 'done' ? '/today' : routeOf(next));
          }}
          testID="permissions.continue"
        />
      }
    >
      <SectionHeader title={t('accountsSection')} />
      {accounts.length === 0 ? (
        <EmptyState
          icon="link_off"
          tone="neutral"
          title={t('noAccounts')}
          testID="permissions.empty"
        />
      ) : (
        accounts.map((account) => (
          <DataSourceControlsBlock
            key={account.id}
            email={account.account_email}
            account={account}
          />
        ))
      )}
      <GroupedList>
        <ListRow title={t('sendInfo')} icon="outgoing_mail" iconStyle="bare" />
        <ListRow title={t('writeInfo')} icon="edit_calendar" iconStyle="bare" />
      </GroupedList>
      <SectionHeader title={t('deviceSection')} />
      <GroupedList>{calendarRow}</GroupedList>
      <AssuranceBox
        rows={[
          { key: 'send', icon: 'verified_user', text: onb('explainer.trustSend') },
          { key: 'calendar', icon: 'event_available', text: onb('explainer.trustCalendar') },
          { key: 'training', icon: 'psychology', text: privacy('promises.trainingLong') },
          { key: 'storage', icon: 'shield', text: privacy('storage.canonical') },
        ]}
        testID="permissions.assurance"
      />
    </OnboardingFrame>
  );
}

function DataSourceControlsBlock({
  email,
  account,
}: {
  readonly email: string | null;
  readonly account: Parameters<typeof DataSourceControls>[0]['account'];
}) {
  return (
    <>
      {email === null ? null : (
        <Text variant="kicker" tone="tertiaryStrong">
          {email}
        </Text>
      )}
      <DataSourceControls account={account} />
    </>
  );
}
