/**
 * M-SET-34 "Veri saklama" (`/settings/privacy/retention`) and M-SET-35 (shorten sheet): the
 * `retention_policy` (30 / 90 / 365 days / until deleted, M§41) enforced by the retention job.
 * Lengthening saves at once (queued offline); shortening first shows how many older items the next
 * cleanup deletes (RPC-19 with `p_older_than = now − new period`) and is blocked offline.
 */
import { useBootstrap } from '@da/api-client/react';
import type { RetentionPolicy } from '@da/domain';
import { formatFileSize } from '@da/i18n';
import { BottomSheet, Button, ListRow, SegmentedControl, SkeletonBlock, Text } from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { useUiPrefs } from '../../lib/ui-prefs';
import { deviceLocale } from '../../i18n/I18nProvider';
import { showToast } from '../../providers/ToastHost';
import { saveUserPreferences } from '../settings/save';
import { Caption, SettingsGroup, SettingsPage } from '../settings/ui';
import { historyPreviewQueryOptions, totalOf, useLatestExport } from './data';

export const POLICIES: readonly RetentionPolicy[] = ['d30', 'd90', 'd365', 'until_deleted'];
const DAYS: Readonly<Record<RetentionPolicy, number | null>> = {
  d30: 30,
  d90: 90,
  d365: 365,
  until_deleted: null,
};

/** Whether moving from `from` to `to` deletes older data (a shorter window). */
export function isShortening(from: RetentionPolicy, to: RetentionPolicy): boolean {
  const a = DAYS[from];
  const b = DAYS[to];
  if (b === null) return false;
  return a === null || b < a;
}

function ShortenSheet({
  from,
  to,
  onDone,
  onCancel,
}: {
  readonly from: RetentionPolicy;
  readonly to: RetentionPolicy;
  readonly onDone: () => void;
  readonly onCancel: () => void;
}) {
  const t = useTranslations();
  const days = DAYS[to] ?? 0;
  const [cutoff] = useState(() => new Date(now().getTime() - days * 86_400_000).toISOString());
  const preview = useQuery(historyPreviewQueryOptions(cutoff));
  const [saving, setSaving] = useState(false);
  const count = preview.data === undefined ? null : totalOf(preview.data);
  const body = (() => {
    if (preview.isPending) return null;
    if (count === null) return t('privacy.retentionScreen.bodyNoCount', { days });
    if (count === 0) return t('privacy.retentionScreen.nothingToDelete');
    return t('privacy.retention.shorten.body', { days, count });
  })();
  return (
    <BottomSheet
      visible
      onDismiss={onCancel}
      dismissible={!saving}
      variant="destructive"
      title={t('privacy.retention.shorten.title', { days })}
      testID="sheet.retentionShorten"
      footer={
        <View style={styles.buttons}>
          <Button
            label={count === 0 ? t('common.actions.save') : t('privacy.retention.shorten.cta')}
            variant={count === 0 ? 'ink' : 'destructive'}
            fullWidth
            loading={saving}
            disabled={preview.isPending}
            onPress={() => {
              setSaving(true);
              track('retention_changed', { from, to, confirmed: true });
              void saveUserPreferences({ retention_policy: to }).then((result) => {
                setSaving(false);
                if (result !== 'failed') onDone();
              });
            }}
            testID="retentionShorten.confirm"
          />
          <Button
            label={t('common.actions.nevermind')}
            variant="text"
            fullWidth
            disabled={saving}
            onPress={onCancel}
            testID="retentionShorten.cancel"
          />
        </View>
      }
    >
      {body === null ? (
        <SkeletonBlock width="100%" height={40} radius={8} />
      ) : (
        <Text variant="body" tone="secondary" testID="retentionShorten.body">
          {body}
        </Text>
      )}
    </BottomSheet>
  );
}

export function RetentionScreen() {
  const t = useTranslations();
  const router = useRouter();
  const online = useOnline();
  const prefs = useUiPrefs();
  const bootstrap = useBootstrap();
  const latestExport = useLatestExport();
  const [target, setTarget] = useState<RetentionPolicy | null>(null);
  const current = bootstrap.data?.preferences.retention_policy ?? 'd90';
  const size = latestExport.data?.file_size_bytes ?? null;
  const explanation = `${t('privacy.retention.explanation')} ${t('privacy.storage.canonical')}`;

  return (
    <SettingsPage
      title={t('privacy.retention.title')}
      subtitle={t('privacy.retention.subtitle')}
      testID="screen.privacy.retention"
    >
      <SegmentedControl
        semantics="radio"
        accessibilityLabel={t('privacy.retention.title')}
        options={POLICIES.map((policy) => ({
          key: policy,
          label: t(`privacy.retention.options.${policy}`),
          accessibilityLabel: `${t('privacy.retention.title')}, ${t(`privacy.retention.options.${policy}`)}`,
        }))}
        selectedKey={current}
        disabled={bootstrap.data === undefined}
        onChange={(key) => {
          const next = POLICIES.find((p) => p === key);
          if (next === undefined || next === current) return;
          if (isShortening(current, next)) {
            if (!online) {
              showToast({ message: t('states.offline.blockedReason'), kind: 'offline' });
              return;
            }
            setTarget(next);
            return;
          }
          track('retention_changed', { from: current, to: next, confirmed: false });
          void saveUserPreferences({ retention_policy: next });
        }}
        testID="retention.segments"
      />
      <Caption>{explanation}</Caption>
      <SettingsGroup>
        <ListRow
          icon="download"
          title={t('privacy.center.export')}
          trailing={
            size === null
              ? { kind: 'chevron' }
              : {
                  kind: 'value',
                  text: t('privacy.retention.exportMeta', {
                    size: formatFileSize(size, prefs.locale ?? deviceLocale()),
                  }),
                  chevron: true,
                }
          }
          onPress={() => {
            router.push('/settings/privacy/export');
          }}
          testID="retention.export"
        />
        <ListRow
          icon="delete_sweep"
          title={t('privacy.center.deleteHistory')}
          destructive
          onPress={() => {
            router.push('/settings/privacy/history');
          }}
          testID="retention.history"
        />
        <ListRow
          icon="person_remove"
          title={t('privacy.center.deleteAccount')}
          destructive
          onPress={() => {
            router.push('/settings/privacy/delete-account');
          }}
          testID="retention.deleteAccount"
        />
      </SettingsGroup>
      {target === null ? null : (
        <ShortenSheet
          from={current}
          to={target}
          onDone={() => {
            setTarget(null);
          }}
          onCancel={() => {
            setTarget(null);
          }}
        />
      )}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  buttons: { gap: 8 },
});
