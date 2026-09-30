/**
 * M-ON-12 First Analysis: real progress of the single `first_analysis` job (API-ONB-01 start with
 * a deterministic idempotency key per attempt, API-ONB-02 polled every 1.5 s, R-19). Only the rows
 * of connected sources are shown; counts come from the job. No timers drive the progress (the
 * prototype's 1 s steps are rejected); after completion the screen continues to the Aha step.
 * Slow (> 60 s) offers "Bugün'e geç"; a failure offers a new attempt or "Şimdilik geç"; offline
 * polling pauses with "Bağlantı bekleniyor…". The footer is the R-15 storage statement.
 */
import { isApiError } from '@da/api-client';
import { firstAnalysisQueryOptions, useApiClient, useBootstrap } from '@da/api-client/react';
import {
  AnalysisProgressCard,
  Button,
  ErrorCard,
  GradientSurface,
  PulsingRing,
  Text,
  useTheme,
  type ProcessingStep,
} from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { intentKey } from '../../lib/idempotency';
import { useOnline } from '../../lib/query/online-manager';
import { enterStep, routeOf, skipStep } from './steps';
import { updateOnboardingState, useOnboardingState } from './store';

export const SLOW_AFTER_MS = 60_000;
/** The completion footer is shown briefly before the Aha step (M-ON-12). */
export const ADVANCE_AFTER_MS = 600;

type StepKey = 'scan_mail' | 'classify' | 'calendar' | 'open_loops';

function mailBucket(count: number): '0' | '1-50' | '51-200' | '201+' {
  if (count === 0) return '0';
  if (count <= 50) return '1-50';
  if (count <= 200) return '51-200';
  return '201+';
}

export function FirstAnalysisScreen() {
  const t = useTranslations('onboarding.analysis');
  const common = useTranslations('common');
  const privacy = useTranslations('privacy.storage');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApiClient();
  const online = useOnline();
  const bootstrap = useBootstrap();
  const state = useOnboardingState();
  const [startError, setStartError] = useState(false);
  const [slow, setSlow] = useState(false);
  const startedAt = useRef(0);
  const completedTracked = useRef<string | null>(null);
  const jobId = state.analysisJobId;

  useEffect(() => {
    startedAt.current = Date.now();
    enterStep('analysis');
  }, []);

  // Start (or re-attach to) the job for this attempt.
  const userId = bootstrap.data?.profile.id;
  const attempt = state.analysisAttempt;
  useEffect(() => {
    if (jobId !== null || userId === undefined) return;
    const guard = { active: true };
    void (async () => {
      try {
        const key = await intentKey(`first_analysis:${userId}:${String(attempt)}`);
        const response = await api.call(
          'POST /onboarding/first-analysis',
          { body: { window_hours: 72 } },
          { idempotencyKey: key },
        );
        if (!guard.active) return;
        track('first_analysis_started', { sources: bootstrap.data?.accounts.length ?? 0 });
        startedAt.current = Date.now();
        updateOnboardingState({ analysisJobId: response.data.job.job_id });
      } catch (error) {
        if (!guard.active) return;
        if (isApiError(error) && error.code === 'STATE_CONFLICT') {
          // No source to analyse (C-17): continue without analysis.
          updateOnboardingState({ skippedAllSources: true });
          router.replace(routeOf('notifications'));
          return;
        }
        setStartError(true);
      }
    })();
    return () => {
      guard.active = false;
    };
  }, [api, attempt, bootstrap.data?.accounts.length, jobId, router, userId]);

  const progress = useQuery({
    ...firstAnalysisQueryOptions(api, jobId ?? 'pending'),
    enabled: jobId !== null,
  });
  const data = progress.data;

  useEffect(() => {
    const timer = setTimeout(() => {
      setSlow(true);
    }, SLOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [jobId]);

  useEffect(() => {
    if (data?.status !== 'completed' || jobId === null) return;
    if (completedTracked.current !== jobId) {
      completedTracked.current = jobId;
      track('first_analysis_completed', {
        duration_s: Math.min(86_400, Math.round((Date.now() - startedAt.current) / 1000)),
        mail_bucket: mailBucket(data.counts.mails_found),
        important_count: data.counts.potential_important,
        event_count: data.counts.upcoming_events,
        followup_count: data.counts.possible_followups,
      });
    }
    const timer = setTimeout(() => {
      router.replace(routeOf('ready'));
    }, ADVANCE_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [data, jobId, router]);

  useEffect(() => {
    if (data?.status === 'failed') track('first_analysis_failed', { error_code: 'INTERNAL' });
  }, [data?.status]);

  const retry = () => {
    track('first_analysis_retry');
    setStartError(false);
    setSlow(false);
    updateOnboardingState({ analysisJobId: null, analysisAttempt: attempt + 1 });
  };

  const skipToNotifications = (kind: 'slow' | 'failed') => {
    if (kind === 'slow') track('first_analysis_slow_continue');
    else skipStep('analysis');
    router.replace(routeOf('notifications'));
  };

  const sourceAccounts = bootstrap.data?.accounts ?? [];
  const hasMail = sourceAccounts.some((a) => a.capabilities_granted.includes('mail_read'));
  const hasCalendar = sourceAccounts.some(
    (a) =>
      a.capabilities_granted.includes('calendar_read') ||
      a.provider === 'apple_device' ||
      a.provider === 'android_device',
  );
  const visibleKeys: readonly StepKey[] = [
    ...(hasMail ? (['scan_mail', 'classify'] as const) : []),
    ...(hasCalendar ? (['calendar'] as const) : []),
    ...(hasMail ? (['open_loops'] as const) : []),
  ];
  const stepOf = (key: StepKey) => data?.steps.find((s) => s.key === key);
  const counts = data?.counts;
  const labelOf = (key: StepKey): string => {
    const step = stepOf(key);
    const done = step?.status === 'done';
    switch (key) {
      case 'scan_mail':
        return done || (step?.count ?? 0) > 0
          ? t('counters.emails', { count: counts?.mails_found ?? step?.count ?? 0 })
          : t('steps.scanning');
      case 'classify':
        return done
          ? t('counters.important', { count: counts?.potential_important ?? 0 })
          : t('steps.classifying');
      case 'calendar':
        if (step?.status === 'failed') return t('calendarFailed');
        return done
          ? t('counters.events', { count: counts?.upcoming_events ?? 0 })
          : t('steps.calendar');
      case 'open_loops':
        return done
          ? t('counters.followUps', { count: counts?.possible_followups ?? 0 })
          : t('steps.openItems');
    }
  };
  const steps: ProcessingStep[] = visibleKeys.map((key) => {
    const status = stepOf(key)?.status ?? 'pending';
    return {
      key,
      label: labelOf(key),
      state:
        status === 'done' || status === 'skipped' || status === 'failed'
          ? 'done'
          : status === 'running'
            ? 'active'
            : 'pending',
    };
  });

  const sources = (bootstrap.data?.accounts ?? [])
    .map((a) =>
      common(
        `providers.${a.provider === 'microsoft' ? 'outlook' : a.provider === 'apple_device' ? 'appleCalendar' : a.provider === 'android_device' ? 'deviceCalendar' : a.provider === 'demo' ? 'demo' : 'gmail'}`,
      ),
    )
    .filter((name, index, all) => all.indexOf(name) === index);
  const failed = startError || data?.status === 'failed';
  const completed = data?.status === 'completed';

  return (
    <GradientSurface gradient="night" radius="none" style={styles.fill}>
      <View
        style={[
          styles.root,
          {
            paddingTop: insets.top + 24,
            paddingBottom: Math.max(insets.bottom, 16),
            paddingHorizontal: theme.layout.screenX,
          },
        ]}
        testID="onboarding.analysis"
      >
        <View
          style={styles.ring}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t('ringA11y')}
          accessibilityState={{ busy: !completed && !failed }}
        >
          <PulsingRing />
        </View>
        <Text variant="titleGradient" tone="onGradient" align="center" heading>
          {t('title')}
        </Text>
        {sources.length > 0 ? (
          <Text variant="secondary" tone="onGradientSecondary" align="center">
            {t('subtitle', { sources: sources.join(` ${t('and')} `) })}
          </Text>
        ) : null}
        <View style={styles.checklist}>
          {failed ? (
            <ErrorCard
              icon="error"
              tone="neutral"
              title={t('failedTitle')}
              body={t('failedBody')}
              primaryAction={{ label: common('actions.retry'), onPress: retry }}
              secondaryAction={{
                label: common('actions.skipForNow'),
                onPress: () => {
                  skipToNotifications('failed');
                },
              }}
              testID="analysis.failed"
            />
          ) : (
            <AnalysisProgressCard
              kicker={t('kicker')}
              steps={steps}
              stateLabels={{
                done: t('stateDone'),
                active: t('stateActive'),
                pending: t('statePending'),
              }}
              onGradient
              testID="analysis.steps"
            />
          )}
        </View>
        {!online && !completed ? (
          <Text
            variant="secondary"
            tone="onGradientSecondary"
            align="center"
            testID="analysis.offline"
          >
            {t('waiting')}
          </Text>
        ) : null}
        {slow && !completed && !failed ? (
          <View style={styles.slow}>
            <Text variant="secondary" tone="onGradientSecondary" align="center">
              {t('slow')}
            </Text>
            <Button
              label={t('goToday')}
              variant="inverse"
              onPress={() => {
                skipToNotifications('slow');
              }}
              testID="analysis.slowContinue"
            />
          </View>
        ) : null}
        <Text variant="bodyXs" tone="onGradientTertiary" align="center" style={styles.footer}>
          {completed ? privacy('firstAnalysisFooter') : t('runningFooter')}
        </Text>
      </View>
    </GradientSurface>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  root: { flex: 1, gap: 12 },
  ring: { alignItems: 'center', marginBottom: 12 },
  checklist: { marginTop: 12 },
  slow: { gap: 12, alignItems: 'center' },
  footer: { marginTop: 'auto' },
});
