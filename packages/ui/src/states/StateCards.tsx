/**
 * Inline global-state components (SCREEN_AND_FLOW_MAP §13, M-STATE-03…10). All copy is passed in
 * from `states.*` by the screen; the kit fixes icon, tone and layout per the specs:
 * - M-STATE-03 `OfflineBanner` (ink pill, `wifi_off` coral, "Yenile").
 * - M-STATE-04 `ReconnectCard` (`link_off` critical; admin consent `admin_panel_settings` warning).
 * - M-STATE-05 `SyncDelayedCard` (`sync_problem` warning).
 * - M-STATE-06 `PartialDataNotice` (neutral strip with `info`, region "Eksik veri uyarısı").
 * - M-STATE-07 `AiUnavailableCard` (`cloud_off` neutral).
 * - M-STATE-08 `PermissionCard` (`event_busy` warning by default).
 * - M-STATE-09 `EntitlementGate` (the 7.6 gate) and `LimitCard` (`hourglass_empty` neutral).
 * - M-STATE-10 `ExternalCredentialRequired` (`settings_alert` neutral, plain text, no CTA).
 * At most two inline cards stack, ordered critical → warning → neutral (`sortStateCards`).
 */
import { useEffect, type JSX } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../icons/Icon.tsx';
import type { IconName } from '../icons/generated/index.ts';
import { IconTile } from '../primitives/IconTile.tsx';
import { PressableScale } from '../primitives/PressableScale.tsx';
import { Spinner } from '../primitives/Spinner.tsx';
import { InkSurface } from '../primitives/Surface.tsx';
import { Text } from '../primitives/Text.tsx';
import { announce } from '../theme/a11y.ts';
import { useTheme } from '../theme/ThemeProvider.tsx';
import { CardActions, TextAction } from '../components/buttons/ActionButtons.tsx';
import { ProGateCard, type ProGateCardProps } from '../components/cards/AiCards.tsx';
import { ErrorCard, type ErrorTone, type StateAction } from './ErrorCard.tsx';

export interface OfflineBannerProps {
  /** "Çevrimdışısın. Son analiz 09:40'tan gösteriliyor." */
  readonly message: string;
  /** "Yenile" */
  readonly refreshLabel: string;
  readonly onRefresh: () => void;
  /** Re-checking the connection (14 px spinner on the action). */
  readonly refreshing?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/** Offline banner (M-STATE-03): r14, padding 10/14, margin 8/20; announced once. */
export function OfflineBanner({
  message,
  refreshLabel,
  onRefresh,
  refreshing = false,
  style,
  testID,
}: OfflineBannerProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  useEffect(() => {
    announce(message);
  }, [message]);
  return (
    <InkSurface
      testID={testID ?? 'ui.offlineBanner'}
      radius="button"
      padding={[10, 14]}
      style={[{ marginVertical: 8, marginHorizontal: theme.layout.screenX }, style]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2.5] }}>
        <Icon name="wifi_off" size={18} color={c.toast.iconError} />
        <Text
          variant="bodyXs"
          tone="onInk"
          style={{ flex: 1 }}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {message}
        </Text>
        <PressableScale
          testID="ui.offlineBanner.refresh"
          accessibilityLabel={refreshLabel}
          busy={refreshing}
          onPress={onRefresh}
          visualSize={{ width: 44, height: 28 }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1], minHeight: 28 }}
        >
          {refreshing ? <Spinner size={14} tone="onGradient" /> : null}
          <Text variant="labelSm" style={{ color: c.toast.action }}>
            {refreshLabel}
          </Text>
        </PressableScale>
      </View>
    </InkSurface>
  );
}

export interface ReconnectCardProps {
  readonly title: string;
  readonly body: string;
  /** "Yeniden Bağlan" (spinner + "Google'da izin bekleniyor…" while waiting). */
  readonly reconnectAction: StateAction;
  /** "Sonra" (hidden until the next cold start). */
  readonly laterAction?: StateAction;
  /** `adminConsent` uses the warning tone and `admin_panel_settings`. */
  readonly variant?: 'expired' | 'adminConsent' | 'declined';
  /** "{service}, yeniden bağlanman gerekiyor" */
  readonly accessibilityLabel?: string;
  readonly correlationId?: string;
  readonly testID?: string;
}

export function ReconnectCard({
  title,
  body,
  reconnectAction,
  laterAction,
  variant = 'expired',
  accessibilityLabel,
  correlationId,
  testID,
}: ReconnectCardProps): JSX.Element {
  const icon: IconName =
    variant === 'adminConsent'
      ? 'admin_panel_settings'
      : variant === 'declined'
        ? 'block'
        : 'link_off';
  return (
    <ErrorCard
      testID={testID ?? `ui.reconnectCard.${variant}`}
      icon={icon}
      tone={variant === 'expired' ? 'critical' : 'warning'}
      title={title}
      body={body}
      primaryAction={reconnectAction}
      secondaryAction={laterAction}
      accessibilityLabel={accessibilityLabel}
      correlationId={correlationId}
    />
  );
}

export interface SimpleStateCardProps {
  readonly title: string;
  readonly body?: string;
  readonly primaryAction?: StateAction;
  readonly secondaryAction?: StateAction;
  readonly correlationId?: string;
  readonly announceOnMount?: boolean;
  readonly testID?: string;
}

/** M-STATE-05: "Senkronizasyon gecikti." · "Şimdi Dene" / "Tamam". */
export function SyncDelayedCard(props: SimpleStateCardProps): JSX.Element {
  return (
    <ErrorCard
      {...props}
      testID={props.testID ?? 'ui.syncDelayedCard'}
      icon="sync_problem"
      tone="warning"
    />
  );
}

/** M-STATE-07: "Asistan şu an yanıt veremiyor." · "Tekrar Dene" / "Brifinge Dön". */
export function AiUnavailableCard(props: SimpleStateCardProps): JSX.Element {
  return (
    <ErrorCard
      {...props}
      testID={props.testID ?? 'ui.aiUnavailableCard'}
      icon="cloud_off"
      tone="neutral"
    />
  );
}

export interface PermissionCardProps extends SimpleStateCardProps {
  /** `event_busy` (calendar, default), `notifications_off`, `alarm`, `mic_off`, … */
  readonly icon?: IconName;
}

/** M-STATE-08: "Takvim izni verilmedi." · "İzin Ver" / "Neden gerekli?". */
export function PermissionCard({
  icon = 'event_busy',
  ...props
}: PermissionCardProps): JSX.Element {
  return (
    <ErrorCard {...props} testID={props.testID ?? 'ui.permissionCard'} icon={icon} tone="warning" />
  );
}

/** M-STATE-09 limit card: "Bugünkü AI analiz hakkın doldu." · "Pro'yu Gör" / "Tamam". */
export function LimitCard(props: SimpleStateCardProps): JSX.Element {
  return (
    <ErrorCard
      {...props}
      testID={props.testID ?? 'ui.limitCard'}
      icon="hourglass_empty"
      tone="neutral"
    />
  );
}

export interface EntitlementGateProps extends ProGateCardProps {
  /**
   * `gate` = the contextual 7.6 Pro gate; `lapse` = warning "Pro sona erdi · {özellik}
   * duraklatıldı" with "Pro'yu Gör".
   */
  readonly variant?: 'gate' | 'lapse';
}

/** M-STATE-09 entitlement gate (≡ M-GL-13). Render it only once its counts are known. */
export function EntitlementGate({ variant = 'gate', ...props }: EntitlementGateProps): JSX.Element {
  if (variant === 'lapse') {
    return (
      <ErrorCard
        testID={props.testID ?? 'ui.entitlementGate.lapse'}
        icon="workspace_premium"
        tone="warning"
        title={props.title}
        body={props.body}
        primaryAction={props.primaryAction}
        secondaryAction={props.dismissAction}
      />
    );
  }
  return <ProGateCard {...props} testID={props.testID ?? 'ui.entitlementGate.gate'} />;
}

export interface ExternalCredentialRequiredProps {
  /** "Bu özellik bu ortamda yapılandırılmamış (harici kimlik bilgisi gerekli)." */
  readonly message: string;
  /** `credential` (default), `disabled` ("Bu özellik şu anda kullanılamıyor."), `outage`. */
  readonly reason?: 'credential' | 'disabled' | 'outage';
  readonly testID?: string;
}

/** M-STATE-10: never fakes success; plain text with no button role and no CTA. */
export function ExternalCredentialRequired({
  message,
  reason = 'credential',
  testID,
}: ExternalCredentialRequiredProps): JSX.Element {
  const theme = useTheme();
  const icon: IconName =
    reason === 'credential' ? 'settings_alert' : reason === 'outage' ? 'cloud_off' : 'block';
  return (
    <View
      testID={testID ?? `ui.externalCredentialRequired.${reason}`}
      accessible
      accessibilityLabel={message}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.list,
          paddingVertical: 14,
          paddingHorizontal: 16,
        },
        theme.elevation('card'),
      ]}
    >
      <IconTile icon={icon} size={36} tone="neutral" />
      <Text variant="bodyXs" tone="secondary" style={{ flex: 1 }}>
        {message}
      </Text>
    </View>
  );
}

/** Alias from the screen map (`UnavailableCard.tsx`). */
export const UnavailableCard = ExternalCredentialRequired;

export interface PartialDataNoticeProps {
  /** "Bazı hesaplarından veri alınamıyor." */
  readonly title: string;
  /** "Outlook bağlantısı yenilenene kadar Outlook mailleri bu listede yok." */
  readonly body?: string;
  /** "Ayrıntılar" → the failing account; or "Aç" for a data source that is off. */
  readonly action?: StateAction;
  /** Region label ("Eksik veri uyarısı"). */
  readonly regionLabel: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/** M-STATE-06 strip under the header: neutral, `info` icon; healthy data keeps rendering. */
export function PartialDataNotice({
  title,
  body,
  action,
  regionLabel,
  style,
  testID,
}: PartialDataNoticeProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.partialDataNotice'}
      style={[
        {
          flexDirection: 'row',
          gap: theme.space[2.5],
          borderRadius: theme.radius.button,
          paddingVertical: 12,
          paddingHorizontal: 14,
          backgroundColor: theme.color.surfaceSunken,
        },
        style,
      ]}
    >
      <Icon name="info" size={18} color={theme.color.icon.default} />
      <View style={{ flex: 1 }}>
        <View
          accessible
          accessibilityRole="summary"
          accessibilityLabel={[regionLabel, title, body].filter(Boolean).join('. ')}
        >
          <Text variant="labelSm">{title}</Text>
          {body === undefined ? null : (
            <Text variant="bodyXs" tone="secondary" style={{ marginTop: 2 }}>
              {body}
            </Text>
          )}
        </View>
        {action === undefined ? null : (
          <CardActions style={{ marginTop: 2 }}>
            <TextAction
              label={action.label}
              onPress={action.onPress}
              compact
              disabled={action.disabled}
              accessibilityHint={action.disabled === true ? action.disabledReason : undefined}
            />
          </CardActions>
        )}
      </View>
    </View>
  );
}

/** Alias from the screen map (`PartialDataStrip.tsx`). */
export const PartialDataStrip = PartialDataNotice;

const TONE_ORDER: Record<ErrorTone, number> = { critical: 0, warning: 1, neutral: 2 };

/** Orders inline state cards critical → warning → neutral and keeps at most two (§13.1). */
export function sortStateCards<T extends { readonly tone: ErrorTone }>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]).slice(0, 2);
}
