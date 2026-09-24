/**
 * M-ON-06A connected account sheet (sheet(host) `integration_account`): what a connection can
 * read, calendar selection for calendar accounts, and removal (M§76) through the disconnect
 * confirmation. Opened from the "Bağlandı" pill on the onboarding connect steps.
 */
import type { Capability } from '@da/domain/enums';
import { BottomSheet, GroupedList, ListRow, SectionHeader } from '@da/ui';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { registerSheet, sheets, type SheetRenderProps } from '../../../providers/SheetHost';
import { useAccounts } from '../accounts';
import { CALENDAR_PICKER_SHEET } from './CalendarPickerSheet';
import { DISCONNECT_SHEET } from './DisconnectSheet';

export const INTEGRATION_ACCOUNT_SHEET = 'integration_account';

export interface AccountSheetParams {
  readonly accountId: string;
}

const SCOPE_KEYS: readonly Capability[] = [
  'mail_read',
  'mail_send',
  'calendar_read',
  'calendar_write',
  'tasks_read',
  'tasks_write',
];

function AccountSheet({
  params,
  visible,
  onDismiss,
  onHidden,
}: SheetRenderProps<AccountSheetParams>) {
  const t = useTranslations('onboarding.account');
  const scopes = useTranslations('privacy.permissions.scopes');
  const disconnect = useTranslations('settings.accounts.disconnect');
  const { data } = useAccounts();
  const account = data?.accounts.find((a) => a.id === params.accountId);
  if (account === undefined) {
    return <BottomSheet visible={visible} onDismiss={onDismiss} onHidden={onHidden} />;
  }
  const calendar =
    account.capabilities_granted.includes('calendar_read') ||
    account.provider === 'apple_device' ||
    account.provider === 'android_device';
  const granted = SCOPE_KEYS.filter((key) => account.capabilities_granted.includes(key));
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={account.account_email ?? account.display_label ?? ''}
      testID="sheet.integrationAccount"
    >
      <View style={styles.body}>
        <SectionHeader title={t('access')} />
        <GroupedList>
          {granted.map((key) => (
            <ListRow key={key} title={scopes(key)} icon="check" iconStyle="bare" />
          ))}
        </GroupedList>
        <GroupedList>
          {calendar ? (
            <ListRow
              title={t('chooseCalendars')}
              icon="calendar_today"
              trailing={{ kind: 'chevron' }}
              onPress={() => {
                sheets.open(
                  CALENDAR_PICKER_SHEET,
                  account.provider === 'apple_device' || account.provider === 'android_device'
                    ? { kind: 'device' }
                    : { kind: 'cloud', accountId: account.id },
                );
              }}
              testID="account.calendars"
            />
          ) : null}
          <ListRow
            title={disconnect('cta')}
            icon="link_off"
            destructive
            onPress={() => {
              onDismiss();
              sheets.open(DISCONNECT_SHEET, {
                accountId: account.id,
                provider: account.provider,
                mail: account.capabilities_granted.includes('mail_read'),
                context: 'onboarding',
              });
            }}
            testID="account.disconnect"
          />
        </GroupedList>
      </View>
    </BottomSheet>
  );
}

registerSheet<AccountSheetParams>(
  INTEGRATION_ACCOUNT_SHEET,
  (props) => <AccountSheet {...props} />,
  {
    analyticsKey: 'account',
  },
);

const styles = StyleSheet.create({ body: { gap: 12 } });
