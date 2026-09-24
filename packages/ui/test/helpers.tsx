/**
 * Test helpers: renders a UI element inside the providers the app mounts (safe area, gesture
 * root, theme, preferences) with deterministic accessibility flags, plus small style readers.
 */
import type { Locale } from '@da/i18n';
import { render, type RenderResult } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { TestInstance } from 'test-renderer';
import {
  ThemeProvider,
  ToastProvider,
  UiPreferencesProvider,
  type ColorSchemeName,
  type HapticsHandler,
} from '../src/index.ts';

export const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export interface UiOptions {
  readonly scheme?: ColorSchemeName;
  readonly reduceMotion?: boolean;
  readonly onHaptic?: HapticsHandler;
  readonly hapticsEnabled?: boolean;
  readonly locale?: Locale;
  readonly screenReaderEnabled?: boolean;
  readonly reduceTransparency?: boolean;
  readonly withToasts?: boolean;
}

export function Providers({
  children,
  ...options
}: UiOptions & { readonly children: ReactNode }): ReactElement {
  const content =
    options.withToasts === true ? <ToastProvider>{children}</ToastProvider> : children;
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ThemeProvider preference={options.scheme ?? 'light'}>
          <UiPreferencesProvider
            reduceMotion={options.reduceMotion ?? false}
            followSystemReduceMotion={false}
            hapticsEnabled={options.hapticsEnabled ?? true}
            onHaptic={options.onHaptic}
            locale={options.locale ?? 'tr'}
            screenReaderEnabled={options.screenReaderEnabled ?? false}
            reduceTransparency={options.reduceTransparency ?? false}
          >
            {content}
          </UiPreferencesProvider>
        </ThemeProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

export async function renderUi(ui: ReactElement, options: UiOptions = {}): Promise<RenderResult> {
  return render(<Providers {...options}>{ui}</Providers>);
}

/** The flattened static style of a host element (animated styles excluded). */
export function styleOf(element: TestInstance): ViewStyle & TextStyle {
  // Flattening an array always yields an object, even when the element has no style.
  return StyleSheet.flatten([element.props.style as StyleProp<ViewStyle & TextStyle>]);
}

/** The current Reanimated animated style of a host element (Jest mode). */
export function animatedStyle(element: TestInstance): Record<string, unknown> {
  return getAnimatedStyle(element) as Record<string, unknown>;
}

/** Every host element below (and including) `root`. */
export function allHosts(root: TestInstance): TestInstance[] {
  const out: TestInstance[] = [root];
  for (const child of root.children) {
    if (typeof child !== 'string') out.push(...allHosts(child));
  }
  return out;
}

/** All string colours appearing in host styles (static and animated) below `root`. */
export function colorsIn(root: TestInstance): string[] {
  const keys = ['backgroundColor', 'color', 'borderColor', 'borderTopColor', 'tintColor'];
  const out: string[] = [];
  for (const host of allHosts(root)) {
    const style = styleOf(host) as Record<string, unknown>;
    for (const key of keys) {
      const value = style[key];
      if (typeof value === 'string') out.push(value);
    }
    const fill: unknown = host.props.color;
    if (typeof fill === 'string') out.push(fill);
  }
  return out;
}
