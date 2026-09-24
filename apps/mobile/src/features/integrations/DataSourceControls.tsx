/**
 * Per-account Data Source Controls (M-ON-08, M-SET-12 "VERİ KAYNAĞI KONTROLLERİ", SREQ-68):
 * switches for the canonical `data_source_toggles` keys of the capabilities the account granted,
 * saved with `PATCH /integrations/:accountId/data-sources {data_sources, expected_updated_at}`
 * (optimistic; reverted with a toast on failure; a `409 STATE_CONFLICT` refetches and re-applies
 * once). Turning mail analysis off asks for confirmation. Sending mail and creating tasks have no
 * switch: every such write needs its own approval (M§33).
 */
import { isApiError, qk } from '@da/api-client';
import type { DataSourceToggles } from '@da/validation/api/common';
import { ConfirmDialog, GroupedList, ListRow } from '@da/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

import { getApiClient } from '../../lib/bootstrap';
import { track } from '../../lib/events';
import { showToast } from '../../providers/ToastHost';
import { fetchAccounts, type AccountRow } from './accounts';

type ToggleKey = keyof DataSourceToggles;

const MAIL_KEYS: readonly ToggleKey[] = [
  'mail_read',
  'attachments_analyze',
  'deadline_detect',
  'draft_replies',
];
const CALENDAR_KEYS: readonly ToggleKey[] = [
  'calendar_read',
  'schedule_suggest',
  'calendar_write_with_approval',
];
const TASK_KEYS: readonly ToggleKey[] = ['tasks_read'];

export function toggleKeysOf(account: AccountRow): readonly ToggleKey[] {
  const granted = account.capabilities_granted;
  return [
    ...(granted.includes('mail_read') ? MAIL_KEYS : []),
    ...(granted.includes('calendar_read') ? CALENDAR_KEYS : []),
    ...(granted.includes('tasks_read') ? TASK_KEYS : []),
  ];
}

async function patch(accountId: string, key: ToggleKey, value: boolean, expected: string) {
  return getApiClient().call('PATCH /integrations/:accountId/data-sources', {
    params: { accountId },
    body: { data_sources: { [key]: value }, expected_updated_at: expected },
  });
}

export interface DataSourceControlsProps {
  readonly account: AccountRow;
  readonly testID?: string;
}

export function DataSourceControls({ account, testID }: DataSourceControlsProps) {
  const t = useTranslations('settings.accounts');
  const onb = useTranslations('onboarding.permissions');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const [overrides, setOverrides] = useState<Partial<Record<ToggleKey, boolean>>>({});
  const [pending, setPending] = useState<ToggleKey | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const valueOf = (key: ToggleKey): boolean => overrides[key] ?? account.data_source_toggles[key];

  const apply = async (key: ToggleKey, value: boolean) => {
    setOverrides((current) => ({ ...current, [key]: value }));
    setPending(key);
    try {
      try {
        await patch(account.id, key, value, account.updated_at);
      } catch (error) {
        if (!isApiError(error) || error.code !== 'STATE_CONFLICT') throw error;
        const fresh = (await fetchAccounts()).accounts.find((a) => a.id === account.id);
        if (fresh === undefined) throw error;
        await patch(account.id, key, value, fresh.updated_at);
      }
      track('data_source_toggled', { toggle: key, value, key, enabled: value });
      void queryClient.invalidateQueries({ queryKey: qk.integrations.all });
    } catch {
      setOverrides((current) => ({ ...current, [key]: !value }));
      showToast({ message: common('toast.saveFailed'), kind: 'error' });
    } finally {
      setPending(null);
    }
  };

  const keys = toggleKeysOf(account);
  if (keys.length === 0) return null;
  return (
    <>
      <GroupedList testID={testID ?? `dataSources.${account.id}`}>
        {keys.map((key) => (
          <ListRow
            key={key}
            title={t(`toggles.${key}`)}
            trailing={{ kind: 'switch', value: valueOf(key) }}
            disabled={pending === key}
            onPress={() => {
              const next = !valueOf(key);
              if (key === 'mail_read' && !next) {
                setConfirmOff(true);
                return;
              }
              void apply(key, next);
            }}
            accessibilityLabel={t(`toggles.${key}`)}
            testID={`dataSources.${account.id}.${key}`}
          />
        ))}
      </GroupedList>
      <ConfirmDialog
        visible={confirmOff}
        title={onb('mailOffTitle')}
        body={onb('mailOffBody')}
        confirm={{
          label: common('actions.turnOff'),
          onPress: () => {
            setConfirmOff(false);
            void apply('mail_read', false);
          },
        }}
        cancel={{
          label: common('actions.nevermind'),
          onPress: () => {
            setConfirmOff(false);
          },
        }}
        testID="dataSources.confirmMailOff"
      />
    </>
  );
}
