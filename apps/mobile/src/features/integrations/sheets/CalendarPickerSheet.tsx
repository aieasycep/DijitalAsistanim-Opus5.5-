/**
 * M-ON-07P calendar picker (sheet(host) `calendar_picker`): which sub-calendars feed briefings and
 * Plan. Cloud accounts save through `PATCH /integrations/:accountId/data-sources {calendars,
 * expected_updated_at}` (402 → `multi_account` gate); device calendars keep the selection locally
 * and upload a snapshot of only the selected ones. Free users keep one selected calendar (D-30):
 * switching on a second reverts the switch and opens the gate. Close = discard.
 */
import { isApiError, qk } from '@da/api-client';
import { BottomSheet, Button, EmptyState, GroupedList, InlineErrorCard, ListRow } from '@da/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { getApiClient } from '../../../lib/bootstrap';
import { track } from '../../../lib/events';
import { entitlementFeatureOf } from '../../../lib/postgrest';
import { isOffline } from '../../../lib/query/online-manager';
import { registerSheet, type SheetRenderProps } from '../../../providers/SheetHost';
import { showToast } from '../../../providers/ToastHost';
import { isPro, openProGate } from '../../pro-gate/ProGate';
import { calendarsOf, useAccounts } from '../accounts';
import {
  defaultSelection,
  listDeviceCalendars,
  saveSelection,
  savedSelection,
  uploadDeviceSnapshot,
} from '../device-calendar';
import { ListSkeleton } from '../../common/ListSkeleton';

export const CALENDAR_PICKER_SHEET = 'calendar_picker';

export type CalendarPickerParams =
  { readonly kind: 'device' } | { readonly kind: 'cloud'; readonly accountId: string };

interface PickerRow {
  readonly id: string;
  readonly name: string;
  readonly meta?: string;
}

function CalendarPickerSheet({
  params,
  visible,
  onDismiss,
  onHidden,
}: SheetRenderProps<CalendarPickerParams>) {
  const t = useTranslations('onboarding.calendar.picker');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const accounts = useAccounts({ enabled: params.kind === 'cloud' });
  const device = useQuery({
    queryKey: ['device-calendars'],
    queryFn: listDeviceCalendars,
    enabled: params.kind === 'device',
    gcTime: 0,
  });
  const pro = isPro();

  const cloudRows = params.kind === 'cloud' ? calendarsOf(accounts.data, params.accountId) : [];
  const rows: readonly PickerRow[] =
    params.kind === 'cloud'
      ? cloudRows.map((c) => ({ id: c.id, name: c.name }))
      : (device.data ?? []).map((c) => ({ id: c.id, name: c.title, meta: c.sourceTitle }));
  const initial: readonly string[] =
    params.kind === 'cloud'
      ? cloudRows.filter((c) => c.selected).map((c) => c.id)
      : (savedSelection() ?? defaultSelection(device.data ?? [], pro));
  const [draft, setDraft] = useState<readonly string[] | null>(null);
  const selected = draft ?? initial;
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const loading = params.kind === 'cloud' ? accounts.isPending : device.isPending;

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      setDraft(selected.filter((s) => s !== id));
      return;
    }
    if (!pro && selected.length >= 1) {
      openProGate('multi_account');
      return;
    }
    setDraft([...selected, id]);
  };

  const save = async () => {
    setSaving(true);
    setFailed(false);
    try {
      if (params.kind === 'device') {
        saveSelection(selected);
        if (isOffline()) {
          showToast({ message: t('offlineQueued'), kind: 'offline' });
        } else {
          await uploadDeviceSnapshot();
        }
      } else {
        const account = accounts.data?.accounts.find((a) => a.id === params.accountId);
        if (account === undefined) return;
        await getApiClient().call('PATCH /integrations/:accountId/data-sources', {
          params: { accountId: account.id },
          body: {
            calendars: rows.map((row) => ({
              calendar_id: row.id,
              selected: selected.includes(row.id),
            })),
            expected_updated_at: account.updated_at,
          },
        });
      }
      track('calendar_picker_saved', {
        selected_count: selected.length,
        total_count: rows.length,
        source: params.kind === 'cloud' ? 'cloud' : 'device',
      });
      void queryClient.invalidateQueries({ queryKey: qk.integrations.all });
      void queryClient.invalidateQueries({ queryKey: qk.me.bootstrap() });
      onDismiss();
    } catch (error) {
      if (entitlementFeatureOf(error) !== null) {
        openProGate('multi_account');
      } else if (isApiError(error) && error.code === 'STATE_CONFLICT') {
        void queryClient.invalidateQueries({ queryKey: qk.integrations.all });
        setFailed(true);
      } else {
        setFailed(true);
      }
    } finally {
      setSaving(false);
    }
  };

  let body;
  if (loading) {
    body = <ListSkeleton rows={3} accessibilityLabel={common('a11y.loading')} />;
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon="calendar_today"
        tone="neutral"
        title={t('empty')}
        action={{ label: common('actions.close'), onPress: onDismiss }}
        testID="calendarPicker.empty"
      />
    );
  } else {
    body = (
      <GroupedList testID="calendarPicker.list">
        {rows.map((row) => (
          <ListRow
            key={row.id}
            title={row.name}
            {...(row.meta === undefined ? {} : { subtitle: row.meta })}
            icon="calendar_today"
            trailing={{ kind: 'switch', value: selected.includes(row.id) }}
            onPress={() => {
              toggle(row.id);
            }}
            testID={`calendarPicker.row.${row.id}`}
          />
        ))}
      </GroupedList>
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={t('title')}
      subtitle={t('body')}
      dismissible={!saving}
      testID="sheet.calendarPicker"
      footer={
        rows.length === 0 ? undefined : (
          <View style={styles.footer}>
            {failed ? (
              <InlineErrorCard
                icon="error"
                tone="critical"
                title={common('toast.saveFailed')}
                primaryAction={{
                  label: common('actions.retry'),
                  onPress: () => {
                    void save();
                  },
                }}
                testID="calendarPicker.error"
              />
            ) : null}
            <Button
              label={common('actions.save')}
              fullWidth
              loading={saving}
              onPress={() => {
                void save();
              }}
              testID="calendarPicker.save"
            />
          </View>
        )
      }
    >
      {body}
    </BottomSheet>
  );
}

registerSheet<CalendarPickerParams>(
  CALENDAR_PICKER_SHEET,
  (props) => <CalendarPickerSheet {...props} />,
  { analyticsKey: 'calendar_picker' },
);

const styles = StyleSheet.create({ footer: { gap: 8 } });
