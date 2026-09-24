/**
 * Root layout (M-GL-01): keeps the native splash up until the fonts are registered and the session
 * is restored, mounts the provider stack, and declares the root routes behind `Stack.Protected`
 * guards (M-GL-02): `(auth)` only signed out, the onboarding group while onboarding, `(tabs)` and
 * every detail route only when signed in, onboarded, on a supported version and active; the entry
 * resolver, `+not-found`, `update-required` and the two callbacks are always reachable. The demo
 * route exists only in demo builds. `ErrorBoundary` is M-GL-10.
 */
import { useTheme } from '@da/ui';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { useShell } from '../src/features/shell/useShell';
import { isDemoBuild } from '../src/lib/env';
import { APP_FONTS } from '../src/lib/fonts';
import {
  APP_ROOT_SCREENS,
  DEMO_ROOT_SCREENS,
  ONBOARDING_ROOT_SCREENS,
  ROOT_SCREEN_OPTIONS,
  SIGNED_OUT_ROOT_SCREENS,
} from '../src/lib/router-guards';
import { AppProviders } from '../src/providers/AppProviders';
import { ShareIntakeBridge } from '../src/features/capture/ShareIntakeBridge';
// Feature hooks that must exist before the first sign-in or OAuth return (T-8.06, T-8.07, T-8.09).
import '../src/features/onboarding/post-sign-in';
import '../src/features/integrations/callback-handler';
import '../src/features/briefing/audio-cache';
// T-8.18 inline approval and editor sheets (registered with the sheet host at import).
import '../src/features/approvals/ApprovalSheet';
import '../src/features/approvals/ApprovalEditorSheet';

export { RootErrorBoundary as ErrorBoundary } from '../src/features/shell/ShellErrorBoundary';

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const theme = useTheme();
  const { context, flags } = useShell();
  const demo = isDemoBuild();

  useEffect(() => {
    if (context.auth !== 'loading') void SplashScreen.hideAsync();
  }, [context.auth]);

  return (
    <>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <ShareIntakeBridge signedIn={flags.app} />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.bg } }}
      >
        <Stack.Screen name="index" />
        <Stack.Protected guard={flags.signedOut}>
          {SIGNED_OUT_ROOT_SCREENS.map((name) => (
            <Stack.Screen key={name} name={name} />
          ))}
        </Stack.Protected>
        <Stack.Protected guard={flags.onboarding}>
          {ONBOARDING_ROOT_SCREENS.map((name) => (
            <Stack.Screen key={name} name={name} />
          ))}
        </Stack.Protected>
        <Stack.Protected guard={flags.app}>
          {APP_ROOT_SCREENS.map((name) => (
            <Stack.Screen key={name} name={name} options={ROOT_SCREEN_OPTIONS[name]} />
          ))}
        </Stack.Protected>
        {demo ? DEMO_ROOT_SCREENS.map((name) => <Stack.Screen key={name} name={name} />) : null}
        <Stack.Screen
          name="update-required"
          options={{ presentation: 'fullScreenModal', gestureEnabled: false }}
        />
        <Stack.Screen name="auth/callback" />
        <Stack.Screen name="integrations/callback" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(APP_FONTS);
  // The same files are embedded natively, so a failed runtime registration still renders text.
  const ready = fontsLoaded || fontError !== null;
  if (!ready) return null;
  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}
