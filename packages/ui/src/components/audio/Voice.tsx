/**
 * Voice and AI-activity visuals (DESIGN_AUDIT §3.9–§3.10): `VoiceOrb` (pulse `dapulse` 1.6 s,
 * level-driven when metering exists), `VoiceWaveform`, `TranscriptText`, `AnswerBubble`,
 * `TranscriptCard` + `MiniWaveform`, `PulsingRing` (analysis in progress, 2.10) and
 * `TypingIndicator`. Every loop stops under reduce motion; decorative parts are hidden and the
 * meaning is carried by labels and titles.
 */
import type { JSX, ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Icon } from '../../icons/Icon.tsx';
import { PressableScale } from '../../primitives/PressableScale.tsx';
import { Card } from '../../primitives/Surface.tsx';
import { Text } from '../../primitives/Text.tsx';
import { useLoop } from '../../primitives/useLoop.ts';
import { hiddenFromA11y } from '../../theme/a11y.ts';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import { nightInk } from './Audio.tsx';

export interface VoiceOrbProps {
  readonly listening: boolean;
  readonly onPress: () => void;
  /** "Dinlemeyi başlat" / "Dinlemeyi durdur" */
  readonly accessibilityLabel: string;
  /** 0–1 input level when metering is available (scales the ring). */
  readonly level?: number;
  readonly size?: 'lg' | 'sm';
  readonly testID?: string;
}

export function VoiceOrb({
  listening,
  onPress,
  accessibilityLabel,
  level,
  size = 'lg',
  testID,
}: VoiceOrbProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const ink = nightInk(theme);
  const outer = size === 'lg' ? 120 : 64;
  const core = size === 'lg' ? 80 : 44;
  const pulse = useLoop({
    durationMs: theme.motion.loop.pulse,
    active: listening && level === undefined,
    rest: 0,
  });
  const from = theme.motion.scale.pulseFrom;
  const to = theme.motion.scale.pulseTo;
  const metered = level === undefined ? undefined : 1 + Math.min(1, Math.max(0, level)) * 0.2;
  const ring = useAnimatedStyle(() => {
    if (metered !== undefined) return { opacity: 0.6, transform: [{ scale: metered }] };
    const p = pulse.get();
    return { opacity: 0.6 * (1 - p), transform: [{ scale: from + (to - from) * p }] };
  });
  return (
    <PressableScale
      testID={testID ?? `ui.voiceOrb.${listening ? 'listening' : 'idle'}`}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: listening }}
      onPress={onPress}
      style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View
        {...hiddenFromA11y}
        style={[
          {
            position: 'absolute',
            width: outer,
            height: outer,
            borderRadius: outer / 2,
            backgroundColor: c.onGradient.fill14,
          },
          listening ? ring : null,
        ]}
      />
      <View
        {...hiddenFromA11y}
        style={{
          position: 'absolute',
          width: outer - 28,
          height: outer - 28,
          borderRadius: (outer - 28) / 2,
          backgroundColor: c.onGradient.fill18,
        }}
      />
      <View
        style={{
          width: core,
          height: core,
          borderRadius: core / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.text.onGradient,
        }}
      >
        <Icon name="mic" size={size === 'lg' ? 36 : 30} color={ink.glyph} />
      </View>
    </PressableScale>
  );
}

function LevelBar({
  index,
  active,
  min,
  max,
  width,
  color,
}: {
  readonly index: number;
  readonly active: boolean;
  readonly min: number;
  readonly max: number;
  readonly width: number;
  readonly color: string;
}): JSX.Element {
  const theme = useTheme();
  const loop = useLoop({
    durationMs: theme.motion.loop.barsMin + (index % 5) * 110,
    delayMs: index * theme.motion.loop.barsStagger,
    alternate: true,
    active,
    rest: 0.5,
  });
  const animated = useAnimatedStyle(() => ({ height: min + (max - min) * loop.get() }));
  return <Animated.View style={[{ width, borderRadius: 2, backgroundColor: color }, animated]} />;
}

export interface VoiceWaveformProps {
  readonly active: boolean;
  readonly testID?: string;
}

/** 22 bars × 4 px r2 at .86 white, 10–40 high, in a 44 container. Hidden. */
export function VoiceWaveform({ active, testID }: VoiceWaveformProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.voiceWaveform'}
      {...hiddenFromA11y}
      style={{
        height: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
      }}
    >
      {Array.from({ length: 22 }, (_, i) => (
        <LevelBar
          key={`v-${String(i)}`}
          index={i}
          active={active}
          min={10}
          max={40}
          width={4}
          color={theme.color.text.onGradientSecondary}
        />
      ))}
    </View>
  );
}

export interface MiniWaveformProps {
  readonly active: boolean;
  readonly testID?: string;
}

/** Inline recording waveform (5.7): 26 bars × 3 px, primary / spinner-track, 6–18 high. */
export function MiniWaveform({ active, testID }: MiniWaveformProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.miniWaveform'}
      {...hiddenFromA11y}
      style={{ height: 20, flexDirection: 'row', alignItems: 'center', gap: 2 }}
    >
      {Array.from({ length: 26 }, (_, i) => (
        <LevelBar
          key={`m-${String(i)}`}
          index={i}
          active={active}
          min={6}
          max={18}
          width={3}
          color={i % 3 === 0 ? theme.color.control.spinnerTrack : theme.color.brand.primary}
        />
      ))}
    </View>
  );
}

export interface TranscriptTextProps {
  readonly text: string;
  readonly testID?: string;
}

/** Live transcript on the night gradient: 22/30 600, max 300 wide; polite live region. */
export function TranscriptText({ text, testID }: TranscriptTextProps): JSX.Element {
  return (
    <Text
      testID={testID ?? 'ui.transcriptText'}
      variant="h2"
      tone="onGradient"
      align="center"
      accessibilityLiveRegion="polite"
      style={{ lineHeight: 30, maxWidth: 300, alignSelf: 'center' }}
    >
      {text}
    </Text>
  );
}

export interface AnswerBubbleProps {
  readonly children: ReactNode;
  readonly testID?: string;
}

/** Voice answer bubble: .10 white r18 padding 14/16, 15/22, max 320. */
export function AnswerBubble({ children, testID }: AnswerBubbleProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.answerBubble'}
      accessibilityLiveRegion="polite"
      style={{
        maxWidth: 320,
        alignSelf: 'center',
        borderRadius: theme.radius.list,
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: theme.color.onGradient.fill10,
      }}
    >
      {typeof children === 'string' ? (
        <Text variant="body" tone="onGradient">
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

export interface TranscriptCardProps {
  readonly transcript: string;
  /** "0:07 · dinleniyor" */
  readonly caption?: string;
  readonly recording?: boolean;
  readonly testID?: string;
}

/** Post-meeting voice note (5.7): surface r20 padding 16, italic transcript, live waveform. */
export function TranscriptCard({
  transcript,
  caption,
  recording = false,
  testID,
}: TranscriptCardProps): JSX.Element {
  return (
    <Card testID={testID ?? 'ui.transcriptCard'} style={{ gap: 10 }}>
      <Text variant="editorialQuote" accessibilityLiveRegion="polite">
        {transcript}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <MiniWaveform active={recording} />
        {caption === undefined ? null : (
          <Text variant="meta" tone="tertiaryStrong" numeric>
            {caption}
          </Text>
        )}
      </View>
    </Card>
  );
}

export interface PulsingRingProps {
  readonly testID?: string;
}

/** Analysis ring (2.10): 132; outer 3 px arc 1.4 s, inner 2 px arc 2.2 s reverse; hidden. */
export function PulsingRing({ testID }: PulsingRingProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const outer = useLoop({ durationMs: 1400, rest: 0 });
  const inner = useLoop({ durationMs: 2200, rest: 0 });
  const outerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${outer.get() * 360}deg` }],
  }));
  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-inner.get() * 360}deg` }],
  }));
  return (
    <View
      testID={testID ?? 'ui.pulsingRing'}
      {...hiddenFromA11y}
      style={{ width: 132, height: 132, alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 132,
            height: 132,
            borderRadius: 66,
            borderWidth: 3,
            borderColor: c.onGradient.fill16,
            borderTopColor: c.text.onGradient,
          },
          outerStyle,
        ]}
      />
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 104,
            height: 104,
            borderRadius: 52,
            borderWidth: 2,
            borderColor: 'transparent',
            borderBottomColor: c.text.onGradientSecondary,
          },
          innerStyle,
        ]}
      />
      <Icon name="auto_awesome" filled size={44} color={c.text.onGradient} />
    </View>
  );
}

function TypingDot({ index }: { readonly index: number }): JSX.Element {
  const theme = useTheme();
  const loop = useLoop({
    durationMs: theme.motion.loop.typing,
    delayMs: index * theme.motion.loop.typingStagger,
    alternate: true,
    rest: 1,
  });
  const animated = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * loop.get() }));
  return (
    <Animated.View
      style={[
        {
          width: 7,
          height: 7,
          borderRadius: 3.5,
          backgroundColor: theme.color.text.tertiaryStrong,
        },
        animated,
      ]}
    />
  );
}

export interface TypingIndicatorProps {
  /** "Yanıt hazırlanıyor" */
  readonly accessibilityLabel: string;
  readonly testID?: string;
}

/** Three 7 px dots (.8 s, 150 ms stagger). */
export function TypingIndicator({ accessibilityLabel, testID }: TypingIndicatorProps): JSX.Element {
  return (
    <View
      testID={testID ?? 'ui.typingIndicator'}
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      accessibilityState={{ busy: true }}
      style={{ flexDirection: 'row', gap: 5, paddingVertical: 8 }}
    >
      {[0, 1, 2].map((i) => (
        <TypingDot key={`dot-${String(i)}`} index={i} />
      ))}
    </View>
  );
}
