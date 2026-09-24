import { color, shadow, shadowToCss } from '@da/design-tokens';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';
import {
  AiGlowSurface,
  Card,
  Divider,
  GradientSurface,
  IconTile,
  IllustrationFrame,
  onGradientTone,
  PressableScale,
  SkeletonBlock,
  SkeletonGroup,
  Spinner,
  Surface,
  type HapticKind,
} from '../src/index.ts';
import { animatedStyle, renderUi, styleOf } from './helpers.tsx';

describe('PressableScale', () => {
  it('fires onPress with role, label and hit slop', async () => {
    const onPress = jest.fn();
    await renderUi(
      <PressableScale
        accessibilityLabel="Kapat"
        onPress={onPress}
        visualSize={{ width: 36, height: 36 }}
        testID="p"
      >
        <RNText>x</RNText>
      </PressableScale>,
    );
    const button = screen.getByRole('button', { name: 'Kapat' });
    expect(button).toHaveProp('hitSlop', { top: 4, bottom: 4, left: 4, right: 4 });
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('blocks presses and exposes the state when disabled or busy', async () => {
    const onPress = jest.fn();
    await renderUi(
      <>
        <PressableScale accessibilityLabel="A" onPress={onPress} disabled>
          <RNText>a</RNText>
        </PressableScale>
        <PressableScale accessibilityLabel="B" onPress={onPress} busy>
          <RNText>b</RNText>
        </PressableScale>
      </>,
    );
    const a = screen.getByRole('button', { name: 'A' });
    const b = screen.getByRole('button', { name: 'B' });
    expect(a).toBeDisabled();
    expect(b.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await fireEvent.press(a);
    await fireEvent.press(b);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('fires the selection haptic on press', async () => {
    const onHaptic = jest.fn<(kind: HapticKind) => void>();
    await renderUi(
      <PressableScale accessibilityLabel="Seç" onPress={jest.fn()} haptic="select">
        <RNText>x</RNText>
      </PressableScale>,
      { onHaptic },
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Seç' }));
    expect(onHaptic).toHaveBeenCalledWith('selection');
  });

  it('shows the keyboard focus ring while focused', async () => {
    await renderUi(
      <PressableScale accessibilityLabel="Odak" onPress={jest.fn()} testID="f">
        <RNText>x</RNText>
      </PressableScale>,
    );
    const el = screen.getByTestId('f');
    await fireEvent(el, 'focus');
    expect(styleOf(el).boxShadow).toBe(shadowToCss(shadow.light.focusRing));
    await fireEvent(el, 'blur');
    expect(styleOf(el).boxShadow).toBeUndefined();
  });

  describe('press scale', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('scales to .97 over 120 ms and drops the scale under reduce motion', async () => {
      await renderUi(
        <PressableScale accessibilityLabel="Bas" onPress={jest.fn()} testID="s">
          <RNText>x</RNText>
        </PressableScale>,
      );
      await fireEvent(screen.getByTestId('s'), 'pressIn');
      await act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(animatedStyle(screen.getByTestId('s'))).toMatchObject({
        transform: [{ scale: 0.97 }],
      });

      await renderUi(
        <PressableScale accessibilityLabel="Bas" onPress={jest.fn()} testID="r">
          <RNText>x</RNText>
        </PressableScale>,
        { reduceMotion: true },
      );
      await fireEvent(screen.getByTestId('r'), 'pressIn');
      await act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(animatedStyle(screen.getByTestId('r'))).toMatchObject({ transform: [{ scale: 1 }] });
    });
  });
});

describe('Surface and Card', () => {
  it('uses the light shadow and the dark hairline ring', async () => {
    await renderUi(<Surface testID="s" />);
    expect(styleOf(screen.getByTestId('s'))).toMatchObject({
      backgroundColor: color.light.surface,
      borderRadius: 20,
      boxShadow: shadowToCss(shadow.light.card),
    });
    await renderUi(<Surface testID="s" />, { scheme: 'dark' });
    expect(styleOf(screen.getByTestId('s'))).toMatchObject({
      backgroundColor: color.dark.surface,
      boxShadow: shadowToCss(shadow.dark.card),
    });
  });

  it('makes a pressable card one button with a composed label and selected ring', async () => {
    const onPress = jest.fn();
    await renderUi(
      <Card onPress={onPress} accessibilityLabel="Acil, 08:42. Teklif" selected>
        <RNText>Teklif</RNText>
      </Card>,
    );
    const card = screen.getByRole('button', { name: 'Acil, 08:42. Teklif' });
    expect(card.props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(card);
    expect(onPress).toHaveBeenCalled();
  });

  it('renders the AI glow and gradients as hidden svg fills', async () => {
    await renderUi(
      <>
        <AiGlowSurface testID="glow">
          <RNText>AI</RNText>
        </AiGlowSurface>
        <GradientSurface gradient="night" testID="night">
          <RNText>Gece</RNText>
        </GradientSurface>
      </>,
      { scheme: 'dark' },
    );
    expect(screen.getByText('AI')).toBeOnTheScreen();
    expect(screen.getByText('Gece')).toBeOnTheScreen();
    expect(styleOf(screen.getByTestId('glow')).backgroundColor).toBe(color.dark.surface);
  });

  it('keeps small text on gradients inside the text-safe band', () => {
    expect(onGradientTone(0.5, 'kicker')).toBe('onGradientTertiary');
    expect(onGradientTone(0.7, 'kicker')).toBe('onGradient');
    expect(onGradientTone(0.8, 'secondary')).toBe('onGradientSecondary');
    expect(onGradientTone(0.9, 'secondary')).toBe('onGradient');
  });

  it('hides dividers and tiles from assistive technology', async () => {
    await renderUi(
      <>
        <Divider />
        <IconTile icon="mail" testID="tile" />
      </>,
    );
    expect(screen.queryByTestId('tile')).toBeNull();
    expect(screen.getByTestId('tile', { includeHiddenElements: true })).toBeTruthy();
  });

  it('gives illustrations one label and drops the tilt under reduce motion', async () => {
    await renderUi(
      <IllustrationFrame accessibilityLabel="Örnek kart" tilt={2}>
        <RNText>iç</RNText>
      </IllustrationFrame>,
    );
    const frame = screen.getByRole('image', { name: 'Örnek kart' });
    expect(styleOf(frame).transform).toEqual([{ rotate: '2deg' }]);
    expect(frame).toHaveProp('pointerEvents', 'none');
    await renderUi(
      <IllustrationFrame accessibilityLabel="Örnek kart" tilt={2}>
        <RNText>iç</RNText>
      </IllustrationFrame>,
      { reduceMotion: true },
    );
    expect(styleOf(screen.getByRole('image', { name: 'Örnek kart' })).transform).toBeUndefined();
  });
});

describe('loading primitives', () => {
  it('shimmers skeleton blocks and shows a static block under reduce motion', async () => {
    await renderUi(<SkeletonBlock height={16} testID="sk" />);
    expect(screen.getByTestId('sk.shimmer', { includeHiddenElements: true })).toBeTruthy();
    expect(styleOf(screen.getByTestId('sk', { includeHiddenElements: true })).backgroundColor).toBe(
      color.light.skeleton.base,
    );
    await renderUi(<SkeletonBlock height={16} testID="sk" />, { reduceMotion: true });
    expect(screen.queryByTestId('sk.shimmer', { includeHiddenElements: true })).toBeNull();
  });

  it('uses radius h/2 and 8 for 22 pt title bars', async () => {
    await renderUi(
      <>
        <SkeletonBlock height={12} testID="a" />
        <SkeletonBlock height={22} testID="b" />
      </>,
    );
    expect(styleOf(screen.getByTestId('a', { includeHiddenElements: true })).borderRadius).toBe(6);
    expect(styleOf(screen.getByTestId('b', { includeHiddenElements: true })).borderRadius).toBe(8);
  });

  it('announces the skeleton group as busy "Yükleniyor"', async () => {
    await renderUi(
      <SkeletonGroup testID="g">
        <SkeletonBlock height={12} />
      </SkeletonGroup>,
    );
    const group = screen.getByLabelText('Yükleniyor');
    expect(group.props.accessibilityState).toMatchObject({ busy: true });
  });

  it('hides the spinner and stops its loop under reduce motion', async () => {
    jest.useFakeTimers();
    try {
      await renderUi(<Spinner testID="sp" />);
      await act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(screen.queryByTestId('sp')).toBeNull();
      expect(
        animatedStyle(screen.getByTestId('sp', { includeHiddenElements: true })),
      ).not.toMatchObject({
        transform: [{ rotate: '0deg' }],
      });
      await renderUi(<Spinner testID="sp2" />, { reduceMotion: true });
      await act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(
        animatedStyle(screen.getByTestId('sp2', { includeHiddenElements: true })),
      ).toMatchObject({
        transform: [{ rotate: '0deg' }],
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
