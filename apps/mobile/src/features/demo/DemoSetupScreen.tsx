/**
 * `app/demo/setup` (R-21, SCREEN_AND_FLOW_MAP §0.8): `dijitalasistan://demo/setup?scenario&clock&
 * locale&theme` for Maestro and the store-screenshot runs. Demo builds only — the file is left out
 * of other bundles by `metro.config.js`, the allow-list rejects the link, the root guard hides the
 * route, and this screen refuses to act outside a demo build as a last line.
 *
 * It resets the app's local demo state (the query cache, so every screen re-reads the demo
 * backend; the backend data itself is reseeded by `pnpm seed:demo --scenario <name>`), pins the
 * clock, sets language and theme (kept over the demo account's bootstrap values), and returns to
 * the entry resolver.
 */
import { EmptyState, Spinner, Text, useTheme } from '@da/ui';
import type { Locale } from '@da/i18n';
import type { ThemePreference } from '@da/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { pinClock } from '../../lib/clock';
import { isDemoBuild } from '../../lib/env';
import { setDemoUiOverride } from '../../lib/ui-prefs';
import { NotFoundScreen } from '../shell/NotFoundScreen';

export interface DemoSetup {
  readonly scenario: string | null;
  readonly clock: Date | null;
  readonly locale: Locale | null;
  readonly theme: ThemePreference | null;
}

const SCENARIO_RE = /^[a-z][a-z0-9_]{0,47}$/;

/** Validates the query; any present but malformed parameter rejects the whole link. */
export function parseDemoSetup(query: Readonly<Record<string, unknown>>): DemoSetup | null {
  const read = (key: string): string | null => {
    const value = query[key];
    return typeof value === 'string' && value !== '' ? value : null;
  };
  const scenario = read('scenario');
  const clock = read('clock');
  const locale = read('locale');
  const theme = read('theme');
  if (scenario !== null && !SCENARIO_RE.test(scenario)) return null;
  const clockDate = clock === null ? null : new Date(clock);
  if (clockDate !== null && Number.isNaN(clockDate.getTime())) return null;
  if (locale !== null && locale !== 'tr' && locale !== 'en') return null;
  if (theme !== null && theme !== 'light' && theme !== 'dark' && theme !== 'system') return null;
  return {
    scenario,
    clock: clockDate,
    locale,
    theme,
  };
}

function DemoSetupRunner() {
  const params = useLocalSearchParams();
  const t = useTranslations('common.demo');
  const actions = useTranslations('common.actions');
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const setup = useMemo(() => parseDemoSetup(params), [params]);

  useEffect(() => {
    if (setup === null) return;
    queryClient.clear();
    if (setup.clock !== null) pinClock(setup.clock);
    setDemoUiOverride({
      ...(setup.locale === null ? {} : { locale: setup.locale }),
      ...(setup.theme === null ? {} : { theme: setup.theme }),
    });
    router.replace('/');
  }, [queryClient, router, setup]);

  if (setup === null) {
    return (
      <View style={[styles.root, { backgroundColor: theme.color.bg }]}>
        <EmptyState
          icon="link_off"
          title={t('setupInvalid')}
          action={{
            label: actions('goBack'),
            onPress: () => {
              router.replace('/');
            },
          }}
          testID="demo.setup.invalid"
        />
      </View>
    );
  }
  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.bg }]}
      accessible
      accessibilityLabel={t('setupWorking')}
      testID="demo.setup.working"
    >
      <Spinner size={16} />
      <Text variant="secondary" tone="secondary">
        {t('setupWorking')}
      </Text>
    </View>
  );
}

export function DemoSetupScreen() {
  if (!isDemoBuild()) return <NotFoundScreen />;
  return <DemoSetupRunner />;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});
