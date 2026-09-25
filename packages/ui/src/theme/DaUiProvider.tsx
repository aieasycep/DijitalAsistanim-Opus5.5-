/**
 * `DaUiProvider`: the one provider the mobile app mounts (inside `SafeAreaProvider` and
 * `GestureHandlerRootView`, after fonts are loaded) — theme resolution, UI preferences (reduce
 * motion, haptics, locale) and the toast queue.
 */
import type { JSX, ReactNode } from 'react';
import type { Locale } from '@da/i18n';
import { ToastProvider } from '../overlays/Toast.tsx';
import type { HapticsHandler } from './haptics.ts';
import { UiPreferencesProvider } from './preferences.tsx';
import { ThemeProvider, type ThemePreference } from './ThemeProvider.tsx';
import type { ColorSchemeName } from './theme.ts';

export interface DaUiProviderProps {
  /** `user_preferences.theme` (default `system`). */
  readonly themePreference?: ThemePreference;
  readonly onThemePreferenceChange?: (preference: ThemePreference) => void;
  /** `user_preferences.reduce_motion` (OR-ed with the OS setting). */
  readonly reduceMotion?: boolean;
  /** `user_preferences.haptics_enabled`. */
  readonly hapticsEnabled?: boolean;
  /** The expo-haptics implementation. */
  readonly onHaptic?: HapticsHandler;
  readonly locale?: Locale;
  /** App text-size multiplier (M-SET-61: 0.9 · 1 · 1.15 · 1.3). */
  readonly textScale?: number;
  /** Toast distance from the bottom (tab bar height + 14 on tab screens). */
  readonly toastBottomOffset?: number;
  /** Overrides for tests, previews and store screenshots. */
  readonly systemScheme?: ColorSchemeName;
  readonly screenReaderEnabled?: boolean;
  readonly reduceTransparency?: boolean;
  readonly followSystemReduceMotion?: boolean;
  readonly children: ReactNode;
}

export function DaUiProvider({
  themePreference = 'system',
  onThemePreferenceChange,
  reduceMotion,
  hapticsEnabled,
  onHaptic,
  locale,
  textScale,
  toastBottomOffset,
  systemScheme,
  screenReaderEnabled,
  reduceTransparency,
  followSystemReduceMotion,
  children,
}: DaUiProviderProps): JSX.Element {
  return (
    <ThemeProvider
      preference={themePreference}
      onPreferenceChange={onThemePreferenceChange}
      systemScheme={systemScheme}
    >
      <UiPreferencesProvider
        reduceMotion={reduceMotion}
        followSystemReduceMotion={followSystemReduceMotion}
        hapticsEnabled={hapticsEnabled}
        onHaptic={onHaptic}
        locale={locale}
        textScale={textScale}
        screenReaderEnabled={screenReaderEnabled}
        reduceTransparency={reduceTransparency}
      >
        <ToastProvider bottomOffset={toastBottomOffset}>{children}</ToastProvider>
      </UiPreferencesProvider>
    </ThemeProvider>
  );
}
