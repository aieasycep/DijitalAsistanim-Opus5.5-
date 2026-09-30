/**
 * M-SET-11 add-account chooser (sheet on `/settings/accounts`): the provider rows by group; a row
 * opens its permission explainer, which starts OAuth or the OS permission. Rows beyond the Free
 * limit show "PRO" and open the `multi_account` gate; providers without credentials in this
 * environment are disabled with the external-credential reason (plan §19).
 */
import type { BootstrapData } from '@da/validation/api/bootstrap';
import { BottomSheet, GroupedList, ListRow, SectionHeader } from '@da/ui';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { unavailableReason } from '../../../lib/bootstrap';
import { track } from '../../../lib/events';
import { registerSheet, sheets, type SheetRenderProps } from '../../../providers/SheetHost';
import { openProGate } from '../../pro-gate/ProGate';
import type { AccountRow } from '../accounts';
import {
  providerOptions,
  providesOption,
  type ProviderGroup,
  type ProviderOption,
} from '../providers';
import { INTEGRATION_EXPLAINER_SHEET } from './ExplainerSheet';

export const ADD_ACCOUNT_SHEET = 'integration_add';

export interface AddAccountParams {
  readonly accounts: readonly AccountRow[];
  readonly bootstrap: BootstrapData | undefined;
  readonly pro: boolean;
}

/** Whether connecting this option needs Pro (a second mail- or calendar-capable account, D-30). */
export function needsPro(
  option: ProviderOption,
  accounts: readonly AccountRow[],
  pro: boolean,
): boolean {
  if (pro || option.group === 'tasks') return false;
  const capability = option.capability;
  const existing = accounts.filter((a) =>
    option.group === 'calendar'
      ? a.capabilities_granted.includes('calendar_read') ||
        a.provider === 'apple_device' ||
        a.provider === 'android_device'
      : a.capabilities_granted.includes(capability),
  );
  // Adding a capability to the same provider's account is an upgrade, not a second account.
  return existing.length >= 1 && !accounts.some((a) => a.provider === option.provider);
}

/** Opens the explainer for an option (settings context). */
export function openOptionExplainer(option: ProviderOption, accounts: readonly AccountRow[]): void {
  if (option.group === 'calendar') {
    sheets.open(INTEGRATION_EXPLAINER_SHEET, {
      kind: 'calendar',
      chip: option.chip ?? 'google',
      returnTo: 'settings_accounts',
      accounts,
    });
    return;
  }
  const provider = option.provider === 'microsoft' ? 'microsoft' : 'google';
  sheets.open(INTEGRATION_EXPLAINER_SHEET, {
    kind: option.group,
    provider,
    returnTo: 'settings_accounts',
    accounts,
  });
}

const GROUPS: readonly ProviderGroup[] = ['mail', 'calendar', 'tasks'];

function AddAccountSheet({
  params,
  visible,
  onDismiss,
  onHidden,
}: SheetRenderProps<AddAccountParams>) {
  const t = useTranslations('settings.accounts');
  const common = useTranslations('common');
  const options = providerOptions();
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={t('addAccount')}
      testID="sheet.addAccount"
    >
      <View style={styles.body}>
        {GROUPS.map((group) => (
          <View key={group} style={styles.group}>
            <SectionHeader title={t(`groups.${group}`)} />
            <GroupedList>
              {options
                .filter((o) => o.group === group)
                .map((option) => {
                  const connected = params.accounts.some((a) => providesOption(a, option));
                  const locked = needsPro(option, params.accounts, params.pro);
                  const configured =
                    (option.provider !== 'google' && option.provider !== 'microsoft') ||
                    unavailableReason(params.bootstrap, `integrations.${option.provider}`) === null;
                  return (
                    <ListRow
                      key={option.key}
                      title={common(`providers.${option.key}`)}
                      {...(connected ? { subtitle: t('status.healthy') } : {})}
                      trailing={
                        connected
                          ? { kind: 'check', checked: true }
                          : locked
                            ? { kind: 'value', text: common('badges.pro') }
                            : { kind: 'link', text: common('actions.connect') }
                      }
                      disabled={connected || !configured}
                      {...(configured ? {} : { disabledReason: t('notConfigured') })}
                      onPress={() => {
                        if (locked) {
                          openProGate('multi_account');
                          return;
                        }
                        onDismiss();
                        openOptionExplainer(option, params.accounts);
                      }}
                      testID={`addAccount.${option.key}`}
                    />
                  );
                })}
            </GroupedList>
          </View>
        ))}
      </View>
    </BottomSheet>
  );
}

registerSheet<AddAccountParams>(ADD_ACCOUNT_SHEET, (props) => <AddAccountSheet {...props} />);

/** Opens the chooser. */
export function openAddAccount(params: AddAccountParams): void {
  track('sheet_opened', { key: 'account' });
  sheets.open(ADD_ACCOUNT_SHEET, params);
}

const styles = StyleSheet.create({ body: { gap: 16 }, group: { gap: 8 } });
