/**
 * The settings stack (SCREEN_AND_FLOW_MAP Part 4 §0.3), presented as a modal by the root layout.
 * `initialRouteName: 'index'` keeps the hub under any deep-linked sub-page so Back returns to it.
 * Every page needs the app guard; a `deletion_pending` account reaches only the deletion status
 * page (M-SET-39, M-GL-02 step 4). Pending settings writes are replayed on reconnect/foreground.
 */
import { useTheme } from '@da/ui';
import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { bindSettingsReplay } from '../../src/features/settings/save';
import { useShell } from '../../src/features/shell/useShell';
import { DELETION_STATUS_SCREEN, SETTINGS_SCREENS } from '../../src/lib/router-guards';
import { useStackMotion } from '../../src/lib/motion';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/features/shell/ShellErrorBoundary';

export const unstable_settings = { initialRouteName: 'index' };

export default function SettingsLayout() {
  const theme = useTheme();
  const stackMotion = useStackMotion();
  const { flags } = useShell();
  useEffect(() => {
    bindSettingsReplay();
  }, []);
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.color.bg },
        ...stackMotion,
      }}
    >
      <Stack.Protected guard={flags.app}>
        {SETTINGS_SCREENS.filter((name) => name !== DELETION_STATUS_SCREEN).map((name) => (
          <Stack.Screen key={name} name={name} />
        ))}
      </Stack.Protected>
      <Stack.Screen name={DELETION_STATUS_SCREEN} />
    </Stack>
  );
}
