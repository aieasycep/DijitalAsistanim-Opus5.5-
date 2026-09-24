/**
 * Audio briefing player (DESIGN_AUDIT §3.10; P:03 3.4): `MiniPlayer` (docks above the tab bar),
 * `FullPlayer` and its parts — `SpeedPill`, `Waveform` (decorative, driven by the played position,
 * not amplitude; bars animate only while playing), `Scrubber` (draggable seek with a 44 pt band;
 * `adjustable` with ±15 s), `TransportControls` (alias `AudioControls`), `ChapterList`,
 * `NativeTtsNotice`. Colours on the night gradient come from the `onGradient` tokens and the
 * gradient stops themselves (identical in both schemes).
 */
import type { JSX } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Icon } from '../../icons/Icon.tsx';
import { PressableScale } from '../../primitives/PressableScale.tsx';
import { GradientSurface } from '../../primitives/Surface.tsx';
import { Text } from '../../primitives/Text.tsx';
import { useLoop } from '../../primitives/useLoop.ts';
import { hiddenFromA11y } from '../../theme/a11y.ts';
import { useHaptic } from '../../theme/preferences.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import type { Theme } from '../../theme/theme.ts';
import { IconButton } from '../buttons/IconButton.tsx';
import { DetailHeader } from '../navigation/Headers.tsx';

/** Night/dawn gradient stop colours used as flat fills (mini player, play glyph). */
export function nightInk(theme: Theme): { readonly deep: string; readonly glyph: string } {
  const dawn = theme.fixedGradients.dawn.stops;
  const night = theme.fixedGradients.night.stops;
  return {
    deep: dawn[0]?.color ?? theme.color.surfaceInk,
    glyph: night[1]?.color ?? theme.color.brand.onSoft,
  };
}

export interface MiniPlayerProps {
  /** "Sabah Brifingi · Öncelikler" */
  readonly title: string;
  /** "0:42 / 2:14" */
  readonly timeText: string;
  /** 0–1 played fraction. */
  readonly progress: number;
  readonly playing: boolean;
  readonly onPlayPause: () => void;
  readonly onClose: () => void;
  readonly onExpand: () => void;
  readonly playLabel: string;
  readonly pauseLabel: string;
  readonly closeLabel: string;
  /** "Oynatıcıyı aç" */
  readonly expandLabel: string;
  readonly testID?: string;
}

/** Mini player: deep indigo r16 padding 10/12, play 40, 3 px progress, time 12 at .72. */
export function MiniPlayer({
  title,
  timeText,
  progress,
  playing,
  onPlayPause,
  onClose,
  onExpand,
  playLabel,
  pauseLabel,
  closeLabel,
  expandLabel,
  testID,
}: MiniPlayerProps): JSX.Element {
  const theme = useTheme();
  const haptic = useHaptic();
  const ink = nightInk(theme);
  const c = theme.color;
  return (
    <View
      testID={testID ?? 'ui.miniPlayer'}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: theme.radius.cardSm,
        paddingVertical: 10,
        paddingHorizontal: 12,
        backgroundColor: ink.deep,
      }}
    >
      <PressableScale
        testID="ui.miniPlayer.playPause"
        accessibilityLabel={playing ? pauseLabel : playLabel}
        onPress={() => {
          haptic('playPause');
          onPlayPause();
        }}
        visualSize={{ width: 40, height: 40 }}
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.text.onGradient,
        }}
      >
        <Icon name={playing ? 'pause' : 'play_arrow'} filled size={24} color={ink.glyph} />
      </PressableScale>
      <PressableScale
        testID="ui.miniPlayer.expand"
        feedback="none"
        accessibilityLabel={`${expandLabel}: ${title}, ${timeText}`}
        onPress={onExpand}
        style={{ flex: 1, gap: 6 }}
      >
        <Text variant="labelSm" tone="onGradient" numberOfLines={1}>
          {title}
        </Text>
        <View
          {...hiddenFromA11y}
          style={{ height: 3, borderRadius: 2, backgroundColor: c.onGradient.fill18 }}
        >
          <View
            style={{
              height: 3,
              borderRadius: 2,
              width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`,
              backgroundColor: c.text.onGradient,
            }}
          />
        </View>
        <Text variant="meta" tone="onGradientTertiary" numeric>
          {timeText}
        </Text>
      </PressableScale>
      <IconButton
        icon="close"
        accessibilityLabel={closeLabel}
        onPress={onClose}
        variant="plainOnGradient"
      />
    </View>
  );
}

export interface SpeedPillProps {
  /** "1.0x" / "1.25x" / "1.5x" */
  readonly label: string;
  readonly onPress: () => void;
  /** "Oynatma hızı 1.25x, değiştir" */
  readonly accessibilityLabel: string;
  readonly testID?: string;
}

/** 32 h translucent speed pill (13/600). */
export function SpeedPill({
  label,
  onPress,
  accessibilityLabel,
  testID,
}: SpeedPillProps): JSX.Element {
  const theme = useTheme();
  return (
    <PressableScale
      testID={testID ?? 'ui.speedPill'}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      visualSize={{ width: 56, height: 32 }}
      style={{
        minHeight: 32,
        paddingHorizontal: 12,
        borderRadius: theme.radius.pill,
        justifyContent: 'center',
        backgroundColor: theme.color.onGradient.fill14,
      }}
    >
      <Text variant="labelSm" tone="onGradient" numeric>
        {label}
      </Text>
    </PressableScale>
  );
}

const BAR_COUNT = 34;

/** Deterministic bar heights (0.3–1) so the waveform looks like speech without real amplitude. */
export function waveformHeights(count: number): number[] {
  return Array.from(
    { length: count },
    (_, i) => 0.3 + 0.7 * Math.abs(Math.sin((i + 1) * 1.7) * Math.cos(i * 0.6)),
  );
}

function WaveBar({
  index,
  height,
  played,
  playing,
  maxHeight,
}: {
  readonly index: number;
  readonly height: number;
  readonly played: boolean;
  readonly playing: boolean;
  readonly maxHeight: number;
}): JSX.Element {
  const theme = useTheme();
  const loop = useLoop({
    durationMs: theme.motion.loop.barsMin + (index % 6) * 100,
    delayMs: index * theme.motion.loop.barsStagger,
    alternate: true,
    active: playing,
    rest: 1,
  });
  const animated = useAnimatedStyle(() => ({ transform: [{ scaleY: 0.25 + 0.75 * loop.get() }] }));
  return (
    <Animated.View
      style={[
        {
          width: 4,
          height: Math.max(4, height * maxHeight),
          borderRadius: 2,
          backgroundColor: played ? theme.color.text.onGradient : theme.color.onGradient.waveIdle,
        },
        animated,
      ]}
    />
  );
}

export interface WaveformProps {
  /** 0–1 played fraction. */
  readonly progress: number;
  readonly playing: boolean;
  readonly bars?: number;
  readonly height?: number;
  readonly testID?: string;
}

/** 34 bars × 4 w, gap 5, h 72; played white, rest .35. Decorative (hidden). */
export function Waveform({
  progress,
  playing,
  bars = BAR_COUNT,
  height = 72,
  testID,
}: WaveformProps): JSX.Element {
  const heights = waveformHeights(bars);
  const playedBars = Math.round(Math.min(1, Math.max(0, progress)) * bars);
  return (
    <View
      testID={testID ?? 'ui.waveform'}
      {...hiddenFromA11y}
      style={{
        height,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
      }}
    >
      {heights.map((h, i) => (
        <WaveBar
          key={`bar-${String(i)}`}
          index={i}
          height={h}
          played={i < playedBars}
          playing={playing}
          maxHeight={height}
        />
      ))}
    </View>
  );
}

export interface ScrubberProps {
  readonly positionS: number;
  readonly durationS: number;
  /** Seek to an absolute position in seconds (drag end or ±15 s adjust). */
  readonly onSeek: (seconds: number) => void;
  /** "0:42 / 2:14" */
  readonly valueText: string;
  readonly accessibilityLabel: string;
  /** Seconds per increment/decrement (default 15). */
  readonly step?: number;
  /** Native-TTS fallback: seeking snaps to chapters (the app maps positions). */
  readonly disabled?: boolean;
  readonly testID?: string;
}

/** 4 px progress with a draggable thumb in a 44 pt band; `role=adjustable`. */
export function Scrubber({
  positionS,
  durationS,
  onSeek,
  valueText,
  accessibilityLabel,
  step = 15,
  disabled = false,
  testID,
}: ScrubberProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const width = useSharedValue(0);
  const drag = useSharedValue(-1);
  const fraction = durationS > 0 ? Math.min(1, Math.max(0, positionS / durationS)) : 0;
  const clampSeek = (seconds: number): void => {
    onSeek(Math.min(durationS, Math.max(0, seconds)));
  };
  const seekFraction = (f: number): void => {
    clampSeek(f * durationS);
  };
  const pan = Gesture.Pan()
    .withTestId('ui.scrubber.pan')
    .enabled(!disabled && durationS > 0)
    .minDistance(0)
    .onUpdate((event) => {
      const w = width.get();
      if (w > 0) drag.set(Math.min(1, Math.max(0, event.x / w)));
    })
    .onEnd((event) => {
      // Seek to the release point (also covers a tap on the band).
      const w = width.get();
      if (w > 0) scheduleOnRN(seekFraction, Math.min(1, Math.max(0, event.x / w)));
      drag.set(-1);
    });
  const fill = useAnimatedStyle(() => {
    const f = drag.get() >= 0 ? drag.get() : fraction;
    return { width: `${f * 100}%` };
  });
  const onLayout = (event: LayoutChangeEvent): void => {
    width.set(event.nativeEvent.layout.width);
  };
  return (
    <GestureDetector gesture={pan}>
      <View
        testID={testID ?? 'ui.scrubber'}
        onLayout={onLayout}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: valueText }}
        accessibilityState={{ disabled }}
        accessibilityActions={disabled ? undefined : [{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') clampSeek(positionS + step);
          if (event.nativeEvent.actionName === 'decrement') clampSeek(positionS - step);
        }}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <View style={{ height: 4, borderRadius: 2, backgroundColor: c.onGradient.fill18 }}>
          <Animated.View
            style={[{ height: 4, borderRadius: 2, backgroundColor: c.text.onGradient }, fill]}
          />
        </View>
      </View>
    </GestureDetector>
  );
}

export interface TransportControlsProps {
  readonly playing: boolean;
  readonly onPlayPause: () => void;
  readonly onSkipBack: () => void;
  readonly onSkipForward: () => void;
  readonly playLabel: string;
  readonly pauseLabel: string;
  /** "15 saniye geri" */
  readonly skipBackLabel: string;
  /** "15 saniye ileri" */
  readonly skipForwardLabel: string;
  /** Caption under the ±15 glyphs ("15"). */
  readonly skipCaption: string;
  readonly loading?: boolean;
  readonly testID?: string;
}

/** −15 · play 76 · +15 (gap 28). Alias `AudioControls`. */
export function TransportControls({
  playing,
  onPlayPause,
  onSkipBack,
  onSkipForward,
  playLabel,
  pauseLabel,
  skipBackLabel,
  skipForwardLabel,
  skipCaption,
  loading = false,
  testID,
}: TransportControlsProps): JSX.Element {
  const haptic = useHaptic();
  return (
    <View
      testID={testID ?? 'ui.transportControls'}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 }}
    >
      <IconButton
        icon="replay"
        variant="skip15"
        caption={skipCaption}
        accessibilityLabel={skipBackLabel}
        onPress={onSkipBack}
      />
      <IconButton
        icon={playing ? 'pause' : 'play_arrow'}
        filled
        variant="play"
        loading={loading}
        accessibilityLabel={playing ? pauseLabel : playLabel}
        onPress={() => {
          haptic('playPause');
          onPlayPause();
        }}
        testID="ui.transportControls.play"
      />
      <IconButton
        icon="replay"
        variant="skip15"
        mirrored
        caption={skipCaption}
        accessibilityLabel={skipForwardLabel}
        onPress={onSkipForward}
      />
    </View>
  );
}

export const AudioControls = TransportControls;

export interface Chapter {
  readonly key: string;
  /** "01" */
  readonly index: string;
  readonly title: string;
  /** "0:18" */
  readonly duration: string;
}

export interface ChapterListProps {
  readonly chapters: readonly Chapter[];
  readonly activeKey?: string;
  readonly onSelect: (key: string) => void;
  /** Spoken suffix for the playing chapter ("oynatılıyor"). */
  readonly playingLabel?: string;
  readonly testID?: string;
}

/** Chapter rows: padding 11/4, top rule .1, 14/500; inactive .55; active `graphic_eq`. */
export function ChapterList({
  chapters,
  activeKey,
  onSelect,
  playingLabel,
  testID,
}: ChapterListProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  return (
    <View testID={testID ?? 'ui.chapterList'}>
      {chapters.map((chapter) => {
        const active = chapter.key === activeKey;
        return (
          <PressableScale
            key={chapter.key}
            testID={`ui.chapterList.${chapter.key}`}
            feedback="none"
            accessibilityLabel={[chapter.title, chapter.duration, active ? playingLabel : undefined]
              .filter(Boolean)
              .join(', ')}
            accessibilityState={{ selected: active }}
            onPress={() => {
              onSelect(chapter.key);
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingVertical: 11,
              paddingHorizontal: 4,
              borderTopWidth: 1,
              borderTopColor: c.onGradient.fill10,
              opacity: active ? 1 : theme.opacity.inactiveChapter,
            }}
          >
            <Text variant="meta" tone="onGradientTertiary" numeric style={{ width: 22 }}>
              {chapter.index}
            </Text>
            <Text variant="secondary" weight={500} tone="onGradient" style={{ flex: 1 }}>
              {chapter.title}
            </Text>
            {active ? <Icon name="graphic_eq" size={16} color={c.text.onGradient} /> : null}
            <Text variant="meta" tone="onGradientTertiary" numeric>
              {chapter.duration}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

export interface NativeTtsNoticeProps {
  /** "Cihaz sesiyle okunuyor · bölüm bölüm ilerler" */
  readonly text: string;
  readonly testID?: string;
}

/** Honest fallback notice on the night player (D-19). */
export function NativeTtsNotice({ text, testID }: NativeTtsNoticeProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.nativeTtsNotice'}
      accessible
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: theme.radius.button,
        paddingVertical: 10,
        paddingHorizontal: 14,
        backgroundColor: theme.color.onGradient.fill10,
      }}
    >
      <Icon name="record_voice_over" size={18} color={theme.color.text.onGradientSecondary} />
      <Text variant="bodyXs" tone="onGradientSecondary" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

export interface FullPlayerProps {
  readonly kicker: string;
  readonly title: string;
  /** "{d MMMM} · {m} dk {s} sn · {bölüm}" */
  readonly meta: string;
  readonly onCollapse: () => void;
  readonly collapseLabel: string;
  readonly speed: SpeedPillProps;
  readonly progress: number;
  readonly playing: boolean;
  readonly scrubber: ScrubberProps;
  readonly transport: TransportControlsProps;
  readonly chapters: ChapterListProps;
  /** Native TTS fallback notice. */
  readonly notice?: string;
  readonly testID?: string;
}

/** Full player (3.4) on the night gradient. */
export function FullPlayer({
  kicker,
  title,
  meta,
  onCollapse,
  collapseLabel,
  speed,
  progress,
  playing,
  scrubber,
  transport,
  chapters,
  notice,
  testID,
}: FullPlayerProps): JSX.Element {
  const theme = useTheme();
  return (
    <GradientSurface
      gradient="night"
      radius="none"
      testID={testID ?? 'ui.fullPlayer'}
      style={{ flex: 1 }}
    >
      <DetailHeader
        kicker={kicker}
        leading="collapse"
        leadingAccessibilityLabel={collapseLabel}
        onLeadingPress={onCollapse}
        onGradient
        trailing={<SpeedPill {...speed} />}
      />
      <View style={{ paddingHorizontal: theme.layout.screenX, gap: 8, marginTop: 44 }}>
        <Text variant="hero" tone="onGradient" heading>
          {title}
        </Text>
        <Text variant="secondary" tone="onGradientTertiary">
          {meta}
        </Text>
        <View style={{ marginTop: 40 }}>
          <Waveform progress={progress} playing={playing} />
        </View>
        <Scrubber {...scrubber} />
        <View style={{ marginTop: 12 }}>
          <TransportControls {...transport} />
        </View>
        {notice === undefined ? null : (
          <View style={{ marginTop: 16 }}>
            <NativeTtsNotice text={notice} />
          </View>
        )}
        <View style={{ marginTop: 36 }}>
          <ChapterList {...chapters} />
        </View>
      </View>
    </GradientSurface>
  );
}
