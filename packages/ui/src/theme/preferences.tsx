/**
 * UI preferences the app sets once at the root (ADR-03, DESIGN_AUDIT §2.13–§2.14):
 * - **Reduce motion** = the OS setting OR `user_preferences.reduce_motion` ("Hareketi azalt").
 *   With it on, every duration is 0 and only a 120 ms opacity transition remains; loops
 *   (shimmer, spinner, pulse, waveform, typing) stop.
 * - **Haptics**: the injected implementation, gated by `haptics_enabled`.
 * - **Locale**: drives Turkish-aware upper-casing (kickers, badges) and the default accessibility
 *   strings the kit takes from the `common` namespace of `@da/i18n`.
 * - **Screen reader / reduce transparency**: read from `AccessibilityInfo` (undo toasts stay 10 s
 *   with a screen reader; the tab bar turns opaque with Reduce Transparency).
 */
import { loadMessages, toUpper, type Locale, type Messages } from '@da/i18n';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { Easing, withTiming, type WithTimingConfig } from 'react-native-reanimated';
import { motion } from '@da/design-tokens';
import {
  hapticKindFor,
  type HapticEvent,
  type HapticKind,
  type HapticsHandler,
} from './haptics.ts';

export type CommonStrings = Messages['common'];

interface PreferencesValue {
  readonly reduceMotion: boolean;
  readonly screenReaderEnabled: boolean;
  readonly reduceTransparency: boolean;
  readonly hapticsEnabled: boolean;
  readonly onHaptic: HapticsHandler | undefined;
  readonly locale: Locale;
  readonly strings: CommonStrings;
}

const DEFAULT_LOCALE: Locale = 'tr';

const PreferencesContext = createContext<PreferencesValue>({
  reduceMotion: false,
  screenReaderEnabled: false,
  reduceTransparency: false,
  hapticsEnabled: true,
  onHaptic: undefined,
  locale: DEFAULT_LOCALE,
  strings: loadMessages(DEFAULT_LOCALE).common,
});

export interface UiPreferencesProviderProps {
  /** `user_preferences.reduce_motion`; OR-ed with the OS setting unless `followSystem` is off. */
  readonly reduceMotion?: boolean;
  /** Also honour the OS "Reduce Motion" / "Remove animations" setting (default true). */
  readonly followSystemReduceMotion?: boolean;
  /** `user_preferences.haptics_enabled` (default true). */
  readonly hapticsEnabled?: boolean;
  /** The app's haptics implementation (expo-haptics); see `haptics.ts` for the mapping. */
  readonly onHaptic?: HapticsHandler;
  /** UI locale (default `tr`). */
  readonly locale?: Locale;
  /** Test/preview overrides of the `AccessibilityInfo` reads. */
  readonly screenReaderEnabled?: boolean;
  readonly reduceTransparency?: boolean;
  readonly children: ReactNode;
}

function useAccessibilityFlag(
  read: () => Promise<boolean>,
  event: 'reduceMotionChanged' | 'screenReaderChanged' | 'reduceTransparencyChanged',
  enabled: boolean,
): boolean {
  const [value, setValue] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    read().then(
      (next) => {
        if (active) setValue(next);
      },
      () => {
        if (active) setValue(false);
      },
    );
    const subscription = AccessibilityInfo.addEventListener(event, (next: boolean) => {
      setValue(next);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [read, event, enabled]);
  return enabled && value;
}

const readReduceMotion = (): Promise<boolean> => AccessibilityInfo.isReduceMotionEnabled();
const readScreenReader = (): Promise<boolean> => AccessibilityInfo.isScreenReaderEnabled();
const readReduceTransparency = (): Promise<boolean> =>
  AccessibilityInfo.isReduceTransparencyEnabled();

export function UiPreferencesProvider({
  reduceMotion = false,
  followSystemReduceMotion = true,
  hapticsEnabled = true,
  onHaptic,
  locale = DEFAULT_LOCALE,
  screenReaderEnabled,
  reduceTransparency,
  children,
}: UiPreferencesProviderProps): JSX.Element {
  const systemReduceMotion = useAccessibilityFlag(
    readReduceMotion,
    'reduceMotionChanged',
    followSystemReduceMotion,
  );
  const systemScreenReader = useAccessibilityFlag(
    readScreenReader,
    'screenReaderChanged',
    screenReaderEnabled === undefined,
  );
  const systemReduceTransparency = useAccessibilityFlag(
    readReduceTransparency,
    'reduceTransparencyChanged',
    reduceTransparency === undefined && Platform.OS === 'ios',
  );
  const value = useMemo<PreferencesValue>(
    () => ({
      reduceMotion: reduceMotion || systemReduceMotion,
      screenReaderEnabled: screenReaderEnabled ?? systemScreenReader,
      reduceTransparency: reduceTransparency ?? systemReduceTransparency,
      hapticsEnabled,
      onHaptic,
      locale,
      strings: loadMessages(locale).common,
    }),
    [
      reduceMotion,
      systemReduceMotion,
      screenReaderEnabled,
      systemScreenReader,
      reduceTransparency,
      systemReduceTransparency,
      hapticsEnabled,
      onHaptic,
      locale,
    ],
  );
  return <PreferencesContext value={value}>{children}</PreferencesContext>;
}

export interface UiPreferences {
  readonly reduceMotion: boolean;
  readonly screenReaderEnabled: boolean;
  readonly reduceTransparency: boolean;
  readonly hapticsEnabled: boolean;
  readonly locale: Locale;
}

export function useUiPreferences(): UiPreferences {
  const p = use(PreferencesContext);
  return {
    reduceMotion: p.reduceMotion,
    screenReaderEnabled: p.screenReaderEnabled,
    reduceTransparency: p.reduceTransparency,
    hapticsEnabled: p.hapticsEnabled,
    locale: p.locale,
  };
}

/** The `common` namespace of the active locale (default accessibility strings). */
export function useUiStrings(): CommonStrings {
  return use(PreferencesContext).strings;
}

/** Turkish-aware upper-casing for kickers and badges ("samimi" → "SAMİMİ" in `tr`). */
export function useUpper(): (text: string) => string {
  const { locale } = use(PreferencesContext);
  return useCallback((text: string) => toUpper(text, locale), [locale]);
}

/**
 * Fires a haptic for a product event or kind, if haptics are enabled and an implementation was
 * injected. Returns a stable function.
 */
export function useHaptic(): (event: HapticEvent | HapticKind) => void {
  const { hapticsEnabled, onHaptic } = use(PreferencesContext);
  return useCallback(
    (event: HapticEvent | HapticKind) => {
      if (!hapticsEnabled || onHaptic === undefined) return;
      const kind: HapticKind =
        event === 'success' || event === 'warning' || event === 'light' || event === 'selection'
          ? event
          : hapticKindFor(event);
      try {
        onHaptic(kind);
      } catch {
        // Haptics are feedback only; a failing implementation never breaks the interaction.
      }
    },
    [hapticsEnabled, onHaptic],
  );
}

const STANDARD = Easing.bezier(...motion.easing.standard);
const EXIT = Easing.bezier(...motion.easing.exit);

export type MotionCurve = 'standard' | 'exit' | 'linear';

function curveOf(curve: MotionCurve): WithTimingConfig['easing'] {
  if (curve === 'linear') return Easing.linear;
  return curve === 'exit' ? EXIT : STANDARD;
}

export interface MotionControl {
  readonly reduceMotion: boolean;
  /** False under reduce motion: loops (shimmer, spinner, pulse, bars) must not run. */
  readonly loops: boolean;
  /** A transform/size/position duration: 0 under reduce motion, capped at 600 ms. */
  readonly duration: (ms: number) => number;
  /** An opacity duration: 120 ms under reduce motion ("yalnızca opaklık geçişi 120 ms kalır"). */
  readonly fadeDuration: (ms: number) => number;
  /** `withTiming` config for a movement. */
  readonly timing: (ms: number, curve?: MotionCurve) => WithTimingConfig;
  /** `withTiming` config for an opacity change. */
  readonly fadeTiming: (ms: number, curve?: MotionCurve) => WithTimingConfig;
  /** Animates to `target` (movement), or jumps there when the duration resolves to 0. */
  readonly animate: (target: number, ms: number, curve?: MotionCurve) => number;
  /** Animates an opacity to `target`. */
  readonly fade: (target: number, ms: number, curve?: MotionCurve) => number;
}

export function motionControl(reduceMotion: boolean): MotionControl {
  const duration = (ms: number): number => (reduceMotion ? 0 : Math.min(ms, motion.max));
  const fadeDuration = (ms: number): number =>
    reduceMotion ? motion.duration.reducedOpacity : Math.min(ms, motion.max);
  const timing = (ms: number, curve: MotionCurve = 'standard'): WithTimingConfig => ({
    duration: duration(ms),
    easing: curveOf(curve),
  });
  const fadeTiming = (ms: number, curve: MotionCurve = 'standard'): WithTimingConfig => ({
    duration: fadeDuration(ms),
    easing: curveOf(curve),
  });
  return {
    reduceMotion,
    loops: !reduceMotion,
    duration,
    fadeDuration,
    timing,
    fadeTiming,
    animate: (target, ms, curve) => {
      const config = timing(ms, curve);
      return config.duration === 0 ? target : withTiming(target, config);
    },
    fade: (target, ms, curve) => withTiming(target, fadeTiming(ms, curve)),
  };
}

const MOTION_ON = motionControl(false);
const MOTION_REDUCED = motionControl(true);

/** Motion helpers honouring reduce motion (stable objects). */
export function useMotion(): MotionControl {
  return use(PreferencesContext).reduceMotion ? MOTION_REDUCED : MOTION_ON;
}
