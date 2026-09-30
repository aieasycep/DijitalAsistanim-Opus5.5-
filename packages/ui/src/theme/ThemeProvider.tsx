/**
 * Theme resolution (DESIGN_AUDIT §2.1, M§38): `user_preferences.theme ∈ {system, light, dark}`,
 * default `system`, which follows the OS appearance. The provider is controlled: the app persists
 * the preference (MMKV + `user_preferences.theme`) and passes it in; `useThemePreference()` lets
 * the Appearance screen change it through `onPreferenceChange`.
 */
import { createContext, use, useMemo, type JSX, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { themes, type ColorSchemeName, type Theme } from './theme.ts';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

interface ThemeContextValue {
  readonly theme: Theme;
  readonly preference: ThemePreference;
  readonly setPreference: ((preference: ThemePreference) => void) | undefined;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: themes.light,
  preference: 'system',
  setPreference: undefined,
});

export interface ThemeProviderProps {
  /** The user's choice; `system` follows the OS appearance. Defaults to `system`. */
  readonly preference?: ThemePreference;
  /** Called by `useThemePreference().setPreference` (the app persists and re-renders). */
  readonly onPreferenceChange?: (preference: ThemePreference) => void;
  /**
   * Overrides the OS scheme used for `system` (tests, previews, store screenshots). The OS
   * appearance is read with `useColorScheme()` otherwise.
   */
  readonly systemScheme?: ColorSchemeName;
  readonly children: ReactNode;
}

/** Resolves a preference against the OS scheme. */
export function resolveScheme(
  preference: ThemePreference,
  system: string | null | undefined,
): ColorSchemeName {
  if (preference !== 'system') return preference;
  return system === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({
  preference = 'system',
  onPreferenceChange,
  systemScheme,
  children,
}: ThemeProviderProps): JSX.Element {
  const osScheme = useColorScheme();
  const scheme = resolveScheme(preference, systemScheme ?? osScheme);
  const value = useMemo<ThemeContextValue>(
    () => ({ theme: themes[scheme], preference, setPreference: onPreferenceChange }),
    [scheme, preference, onPreferenceChange],
  );
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

/**
 * The active theme. Outside a `ThemeProvider` it is the light theme, so isolated renders (tests,
 * previews) still resolve every token.
 */
export function useTheme(): Theme {
  return use(ThemeContext).theme;
}

export interface ThemePreferenceControl {
  readonly preference: ThemePreference;
  readonly scheme: ColorSchemeName;
  /** Undefined when the provider was not given `onPreferenceChange` (read-only theme). */
  readonly setPreference: ((preference: ThemePreference) => void) | undefined;
}

/** The current preference and its setter, for the Appearance screen (7.8). */
export function useThemePreference(): ThemePreferenceControl {
  const { theme, preference, setPreference } = use(ThemeContext);
  return { preference, scheme: theme.scheme, setPreference };
}
