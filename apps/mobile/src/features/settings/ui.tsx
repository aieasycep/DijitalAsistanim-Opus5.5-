/**
 * Shared frame of the settings screens (SCREEN_AND_FLOW_MAP Part 4 §0.3–§0.5): the hub shows a
 * `close` button and every sub-page `arrow_back`; the body scrolls with the page title and
 * subtitle; offline the persisted values stay visible under the `OfflineBanner`; an optional
 * sticky footer carries the page CTA. `SettingsGroup` is a kicker plus a grouped list.
 */
import {
  DetailHeader,
  GroupedList,
  OfflineBanner,
  SectionHeader,
  StickyCTABar,
  Text,
  useTheme,
} from '@da/ui';
import { qk } from '@da/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { useOnline } from '../../lib/query/online-manager';

export const SETTINGS_ROUTE = '/settings';

/** Pops one settings page; a deep-linked page without history returns to the hub. */
export function goBack(router: {
  canGoBack: () => boolean;
  back: () => void;
  replace: (href: string) => void;
}): void {
  if (router.canGoBack()) router.back();
  else router.replace(SETTINGS_ROUTE);
}

export interface SettingsPageProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly kicker?: string;
  readonly leading?: 'back' | 'close';
  readonly onLeadingPress?: () => void;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly refreshing?: boolean;
  readonly onRefresh?: () => void;
  readonly testID: string;
}

export function SettingsPage({
  title,
  subtitle,
  kicker,
  leading = 'back',
  onLeadingPress,
  children,
  footer,
  refreshing,
  onRefresh,
  testID,
}: SettingsPageProps) {
  const t = useTranslations();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const queryClient = useQueryClient();
  const refresh =
    onRefresh ??
    (() => {
      void queryClient.invalidateQueries({ queryKey: qk.me.bootstrap() });
    });
  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
      testID={testID}
    >
      <DetailHeader
        leading={leading}
        {...(kicker === undefined ? {} : { kicker })}
        onLeadingPress={
          onLeadingPress ??
          (() => {
            goBack(router);
          })
        }
        leadingAccessibilityLabel={
          leading === 'close' ? t('common.actions.close') : t('common.actions.back')
        }
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: theme.layout.screenX,
            paddingBottom: footer === undefined ? Math.max(insets.bottom, 24) + 8 : 24,
          },
        ]}
        {...(onRefresh === undefined
          ? {}
          : {
              refreshControl: (
                <RefreshControl
                  refreshing={refreshing === true}
                  onRefresh={onRefresh}
                  tintColor={theme.color.brand.primary}
                />
              ),
            })}
      >
        {online ? null : (
          <OfflineBanner
            message={t('settings.common.offlineBanner')}
            refreshLabel={t('states.offline.refresh')}
            onRefresh={refresh}
            testID={`${testID}.offline`}
          />
        )}
        <Text variant="h1" heading>
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text variant="body" tone="secondary">
            {subtitle}
          </Text>
        )}
        {children}
      </ScrollView>
      {footer === undefined ? null : (
        <StickyCTABar
          style={{
            paddingBottom: Math.max(insets.bottom, 12),
            paddingHorizontal: theme.layout.screenX,
          }}
        >
          {footer}
        </StickyCTABar>
      )}
    </View>
  );
}

export function SettingsGroup({
  title,
  children,
  testID,
}: {
  readonly title?: string;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  return (
    <View style={styles.group}>
      {title === undefined ? null : <SectionHeader title={title} />}
      <GroupedList {...(testID === undefined ? {} : { testID })}>{children}</GroupedList>
    </View>
  );
}

/** A caption under a group (meta text in the AA-safe tertiary tone, §0.5 rule 5). */
export function Caption({
  children,
  testID,
}: {
  readonly children: string;
  readonly testID?: string;
}) {
  return (
    <Text variant="secondary" tone="tertiaryStrong" {...(testID === undefined ? {} : { testID })}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 12, paddingTop: 4 },
  group: { gap: 8, marginTop: 8 },
});
