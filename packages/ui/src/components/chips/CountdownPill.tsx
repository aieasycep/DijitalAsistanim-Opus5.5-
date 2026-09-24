/**
 * `CountdownPill` (DESIGN_AUDIT §3.3): 30 h, padding 0/10, `labelXs`, `schedule` 15, warning tone;
 * the text is computed live ("18 dk", 1-minute ticks; "Başladı" after the start). The `join`
 * variant (DEV-40) uses the primary tone and `videocam` ("Katıl · 4 dk"). No live region: the
 * value is read when focused rather than announced every minute.
 */
import { useEffect, useState, type JSX } from 'react';
import { View, type ViewStyle } from 'react-native';
import { Icon } from '../../icons/Icon.tsx';
import { PressableScale } from '../../primitives/PressableScale.tsx';
import { Text } from '../../primitives/Text.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';

const MINUTE = 60_000;

/** Remaining whole minutes (rounded up), or null once started. */
export function minutesUntil(startsAt: number, now: number): number | null {
  const remaining = startsAt - now;
  return remaining <= 0 ? null : Math.ceil(remaining / MINUTE);
}

export interface CountdownPillProps {
  /** Start time (epoch ms). */
  readonly startsAt: number;
  /** Formats the remaining minutes ("18 dk", "Katıl · 4 dk"). */
  readonly format: (minutesLeft: number) => string;
  /** "Başladı" */
  readonly startedLabel: string;
  readonly variant?: 'countdown' | 'join';
  /** Join the online meeting (join variant). */
  readonly onPress?: () => void;
  /** Injectable clock for tests and previews (default `Date.now`). */
  readonly now?: () => number;
  readonly testID?: string;
}

export function CountdownPill({
  startsAt,
  format,
  startedLabel,
  variant = 'countdown',
  onPress,
  now = Date.now,
  testID,
}: CountdownPillProps): JSX.Element {
  const theme = useTheme();
  const [current, setCurrent] = useState(now);
  const remainingMs = startsAt - current;
  useEffect(() => {
    if (remainingMs <= 0) return undefined;
    const partial = remainingMs % MINUTE;
    const timer = setTimeout(
      () => {
        setCurrent(now());
      },
      partial === 0 ? MINUTE : partial,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [remainingMs, now]);
  const minutes = minutesUntil(startsAt, current);
  const label = minutes === null ? startedLabel : format(minutes);
  const tone = variant === 'join' ? theme.tone.primary : theme.tone.warning;
  const content = (
    <>
      <Icon name={variant === 'join' ? 'videocam' : 'schedule'} size={15} color={tone.icon} />
      <Text variant="labelXs" numeric style={{ color: tone.text }}>
        {label}
      </Text>
    </>
  );
  const style: ViewStyle = {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: theme.radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: theme.space[1],
    backgroundColor: tone.soft,
  };
  if (onPress === undefined) {
    return (
      <View
        testID={testID ?? `ui.countdownPill.${variant}`}
        accessible
        accessibilityLabel={label}
        style={style}
      >
        {content}
      </View>
    );
  }
  return (
    <PressableScale
      testID={testID ?? `ui.countdownPill.${variant}`}
      accessibilityLabel={label}
      onPress={onPress}
      visualSize={{ width: 44, height: 30 }}
      style={style}
    >
      {content}
    </PressableScale>
  );
}
