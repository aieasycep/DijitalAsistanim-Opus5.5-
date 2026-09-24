/**
 * M-ON-14A Android notification access ("Telefon bildirimlerini de anlayayım mı?", Android only):
 * the prominent disclosure before the notification listener (R-15 canonical copy), the
 * "Seçili uygulamalar" / "Tüm uygulamalar" mode (D-27) and the category presets, then the system
 * "Bildirim erişimi" screen through the `notification-intelligence` module. Back in the app the
 * real grant is checked: granted → the analysis is switched on, mirrored with
 * `POST /devices/register {android_ni}` and the flow continues (M-ON-15); not granted → an inline
 * notice and "Tekrar Dene". Messaging and security apps are shown locked ("her zaman hariç").
 * Free users see the `android_ni` gate and "Atla". On iOS the route is not registered (the group
 * layout guards it).
 */
import { Accordion, Button, ErrorCard, SegmentedControl, Text } from '@da/ui';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { track } from '../../lib/events';
import { showToast } from '../../providers/ToastHost';
import { acceptDisclosure, applyChoice, readChoice, type NiChoice } from '../android-ni/choice';
import { reportAniState, syncBackgroundUpload } from '../android-ni/lifecycle';
import { niCall, niModule } from '../android-ni/native';
import { NiChoiceList } from '../android-ni/NiChoiceList';
import { DenylistSheet } from '../android-ni/sheets';
import { ContextualGate, isPro } from '../pro-gate/ProGate';
import { completeOnboarding } from './complete';
import { OnboardingFrame } from './OnboardingFrame';
import { enterStep, skipStep } from './steps';
import { getOnboardingState } from './store';

const LISTENER_SETTINGS = 'android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS';

type Phase = 'choose' | 'waiting' | 'denied';

/** The module's settings handoff, else the plain list intent, else the app's settings page. */
async function openListenerSettings(): Promise<boolean> {
  if (niModule() !== null && niCall(false, (ni) => ni.openSettings())) return true;
  try {
    await Linking.sendIntent(LISTENER_SETTINGS);
    return true;
  } catch {
    try {
      await Linking.openSettings();
      return true;
    } catch {
      return false;
    }
  }
}

export function AndroidNiStepScreen() {
  const t = useTranslations('onboarding.androidNotifications');
  const ni = useTranslations('android_ni');
  const common = useTranslations('common');
  const router = useRouter();
  const pro = isPro();
  const [choice, setChoice] = useState<NiChoice>(readChoice);
  const [phase, setPhase] = useState<Phase>('choose');
  const [denylist, setDenylist] = useState(false);
  const [trouble, setTrouble] = useState(false);
  const waiting = useRef(false);
  const mode = useRef(choice.mode);

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

  // Back from the system screen: the real grant decides.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !waiting.current) return;
      waiting.current = false;
      const granted = niCall(false, (m) => m.isGranted());
      track('android_ni_result', { granted, mode: mode.current });
      if (!granted) {
        setPhase('denied');
        void reportAniState();
        return;
      }
      niCall(undefined, (m) => {
        m.setEnabled(true);
      });
      void syncBackgroundUpload(true);
      void reportAniState();
      showToast({ message: ni('screen.grantedToast'), kind: 'success' });
      finish();
    });
    return () => {
      sub.remove();
    };
    // `finish` only reads the store and the router.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ni]);

  const update = (next: NiChoice) => {
    mode.current = next.mode;
    setChoice(next);
    applyChoice(next);
  };

  const openAccess = async () => {
    applyChoice(choice);
    acceptDisclosure(now());
    track('android_ni_access_opened');
    waiting.current = true;
    if (await openListenerSettings()) {
      setPhase('waiting');
    } else {
      waiting.current = false;
      showToast({ message: t('settingsFailed'), kind: 'error' });
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
        <>
          <Button
            label={phase === 'denied' ? ni('onboardingStep.retry') : ni('grantCta')}
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
      }
    >
      {phase === 'denied' ? (
        <ErrorCard
          icon="notifications_off"
          tone="warning"
          title={ni('onboardingStep.notGrantedTitle')}
          body={ni('onboardingStep.notGrantedBody')}
          testID="androidNi.denied"
        />
      ) : null}
      <SegmentedControl
        options={[
          { key: 'selected', label: ni('modes.selected') },
          { key: 'all', label: ni('modes.all') },
        ]}
        selectedKey={choice.mode}
        semantics="radio"
        onChange={(key) => {
          const mode = key === 'all' ? 'all' : 'selected';
          track('android_ni_mode_changed', { mode });
          update({ ...choice, mode });
        }}
        accessibilityLabel={t('modeA11y')}
        testID="androidNi.mode"
      />
      <NiChoiceList
        categories={choice.categories}
        onToggle={(key, value) => {
          update({ ...choice, categories: { ...choice.categories, [key]: value } });
        }}
        showCategories={choice.mode === 'selected'}
        onLockedPress={() => {
          track('android_ni_denylist_viewed');
          setDenylist(true);
        }}
        testID="androidNi"
      />
      <Text variant="secondary" tone="tertiaryStrong">
        {ni('disclosureSheet.footnote')}
      </Text>
      <Accordion
        title={ni('onboardingStep.troubleTitle')}
        icon="help"
        expanded={trouble}
        onToggle={() => {
          setTrouble((v) => !v);
        }}
        testID="androidNi.trouble"
      >
        <Text variant="secondary" tone="secondary">
          {ni('onboardingStep.troubleBody')}
        </Text>
      </Accordion>
      <DenylistSheet
        visible={denylist}
        onDismiss={() => {
          setDenylist(false);
        }}
      />
    </OnboardingFrame>
  );
}
