/**
 * `ErrorCard` (DESIGN_AUDIT §3.6, P:08 "HATA DURUMLARI · OKUNUR, TEK AKSİYON") and the inline
 * M-STATE cards built on it (alias `InlineErrorCard`): IconTile 36 r11 in the tone + title 15/600
 * + body 13/19 + ≤ 2 text actions 13/600; surface r18 padding 14/16, gap 12. Announced once when
 * it appears (`role=alert`). A request `correlationId` goes into the testID and hint only — it is
 * never shown as text (SCREEN_AND_FLOW_MAP §13.1).
 */
import { useEffect, type JSX } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { IconName } from '../icons/generated/index.ts';
import { IconTile } from '../primitives/IconTile.tsx';
import { Text } from '../primitives/Text.tsx';
import { announce } from '../theme/a11y.ts';
import { useTheme } from '../theme/ThemeProvider.tsx';
import { CardActions, TextAction } from '../components/buttons/ActionButtons.tsx';

export type ErrorTone = 'critical' | 'warning' | 'neutral';

export interface StateAction {
  readonly label: string;
  readonly onPress: () => void;
  readonly loading?: boolean;
  readonly loadingLabel?: string;
  /** Disabled with a reason (offline: "Bu işlem için internet bağlantısı gerekiyor."). */
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}

export interface ErrorCardProps {
  readonly icon: IconName;
  readonly tone: ErrorTone;
  readonly title: string;
  readonly body?: string;
  readonly primaryAction?: StateAction;
  readonly secondaryAction?: StateAction;
  /** Request correlation id: testID suffix and accessibility hint only. */
  readonly correlationId?: string;
  /** Announce on appear (default true; `false` for cards rendered from cache on screen entry). */
  readonly announceOnMount?: boolean;
  /** Composed accessibility label override (e.g. "Gmail, yeniden bağlanman gerekiyor"). */
  readonly accessibilityLabel?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

function StateTextAction({
  action,
  emphasis,
}: {
  readonly action: StateAction;
  readonly emphasis: 'primary' | 'secondary';
}): JSX.Element {
  return (
    <TextAction
      label={action.label}
      onPress={action.onPress}
      emphasis={emphasis}
      compact
      loading={action.loading}
      loadingLabel={action.loadingLabel}
      disabled={action.disabled}
      accessibilityHint={action.disabled === true ? action.disabledReason : undefined}
      testID={`ui.errorCard.${emphasis}`}
    />
  );
}

export function ErrorCard({
  icon,
  tone,
  title,
  body,
  primaryAction,
  secondaryAction,
  correlationId,
  announceOnMount = true,
  accessibilityLabel,
  style,
  testID,
}: ErrorCardProps): JSX.Element {
  const theme = useTheme();
  const spoken = accessibilityLabel ?? [title, body].filter(Boolean).join(' ');
  useEffect(() => {
    if (announceOnMount) announce(spoken);
  }, [announceOnMount, spoken]);
  const id = testID ?? 'ui.errorCard';
  return (
    <View
      testID={correlationId === undefined ? id : `${id}.${correlationId}`}
      style={[
        {
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.list,
          paddingVertical: 14,
          paddingHorizontal: 16,
          flexDirection: 'row',
          gap: 12,
        },
        theme.elevation('card'),
        style,
      ]}
    >
      <IconTile icon={icon} size={36} tone={tone} />
      <View style={{ flex: 1 }}>
        <View
          accessible
          accessibilityRole="alert"
          accessibilityLabel={spoken}
          accessibilityHint={correlationId}
        >
          <Text variant="rowTitle" weight={600}>
            {title}
          </Text>
          {body === undefined ? null : (
            <Text variant="bodyXs" tone="secondary" style={{ marginTop: 2 }}>
              {body}
            </Text>
          )}
        </View>
        {primaryAction === undefined && secondaryAction === undefined ? null : (
          <CardActions style={{ marginTop: 4 }}>
            {primaryAction === undefined ? null : (
              <StateTextAction action={primaryAction} emphasis="primary" />
            )}
            {secondaryAction === undefined ? null : (
              <StateTextAction action={secondaryAction} emphasis="secondary" />
            )}
          </CardActions>
        )}
      </View>
    </View>
  );
}

export const InlineErrorCard = ErrorCard;
