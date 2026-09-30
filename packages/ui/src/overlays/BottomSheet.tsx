/**
 * `BottomSheet` (alias `Sheet`; DESIGN_AUDIT §3.9, P:01 "Alt sayfa: seçim listeleri, düzeltme
 * menüsü, hatırlatıcı … Arka plan %35 ink.") — built on react-native-reanimated 4.5 and
 * react-native-gesture-handler 2.32 (the kit does not depend on @gorhom/bottom-sheet; see README).
 *
 * - Scrim `overlay.scrim`, 0 → 1 over 250 ms; tapping it dismisses.
 * - Sheet: surface, radius 28/28/0/0, padding 10/20/(insets.bottom + 16) (destructive 24 sides),
 *   `shadow.sheet`; grabber 36×5 r3; title `sheetTitle`, subtitle 13 secondary; content-height up
 *   to 90% of the window; keyboard-aware on iOS.
 * - Motion: opens in 300 ms (standard curve), closes in 240 ms (exit curve), light haptic on open;
 *   drag the handle down to close with a velocity snap (35% of the height or a fast fling), spring
 *   back otherwise. Reduce motion: no slide, only the 120 ms fade.
 * - Accessibility: `accessibilityViewIsModal`, focus moves to the title on open, the iOS escape
 *   gesture and the Android hardware back dismiss; `modal` presentation (default) is an RN `Modal`,
 *   whose native window confines TalkBack/VoiceOver to the sheet. `inline` renders in place (route
 *   sheets presented as `transparentModal`) and handles back through `useBackHandler`.
 */
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { Text } from '../primitives/Text.tsx';
import { focusAccessibility, hiddenFromA11y } from '../theme/a11y.ts';
import { useHaptic, useMotion } from '../theme/preferences.tsx';
import { useTheme } from '../theme/ThemeProvider.tsx';
import { useBackHandler } from './useBackHandler.ts';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface BottomSheetProps {
  readonly visible: boolean;
  /** Dismiss request (scrim tap, drag, hardware back, escape); the parent sets `visible=false`. */
  readonly onDismiss: () => void;
  /** Called after the close animation, when the sheet is unmounted (return focus here). */
  readonly onHidden?: () => void;
  readonly title?: string;
  readonly subtitle?: string;
  readonly children?: ReactNode;
  /** Sticky footer (CTAs) under the content. */
  readonly footer?: ReactNode;
  /** `destructive` uses 24 pt sides (consequence sheets). */
  readonly variant?: 'default' | 'destructive';
  /** `modal` (RN Modal, default) or `inline` (in place, for transparentModal routes). */
  readonly presentation?: 'modal' | 'inline';
  /** Blocks every dismissal path (e.g. while a mutation is in flight). */
  readonly dismissible?: boolean;
  /** Accessibility label of the sheet container when it has no title. */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

const DISMISS_RATIO = 0.35;
const DISMISS_VELOCITY = 900;

export function BottomSheet({
  visible,
  onDismiss,
  onHidden,
  title,
  subtitle,
  children,
  footer,
  variant = 'default',
  presentation = 'modal',
  dismissible = true,
  accessibilityLabel,
  testID,
}: BottomSheetProps): JSX.Element | null {
  const theme = useTheme();
  const c = theme.color;
  const motionControl = useMotion();
  const haptic = useHaptic();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const sheetHeight = useSharedValue(window.height);
  const translate = useSharedValue(window.height);
  const scrim = useSharedValue(0);
  const titleRef = useRef<View>(null);
  const hiddenRef = useRef(onHidden);
  useEffect(() => {
    hiddenRef.current = onHidden;
  }, [onHidden]);

  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      haptic('sheetOpen');
      scrim.set(motionControl.fade(1, theme.motion.duration.dim));
      translate.set(motionControl.animate(0, theme.motion.duration.sheetOpen));
      const timer = setTimeout(() => {
        focusAccessibility(titleRef);
      }, motionControl.duration(theme.motion.duration.sheetOpen));
      return () => {
        clearTimeout(timer);
      };
    }
    scrim.set(motionControl.fade(0, theme.motion.duration.sheetClose, 'exit'));
    translate.set(
      motionControl.animate(sheetHeight.get(), theme.motion.duration.sheetClose, 'exit'),
    );
    const timer = setTimeout(() => {
      setMounted(false);
      hiddenRef.current?.();
    }, motionControl.fadeDuration(theme.motion.duration.sheetClose));
    return () => {
      clearTimeout(timer);
    };
  }, [visible, haptic, motionControl, scrim, sheetHeight, translate, theme.motion]);

  const requestDismiss = (): void => {
    if (dismissible) onDismiss();
  };

  useBackHandler(presentation === 'inline' && visible, () => {
    requestDismiss();
    return true;
  });

  const reduce = motionControl.reduceMotion;
  const springBack = {
    damping: theme.motion.swipe.damping,
    stiffness: theme.motion.swipe.stiffness,
  };
  const pan = Gesture.Pan()
    .withTestId('ui.bottomSheet.pan')
    .enabled(dismissible)
    .activeOffsetY(8)
    .onUpdate((event) => {
      translate.set(Math.max(0, event.translationY));
    })
    .onEnd((event) => {
      if (
        event.translationY > sheetHeight.get() * DISMISS_RATIO ||
        event.velocityY > DISMISS_VELOCITY
      ) {
        scheduleOnRN(onDismiss);
      } else {
        translate.set(reduce ? 0 : withSpring(0, springBack));
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translate.get() }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.get() }));

  if (!mounted) return null;

  const onLayout = (event: LayoutChangeEvent): void => {
    const next = event.nativeEvent.layout.height;
    if (next > 0) sheetHeight.set(next);
  };
  const sideX = variant === 'destructive' ? theme.layout.destructiveSheetX : theme.layout.sheetX;

  const body = (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      testID={testID ?? `ui.bottomSheet.${variant}`}
    >
      <AnimatedPressable
        testID="ui.bottomSheet.scrim"
        {...hiddenFromA11y}
        onPress={requestDismiss}
        style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay.scrim }, scrimStyle]}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'flex-end' }}
        pointerEvents="box-none"
      >
        <Animated.View
          accessibilityViewIsModal
          accessibilityLabel={title === undefined ? accessibilityLabel : undefined}
          onAccessibilityEscape={requestDismiss}
          onLayout={onLayout}
          style={[
            {
              maxHeight: window.height * 0.9,
              backgroundColor: c.surface,
              borderTopLeftRadius: theme.radius.sheet,
              borderTopRightRadius: theme.radius.sheet,
              paddingTop: 10,
              paddingHorizontal: sideX,
              paddingBottom: insets.bottom + 16,
              zIndex: theme.zIndex.sheet,
            },
            theme.elevation('sheet'),
            reduce ? null : sheetStyle,
          ]}
        >
          <GestureDetector gesture={pan}>
            <View testID="ui.bottomSheet.handle" style={{ paddingBottom: 4 }}>
              <View
                {...hiddenFromA11y}
                style={{
                  alignSelf: 'center',
                  width: 36,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: c.control.grabber,
                  marginBottom: 14,
                }}
              />
              {title === undefined ? null : (
                <View ref={titleRef} accessible accessibilityRole="header">
                  <Text variant="sheetTitle">{title}</Text>
                </View>
              )}
              {subtitle === undefined ? null : (
                <Text variant="bodyXs" tone="secondary" style={{ marginTop: 4 }}>
                  {subtitle}
                </Text>
              )}
            </View>
          </GestureDetector>
          <View style={{ flexShrink: 1, marginTop: title === undefined ? 0 : 12 }}>{children}</View>
          {footer === undefined ? null : <View style={{ marginTop: 16, gap: 8 }}>{footer}</View>}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );

  if (presentation === 'inline') return body;
  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={requestDismiss}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>{body}</GestureHandlerRootView>
    </Modal>
  );
}

export const Sheet = BottomSheet;
