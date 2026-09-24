/**
 * M-ON-13 Aha moment ("HAZIR."): the first value moment with the real findings of the First
 * Analysis job — N is the job's `total_items` (the Today priority count at completion, D-13), the
 * first three `top_items` are listed and the rest summarised; the zero variant says nothing urgent
 * was found (SREQ-56). "Brifingimi Gör" continues to the notification step; the first briefing
 * opens after onboarding (D-05). Rows are not interactive.
 */
import { toUpper } from '@da/i18n';
import { firstAnalysisQueryOptions, useApiClient } from '@da/api-client/react';
import { Badge, Button, GradientSurface, Icon, Surface, Text, useTheme } from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale, useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { badgeOf } from '../today/badges';
import { enterStep, routeOf } from './steps';
import { updateOnboardingState, useOnboardingState } from './store';

export function AhaScreen() {
  const t = useTranslations('onboarding.aha');
  const common = useTranslations('common');
  const privacy = useTranslations('privacy.storage');
  const theme = useTheme();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApiClient();
  const { analysisJobId } = useOnboardingState();
  const job = useQuery({
    ...firstAnalysisQueryOptions(api, analysisJobId ?? 'none'),
    enabled: analysisJobId !== null,
  });
  const data = job.data;
  const total = data?.total_items ?? 0;
  const briefingId = data?.briefing_id ?? null;
  const tracked = useRef(false);

  useEffect(() => {
    enterStep('ready');
  }, []);

  useEffect(() => {
    if (data === undefined || tracked.current) return;
    tracked.current = true;
    track('aha_viewed', { findings_count: total, has_briefing: briefingId !== null });
  }, [briefingId, data, total]);

  const next = () => {
    updateOnboardingState({ firstBriefingId: briefingId });
    router.push(routeOf('notifications'));
  };

  const findings = (data?.top_items ?? []).slice(0, 3);
  const more = Math.max(0, total - findings.length);
  const zero = data !== undefined && total === 0;

  return (
    <GradientSurface gradient="dawnFullbleed" radius="none" style={styles.fill}>
      <View
        style={[
          styles.root,
          {
            paddingTop: insets.top + 32,
            paddingBottom: Math.max(insets.bottom, 16),
            paddingHorizontal: theme.layout.screenX,
          },
        ]}
        testID="onboarding.ready"
      >
        <View
          style={styles.disc}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          <Surface radius="pill" padding={22}>
            <Icon name="check" size={44} color={theme.color.tone.success.solid} />
          </Surface>
        </View>
        <Text variant="kicker" tone="onGradientSecondary">
          {toUpper(t('kicker'), locale === 'en' ? 'en' : 'tr')}
        </Text>
        <Text variant="titleGradient" tone="onGradient" heading testID="ready.title">
          {zero ? t('zero') : data === undefined ? t('pending') : t('title', { count: total })}
        </Text>
        {zero ? (
          <Text variant="body" tone="onGradientSecondary">
            {t('zeroBody')}
          </Text>
        ) : findings.length > 0 ? (
          <Surface
            background="transparent"
            radius="card"
            style={styles.panel}
            accessibilityRole="list"
          >
            {findings.map((item) => {
              const badge = badgeOf(item.kind);
              return (
                <View key={item.insight_id} style={styles.finding} accessible>
                  <Badge
                    label={common(`badges.${badge.key}`)}
                    category={badge.category}
                    size="sm"
                  />
                  <Text variant="body" tone="onGradient" numberOfLines={2} style={styles.flex}>
                    {item.title}
                  </Text>
                </View>
              );
            })}
            {more > 0 ? (
              <Text variant="secondary" tone="onGradientSecondary">
                {t('more', { count: more })}
              </Text>
            ) : null}
          </Surface>
        ) : null}
        <Text variant="bodyXs" tone="onGradientTertiary">
          {privacy('firstAnalysisFooter')}
        </Text>
        <View style={styles.cta}>
          <Button
            label={
              briefingId !== null ? common('actions.viewBriefing') : common('actions.continue')
            }
            variant="inverse"
            fullWidth
            onPress={next}
            testID="ready.continue"
          />
        </View>
      </View>
    </GradientSurface>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  root: { flex: 1, gap: 14 },
  disc: { alignItems: 'flex-start', marginBottom: 8 },
  panel: { gap: 12, paddingVertical: 12 },
  finding: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  cta: { marginTop: 'auto' },
});
