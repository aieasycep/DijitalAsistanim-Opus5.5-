/**
 * `(onboarding)` group (T-8.06, M§34 / C-01 order). The root guard admits the group while signed
 * out or while onboarding is incomplete; this layout splits it: the intro pages (M-ON-01…04) are
 * for signed-out users only, the post-auth steps (M-ON-06…14A) for signed-in users only, and the
 * Android notification-access step (M-ON-14A) is never registered on iOS.
 */
import { useTheme } from '@da/ui';
import { Stack } from 'expo-router';
import { Platform } from 'react-native';

import { useAuth } from '../../src/providers/AuthProvider';
import { useStackMotion } from '../../src/lib/motion';

const INTRO_SCREENS = ['welcome', 'noise', 'proactive', 'control'] as const;
const STEP_SCREENS = [
  'connect-mail',
  'connect-calendar',
  'permissions',
  'personalization',
  'briefing-schedule',
  'vip',
  'analysis',
  'ready',
  'notifications',
] as const;

export default function OnboardingLayout() {
  const theme = useTheme();
  const stackMotion = useStackMotion();
  const { status } = useAuth();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.color.bg },
        ...stackMotion,
      }}
    >
      <Stack.Protected guard={status === 'signed_out'}>
        {INTRO_SCREENS.map((name) => (
          <Stack.Screen key={name} name={name} />
        ))}
      </Stack.Protected>
      <Stack.Protected guard={status === 'signed_in'}>
        {STEP_SCREENS.map((name) => (
          <Stack.Screen key={name} name={name} options={{ gestureEnabled: name !== 'analysis' }} />
        ))}
        <Stack.Protected guard={Platform.OS === 'android'}>
          <Stack.Screen name="android-notifications" />
        </Stack.Protected>
      </Stack.Protected>
    </Stack>
  );
}
