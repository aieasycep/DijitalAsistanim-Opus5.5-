/**
 * `InAppBanner` (DESIGN_AUDIT §3.9): the foreground-push banner ("Kritik bildirimler flow'u
 * kesebilir"). Top, surface r18, `shadow.page`; app tile 28 + title 14/600 + body 13 + chevron;
 * auto-hides after 4 s, swipe up dismisses, tap opens the deep link; the title is announced.
 */
import { useEffect, useRef, type JSX } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { Icon } from '../icons/Icon.tsx';
import { IconTile } from '../primitives/IconTile.tsx';
import { PressableScale } from '../primitives/PressableScale.tsx';
import { Text } from '../primitives/Text.tsx';
import { announce } from '../theme/a11y.ts';
import { useMotion } from '../theme/preferences.tsx';
import { useTheme } from '../theme/ThemeProvider.tsx';

export const IN_APP_BANNER_HOLD_MS = 4000;

export interface InAppBannerData {
  readonly id: string;
  readonly title: string;
  readonly body?: string;
}

export interface InAppBannerProps {
  readonly banner: InAppBannerData | null;
  /** Opens the notification's deep link. */
  readonly onPress: (id: string) => void;
  /** Auto-hide, swipe up, or after the press. */
  readonly onDismiss: (id: string) => void;
  readonly testID?: string;
}

export function InAppBanner({
  banner,
  onPress,
  onDismiss,
  testID,
}: InAppBannerProps): JSX.Element | null {
  const theme = useTheme();
  const motionControl = useMotion();
  const insets = useSafeAreaInsets();
  const offset = useSharedValue(0);
  const opacity = useSharedValue(0);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);
  const id = banner?.id;
  const title = banner?.title;
  useEffect(() => {
    if (id === undefined) return undefined;
    offset.set(0);
    opacity.set(0);
    opacity.set(motionControl.fade(1, theme.motion.duration.toastIn));
    if (title !== undefined) announce(title);
    const timer = setTimeout(() => {
      dismissRef.current(id);
    }, IN_APP_BANNER_HOLD_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [id, title, motionControl, offset, opacity, theme.motion.duration.toastIn]);
  const dismissCurrent = (): void => {
    if (id !== undefined) onDismiss(id);
  };
  const swipe = Gesture.Pan()
    .withTestId('ui.inAppBanner.pan')
    .activeOffsetY(-8)
    .onUpdate((event) => {
      offset.set(Math.min(0, event.translationY));
    })
    .onEnd((event) => {
      if (event.translationY < -24 || event.velocityY < -600) scheduleOnRN(dismissCurrent);
      else offset.set(0);
    });
  const animated = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateY: offset.get() }],
  }));
  if (banner === null) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, { zIndex: theme.zIndex.toast }]}
    >
      <GestureDetector gesture={swipe}>
        <Animated.View
          testID={testID ?? 'ui.inAppBanner'}
          style={[{ marginTop: insets.top + 8, marginHorizontal: 12 }, animated]}
        >
          <PressableScale
            feedback="card"
            testID="ui.inAppBanner.press"
            accessibilityLabel={[banner.title, banner.body].filter(Boolean).join('. ')}
            accessibilityActions={[{ name: 'escape' }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'escape') onDismiss(banner.id);
            }}
            onPress={() => {
              onPress(banner.id);
              onDismiss(banner.id);
            }}
            style={[
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                borderRadius: theme.radius.list,
                backgroundColor: theme.color.surface,
              },
              theme.elevation('page'),
            ]}
          >
            <IconTile icon="auto_awesome" size={28} tone="primary" filled />
            <View style={{ flex: 1 }}>
              <Text variant="label" numberOfLines={1}>
                {banner.title}
              </Text>
              {banner.body === undefined ? null : (
                <Text variant="bodyXs" tone="secondary" numberOfLines={2}>
                  {banner.body}
                </Text>
              )}
            </View>
            <Icon name="chevron_right" size={18} color={theme.color.icon.chevron} />
          </PressableScale>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
