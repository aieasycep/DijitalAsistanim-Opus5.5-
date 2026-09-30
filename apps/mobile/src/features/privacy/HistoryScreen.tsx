/**
 * M-SET-36 "Analiz geçmişi" (`/settings/privacy/history`) with M-SET-37 (confirmation) and M-SET-40
 * (re-auth, R-16): the counts that would be deleted (RPC-19) and what is preserved, then
 * `POST /privacy/delete-history` [IK]. The status card follows the real `data_deletion_requests`
 * row (polled every 3 s while active); "silindi" appears only when the job reports `completed`.
 * The request is blocked offline.
 */
import { isApiError, qk } from '@da/api-client';
import { deleteHistoryMutationOptions, useBootstrap } from '@da/api-client/react';
import {
  AISpinner,
  BottomSheet,
  Button,
  ErrorCard,
  SkeletonBlock,
  SuccessState,
  Text,
} from '@da/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';

import { getApiClient } from '../../lib/bootstrap';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { Caption, SettingsPage } from '../settings/ui';
import {
  historyPreviewQueryOptions,
  isDeletionActive,
  totalOf,
  useLatestHistoryDeletion,
} from './data';
import { needsReauth } from './reauth';
import { ReauthSheet } from './ReauthSheet';

/** Query roots whose content the history deletion removes. */
export const HISTORY_ROOTS = [
  qk.today.all,
  qk.insights.all,
  qk.briefings.all,
  qk.weekly.all,
  qk.assistant.all,
  qk.learned.all,
  qk.settings.counts(),
] as const;

export function HistoryScreen() {
  const t = useTranslations();
  const format = useFormatter();
  const online = useOnline();
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  const preview = useQuery(historyPreviewQueryOptions(null));
  const latest = useLatestHistoryDeletion();
  const mutation = useMutation(deleteHistoryMutationOptions(getApiClient()));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reauth, setReauth] = useState<{ notice?: string } | null>(null);
  const [key, setKey] = useState(() => Crypto.randomUUID());
  const [deleted, setDeleted] = useState<number | null>(null);
  const row = latest.data;
  const active = isDeletionActive(row);
  const previous = useRef(row?.status);

  useEffect(() => {
    const before = previous.current;
    previous.current = row?.status;
    if (before !== undefined && before !== 'completed' && row?.status === 'completed') {
      track('history_delete_completed');
      for (const root of HISTORY_ROOTS) void queryClient.invalidateQueries({ queryKey: root });
    }
  }, [row?.status, queryClient]);

  const counts = preview.data;
  const total = counts === undefined ? null : totalOf(counts);
  const retention = bootstrap.data?.preferences.retention_policy ?? 'd90';
  const days = retention === 'd30' ? 30 : retention === 'd365' ? 365 : 90;

  const submit = () => {
    mutation.mutate(
      { body: { scope: { type: 'all_analysis' }, confirm: true }, idempotencyKey: key },
      {
        onSuccess: (result) => {
          track('history_delete_requested');
          setDeleted(result.will_delete.summaries);
          setConfirmOpen(false);
          setReauth(null);
          setKey(Crypto.randomUUID());
          void queryClient.invalidateQueries({ queryKey: qk.privacy.historyLatest() });
        },
        onError: (error) => {
          if (isApiError(error) && error.code === 'REAUTH_REQUIRED') {
            setReauth({ notice: t('privacy.historyScreen.reauthExpired') });
            return;
          }
          if (isApiError(error) && error.code === 'STATE_CONFLICT') {
            setConfirmOpen(false);
            void queryClient.invalidateQueries({ queryKey: qk.privacy.historyLatest() });
            return;
          }
          showToast({ message: t('privacy.historyScreen.submitFailed'), kind: 'error' });
        },
      },
    );
  };

  const start = () => {
    void needsReauth().then((stale) => {
      if (stale) setReauth({});
      else submit();
    });
  };

  const statusCard = (() => {
    if (row === null || row === undefined) return null;
    if (isDeletionActive(row)) {
      return (
        <View style={styles.status} accessibilityLiveRegion="polite" testID="history.processing">
          <AISpinner label={t('privacy.history.processing')} />
          <Text variant="body">{t('privacy.history.processing')}</Text>
        </View>
      );
    }
    if (row.status === 'completed') {
      return (
        <SuccessState
          title={t('privacy.history.completed', {
            when: format.dateTime(new Date(row.completed_at ?? row.created_at), {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })}
          {...(deleted === null
            ? {}
            : { body: t('privacy.history.completedCount', { count: deleted }) })}
          testID="history.completed"
        />
      );
    }
    if (row.status === 'failed') {
      return (
        <ErrorCard
          icon="error"
          tone="critical"
          title={t('privacy.history.failed')}
          primaryAction={{
            label: t('common.actions.retry'),
            disabled: !online,
            onPress: () => {
              setConfirmOpen(true);
            },
          }}
          testID="history.failed"
        />
      );
    }
    return null;
  })();

  return (
    <SettingsPage
      title={t('privacy.history.title')}
      subtitle={t('privacy.history.body')}
      refreshing={latest.isRefetching}
      onRefresh={() => {
        void latest.refetch();
        void preview.refetch();
      }}
      testID="screen.privacy.history"
      footer={
        <Button
          label={t('privacy.history.cta')}
          variant="destructive"
          fullWidth
          disabled={!online || active || total === 0 || mutation.isPending}
          {...(online ? {} : { accessibilityHint: t('states.offline.blockedReason') })}
          onPress={() => {
            setConfirmOpen(true);
          }}
          testID="history.cta"
        />
      }
    >
      {statusCard}
      <View style={styles.summary} testID="history.summary">
        {counts === undefined ? (
          preview.isPending ? (
            <SkeletonBlock width="100%" height={48} radius={8} />
          ) : (
            <Text variant="body" tone="secondary">
              {t('privacy.historyScreen.willDeleteNoCount')}
            </Text>
          )
        ) : total === 0 ? (
          <Text variant="body" testID="history.empty">
            {t('privacy.historyScreen.nothing')}
          </Text>
        ) : (
          <Text variant="body" testID="history.counts">
            {t('privacy.history.willDelete', {
              summaries: counts.summaries,
              decisions: counts.priority_decisions,
              memory: counts.memory_entries,
              preferences: counts.learned_preferences,
            })}
          </Text>
        )}
        <Text variant="bodySm" tone="secondary">
          {t('privacy.history.willKeep')}
        </Text>
        <Text variant="bodySm" tone="secondary">
          {t('privacy.history.pendingCancelled')}
        </Text>
      </View>
      {online ? null : <Caption>{t('states.offline.blockedReason')}</Caption>}

      <BottomSheet
        visible={confirmOpen && reauth === null}
        onDismiss={() => {
          setConfirmOpen(false);
        }}
        dismissible={!mutation.isPending}
        variant="destructive"
        title={t('privacy.history.confirm.title')}
        testID="sheet.historyConfirm"
        footer={
          <View style={styles.buttons}>
            <Button
              label={t('privacy.history.confirm.cta')}
              variant="destructive"
              fullWidth
              loading={mutation.isPending}
              disabled={!online}
              onPress={start}
              testID="historyConfirm.delete"
            />
            <Button
              label={t('common.actions.nevermind')}
              variant="text"
              fullWidth
              disabled={mutation.isPending}
              onPress={() => {
                setConfirmOpen(false);
              }}
            />
          </View>
        }
      >
        <Text variant="body" tone="secondary">
          {retention === 'until_deleted'
            ? t('privacy.history.confirm.bodyAll')
            : t('privacy.history.confirm.body', { days })}
        </Text>
        {counts === undefined || total === 0 ? null : (
          <Text variant="bodySm">
            {t('privacy.history.willDelete', {
              summaries: counts.summaries,
              decisions: counts.priority_decisions,
              memory: counts.memory_entries,
              preferences: counts.learned_preferences,
            })}
          </Text>
        )}
        <Text variant="bodySm" tone="secondary">
          {t('privacy.history.willKeep')}
        </Text>
      </BottomSheet>
      {reauth === null ? null : (
        <ReauthSheet
          visible
          {...(reauth.notice === undefined ? {} : { notice: reauth.notice })}
          onDismiss={() => {
            setReauth(null);
          }}
          onVerified={() => {
            setReauth(null);
            submit();
          }}
        />
      )}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  summary: { gap: 8, marginTop: 8 },
  buttons: { gap: 8 },
});
