/**
 * Shared screen plumbing for the T-8.10…T-8.14 screens: the detail-screen frame (header,
 * scroll, pull-to-refresh, offline banner at opacity .75 content, sticky footer), the query-state
 * switch (M-STATE-01 skeleton → M-STATE-11 error with retry / M-STATE-03 offline without cache /
 * M-STATE-12 not found), the offline-blocked write toast (§0.7) and back navigation with a tab-root
 * fallback when the screen was opened from a deep link.
 */
import { isApiError } from '@da/api-client';
import {
  DetailHeader,
  ErrorCard,
  NotFoundState,
  OfflineScreen,
  StickyCTABar,
  useTheme,
  useToast,
  type DetailLeading,
} from '@da/ui';
import { onlineManager } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { AppOfflineBanner } from '../common/OfflineBanner';

export type OfflineAction =
  'reply' | 'approve' | 'reject' | 'capture' | 'assistant' | 'sync' | 'connect' | 'smart_reminder';

/** Toast + `offline_blocked_action` for writes that need the server (approvals, AI, sync). */
export function useOfflineGuard(): (action: OfflineAction) => boolean {
  const t = useTranslations('states.offline');
  const toast = useToast();
  return (action) => {
    if (onlineManager.isOnline()) return false;
    track('offline_blocked_action', { action });
    toast.show({ message: t('blockedToast'), kind: 'offline' });
    return true;
  };
}

/** Back, or the given root when the screen was opened without history (deep link, push). */
export function useBack(fallback: Href): () => void {
  const router = useRouter();
  return () => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  };
}

export interface DetailScreenProps {
  readonly kicker?: string;
  readonly leading?: DetailLeading;
  readonly onLeadingPress: () => void;
  readonly trailing?: ReactNode;
  readonly children: ReactNode;
  /** Pull-to-refresh; omitted for screens without server data to refresh. */
  readonly onRefresh?: () => Promise<unknown>;
  /** Last successful fetch (offline banner "Son analiz {time}"). */
  readonly updatedAt?: number;
  /** Rendered in a `StickyCTABar` below the scroll view. */
  readonly footer?: ReactNode;
  readonly testID?: string;
}

export function DetailScreen({
  kicker,
  leading = 'back',
  onLeadingPress,
  trailing,
  children,
  onRefresh,
  updatedAt,
  footer,
  testID,
}: DetailScreenProps) {
  const theme = useTheme();
  const online = useOnline();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    if (onRefresh === undefined) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <View style={[styles.flex, { backgroundColor: theme.color.bg }]} testID={testID}>
      <DetailHeader
        {...(kicker === undefined ? {} : { kicker })}
        leading={leading}
        onLeadingPress={onLeadingPress}
        trailing={trailing}
      />
      {online ? null : (
        <OfflineNotice
          {...(updatedAt === undefined ? {} : { updatedAt })}
          {...(onRefresh === undefined ? {} : { onRefresh: refresh })}
        />
      )}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: theme.layout.screenX, opacity: online ? 1 : 0.75 },
        ]}
        keyboardShouldPersistTaps="handled"
        {...(onRefresh === undefined
          ? {}
          : {
              refreshControl: (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => {
                    void refresh();
                  }}
                  tintColor={theme.color.brand.primary}
                  colors={[theme.color.brand.primary]}
                />
              ),
            })}
      >
        {children}
      </ScrollView>
      {footer === undefined ? null : <StickyCTABar>{footer}</StickyCTABar>}
    </View>
  );
}

/**
 * "Çevrimdışısın. Son analiz {HH:mm}'den gösteriliyor." + "Yenile" (M-STATE-03 banner) with the
 * M-GL-09 behaviour of the shared banner (re-check, "Hâlâ çevrimdışı.", reconnect flash).
 */
export function OfflineNotice({
  updatedAt,
  onRefresh,
}: {
  readonly updatedAt?: number;
  readonly onRefresh?: () => Promise<unknown>;
}) {
  const theme = useTheme();
  return (
    <View style={{ paddingHorizontal: theme.layout.screenX, paddingTop: theme.space[2] }}>
      <AppOfflineBanner
        offline
        style={{ marginHorizontal: 0 }}
        {...(updatedAt === undefined ? {} : { updatedAt })}
        {...(onRefresh === undefined ? {} : { onRefresh })}
        testID="m2.offlineBanner"
      />
    </View>
  );
}

export interface QueryStateProps {
  /** Screen name for "{Ekran} yüklenemedi." */
  readonly screen: string;
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly retrying?: boolean;
  /** "Bu içerik artık yok." handling for detail screens. */
  readonly notFound?: {
    readonly title?: string;
    readonly backLabel: string;
    readonly onBack: () => void;
  };
  readonly testID?: string;
}

/** The failure half of a query screen without cached data. */
export function QueryFailure({
  screen,
  error,
  onRetry,
  retrying,
  notFound,
  testID,
}: QueryStateProps) {
  const t = useTranslations('states');
  const tc = useTranslations('common.actions');
  const online = useOnline();
  if (notFound !== undefined && isApiError(error) && error.code === 'NOT_FOUND') {
    return (
      <NotFoundState
        variant="entity"
        title={notFound.title ?? t('notFound.entity.title')}
        body={t('notFound.entity.body')}
        backAction={{ label: notFound.backLabel, onPress: notFound.onBack }}
        testID={`${testID ?? 'm2'}.notFound`}
      />
    );
  }
  if (!online) {
    return (
      <OfflineScreen
        title={t('offline.noCache.title')}
        body={t('offline.noCache.body')}
        retryAction={{ label: t('offline.noCache.cta'), onPress: onRetry }}
        testID={`${testID ?? 'm2'}.offline`}
      />
    );
  }
  return (
    <ErrorCard
      icon="error"
      tone="neutral"
      title={t('error.loadFailed.title', { screen })}
      body={t('error.loadFailed.body')}
      primaryAction={{
        label: tc('retry'),
        onPress: onRetry,
        ...(retrying === undefined ? {} : { loading: retrying }),
      }}
      {...(isApiError(error) && error.correlationId !== null
        ? { correlationId: error.correlationId }
        : {})}
      testID={`${testID ?? 'm2'}.error`}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: 12, paddingBottom: 40, gap: 16 },
});
