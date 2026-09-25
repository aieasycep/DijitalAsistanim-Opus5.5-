/**
 * Root layout (M-GL-01): keeps the native splash up until the fonts are registered and the session
 * is restored, mounts the provider stack, and declares the root routes behind `Stack.Protected`
 * guards (M-GL-02): `(auth)` only signed out, the onboarding group while onboarding, `(tabs)` and
 * every detail route only when signed in, onboarded, on a supported version and active; the entry
 * resolver, `+not-found`, `update-required` and the two callbacks are always reachable. The demo
 * route exists only in demo builds. `ErrorBoundary` is M-GL-10.
 *
 * T-8.23/T-8.24/T-8.28: the startup clock starts with this module, Sentry starts before the first
 * render (scrubbed, no screenshots), the root is wrapped for the SDK's app-start measurement, and
 * `NotificationBridge` routes notification taps from the first frame.
 */
// The startup clock starts when this module is evaluated (T-8.28).
import { markStartupComplete } from '../src/lib/perf';
import { useTheme } from '@da/ui';
import * as Sentry from '@sentry/react-native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { NotificationBridge } from '../src/features/shell/NotificationBridge';
import { useShell } from '../src/features/shell/useShell';
import { isDemoBuild } from '../src/lib/env';
import { APP_FONTS } from '../src/lib/fonts';
import {
  APP_ROOT_SCREENS,
  DEMO_ROOT_SCREENS,
  ONBOARDING_ROOT_SCREENS,
  ROOT_SCREEN_OPTIONS,
  SETTINGS_ROOT_SCREENS,
  SIGNED_OUT_ROOT_SCREENS,
} from '../src/lib/router-guards';
import { initSentry } from '../src/lib/sentry';
import { AppProviders } from '../src/providers/AppProviders';
import { ShareIntakeBridge } from '../src/features/capture/ShareIntakeBridge';
// T-8.26 Android NI: sign-out wipe, background upload task, foreground upload and entitlement sync.
import { AniBridge } from '../src/features/android-ni/AniBridge';
// T-8.25: widget snapshot refresh triggers, the sign-in refresh and the sign-out clear hook.
import { WidgetBridge } from '../src/features/widgets/WidgetBridge';
// Feature hooks that must exist before the first sign-in or OAuth return (T-8.06, T-8.07, T-8.09).
import '../src/features/onboarding/post-sign-in';
import '../src/features/integrations/callback-handler';
import '../src/features/briefing/audio-cache';
// T-8.22: RevenueCat log-in/log-out hooks and the pending referral code after sign-in.
import '../src/lib/purchases';
import '../src/features/referral/pending';
// T-8.18 inline approval and editor sheets (registered with the sheet host at import).
import '../src/features/approvals/ApprovalSheet';
import '../src/features/approvals/InlineApprovalSheet';
import '../src/features/approvals/ApprovalEditorSheet';

export { RootErrorBoundary as ErrorBoundary } from '../src/features/shell/ShellErrorBoundary';

void SplashScreen.preventAutoHideAsync();
initSentry();

function RootNavigator() {
  const theme = useTheme();
  const { context, flags } = useShell();
  const demo = isDemoBuild();

  useEffect(() => {
    if (context.auth === 'loading') return;
    void SplashScreen.hideAsync();
    markStartupComplete();
  }, [context.auth]);

  return (
    <>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <ShareIntakeBridge signedIn={flags.app} />
      <AniBridge signedIn={flags.app} />
      <NotificationBridge signedIn={flags.app} />
      <WidgetBridge signedIn={flags.app} />
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
        <Stack.Protected guard={flags.app || flags.deletionStatus}>
          {SETTINGS_ROOT_SCREENS.map((name) => (
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

function RootLayout() {
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

export default Sentry.wrap(RootLayout);
