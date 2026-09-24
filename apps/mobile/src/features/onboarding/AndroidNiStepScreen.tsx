/**
 * M-ON-14A Android notification access ("Telefon bildirimlerini de anlayayım mı?", Android only):
 * the prominent disclosure before the notification listener (R-15 canonical copy), the
 * "Seçili uygulamalar" / "Tüm uygulamalar" mode (D-27) and the category presets, then the system
 * "Bildirim erişimi" screen through a settings intent. The listener module, its grant check and the
 * `POST /devices/register {android_ni}` mirror are T-8.26; the choices made here are kept on the
 * device for it. Free users see the `android_ni` gate and "Atla". On iOS the route is not
 * registered (the group layout guards it).
 */
import {
  AssuranceBox,
  Button,
  GroupedList,
  ListRow,
  SectionHeader,
  SegmentedControl,
} from '@da/ui';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { encryptedStorage, isEncryptedStorageOpen } from '../../lib/storage';
import { showToast } from '../../providers/ToastHost';
import { ContextualGate, isPro } from '../pro-gate/ProGate';
import { completeOnboarding } from './complete';
import { OnboardingFrame } from './OnboardingFrame';
import { enterStep, skipStep } from './steps';
import { getOnboardingState } from './store';

type Category = 'shipping' | 'banking' | 'airline' | 'reservation' | 'messaging';
type Mode = 'selected' | 'all';

const CATEGORIES: readonly {
  key: Category;
  event: 'cargo' | 'bank_payment' | 'flight' | 'reservation' | 'other';
  on: boolean;
}[] = [
  { key: 'shipping', event: 'cargo', on: true },
  { key: 'banking', event: 'bank_payment', on: true },
  { key: 'airline', event: 'flight', on: true },
  { key: 'reservation', event: 'reservation', on: false },
  { key: 'messaging', event: 'other', on: false },
];

/** The device-side choice T-8.26 applies to the listener module. */
export const NI_CHOICE_KEY = 'android_ni.onboarding_choice';
const LISTENER_SETTINGS = 'android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS';

export function AndroidNiStepScreen() {
  const t = useTranslations('onboarding.androidNotifications');
  const ni = useTranslations('android_ni');
  const privacy = useTranslations('privacy.storage');
  const common = useTranslations('common');
  const router = useRouter();
  const pro = isPro();
  const [mode, setMode] = useState<Mode>('selected');
  const [enabled, setEnabled] = useState<Record<Category, boolean>>(
    () => Object.fromEntries(CATEGORIES.map((c) => [c.key, c.on])) as Record<Category, boolean>,
  );
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    enterStep('android_notifications');
    track('android_ni_prompt_viewed');
  }, []);

  const finish = () => {
    void completeOnboarding(router, { briefingId: getOnboardingState().firstBriefingId });
  };

  const skip = () => {
    skipStep('android_notifications');
    finish();
  };

  const openAccess = async () => {
    if (isEncryptedStorageOpen()) {
      encryptedStorage().prefs.set(NI_CHOICE_KEY, JSON.stringify({ mode, categories: enabled }));
    }
    track('android_ni_access_opened');
    try {
      await Linking.sendIntent(LISTENER_SETTINGS);
      setOpened(true);
    } catch {
      try {
        await Linking.openSettings();
        setOpened(true);
      } catch {
        showToast({ message: t('settingsFailed'), kind: 'error' });
      }
    }
  };

  if (!pro) {
    return (
      <OnboardingFrame
        title={t('title')}
        subtitle={t('body')}
        testID="onboarding.androidNi"
        footer={
          <Button label={common('actions.skip')} fullWidth onPress={skip} testID="androidNi.skip" />
        }
      >
        <ContextualGate feature="android_ni" />
      </OnboardingFrame>
    );
  }

  return (
    <OnboardingFrame
      kicker={t('kicker')}
      title={t('title')}
      subtitle={t('body')}
      onBack={() => {
        router.back();
      }}
      skip={{ label: common('actions.skip'), onPress: skip }}
      testID="onboarding.androidNi"
      footer={
        opened ? (
          <Button
            label={common('actions.continue')}
            fullWidth
            onPress={finish}
            testID="androidNi.continue"
          />
        ) : (
          <>
            <Button
              label={t('cta')}
              fullWidth
              onPress={() => {
                void openAccess();
              }}
              testID="androidNi.open"
            />
            <Button
              label={t('skip')}
              variant="text"
              fullWidth
              onPress={skip}
              testID="androidNi.later"
            />
          </>
        )
      }
    >
      <SegmentedControl
        options={[
          { key: 'selected', label: ni('modes.selected') },
          { key: 'all', label: ni('modes.all') },
        ]}
        selectedKey={mode}
        semantics="radio"
        onChange={(key) => {
          const next: Mode = key === 'all' ? 'all' : 'selected';
          setMode(next);
          track('android_ni_mode_changed', { mode: next });
        }}
        accessibilityLabel={t('modeA11y')}
        testID="androidNi.mode"
      />
      {mode === 'selected' ? (
        <>
          <SectionHeader title={ni('apps')} />
          <GroupedList>
            {CATEGORIES.map((category) => (
              <ListRow
                key={category.key}
                title={t(`groups.${category.key}.title`)}
                subtitle={t(`groups.${category.key}.meta`)}
                trailing={{ kind: 'switch', value: enabled[category.key] }}
                onPress={() => {
                  const value = !enabled[category.key];
                  setEnabled((current) => ({ ...current, [category.key]: value }));
                  track('android_ni_category_toggled', {
                    category: category.event,
                    enabled: value,
                  });
                }}
                testID={`androidNi.${category.key}`}
              />
            ))}
          </GroupedList>
        </>
      ) : null}
      <GroupedList>
        <ListRow
          title={t('lockedTitle')}
          subtitle={t('lockedMeta')}
          icon="lock"
          accessibilityLabel={t('lockedA11y')}
          testID="androidNi.locked"
        />
      </GroupedList>
      <AssuranceBox
        rows={[
          { key: 'device', icon: 'phonelink', text: t('footer') },
          { key: 'storage', icon: 'shield', text: privacy('androidNi') },
        ]}
      />
      {opened ? null : <ListRow title={t('settingsHint')} icon="settings" iconStyle="bare" />}
      {opened ? (
        <ListRow title={t('returned')} icon="info" iconStyle="bare" testID="androidNi.returned" />
      ) : null}
      <ListRow title={t('restricted')} icon="help" iconStyle="bare" />
    </OnboardingFrame>
  );
}
