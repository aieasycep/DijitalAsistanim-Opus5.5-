/**
 * Loading (M-STATE-01): skeletons at real card sizes ("Başlık ve tarih anında; yalnızca AI içeriği
 * iskelet. 1,6 sn parıltı, kartlar tek tek 60 ms arayla dolar."), the AI-working kicker, the sync
 * line ("Senkron": 2 px indigo line 400 ms → "Güncel · HH:mm" for 1.5 s) and the staggered fill-in.
 * There is never a fake progress bar.
 */
import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay } from 'react-native-reanimated';
import { SkeletonBlock, SkeletonGroup } from '../primitives/Skeleton.tsx';
import { Spinner } from '../primitives/Spinner.tsx';
import { InkSurface, Surface } from '../primitives/Surface.tsx';
import { Text } from '../primitives/Text.tsx';
import { announce, hiddenFromA11y } from '../theme/a11y.ts';
import { useHaptic, useMotion } from '../theme/preferences.tsx';
import { useTheme } from '../theme/ThemeProvider.tsx';
import { AiKicker } from '../components/cards/AiCards.tsx';

export interface AiWorkingKickerProps {
  /** "Brifing hazırlanıyor…" (read by screen readers; the spinner is hidden). */
  readonly label: string;
  readonly testID?: string;
}

/** AI working: 14 px ring + kicker (alias `AISpinner`). */
export function AiWorkingKicker({ label, testID }: AiWorkingKickerProps): JSX.Element {
  return (
    <View
      testID={testID ?? 'ui.aiWorkingKicker'}
      accessible
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
    >
      <AiKicker label={label} busy />
    </View>
  );
}

export const AISpinner = AiWorkingKicker;

export interface LongRunningNoticeProps {
  /** "Brifing hâlâ hazırlanıyor; hazır olunca bildiririz." */
  readonly text: string;
  readonly testID?: string;
}

/** Shown after 10 s of AI work; polite live region. */
export function LongRunningNotice({ text, testID }: LongRunningNoticeProps): JSX.Element {
  return (
    <Text
      testID={testID ?? 'ui.longRunningNotice'}
      variant="meta"
      tone="tertiaryStrong"
      accessibilityLiveRegion="polite"
    >
      {text}
    </Text>
  );
}

export type SyncPhase = 'idle' | 'syncing' | 'done';

export interface SyncLineProps {
  readonly phase: SyncPhase;
  /** "Güncel · 09:41" */
  readonly doneLabel: string;
  /** Announced when done ("Güncellendi"). */
  readonly announcement?: string;
  /** Called after the 1.5 s confirmation so the screen can return to `idle`. */
  readonly onDoneHidden?: () => void;
  readonly testID?: string;
}

/**
 * Pull-to-sync feedback drawn in a custom header (RefreshControl cannot draw the line; keep its
 * native indicator tinted primary on Android). Light haptic when syncing starts.
 */
export function SyncLine({
  phase,
  doneLabel,
  announcement,
  onDoneHidden,
  testID,
}: SyncLineProps): JSX.Element | null {
  const theme = useTheme();
  const motionControl = useMotion();
  const haptic = useHaptic();
  const line = useSharedValue(0);
  const pill = useSharedValue(0);
  const hidden = useRef(onDoneHidden);
  useEffect(() => {
    hidden.current = onDoneHidden;
  }, [onDoneHidden]);
  useEffect(() => {
    if (phase === 'syncing') {
      haptic('pullToSync');
      line.set(0);
      line.set(motionControl.animate(1, theme.motion.duration.syncLine, 'linear'));
      return undefined;
    }
    if (phase === 'done') {
      line.set(0);
      if (announcement !== undefined) announce(announcement);
      pill.set(motionControl.fade(1, theme.motion.duration.toastIn));
      const timer = setTimeout(() => {
        hidden.current?.();
      }, theme.motion.hold.syncMessage);
      return () => {
        clearTimeout(timer);
      };
    }
    line.set(0);
    pill.set(0);
    return undefined;
  }, [phase, announcement, haptic, line, pill, motionControl, theme.motion]);
  const lineStyle = useAnimatedStyle(() => ({ width: `${line.get() * 100}%` }));
  const pillStyle = useAnimatedStyle(() => ({ opacity: pill.get() }));
  if (phase === 'idle') return null;
  return (
    <View testID={testID ?? `ui.syncLine.${phase}`} style={{ alignItems: 'center' }}>
      {phase === 'syncing' ? (
        <View {...hiddenFromA11y} style={{ alignSelf: 'stretch', height: 2 }}>
          <Animated.View
            style={[{ height: 2, backgroundColor: theme.color.brand.primary }, lineStyle]}
          />
        </View>
      ) : (
        <Animated.View
          style={[
            {
              marginTop: 8,
              paddingHorizontal: 12,
              minHeight: 28,
              justifyContent: 'center',
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.surface,
            },
            theme.elevation('s1'),
            pillStyle,
          ]}
        >
          <Text variant="labelXs" tone="secondary" numeric>
            {doneLabel}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

export interface StaggerInProps {
  /** Position in the list: the fill-in starts at index × 60 ms. */
  readonly index: number;
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}

/** Cards fill in one by one (60 ms stagger, 280 ms, translateY 8 → 0; fade only when reduced). */
export function StaggerIn({ index, children, style }: StaggerInProps): JSX.Element {
  const theme = useTheme();
  const motionControl = useMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    const delayMs = motionControl.reduceMotion ? 0 : index * theme.motion.delay.stagger;
    progress.set(withDelay(delayMs, motionControl.fade(1, theme.motion.duration.cardEnter)));
  }, [index, motionControl, progress, theme.motion]);
  const distance = theme.motion.distance.heroY;
  const reduce = motionControl.reduceMotion;
  const animated = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: reduce ? [] : [{ translateY: (1 - progress.get()) * distance }],
  }));
  return <Animated.View style={[animated, style]}>{children}</Animated.View>;
}

interface PresetProps {
  readonly testID?: string;
  readonly accessibilityLabel?: string;
}

/** Card skeleton: 30%×18 r9, 92%×16 r8, 50%×12 r6 in a r20 card with `shadow.s1Soft`. */
export function CardSkeleton({ testID, accessibilityLabel }: PresetProps): JSX.Element {
  return (
    <SkeletonGroup testID={testID ?? 'ui.cardSkeleton'} accessibilityLabel={accessibilityLabel}>
      <Surface elevation="s1Soft" padding={16} style={{ gap: 10 }}>
        <SkeletonBlock width="30%" height={18} radius={9} />
        <SkeletonBlock width="92%" height={16} radius={8} />
        <SkeletonBlock width="50%" height={12} radius={6} />
      </Surface>
    </SkeletonGroup>
  );
}

export interface TodaySkeletonProps extends PresetProps {
  /** The hero kicker ("Brifing hazırlanıyor…"). */
  readonly kicker: string;
  readonly cards?: number;
}

/** Today (08): hero with kicker spinner, bars 85%×22, 55%×22, 40%×12, button stand-ins; cards. */
export function TodaySkeleton({
  kicker,
  cards = 3,
  testID,
  accessibilityLabel,
}: TodaySkeletonProps): JSX.Element {
  const theme = useTheme();
  return (
    <SkeletonGroup
      testID={testID ?? 'ui.todaySkeleton'}
      accessibilityLabel={accessibilityLabel}
      style={{ gap: theme.layout.sectionGap.today }}
    >
      <Surface radius="hero" elevation="heroAi" padding={[22, 22, 20]} style={{ gap: 10 }}>
        <AiKicker label={kicker} busy />
        <SkeletonBlock width="85%" height={22} />
        <SkeletonBlock width="55%" height={22} />
        <SkeletonBlock width="40%" height={12} />
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <SkeletonBlock width="auto" height={48} radius={14} style={{ flex: 1 }} />
          <SkeletonBlock width={110} height={48} radius={14} tone="bg" />
        </View>
      </Surface>
      {Array.from({ length: cards }, (_, i) => (
        <Surface key={`card-${String(i)}`} elevation="s1Soft" padding={16} style={{ gap: 10 }}>
          <SkeletonBlock width="30%" height={18} radius={9} />
          <SkeletonBlock width="92%" height={16} radius={8} />
          <SkeletonBlock width="50%" height={12} radius={6} />
        </Surface>
      ))}
    </SkeletonGroup>
  );
}

export interface ListSkeletonProps extends PresetProps {
  readonly rows?: number;
}

/** Flow feed: tile 28 + source bar, title, summary per card. */
export function FeedSkeleton({
  rows = 4,
  testID,
  accessibilityLabel,
}: ListSkeletonProps): JSX.Element {
  const theme = useTheme();
  return (
    <SkeletonGroup
      testID={testID ?? 'ui.feedSkeleton'}
      accessibilityLabel={accessibilityLabel}
      style={{ gap: theme.layout.cardGap }}
    >
      {Array.from({ length: rows }, (_, i) => (
        <Surface
          key={`feed-${String(i)}`}
          elevation="s1Soft"
          padding={[14, 16, 14]}
          style={{ gap: 10 }}
        >
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <SkeletonBlock width={28} height={28} radius={9} />
            <SkeletonBlock width="40%" height={12} />
          </View>
          <SkeletonBlock width="80%" height={16} radius={8} />
          <SkeletonBlock width="95%" height={12} />
        </Surface>
      ))}
    </SkeletonGroup>
  );
}

/** Plan timeline: 44 time gutter + blocks. */
export function TimelineSkeleton({
  rows = 5,
  testID,
  accessibilityLabel,
}: ListSkeletonProps): JSX.Element {
  return (
    <SkeletonGroup
      testID={testID ?? 'ui.timelineSkeleton'}
      accessibilityLabel={accessibilityLabel}
      style={{ gap: 12 }}
    >
      {Array.from({ length: rows }, (_, i) => (
        <View key={`tl-${String(i)}`} style={{ flexDirection: 'row', gap: 12, minHeight: 68 }}>
          <SkeletonBlock width={36} height={12} style={{ marginTop: 8 }} />
          <SkeletonBlock width="auto" height={56} radius={14} style={{ flex: 1 }} />
        </View>
      ))}
    </SkeletonGroup>
  );
}

/** A settings value column before bootstrap (56×12 r6). */
export function SettingsValueSkeleton({ testID, accessibilityLabel }: PresetProps): JSX.Element {
  return (
    <SkeletonGroup
      testID={testID ?? 'ui.settingsValueSkeleton'}
      accessibilityLabel={accessibilityLabel}
    >
      <SkeletonBlock width={56} height={12} radius={6} />
    </SkeletonGroup>
  );
}

/** Email detail: the header renders instantly; only the AI card shimmers. */
export function MailDetailSkeleton({ testID, accessibilityLabel }: PresetProps): JSX.Element {
  return (
    <SkeletonGroup
      testID={testID ?? 'ui.mailDetailSkeleton'}
      accessibilityLabel={accessibilityLabel}
    >
      <Surface padding={16} style={{ gap: 10 }}>
        <SkeletonBlock width="35%" height={12} />
        <SkeletonBlock width="90%" height={16} radius={8} />
        <SkeletonBlock width="85%" height={16} radius={8} />
        <SkeletonBlock width="60%" height={16} radius={8} />
      </Surface>
    </SkeletonGroup>
  );
}

/** Meeting prep: the ink talking-points card shimmering. */
export function PrepSkeleton({ testID, accessibilityLabel }: PresetProps): JSX.Element {
  return (
    <SkeletonGroup testID={testID ?? 'ui.prepSkeleton'} accessibilityLabel={accessibilityLabel}>
      <InkSurface radius="panel" padding={20} style={{ gap: 12 }}>
        <SkeletonBlock width="40%" height={12} />
        <SkeletonBlock width="85%" height={16} radius={8} />
        <SkeletonBlock width="75%" height={16} radius={8} />
        <SkeletonBlock width="80%" height={16} radius={8} />
      </InkSurface>
    </SkeletonGroup>
  );
}

/** Assistant answer streaming: a bubble of shimmering lines at answer-bubble width. */
export function ChatStreamingSkeleton({ testID, accessibilityLabel }: PresetProps): JSX.Element {
  return (
    <SkeletonGroup
      testID={testID ?? 'ui.chatStreamingSkeleton'}
      accessibilityLabel={accessibilityLabel}
    >
      <Surface radius="list" padding={[14, 16]} style={{ gap: 8, maxWidth: 320 }}>
        <SkeletonBlock width="90%" height={14} />
        <SkeletonBlock width="75%" height={14} />
        <SkeletonBlock width="50%" height={14} />
      </Surface>
    </SkeletonGroup>
  );
}

export interface AiWorkingButtonProps {
  readonly label: string;
}

/** Inline "AI işliyor" indicator (spinner + label) for rows and cards. */
export function AiWorkingInline({ label }: AiWorkingButtonProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID="ui.aiWorkingInline"
      accessible
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}
    >
      <Spinner size={16} />
      <Text variant="labelSm" tone="brand">
        {label}
      </Text>
    </View>
  );
}
