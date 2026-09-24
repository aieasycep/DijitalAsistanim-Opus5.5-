/**
 * M-ON-09 personalization (step 2 / 4): which life areas matter (SREQ-54, a soft weighting below
 * learned preferences). "Hepsi" selects all seven; deselecting any clears it. Saved to
 * `user_preferences.interest_categories` (optimistic bootstrap update; the write never blocks).
 */
import { useBootstrap } from '@da/api-client/react';
import { Button, SelectableTile, Text, announce, type IconName } from '@da/ui';
import type { UserPreferencesView } from '@da/validation/api/bootstrap';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { patchBootstrapCache, updateUserPreferences } from '../../lib/postgrest';
import { OnboardingFrame } from './OnboardingFrame';
import { enterStep, routeOf } from './steps';

type Interest = UserPreferencesView['interest_categories'][number];

export const INTERESTS: readonly { key: Interest; icon: IconName }[] = [
  { key: 'work', icon: 'work' },
  { key: 'family', icon: 'family_restroom' },
  { key: 'finance', icon: 'account_balance_wallet' },
  { key: 'travel', icon: 'flight' },
  { key: 'shopping', icon: 'shopping_bag' },
  { key: 'appointments', icon: 'event_available' },
  { key: 'deadlines', icon: 'hourglass_top' },
];

export function PersonalizationScreen() {
  const t = useTranslations('onboarding.personalization');
  const onb = useTranslations('onboarding');
  const router = useRouter();
  const bootstrap = useBootstrap();
  const [selected, setSelected] = useState<readonly Interest[] | null>(null);
  const current = selected ?? bootstrap.data?.preferences.interest_categories ?? [];
  const all = current.length === INTERESTS.length;

  useEffect(() => {
    enterStep('personalization');
  }, []);

  const toggle = (key: Interest) => {
    setSelected(current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
  };

  const save = () => {
    const interests = [...current];
    track('personalization_saved', { count: interests.length, all });
    patchBootstrapCache((data) => ({
      ...data,
      preferences: { ...data.preferences, interest_categories: interests },
    }));
    void updateUserPreferences({ interest_categories: interests }).catch(() => undefined);
    router.push(routeOf('briefing_schedule'));
  };

  return (
    <OnboardingFrame
      kicker={onb('steps.personalization')}
      title={t('title')}
      subtitle={t('body')}
      onBack={() => {
        router.back();
      }}
      testID="onboarding.personalization"
      footer={
        <>
          {current.length === 0 ? (
            <Text variant="secondary" tone="tertiaryStrong" align="center">
              {t('helper')}
            </Text>
          ) : null}
          <Button
            label={t('cta', { count: current.length })}
            fullWidth
            disabled={current.length === 0}
            onPress={save}
            testID="personalization.continue"
          />
        </>
      }
    >
      <View style={styles.grid} accessibilityRole="list">
        {INTERESTS.map((item) => (
          <View key={item.key} style={styles.cell}>
            <SelectableTile
              label={t(`interests.${item.key}`)}
              icon={item.icon}
              selected={current.includes(item.key)}
              onPress={() => {
                toggle(item.key);
              }}
              testID={`personalization.${item.key}`}
            />
          </View>
        ))}
        <View style={styles.cell}>
          <SelectableTile
            label={t('interests.all')}
            icon="select_all"
            selected={all}
            onPress={() => {
              if (all) {
                setSelected([]);
              } else {
                setSelected(INTERESTS.map((i) => i.key));
                announce(t('allSelected'));
              }
            }}
            testID="personalization.all"
          />
        </View>
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  cell: { width: '50%', padding: 6 },
});
