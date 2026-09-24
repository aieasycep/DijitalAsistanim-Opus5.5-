/**
 * M-ON-14 notification permission, asked after value was shown: "Sadece önemli olduğunda haber
 * veririz." (R-14; no frequency promise). Skipped when the permission is already granted (the token
 * is registered silently). "Bildirimleri Aç" → Android channels → OS prompt → token registration;
 * a denial turns the CTA into "Ayarları Aç" with "Devam"; "Daha sonra" records the single deferral
 * (`notification_preferences.prompt_deferred_count = 1`, re-asked once on the first briefing, D-29).
 */
import { useBootstrap } from '@da/api-client/react';
import { Button, NotificationPreview, Text } from '@da/ui';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { updateNotificationPreferences } from '../../lib/postgrest';
import { isPro } from '../pro-gate/ProGate';
import { completeOnboarding } from './complete';
import { OnboardingFrame } from './OnboardingFrame';
import {
  currentNotificationPermission,
  registerPushToken,
  requestNotificationPermission,
  type OsPermission,
} from './push';
import { enterStep, nextStep, routeOf, stepContext } from './steps';
import { getOnboardingState } from './store';

export function NotificationStepScreen() {
  const t = useTranslations('onboarding.notifications');
  const common = useTranslations('common');
  const promise = useTranslations('notifications');
  const router = useRouter();
  const bootstrap = useBootstrap();
  const [permission, setPermission] = useState<OsPermission | null>(null);
  const [busy, setBusy] = useState(false);
  const advanced = useRef(false);

  const advance = () => {
    if (advanced.current) return;
    advanced.current = true;
    const hasMail = (bootstrap.data?.accounts ?? []).some((a) =>
      a.capabilities_granted.includes('mail_read'),
    );
    const next = nextStep('notifications', stepContext(hasMail));
    if (next === 'done') {
      void completeOnboarding(router, { briefingId: getOnboardingState().firstBriefingId });
    } else {
      router.push(routeOf(next));
    }
  };

  useEffect(() => {
    enterStep('notifications');
    let active = true;
    void currentNotificationPermission().then((status) => {
      if (!active) return;
      if (status === 'granted') {
        void registerPushToken();
        advance();
        return;
      }
      setPermission(status);
      track('notification_prompt_viewed', { context: 'onboarding' });
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allow = async () => {
    setBusy(true);
    try {
      const status = await requestNotificationPermission();
      track('notification_permission_result', {
        status: status === 'granted' ? 'granted' : status === 'blocked' ? 'blocked' : 'denied',
        context: 'onboarding',
      });
      void updateNotificationPreferences({
        os_permission: status === 'granted' ? 'granted' : 'denied',
        os_permission_updated_at: new Date().toISOString(),
      }).catch(() => undefined);
      if (status === 'granted') {
        await registerPushToken();
        advance();
      } else {
        setPermission(status);
      }
    } finally {
      setBusy(false);
    }
  };

  const later = () => {
    track('notification_prompt_deferred');
    void updateNotificationPreferences({ prompt_deferred_count: 1 }).catch(() => undefined);
    advance();
  };

  const denied = permission === 'denied' || permission === 'blocked';
  const pro = isPro();
  return (
    <OnboardingFrame
      title={promise('promise')}
      subtitle={denied ? t('deniedBody') : t('body')}
      testID="onboarding.notifications"
      footer={
        denied ? (
          <>
            <Button
              label={common('actions.openSettings')}
              fullWidth
              onPress={() => {
                void Linking.openSettings();
              }}
              testID="notifications.settings"
            />
            <Button
              label={common('actions.continue')}
              variant="text"
              fullWidth
              onPress={advance}
              testID="notifications.continue"
            />
          </>
        ) : (
          <>
            <Button
              label={t('cta')}
              fullWidth
              loading={busy}
              disabled={permission === null}
              onPress={() => {
                void allow();
              }}
              testID="notifications.allow"
            />
            <Button
              label={t('later')}
              variant="text"
              fullWidth
              onPress={later}
              testID="notifications.later"
            />
          </>
        )
      }
    >
      <NotificationPreview
        accessibilityLabel={t('previewA11y')}
        items={[
          {
            key: 'meeting',
            appName: common('app.name'),
            time: '14:10',
            body: pro
              ? t('exampleMeeting', { minutes: 20, name: t('exampleName'), count: 3 })
              : t('exampleMeetingFree', { minutes: 20 }),
          },
          { key: 'mail', appName: common('app.name'), time: '08:00', body: t('exampleMail') },
          {
            key: 'shipment',
            appName: common('app.name'),
            time: '11:30',
            body: t('exampleShipment', { from: '14:00', to: '18:00' }),
          },
        ]}
      />
      <Text variant="secondary" tone="tertiaryStrong">
        {t('illustrative')}
      </Text>
    </OnboardingFrame>
  );
}
