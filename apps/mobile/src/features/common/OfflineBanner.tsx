/**
 * M-GL-09 / M-STATE-03 connectivity banner with its behaviour (T-8.23):
 * - appears after 2 s offline: "Çevrimdışısın. Son analiz {HH:mm}'{dan} gösteriliyor." (the time is
 *   the newest account sync from the bootstrap, else the screen's own last fetch) with "Yenile";
 * - "Yenile" re-checks NetInfo (14 px spinner meanwhile); online → the active queries refetch,
 *   still offline → "Hâlâ çevrimdışı." for 1.5 s;
 * - on reconnect: the 2 px line and "Güncel · {HH:mm}" for 1.5 s (SyncLine);
 * - `offline_banner_shown {screen}` once per appearance, `offline_refresh_tapped {result}`.
 * The banner is a polite live region announced once; content under it stays accessible.
 */
import { useBootstrap } from '@da/api-client/react';
import { withTrCases } from '@da/i18n';
import { OfflineBanner, SyncLine, useTheme, type SyncPhase } from '@da/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslations } from 'use-intl';

import { useFormats } from '../../lib/data/session';
import { track } from '../../lib/events';
import { lastAnalysisAt, recheckConnection, useConnectivity } from '../../lib/offline/connectivity';

export const STILL_OFFLINE_MS = 1_500;

export interface AppOfflineBannerProps {
  /** Screen ID for `offline_banner_shown` (e.g. `M-TD-01`). */
  readonly screen?: string;
  /** The screen's own last successful fetch (fallback for "Son analiz"). */
  readonly updatedAt?: number;
  /** Extra refresh after the active queries refetched (e.g. a custom sync line). */
  readonly onRefresh?: () => Promise<unknown>;
  /** Offline-state override (screens that already track it); default: the debounced state. */
  readonly offline?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

export function AppOfflineBanner({
  screen,
  updatedAt,
  onRefresh,
  offline: forced,
  style,
  testID = 'app.offlineBanner',
}: AppOfflineBannerProps) {
  const t = useTranslations('states.offline');
  const formats = useFormats();
  const theme = useTheme();
  const client = useQueryClient();
  const connectivity = useConnectivity();
  const offline = forced ?? connectivity.offline;
  const bootstrap = useBootstrap({ enabled: false });
  const [refreshing, setRefreshing] = useState(false);
  const [stillOffline, setStillOffline] = useState(false);
  // Reconnect flash: the 2 px line for 400 ms, then "Güncel · {HH:mm}" (SyncLine hides it).
  const reconnectedAt = forced === undefined ? connectivity.reconnectedAt : null;
  const [doneFor, setDoneFor] = useState<number | null>(null);
  const [hiddenFor, setHiddenFor] = useState<number | null>(null);

  useEffect(() => {
    if (!offline) return;
    track('offline_banner_shown', screen === undefined ? {} : { screen });
  }, [offline, screen]);

  useEffect(() => {
    if (reconnectedAt === null) return;
    const timer = setTimeout(() => {
      setDoneFor(reconnectedAt);
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [reconnectedAt]);

  const phase: SyncPhase =
    reconnectedAt === null || hiddenFor === reconnectedAt
      ? 'idle'
      : doneFor === reconnectedAt
        ? 'done'
        : 'syncing';

  useEffect(() => {
    if (!stillOffline) return;
    const timer = setTimeout(() => {
      setStillOffline(false);
    }, STILL_OFFLINE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [stillOffline]);

  const analysis = lastAnalysisAt(bootstrap.data) ?? (updatedAt === 0 ? null : (updatedAt ?? null));
  const time = analysis === null ? null : formats.time(analysis);
  const message = stillOffline
    ? t('stillOffline')
    : time === null
      ? t('sinceNoTime')
      : t('banner', withTrCases({ time }, ['time']));

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const result = await recheckConnection(client);
      track('offline_refresh_tapped', { result });
      if (result === 'online') await onRefresh?.();
      else setStillOffline(true);
    } finally {
      setRefreshing(false);
    }
  };

  if (!offline) {
    if (phase === 'idle' || reconnectedAt === null) return null;
    return (
      <View style={[{ paddingHorizontal: theme.layout.screenX }, style]}>
        <SyncLine
          phase={phase}
          doneLabel={t('reconnected', { time: formats.time(reconnectedAt) })}
          onDoneHidden={() => {
            setHiddenFor(reconnectedAt);
          }}
          testID={`${testID}.reconnected`}
        />
      </View>
    );
  }
  return (
    <OfflineBanner
      message={message}
      refreshLabel={t('refresh')}
      refreshing={refreshing}
      onRefresh={() => {
        void refresh();
      }}
      {...(style === undefined ? {} : { style })}
      testID={testID}
    />
  );
}
