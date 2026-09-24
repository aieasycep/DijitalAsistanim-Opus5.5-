/**
 * Centred state blocks (DESIGN_AUDIT §3.9, SCREEN_AND_FLOW_MAP §13):
 * - `EmptyState` (M-STATE-02; "Boş durum bir başarı mesajıdır"): circle 60 in the tone + glyph 30,
 *   title `sheetTitle` (header), body secondary, one CTA 38/12 surface with brand text. No CTA at a
 *   stack root when it would be a dead action.
 * - `ErrorState` (M-STATE-11 full screen ≡ M-GL-10): title gets focus, footnote with the error
 *   code and "Sorunu bildir".
 * - `OfflineScreen` (M-STATE-03 without cache) and `NotFoundState` (M-STATE-12).
 * - `SuccessState`: ring 96 (scale .4 → 1, 500 ms) + `check_circle` 48 (450 ms, 100 ms delay),
 *   title `hero`, success haptic; focus to the title.
 */
import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay } from 'react-native-reanimated';
import { Icon } from '../icons/Icon.tsx';
import type { IconName } from '../icons/generated/index.ts';
import { PressableScale } from '../primitives/PressableScale.tsx';
import { Text } from '../primitives/Text.tsx';
import { announce, focusAccessibility, hiddenFromA11y } from '../theme/a11y.ts';
import { useHaptic, useMotion } from '../theme/preferences.tsx';
import { useTheme } from '../theme/ThemeProvider.tsx';
import type { Tone } from '../theme/theme.ts';
import { Button } from '../components/buttons/Button.tsx';
import type { StateAction } from './ErrorCard.tsx';

export interface EmptyStateProps {
  readonly icon: IconName;
  /** success (today, follow-up), primary (plan, no account, VIP) or neutral (approvals, …). */
  readonly tone?: Extract<Tone, 'success' | 'primary' | 'neutral'>;
  readonly title: string;
  readonly body?: string;
  readonly action?: StateAction;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

export function EmptyState({
  icon,
  tone = 'neutral',
  title,
  body,
  action,
  style,
  testID,
}: EmptyStateProps): JSX.Element {
  const theme = useTheme();
  const colors = theme.tone[tone];
  return (
    <View
      testID={testID ?? `ui.emptyState.${tone}`}
      style={[{ alignItems: 'center', padding: 28, gap: 12 }, style]}
    >
      <View
        {...hiddenFromA11y}
        style={{
          width: 60,
          height: 60,
          borderRadius: 30,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.soft,
        }}
      >
        <Icon name={icon} size={30} color={colors.icon} />
      </View>
      <Text variant="sheetTitle" heading align="center">
        {title}
      </Text>
      {body === undefined ? null : (
        <Text variant="secondary" align="center">
          {body}
        </Text>
      )}
      {action === undefined ? null : (
        <PressableScale
          testID="ui.emptyState.action"
          accessibilityLabel={action.label}
          accessibilityHint={action.disabled === true ? action.disabledReason : undefined}
          onPress={action.onPress}
          disabled={action.disabled}
          busy={action.loading}
          visualSize={{ width: 44, height: 38 }}
          pressedStyle={{ backgroundColor: theme.color.surfacePressed }}
          style={[
            {
              minHeight: 38,
              paddingHorizontal: 16,
              borderRadius: theme.radius.inline,
              justifyContent: 'center',
              backgroundColor: theme.color.surface,
              opacity: action.disabled === true ? theme.opacity.disabled : 1,
            },
            theme.elevation('s1'),
          ]}
        >
          <Text variant="labelSm" tone="link">
            {action.loading === true && action.loadingLabel !== undefined
              ? action.loadingLabel
              : action.label}
          </Text>
        </PressableScale>
      )}
    </View>
  );
}

interface StateScreenProps {
  readonly icon: IconName;
  readonly title: string;
  readonly body?: string;
  readonly primaryAction?: StateAction;
  readonly secondaryAction?: StateAction;
  readonly footnote?: string;
  readonly reportAction?: StateAction;
  /** Move the screen-reader focus to the title on mount (full-screen errors). */
  readonly focusTitle?: boolean;
  readonly correlationId?: string;
  readonly testID: string;
}

function StateScreen({
  icon,
  title,
  body,
  primaryAction,
  secondaryAction,
  footnote,
  reportAction,
  focusTitle = false,
  correlationId,
  testID,
}: StateScreenProps): JSX.Element {
  const theme = useTheme();
  const titleRef = useRef<View>(null);
  useEffect(() => {
    if (focusTitle) focusAccessibility(titleRef);
  }, [focusTitle]);
  return (
    <View
      testID={correlationId === undefined ? testID : `${testID}.${correlationId}`}
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 28,
        gap: 12,
        backgroundColor: theme.color.bg,
      }}
    >
      <View
        {...hiddenFromA11y}
        style={{
          width: 60,
          height: 60,
          borderRadius: 30,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.tone.neutral.soft,
        }}
      >
        <Icon name={icon} size={30} color={theme.tone.neutral.icon} />
      </View>
      <View ref={titleRef} accessible accessibilityRole="header" accessibilityHint={correlationId}>
        <Text variant="sheetTitle" align="center">
          {title}
        </Text>
      </View>
      {body === undefined ? null : (
        <Text variant="secondary" align="center">
          {body}
        </Text>
      )}
      <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 8 }}>
        {primaryAction === undefined ? null : (
          <Button
            label={primaryAction.label}
            onPress={primaryAction.onPress}
            loading={primaryAction.loading}
            loadingLabel={primaryAction.loadingLabel}
            disabled={primaryAction.disabled}
            fullWidth
            testID={`${testID}.primary`}
          />
        )}
        {secondaryAction === undefined ? null : (
          <Button
            label={secondaryAction.label}
            onPress={secondaryAction.onPress}
            variant="text"
            fullWidth
            testID={`${testID}.secondary`}
          />
        )}
      </View>
      {footnote === undefined ? null : (
        <Text variant="meta" tone="tertiaryStrong" align="center">
          {footnote}
        </Text>
      )}
      {reportAction === undefined ? null : (
        <Button
          label={reportAction.label}
          onPress={reportAction.onPress}
          variant="ghostSecondary"
          size="ghost"
          testID={`${testID}.report`}
        />
      )}
    </View>
  );
}

export interface ErrorStateProps {
  /** "Bir şeyler ters gitti." */
  readonly title: string;
  readonly body?: string;
  /** "Tekrar Dene" (same Idempotency-Key for mutations). */
  readonly retryAction?: StateAction;
  /** "Bugün'e Dön" */
  readonly homeAction?: StateAction;
  /** "Hata kodu: 3F9A21C0" */
  readonly errorCodeText?: string;
  /** "Sorunu bildir" */
  readonly reportAction?: StateAction;
  readonly icon?: IconName;
  readonly correlationId?: string;
  readonly testID?: string;
}

/** Full-screen error (M-STATE-11 / M-GL-10); also used for load failures without cache. */
export function ErrorState({
  title,
  body,
  retryAction,
  homeAction,
  errorCodeText,
  reportAction,
  icon = 'error',
  correlationId,
  testID,
}: ErrorStateProps): JSX.Element {
  return (
    <StateScreen
      testID={testID ?? 'ui.errorState'}
      icon={icon}
      title={title}
      body={body}
      primaryAction={retryAction}
      secondaryAction={homeAction}
      footnote={errorCodeText}
      reportAction={reportAction}
      correlationId={correlationId}
      focusTitle
    />
  );
}

export interface OfflineScreenProps {
  /** "İnternet bağlantısı yok." */
  readonly title: string;
  /** "Çevrimiçi olduğunda her şey otomatik olarak güncellenir." */
  readonly body?: string;
  /** "Tekrar Dene" */
  readonly retryAction: StateAction;
  readonly testID?: string;
}

/** Offline without cache (M-STATE-03). */
export function OfflineScreen({
  title,
  body,
  retryAction,
  testID,
}: OfflineScreenProps): JSX.Element {
  return (
    <StateScreen
      testID={testID ?? 'ui.offlineScreen'}
      icon="wifi_off"
      title={title}
      body={body}
      primaryAction={retryAction}
      focusTitle
    />
  );
}

export interface NotFoundStateProps {
  /** "Bu içerik artık yok." / "Bu sayfa bulunamadı." */
  readonly title: string;
  readonly body?: string;
  /** "Geri Dön" / "Bugün'e Dön" / "Onay Merkezi'ne Dön" */
  readonly backAction: StateAction;
  /** `link` = route variant (`link_off`), `entity` = removed content (`search_off`). */
  readonly variant?: 'route' | 'entity';
  readonly testID?: string;
}

/** Not found (M-STATE-12): foreign ids show the same state, so existence is not leaked. */
export function NotFoundState({
  title,
  body,
  backAction,
  variant = 'entity',
  testID,
}: NotFoundStateProps): JSX.Element {
  return (
    <StateScreen
      testID={testID ?? `ui.notFoundState.${variant}`}
      icon={variant === 'route' ? 'link_off' : 'search_off'}
      title={title}
      body={body}
      primaryAction={backAction}
    />
  );
}

export interface SuccessStateProps {
  readonly title: string;
  readonly body?: string;
  /** Result chips (deep links to what was created). */
  readonly results?: ReactNode;
  /** "{Kaynağa} Dön" (ink CTA; dark primary). */
  readonly action?: StateAction;
  readonly testID?: string;
}

export function SuccessState({
  title,
  body,
  results,
  action,
  testID,
}: SuccessStateProps): JSX.Element {
  const theme = useTheme();
  const motionControl = useMotion();
  const haptic = useHaptic();
  const titleRef = useRef<View>(null);
  const ring = useSharedValue(motionControl.reduceMotion ? 1 : theme.motion.scale.successIconFrom);
  const iconScale = useSharedValue(
    motionControl.reduceMotion ? 1 : theme.motion.scale.successIconFrom,
  );
  const opacity = useSharedValue(0);
  useEffect(() => {
    ring.set(motionControl.animate(1, theme.motion.duration.successRing));
    iconScale.set(
      motionControl.reduceMotion
        ? 1
        : withDelay(
            theme.motion.delay.successIcon,
            motionControl.animate(1, theme.motion.duration.successIcon),
          ),
    );
    opacity.set(motionControl.fade(1, theme.motion.duration.successRing));
    haptic('success');
    announce(title);
    focusAccessibility(titleRef);
  }, [haptic, iconScale, motionControl, opacity, ring, theme.motion, title]);
  const ringStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ scale: ring.get() }],
  }));
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: iconScale.get() }] }));
  return (
    <View
      testID={testID ?? 'ui.successState'}
      style={{ alignItems: 'center', paddingHorizontal: 28, gap: 12 }}
    >
      <Animated.View
        {...hiddenFromA11y}
        style={[
          {
            width: 96,
            height: 96,
            borderRadius: 48,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.tone.success.soft,
          },
          ringStyle,
        ]}
      >
        <Animated.View style={iconStyle}>
          <Icon name="check_circle" filled size={48} color={theme.color.tone.success.text} />
        </Animated.View>
      </Animated.View>
      <View ref={titleRef} accessible accessibilityRole="header">
        <Text variant="hero" align="center">
          {title}
        </Text>
      </View>
      {body === undefined ? null : (
        <Text variant="body" tone="secondary" align="center">
          {body}
        </Text>
      )}
      {results === undefined ? null : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          {results}
        </View>
      )}
      {action === undefined ? null : (
        <Button
          label={action.label}
          onPress={action.onPress}
          variant="ink"
          style={{ marginTop: 8 }}
        />
      )}
    </View>
  );
}
