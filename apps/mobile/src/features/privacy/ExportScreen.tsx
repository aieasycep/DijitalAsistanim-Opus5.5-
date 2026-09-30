/**
 * M-SET-38 "Verilerimi dışa aktar" (`/settings/privacy/export`): `POST /privacy/export` [IK] queues
 * a ZIP of JSON files; the status card follows the real `data_export_requests` row (polled every
 * 5 s while it is prepared); "İndir" mints a fresh 300 s signed URL per tap
 * (`POST /privacy/export/:id/download`), downloads it to the cache with progress and hands it to the
 * system share/save sheet. Request and download are blocked offline.
 */
import { isApiError, qk } from '@da/api-client';
import {
  exportDownloadMutationOptions,
  privacyExportMutationOptions,
  useBootstrap,
} from '@da/api-client/react';
import { formatFileSize } from '@da/i18n';
import { Button, ErrorCard, InkCallout, SkeletonBlock, Text } from '@da/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';

import { getApiClient } from '../../lib/bootstrap';
import { pushPermission, type PushPermission } from '../../lib/device';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { useUiPrefs } from '../../lib/ui-prefs';
import { deviceLocale } from '../../i18n/I18nProvider';
import { showToast } from '../../providers/ToastHost';
import { Caption, SettingsPage } from '../settings/ui';
import { isExportActive, useLatestExport } from './data';

export function sizeBucket(bytes: number): '<1mb' | '1-10mb' | '10-100mb' | '>100mb' {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return '<1mb';
  if (mb < 10) return '1-10mb';
  if (mb < 100) return '10-100mb';
  return '>100mb';
}

export function ExportScreen() {
  const t = useTranslations();
  const format = useFormatter();
  const online = useOnline();
  const prefs = useUiPrefs();
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  const latest = useLatestExport();
  const request = useMutation(privacyExportMutationOptions(getApiClient()));
  const download = useMutation(exportDownloadMutationOptions(getApiClient()));
  const [key, setKey] = useState(() => Crypto.randomUUID());
  const [progress, setProgress] = useState<number | null>(null);
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const row = latest.data;
  const locale = prefs.locale ?? deviceLocale();

  useEffect(() => {
    let alive = true;
    void pushPermission().then((value) => {
      if (alive) setPermission(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  const willNotify =
    permission === 'granted' && bootstrap.data?.notification_preferences.account === true;

  const create = () => {
    request.mutate(
      { body: {}, idempotencyKey: key },
      {
        onSuccess: () => {
          track('export_requested');
          setKey(Crypto.randomUUID());
          void queryClient.invalidateQueries({ queryKey: qk.privacy.exportLatest() });
        },
        onError: (error) => {
          if (isApiError(error) && error.code === 'RATE_LIMITED') setLimitReached(true);
          else if (isApiError(error) && error.code === 'STATE_CONFLICT') {
            void queryClient.invalidateQueries({ queryKey: qk.privacy.exportLatest() });
          } else showToast({ message: t('privacy.exportScreen.requestFailed'), kind: 'error' });
        },
      },
    );
  };

  const saveFile = async (id: string, link: { signed_url: string; file_size_bytes: number }) => {
    const target = `${FileSystem.cacheDirectory ?? ''}dijital-asistan-export-${id}.zip`;
    setProgress(0);
    try {
      const task = FileSystem.createDownloadResumable(link.signed_url, target, {}, (p) => {
        if (p.totalBytesExpectedToWrite > 0) {
          setProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
        }
      });
      const result = await task.downloadAsync();
      if (result === undefined) throw new Error('download_cancelled');
      track('export_downloaded', { size_bucket: sizeBucket(link.file_size_bytes) });
      await Sharing.shareAsync(result.uri, {
        mimeType: 'application/zip',
        UTI: 'public.zip-archive',
      });
    } catch {
      showToast({ message: t('privacy.exportScreen.downloadFailed'), kind: 'error' });
    } finally {
      setProgress(null);
    }
  };

  const save = (id: string) => {
    download.mutate(
      { id },
      {
        onSuccess: (link) => {
          void saveFile(id, link);
        },
        onError: () => {
          showToast({ message: t('privacy.exportScreen.linkFailed'), kind: 'error' });
        },
      },
    );
  };

  const statusCard = (() => {
    if (latest.isPending) return <SkeletonBlock width="100%" height={56} radius={12} />;
    if (row === null || row === undefined) return null;
    if (isExportActive(row)) {
      return (
        <InkCallout
          variant="banner"
          icon="hourglass_top"
          title={willNotify ? t('privacy.export.processingNotify') : t('privacy.export.processing')}
          testID="export.processing"
        />
      );
    }
    if (row.status === 'ready') {
      const expires = row.expires_at ?? row.ready_at ?? row.created_at;
      return (
        <View style={styles.card} testID="export.ready">
          <Text variant="body">
            {t('privacy.export.ready', {
              size: formatFileSize(row.file_size_bytes ?? 0, locale),
              expires: format.dateTime(new Date(expires), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
          </Text>
          <Button
            label={t('privacy.export.download')}
            icon="download"
            loading={download.isPending || progress !== null}
            disabled={!online}
            onPress={() => {
              save(row.id);
            }}
            testID="export.download"
          />
          {progress === null ? null : (
            <Text
              variant="meta"
              tone="tertiaryStrong"
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
              testID="export.progress"
            >
              {t('privacy.exportScreen.progress', { percent: Math.round(progress * 100) })}
            </Text>
          )}
        </View>
      );
    }
    if (row.status === 'expired') {
      return (
        <Text variant="body" tone="secondary" testID="export.expired">
          {t('privacy.export.expired')}
        </Text>
      );
    }
    if (row.status === 'failed') {
      return (
        <ErrorCard
          icon="error"
          tone="critical"
          title={t('privacy.export.failed')}
          primaryAction={{ label: t('common.actions.retry'), disabled: !online, onPress: create }}
          testID="export.failed"
        />
      );
    }
    return null;
  })();

  const showCta = !isExportActive(row) && row?.status !== 'failed';
  const ctaLabel =
    row?.status === 'expired' || row?.status === 'ready'
      ? t('privacy.export.newRequest')
      : t('privacy.export.cta');

  return (
    <SettingsPage
      title={t('privacy.export.title')}
      subtitle={t('privacy.export.body')}
      refreshing={latest.isRefetching}
      onRefresh={() => {
        void latest.refetch();
      }}
      testID="screen.privacy.export"
      {...(showCta
        ? {
            footer: (
              <Button
                label={ctaLabel}
                fullWidth
                loading={request.isPending}
                disabled={!online || limitReached}
                onPress={create}
                testID="export.cta"
              />
            ),
          }
        : {})}
    >
      <Text variant="kicker" tone="secondary">
        {t('privacy.export.contentsTitle')}
      </Text>
      <Text variant="bodySm" tone="secondary">
        {t('privacy.export.contents')}
      </Text>
      {statusCard}
      {limitReached ? (
        <Text variant="bodySm" tone="warning" testID="export.limit">
          {t('privacy.exportScreen.rateLimited')}
        </Text>
      ) : null}
      {online ? null : <Caption>{t('states.offline.blockedReason')}</Caption>}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, paddingVertical: 8 },
});
