/**
 * Root layout: keeps the native splash up until the fonts are registered, then provides safe-area
 * insets and the ICU catalogs to every route. Auth, onboarding and deep-link guards join here with
 * the app shell (T-8.04).
 */
import { color } from '@da/design-tokens';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { I18nProvider } from '../src/i18n/I18nProvider';
import { APP_FONTS } from '../src/lib/fonts';
import { useSchemeName } from '../src/lib/useSchemeName';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(APP_FONTS);
  const scheme = useSchemeName();
  // The same files are embedded natively, so a failed runtime registration still renders text.
  const ready = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <I18nProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color[scheme].bg },
          }}
        />
      </I18nProvider>
    </SafeAreaProvider>
  );
}
