/**
 * Headers (DESIGN_AUDIT §3.4). Rule (verbatim P:01): "Kök ekranlar büyük başlık (28) + tarih
 * kicker; alt sayfalar geri dairesi + ortalanmış kicker + sağda bağlam çipi." The status bar is
 * never drawn; content starts at `insets.top + 14` (root) or `+ 6` (sub-page).
 */
import type { GradientName } from '@da/design-tokens';
import type { JSX, ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../primitives/Text.tsx';
import { GradientSurface } from '../../primitives/Surface.tsx';
import { PressableScale } from '../../primitives/PressableScale.tsx';
import { useUiStrings } from '../../theme/preferences.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import { Avatar } from '../avatar/Avatar.tsx';
import { IconButton } from '../buttons/IconButton.tsx';
import { Button } from '../buttons/Button.tsx';

export interface RootHeaderProps {
  /** Date kicker ("23 Eylül Salı"; upper-cased by the kit). */
  readonly kicker: string;
  /** Greeting or tab title (`h1`). */
  readonly title: string;
  /** Trailing controls (header pills, search button). */
  readonly trailing?: ReactNode;
  /** The ink self avatar that opens profile & settings. */
  readonly avatar?: {
    readonly name: string;
    readonly onPress: () => void;
    /** "Profil ve ayarlar" */
    readonly accessibilityLabel: string;
  };
  readonly testID?: string;
}

/** Tab-root large title header (alias `LargeTitleHeader`). */
export function RootHeader({
  kicker,
  title,
  trailing,
  avatar,
  testID,
}: RootHeaderProps): JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      testID={testID ?? 'ui.rootHeader'}
      style={{
        paddingTop: insets.top + theme.layout.contentTopRoot,
        paddingHorizontal: theme.layout.screenX,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: theme.space[3],
      }}
    >
      <View style={{ flex: 1 }}>
        <Text variant="kicker" tone="tertiaryStrong">
          {kicker}
        </Text>
        <Text variant="h1" heading style={{ marginTop: 2 }}>
          {title}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        {trailing}
        {avatar === undefined ? null : (
          <PressableScale
            testID="ui.rootHeader.avatar"
            accessibilityLabel={avatar.accessibilityLabel}
            onPress={avatar.onPress}
            visualSize={{ width: 40, height: 40 }}
            style={{ borderRadius: 20 }}
          >
            <Avatar name={avatar.name} self size={40} decorative />
          </PressableScale>
        )}
      </View>
    </View>
  );
}

export const LargeTitleHeader = RootHeader;

export type DetailLeading = 'back' | 'close' | 'collapse';

export interface DetailHeaderProps {
  readonly kicker?: string;
  readonly leading?: DetailLeading;
  readonly onLeadingPress: () => void;
  /** Overrides the default "Geri" / "Kapat" label. */
  readonly leadingAccessibilityLabel?: string;
  /** Context chip on the right (badge, countdown, VIP pill, speed pill, text action). */
  readonly trailing?: ReactNode;
  /** Translucent buttons and light kicker on gradient headers. */
  readonly onGradient?: boolean;
  /** Skip the top safe-area inset (modal sheets with their own inset). */
  readonly insetTop?: boolean;
  readonly testID?: string;
}

const LEADING_ICON = { back: 'arrow_back', close: 'close', collapse: 'expand_more' } as const;

/** Sub-page header: 36 back circle + centred kicker + trailing slot (alias `NavHeader`). */
export function DetailHeader({
  kicker,
  leading = 'back',
  onLeadingPress,
  leadingAccessibilityLabel,
  trailing,
  onGradient = false,
  insetTop = true,
  testID,
}: DetailHeaderProps): JSX.Element {
  const theme = useTheme();
  const strings = useUiStrings();
  const insets = useSafeAreaInsets();
  const label =
    leadingAccessibilityLabel ??
    (leading === 'back' ? strings.actions.back : strings.actions.close);
  return (
    <View
      testID={testID ?? 'ui.detailHeader'}
      style={{
        paddingTop: (insetTop ? insets.top : 0) + theme.layout.contentTopSub,
        paddingHorizontal: theme.layout.screenX,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
      }}
    >
      <IconButton
        icon={LEADING_ICON[leading]}
        accessibilityLabel={label}
        onPress={onLeadingPress}
        variant={onGradient ? 'onGradient' : 'surface'}
        testID="ui.detailHeader.leading"
      />
      <View style={{ flex: 1, alignItems: 'center' }}>
        {kicker === undefined ? null : (
          <Text
            variant="kicker"
            tone={onGradient ? 'onGradientTertiary' : 'tertiaryStrong'}
            heading
            numberOfLines={1}
          >
            {kicker}
          </Text>
        )}
      </View>
      <View style={{ minWidth: 36, alignItems: 'flex-end' }}>{trailing}</View>
    </View>
  );
}

export const NavHeader = DetailHeader;

export interface GradientHeaderProps {
  readonly gradient?: Extract<GradientName, 'dawn' | 'dusk' | 'night' | 'dawnFullbleed'>;
  readonly kicker?: string;
  readonly title: string;
  readonly subtitle?: string;
  /** A `DetailHeader onGradient` row, rendered above the kicker. */
  readonly top?: ReactNode;
  readonly children?: ReactNode;
  readonly testID?: string;
}

/**
 * Gradient header (morning brief, evening close): padding 0/20/60 (dusk 56), kicker mt 36 (dusk
 * 32) at .72, title `titleGradient` (dusk `titleXl`), subtitle 16/22 at .86. Pair it with
 * `OverlappingSheet`.
 */
export function GradientHeader({
  gradient = 'dawn',
  kicker,
  title,
  subtitle,
  top,
  children,
  testID,
}: GradientHeaderProps): JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const dusk = gradient === 'dusk';
  return (
    <GradientSurface
      gradient={gradient}
      radius="none"
      testID={testID ?? `ui.gradientHeader.${gradient}`}
      style={{
        paddingTop: top === undefined ? insets.top + theme.layout.contentTopRoot : 0,
        paddingBottom: dusk ? 56 : 60,
      }}
    >
      {top}
      <View style={{ paddingHorizontal: theme.layout.screenX }}>
        {kicker === undefined ? null : (
          <Text variant="kicker" tone="onGradientTertiary" style={{ marginTop: dusk ? 32 : 36 }}>
            {kicker}
          </Text>
        )}
        <Text
          variant={dusk ? 'titleXl' : 'titleGradient'}
          tone="onGradient"
          heading
          style={{ marginTop: 6 }}
        >
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text
            variant="emph"
            weight={400}
            tone="onGradientSecondary"
            style={{ marginTop: 8, fontSize: 16, lineHeight: 22 }}
          >
            {subtitle}
          </Text>
        )}
        {children}
      </View>
    </GradientSurface>
  );
}

export interface OverlappingSheetProps {
  readonly children: ReactNode;
  /** Height of a sticky footer below, added to the bottom padding (+16). */
  readonly footerHeight?: number;
  readonly style?: StyleProp<ViewStyle>;
}

/** The content sheet that overlaps a gradient header: margin-top −28, radius 28/28/0/0, gap 22. */
export function OverlappingSheet({
  children,
  footerHeight = 0,
  style,
}: OverlappingSheetProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          marginTop: -28,
          borderTopLeftRadius: theme.radius.sheet,
          borderTopRightRadius: theme.radius.sheet,
          backgroundColor: theme.color.bg,
          paddingTop: 26,
          paddingHorizontal: theme.layout.screenX,
          paddingBottom: footerHeight + 16,
          gap: theme.layout.sectionGap.brief,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface StepHeaderProps {
  /** "Adım 2 / 4 · Mail" (upper-cased). */
  readonly kicker: string;
  /** Spoken form ("Adım 2 / 4"). */
  readonly kickerAccessibilityLabel?: string;
  readonly onBack?: () => void;
  readonly backAccessibilityLabel?: string;
  /** "Atla" text action. */
  readonly skip?: { readonly label: string; readonly onPress: () => void };
  readonly testID?: string;
}

/** Onboarding step header: back 36 + kicker "ADIM n / 4" + trailing "Atla" or a 36 spacer. */
export function StepHeader({
  kicker,
  kickerAccessibilityLabel,
  onBack,
  backAccessibilityLabel,
  skip,
  testID,
}: StepHeaderProps): JSX.Element {
  const theme = useTheme();
  const strings = useUiStrings();
  const insets = useSafeAreaInsets();
  return (
    <View
      testID={testID ?? 'ui.stepHeader'}
      style={{
        paddingTop: insets.top + theme.layout.contentTopSub,
        paddingHorizontal: theme.layout.onboardingX,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <View style={{ width: 44 }}>
        {onBack === undefined ? null : (
          <IconButton
            icon="arrow_back"
            accessibilityLabel={backAccessibilityLabel ?? strings.actions.back}
            onPress={onBack}
          />
        )}
      </View>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text
          variant="kicker"
          tone="tertiaryStrong"
          heading
          accessibilityLabel={kickerAccessibilityLabel}
        >
          {kicker}
        </Text>
      </View>
      <View style={{ minWidth: 44, alignItems: 'flex-end' }}>
        {skip === undefined ? null : (
          <Button label={skip.label} onPress={skip.onPress} variant="text" size="ghost" />
        )}
      </View>
    </View>
  );
}

export interface PageDotsProps {
  readonly count: number;
  readonly index: number;
  /** Swipe/adjust to a page; when set, the dots are `adjustable`. */
  readonly onChange?: (index: number) => void;
  /** Spoken value ("Sayfa 2 / 4"). */
  readonly valueText: string;
  readonly accessibilityLabel?: string;
  readonly onGradient?: boolean;
  readonly testID?: string;
}

/** Page dots: active 20×6 r3, inactive 6×6, gap 6. `role=adjustable` with increment/decrement. */
export function PageDots({
  count,
  index,
  onChange,
  valueText,
  accessibilityLabel,
  onGradient = false,
  testID,
}: PageDotsProps): JSX.Element {
  const theme = useTheme();
  const active = onGradient ? theme.color.text.onGradient : theme.color.text.primary;
  const inactive = onGradient ? theme.color.onGradient.waveIdle : theme.color.icon.chevron;
  return (
    <View
      testID={testID ?? 'ui.pageDots'}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: valueText }}
      accessibilityActions={
        onChange === undefined ? undefined : [{ name: 'increment' }, { name: 'decrement' }]
      }
      onAccessibilityAction={
        onChange === undefined
          ? undefined
          : (event) => {
              if (event.nativeEvent.actionName === 'increment' && index < count - 1) {
                onChange(index + 1);
              }
              if (event.nativeEvent.actionName === 'decrement' && index > 0) onChange(index - 1);
            }
      }
      style={{ flexDirection: 'row', gap: 6, alignItems: 'center', alignSelf: 'center' }}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          key={`dot-${String(i)}`}
          style={{
            width: i === index ? 20 : 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: i === index ? active : inactive,
          }}
        />
      ))}
    </View>
  );
}
