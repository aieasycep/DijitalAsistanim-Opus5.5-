/**
 * M-BR-04C "Yarına Hazırım" confirmation + success (sheet(host) `evening_ready`): the M§11
 * confirmation step. The switches choose which open items move to tomorrow's morning briefing; the
 * quiet switch (hidden when notifications are off) silences non-critical notifications until the
 * morning. `POST /briefings/:id/evening-ready {carry_over_item_ids, confirm}` with the
 * `evening_ready:{briefing}` idempotency key; a repeat is safe. Quiet mode is the owner-scoped
 * `notification_preferences.snooze_until = next_morning_at`.
 */
import { qk } from '@da/api-client';
import {
  BottomSheet,
  Button,
  GroupedList,
  InlineErrorCard,
  ListRow,
  SectionHeader,
  SuccessState,
  Text,
} from '@da/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { getApiClient } from '../../lib/bootstrap';
import { track } from '../../lib/events';
import { intentKey } from '../../lib/idempotency';
import { cachedBootstrap, updateNotificationPreferences } from '../../lib/postgrest';
import { useOnline } from '../../lib/query/online-manager';
import { registerSheet, type SheetRenderProps } from '../../providers/SheetHost';
import { currentNotificationPermission } from '../onboarding/push';
import type { BriefingItem } from './data';

export const EVENING_READY_SHEET = 'evening_ready';

export interface EveningReadyParams {
  readonly briefingId: string;
  readonly items: readonly BriefingItem[];
}

function EveningReadySheet({
  params,
  visible,
  onDismiss,
  onHidden,
}: SheetRenderProps<EveningReadyParams>) {
  const t = useTranslations('briefing.eveningReady');
  const common = useTranslations('common');
  const online = useOnline();
  const queryClient = useQueryClient();
  const [excluded, setExcluded] = useState<readonly string[]>([]);
  const [quiet, setQuiet] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<{ carried: number } | null>(null);
  const permission = useQuery({
    queryKey: ['notification-permission'],
    queryFn: currentNotificationPermission,
  });
  const notificationsOn = permission.data === 'granted';
  const morning = cachedBootstrap()?.preferences.morning_time.slice(0, 5) ?? '08:00';
  const included = params.items.filter((i) => !excluded.includes(i.id));

  const confirm = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const response = await getApiClient().call(
        'POST /briefings/:id/evening-ready',
        {
          params: { id: params.briefingId },
          body: { confirm: true, carry_over_item_ids: included.map((i) => i.id) },
        },
        { idempotencyKey: await intentKey(`evening_ready:${params.briefingId}`) },
      );
      const quietOn = quiet && notificationsOn;
      if (quietOn) {
        void updateNotificationPreferences({ snooze_until: response.data.next_morning_at }).catch(
          () => undefined,
        );
      }
      track('evening_ready_confirmed', {
        carried_count: response.data.carried,
        excluded_count: excluded.length,
        quiet: quietOn,
      });
      void queryClient.invalidateQueries({ queryKey: qk.briefings.detail(params.briefingId) });
      void queryClient.invalidateQueries({ queryKey: qk.today.all });
      setDone({ carried: response.data.carried });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (done !== null) {
    return (
      <BottomSheet
        visible={visible}
        onDismiss={onDismiss}
        onHidden={onHidden}
        testID="sheet.eveningReady"
      >
        <SuccessState
          title={t('successTitle')}
          body={t('successBody', { count: done.carried })}
          action={{
            label: common('actions.backToToday'),
            onPress: () => {
              onDismiss();
              router.replace('/today');
            },
          }}
          testID="eveningReady.success"
        />
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={params.items.length === 0 ? t('titleZero') : t('title')}
      subtitle={t('subtitle')}
      dismissible={!busy}
      testID="sheet.eveningReady"
      footer={
        <View style={styles.footer}>
          {failed ? (
            <InlineErrorCard
              icon="error"
              tone="critical"
              title={common('toast.saveFailed')}
              testID="eveningReady.error"
            />
          ) : null}
          <Button
            label={t('cta')}
            icon="bedtime"
            fullWidth
            loading={busy}
            disabled={!online}
            onPress={() => {
              void confirm();
            }}
            testID="eveningReady.confirm"
          />
          <Button
            label={common('actions.nevermind')}
            variant="text"
            fullWidth
            onPress={onDismiss}
            testID="eveningReady.cancel"
          />
        </View>
      }
    >
      <View style={styles.body}>
        {params.items.length === 0 ? null : (
          <>
            <SectionHeader title={t('section')} count={String(included.length)} />
            <GroupedList testID="eveningReady.items">
              {params.items.map((item) => (
                <ListRow
                  key={item.id}
                  title={item.title}
                  trailing={{ kind: 'switch', value: !excluded.includes(item.id) }}
                  disabled={busy}
                  onPress={() => {
                    setExcluded((current) =>
                      current.includes(item.id)
                        ? current.filter((id) => id !== item.id)
                        : [...current, item.id],
                    );
                  }}
                  testID={`eveningReady.item.${item.id}`}
                />
              ))}
            </GroupedList>
          </>
        )}
        {notificationsOn ? (
          <GroupedList>
            <ListRow
              title={t('quiet')}
              subtitle={t('quietMeta')}
              trailing={{ kind: 'switch', value: quiet }}
              disabled={busy}
              onPress={() => {
                setQuiet((value) => !value);
              }}
              testID="eveningReady.quiet"
            />
          </GroupedList>
        ) : null}
        <Text variant="secondary" tone="secondary">
          {t('echo', { time: morning, time_loc: morning })}
        </Text>
        {!online ? (
          <Text variant="secondary" tone="tertiaryStrong">
            {t('offline')}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}

registerSheet<EveningReadyParams>(EVENING_READY_SHEET, (props) => <EveningReadySheet {...props} />);

const styles = StyleSheet.create({ footer: { gap: 8 }, body: { gap: 12 } });
