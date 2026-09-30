/**
 * `SwipeableRow` (DESIGN_AUDIT §3.13, D-18, SREQ-82). Swipe right = "Tamamlandı" (96 px track in
 * `swipe.completeBg`, DEV-10, `check_circle` FILL 26 + 11/600 label); swipe left reveals a 168 px
 * group ("Ertele" on `surfaceSunken`, "Önemli değil" on `surfaceTrack`, 24 glyphs, 11/600
 * `secondaryOnTrack` labels). The row tracks the finger 1:1; crossing 35% of the width gives a
 * light haptic; releasing past it applies the right action (a full left swipe applies the first
 * left action); otherwise it springs back (260 ms spring, damping 20, stiffness 220), or snaps the
 * left group open. Reduce motion jumps without the spring.
 *
 * Swipes are never the only path: every verb is also an `accessibilityAction` (pass
 * `children` as a function to hand the verbs to the card, e.g. `a11yActions` of `PriorityCard`)
 * and must exist as a visible control on the card (✓ / ··· menu).
 */
import { useState, type JSX, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Icon } from '../../icons/Icon.tsx';
import type { IconName } from '../../icons/generated/index.ts';
import { PressableScale } from '../../primitives/PressableScale.tsx';
import { Text } from '../../primitives/Text.tsx';
import { hiddenFromA11y } from '../../theme/a11y.ts';
import { useHaptic, useMotion } from '../../theme/preferences.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import type { A11yAction } from '../cards/shared.tsx';

export interface SwipeVerb {
  readonly key: string;
  /** Visible label and screen-reader action name ("Tamamlandı", "Ertele", "Önemli değil"). */
  readonly label: string;
  readonly icon?: IconName;
  readonly onAction: () => void;
}

export interface SwipeableRowProps {
  /** Swipe right (complete / close / acknowledge / "Bendim"). */
  readonly right?: SwipeVerb;
  /** Swipe left group (at most two). */
  readonly left?: readonly SwipeVerb[];
  /**
   * The row content. As a function it receives the verbs as `A11yAction`s for the card's own
   * `accessibilityActions`; as a node it is wrapped in an accessible container that carries them
   * (then `accessibilityLabel` is required).
   */
  readonly children: ReactNode | ((verbs: readonly A11yAction[]) => ReactNode);
  readonly accessibilityLabel?: string;
  readonly disabled?: boolean;
  readonly testID?: string;
}

const RIGHT_TRACK = 96;
const LEFT_ACTION = 84;

/** The swipe verbs as screen-reader actions (right first, then left). */
export function swipeA11yActions(
  right: SwipeVerb | undefined,
  left: readonly SwipeVerb[] | undefined,
): A11yAction[] {
  const verbs = [...(right === undefined ? [] : [right]), ...(left ?? []).slice(0, 2)];
  return verbs.map((v) => ({ key: v.key, label: v.label, onPress: v.onAction }));
}

export function SwipeableRow({
  right,
  left,
  children,
  accessibilityLabel,
  disabled = false,
  testID,
}: SwipeableRowProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const motionControl = useMotion();
  const haptic = useHaptic();
  const leftVerbs = (left ?? []).slice(0, 2);
  const groupWidth = leftVerbs.length * LEFT_ACTION;
  const width = useSharedValue(0);
  const translateX = useSharedValue(0);
  const start = useSharedValue(0);
  const crossed = useSharedValue(0);
  const [open, setOpen] = useState(false);
  const verbs = swipeA11yActions(right, leftVerbs);
  const threshold = theme.motion.swipe.threshold;
  const spring = { damping: theme.motion.swipe.damping, stiffness: theme.motion.swipe.stiffness };
  const reduce = motionControl.reduceMotion;
  const hasRight = right !== undefined;
  const hasLeft = leftVerbs.length > 0;

  const fireThreshold = (): void => {
    haptic('swipeThreshold');
  };
  const applyRight = (): void => {
    setOpen(false);
    right?.onAction();
  };
  const applyFirstLeft = (): void => {
    setOpen(false);
    leftVerbs[0]?.onAction();
  };
  const markOpen = (next: boolean): void => {
    setOpen(next);
  };

  const pan = Gesture.Pan()
    .withTestId(`${testID ?? 'ui.swipeableRow'}.pan`)
    .enabled(!disabled)
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onBegin(() => {
      start.set(translateX.get());
    })
    .onUpdate((event) => {
      let next = start.get() + event.translationX;
      if (!hasRight) next = Math.min(0, next);
      if (!hasLeft) next = Math.max(0, next);
      translateX.set(next);
      const past = Math.abs(next) >= width.get() * threshold;
      if (past && crossed.get() === 0) {
        crossed.set(1);
        scheduleOnRN(fireThreshold);
      } else if (!past && crossed.get() === 1) {
        crossed.set(0);
      }
    })
    .onEnd((event) => {
      // Decide from the release position (the last update can lag behind a fast fling).
      let x = start.get() + event.translationX;
      if (!hasRight) x = Math.min(0, x);
      if (!hasLeft) x = Math.max(0, x);
      const w = width.get();
      crossed.set(0);
      let target = 0;
      if (hasRight && x >= w * threshold) {
        scheduleOnRN(applyRight);
      } else if (hasLeft && -x >= Math.max(w * threshold, groupWidth + 24)) {
        scheduleOnRN(applyFirstLeft);
      } else if (hasLeft && -x >= groupWidth / 2) {
        target = -groupWidth;
      }
      translateX.set(reduce ? target : withSpring(target, spring));
      scheduleOnRN(markOpen, target !== 0);
    });

  const close = (): void => {
    setOpen(false);
    translateX.set(motionControl.animate(0, theme.motion.duration.swipeRelease));
  };

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.get() }] }));
  const rightTrack = useAnimatedStyle(() => ({ opacity: translateX.get() > 0 ? 1 : 0 }));
  const leftTrack = useAnimatedStyle(() => ({ opacity: translateX.get() < 0 ? 1 : 0 }));

  const onLayout = (event: LayoutChangeEvent): void => {
    width.set(event.nativeEvent.layout.width);
  };

  const content = typeof children === 'function' ? children(verbs) : children;
  const wrapped =
    typeof children === 'function' ? (
      content
    ) : (
      <View
        accessible
        accessibilityLabel={accessibilityLabel}
        accessibilityActions={verbs.map((v) => ({ name: v.key, label: v.label }))}
        onAccessibilityAction={(event) => {
          verbs.find((v) => v.key === event.nativeEvent.actionName)?.onPress();
        }}
      >
        {content}
      </View>
    );

  return (
    <View testID={testID ?? 'ui.swipeableRow'} onLayout={onLayout}>
      {right === undefined ? null : (
        <Animated.View
          {...hiddenFromA11y}
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              borderRadius: theme.radius.card,
              backgroundColor: c.swipe.completeBg,
              justifyContent: 'center',
            },
            rightTrack,
          ]}
        >
          <View style={{ alignItems: 'center', width: RIGHT_TRACK, gap: 2 }}>
            <Icon
              name={right.icon ?? 'check_circle'}
              filled
              size={26}
              color={c.swipe.completeText}
            />
            <Text variant="badge" weight={600} style={{ color: c.swipe.completeText }}>
              {right.label}
            </Text>
          </View>
        </Animated.View>
      )}
      {hasLeft ? (
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: groupWidth,
              flexDirection: 'row',
              borderRadius: theme.radius.card,
              overflow: 'hidden',
            },
            leftTrack,
          ]}
          importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
          accessibilityElementsHidden={!open}
        >
          {leftVerbs.map((verb, i) => (
            <PressableScale
              key={verb.key}
              testID={`ui.swipeableRow.left.${verb.key}`}
              feedback="none"
              accessibilityLabel={verb.label}
              onPress={() => {
                close();
                verb.onAction();
              }}
              style={{
                width: LEFT_ACTION,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                backgroundColor: i === 0 ? c.surfaceSunken : c.surfaceTrack,
              }}
            >
              <Icon
                name={verb.icon ?? (i === 0 ? 'schedule' : 'remove_circle')}
                size={24}
                color={c.text.secondaryOnTrack}
              />
              <Text variant="badge" weight={600} tone="secondaryOnTrack">
                {verb.label}
              </Text>
            </PressableScale>
          ))}
        </Animated.View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View testID="ui.swipeableRow.content" style={rowStyle}>
          {wrapped}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
