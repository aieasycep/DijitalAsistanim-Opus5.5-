/**
 * Account, onboarding and monetisation parts (DESIGN_AUDIT §3.13): `IntegrationRow` (official
 * provider logo passed in), `PermissionExplainer` (sheet body) with `ReasonRow` and
 * `AssuranceBox`, `NotificationPreview` (illustration only), `PlanComparisonTable`,
 * `ReferralLinkField`, `InviteRow`, `RulePreviewCard`.
 */
import type { JSX, ReactNode } from 'react';
import { View } from 'react-native';
import { Icon } from '../../icons/Icon.tsx';
import type { IconName } from '../../icons/generated/index.ts';
import { IconTile } from '../../primitives/IconTile.tsx';
import { SkeletonBlock, SkeletonGroup } from '../../primitives/Skeleton.tsx';
import { AiGlowSurface, Card, Divider, IllustrationFrame } from '../../primitives/Surface.tsx';
import { Text } from '../../primitives/Text.tsx';
import { hiddenFromA11y } from '../../theme/a11y.ts';
import { useMotion } from '../../theme/preferences.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import { Avatar } from '../avatar/Avatar.tsx';
import { StatusPill, type StatusTone } from '../badges/Badge.tsx';
import { Button } from '../buttons/Button.tsx';
import { ChoiceChip, ConnectPill, type ConnectState } from '../chips/Chips.tsx';
import { AiKicker } from '../cards/AiCards.tsx';

export interface IntegrationRowProps {
  /** Official provider logo (Gmail, Outlook, Google Calendar, Apple, …) from the app. */
  readonly logo: ReactNode;
  readonly name: string;
  /** "yu***@gmail.com · Son eşitleme 09:40" */
  readonly meta?: string;
  readonly state: ConnectState;
  readonly stateLabel: string;
  readonly onConnectPress?: () => void;
  /** Opens the account detail. */
  readonly onPress?: () => void;
  readonly disabled?: boolean;
  /** "Harici kimlik bilgisi gerekli" */
  readonly disabledReason?: string;
  readonly testID?: string;
}

/** Card padding 12/14 r18 `shadow.card`; 44 r14 logo tile on `surfaceSunken`; ConnectPill. */
export function IntegrationRow({
  logo,
  name,
  meta,
  state,
  stateLabel,
  onConnectPress,
  onPress,
  disabled = false,
  disabledReason,
  testID,
}: IntegrationRowProps): JSX.Element {
  const theme = useTheme();
  return (
    <Card
      testID={testID ?? `ui.integrationRow.${state}`}
      radius="list"
      padding={[12, 14]}
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={[name, meta, stateLabel, disabled ? disabledReason : undefined]
        .filter(Boolean)
        .join(', ')}
      accessibilityActions={
        onConnectPress === undefined || disabled || state === 'connected'
          ? undefined
          : [{ name: 'connect', label: stateLabel }]
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'connect') onConnectPress?.();
      }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        opacity: disabled ? theme.opacity.disabled : 1,
      }}
    >
      <View
        {...hiddenFromA11y}
        style={{
          width: 44,
          height: 44,
          borderRadius: theme.radius.button,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.surfaceSunken,
        }}
      >
        {logo}
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="rowTitle" weight={600}>
          {name}
        </Text>
        {meta === undefined && !(disabled && disabledReason !== undefined) ? null : (
          <Text variant="meta" tone="tertiaryStrong" numberOfLines={1}>
            {disabled && disabledReason !== undefined ? disabledReason : meta}
          </Text>
        )}
      </View>
      <ConnectPill state={state} label={stateLabel} onPress={onConnectPress} disabled={disabled} />
    </Card>
  );
}

export interface ReasonRowProps {
  readonly icon: IconName;
  readonly text: string;
  readonly compact?: boolean;
}

/** Explainer reason row: bg r14 padding 12/14 (calendar 11/14), icon 20 primary, 15 px. */
export function ReasonRow({ icon, text, compact = false }: ReasonRowProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      accessible
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: theme.radius.button,
        paddingVertical: compact ? 11 : 12,
        paddingHorizontal: 14,
        backgroundColor: theme.color.bg,
      }}
    >
      <Icon name={icon} size={20} color={theme.color.icon.ai} />
      <Text variant="body" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

export interface AssuranceBoxProps {
  /** The first row is bold. */
  readonly rows: readonly {
    readonly key: string;
    readonly icon: IconName;
    readonly text: string;
  }[];
  readonly testID?: string;
}

/** Success-soft assurance box: r18 padding 16 gap 10; deep success text 14/20; icons 20. */
export function AssuranceBox({ rows, testID }: AssuranceBoxProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.assuranceBox'}
      accessible
      style={{
        borderRadius: theme.radius.list,
        padding: 16,
        gap: 10,
        backgroundColor: theme.color.tone.success.soft,
      }}
    >
      {rows.map((row, i) => (
        <View key={row.key} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <Icon name={row.icon} size={20} color={theme.color.tone.success.text} />
          <Text
            variant="secondary"
            weight={i === 0 ? 600 : 400}
            tone="successDeep"
            style={{ flex: 1 }}
          >
            {row.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

export interface PermissionExplainerProps {
  readonly icon: IconName;
  readonly kicker?: string;
  readonly title: string;
  /** Provider choice chips (2.7c). */
  readonly providers?: readonly { readonly key: string; readonly label: string }[];
  readonly selectedProvider?: string;
  readonly onSelectProvider?: (key: string) => void;
  readonly reasons: readonly (ReasonRowProps & { readonly key: string })[];
  readonly assurance?: AssuranceBoxProps['rows'];
  /** "Google ile Bağlan" */
  readonly primaryAction: {
    readonly label: string;
    readonly onPress: () => void;
    readonly loading?: boolean;
    readonly loadingLabel?: string;
  };
  /** "Şimdi değil" */
  readonly secondaryAction?: { readonly label: string; readonly onPress: () => void };
  readonly footnote?: string;
  readonly testID?: string;
}

/** Permission / connection explainer body (put it in a `BottomSheet`). */
export function PermissionExplainer({
  icon,
  kicker,
  title,
  providers,
  selectedProvider,
  onSelectProvider,
  reasons,
  assurance,
  primaryAction,
  secondaryAction,
  footnote,
  testID,
}: PermissionExplainerProps): JSX.Element {
  const theme = useTheme();
  return (
    <View testID={testID ?? 'ui.permissionExplainer'} style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconTile icon={icon} size={44} tone="primary" />
        <View style={{ flex: 1 }}>
          {kicker === undefined ? null : (
            <Text variant="kicker" tone="tertiaryStrong">
              {kicker}
            </Text>
          )}
          <Text variant="titleMd" heading>
            {title}
          </Text>
        </View>
      </View>
      {providers === undefined || onSelectProvider === undefined ? null : (
        <View
          accessibilityRole="radiogroup"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
        >
          {providers.map((p) => (
            <ChoiceChip
              key={p.key}
              label={p.label}
              selected={p.key === selectedProvider}
              onPress={() => {
                onSelectProvider(p.key);
              }}
            />
          ))}
        </View>
      )}
      <View style={{ gap: 8 }}>
        {reasons.map(({ key, ...reason }) => (
          <ReasonRow key={key} {...reason} />
        ))}
      </View>
      {assurance === undefined ? null : <AssuranceBox rows={assurance} />}
      <Button
        label={primaryAction.label}
        onPress={primaryAction.onPress}
        loading={primaryAction.loading}
        loadingLabel={primaryAction.loadingLabel}
        size="lg"
        fullWidth
        pageCta
      />
      {secondaryAction === undefined ? null : (
        <Button
          label={secondaryAction.label}
          onPress={secondaryAction.onPress}
          variant="text"
          fullWidth
        />
      )}
      {footnote === undefined ? null : (
        <Text
          variant="meta"
          tone="tertiaryStrong"
          align="center"
          style={{ marginTop: theme.space[1] }}
        >
          {footnote}
        </Text>
      )}
    </View>
  );
}

export interface NotificationPreviewItem {
  readonly key: string;
  /** "Dijital Asistan" */
  readonly appName: string;
  readonly time: string;
  readonly body: string;
}

export interface NotificationPreviewProps {
  readonly items: readonly NotificationPreviewItem[];
  /** Single description of the illustration. */
  readonly accessibilityLabel: string;
  readonly testID?: string;
}

/** Onboarding 2.12 notification stack — an illustration (no touch), offsets removed when reduced. */
export function NotificationPreview({
  items,
  accessibilityLabel,
  testID,
}: NotificationPreviewProps): JSX.Element {
  const theme = useTheme();
  const { reduceMotion } = useMotion();
  const offsets = [-8, 8, -4];
  return (
    <IllustrationFrame accessibilityLabel={accessibilityLabel}>
      <View testID={testID ?? 'ui.notificationPreview'} style={{ gap: 10 }}>
        {items.map((item, i) => (
          <View
            key={item.key}
            style={[
              {
                padding: 14,
                borderRadius: theme.radius.card,
                backgroundColor: theme.color.overlay.glassCard,
                flexDirection: 'row',
                gap: 10,
                transform: reduceMotion ? [] : [{ translateX: offsets[i % offsets.length] ?? 0 }],
              },
              theme.elevation('s1'),
            ]}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.brand.primary,
              }}
            >
              <Icon name="auto_awesome" filled size={22} color={theme.color.text.onPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Text variant="labelSm" weight={700} style={{ flex: 1 }}>
                  {item.appName}
                </Text>
                <Text variant="meta" tone="tertiaryStrong">
                  {item.time}
                </Text>
              </View>
              <Text variant="secondary" tone="primary" style={{ lineHeight: 19 }}>
                {item.body}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </IllustrationFrame>
  );
}

export interface PlanComparisonRow {
  readonly key: string;
  readonly label: string;
  /** Free cell: a value, `true` (check) or `false` (empty). */
  readonly free: string | boolean;
  readonly pro: string | boolean;
  /** Spoken row ("Öğle nabzı: Free yok, Pro var"). */
  readonly accessibilityLabel: string;
}

export interface PlanComparisonTableProps {
  readonly freeLabel: string;
  readonly proLabel: string;
  readonly rows: readonly PlanComparisonRow[];
  readonly testID?: string;
}

/** Paywall table (7.5): header `1fr 56 56`, 11/700 labels; rows 44, checks primary. */
export function PlanComparisonTable({
  freeLabel,
  proLabel,
  rows,
  testID,
}: PlanComparisonTableProps): JSX.Element {
  const theme = useTheme();
  const cell = (value: string | boolean, pro: boolean): JSX.Element => (
    <View style={{ width: 56, alignItems: 'center' }}>
      {typeof value === 'string' ? (
        <Text variant="bodyXs" tone={pro ? 'brand' : 'tertiaryStrong'} align="center">
          {value}
        </Text>
      ) : value ? (
        <Icon
          name="check"
          size={18}
          color={pro ? theme.color.brand.primary : theme.color.text.tertiaryStrong}
        />
      ) : null}
    </View>
  );
  return (
    <Card testID={testID ?? 'ui.planComparisonTable'} padding={[8, 16]}>
      <View
        {...hiddenFromA11y}
        style={{ flexDirection: 'row', alignItems: 'center', minHeight: 36 }}
      >
        <View style={{ flex: 1 }} />
        <Text variant="typeLabel" tone="tertiaryStrong" align="center" style={{ width: 56 }}>
          {freeLabel}
        </Text>
        <Text
          variant="typeLabel"
          align="center"
          style={{ width: 56, color: theme.color.brand.primary }}
        >
          {proLabel}
        </Text>
      </View>
      {rows.map((row) => (
        <View key={row.key}>
          <Divider />
          <View
            accessible
            accessibilityLabel={row.accessibilityLabel}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}
          >
            <Text variant="secondary" tone="primary" style={{ flex: 1 }}>
              {row.label}
            </Text>
            {cell(row.free, false)}
            {cell(row.pro, true)}
          </View>
        </View>
      ))}
    </Card>
  );
}

export interface ReferralLinkFieldProps {
  readonly link: string;
  /** "Kopyala" */
  readonly copyLabel: string;
  readonly onCopy: () => void;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/** 52/16 surface field; mono 14/500 link (middle ellipsis) + tonal 40/12 "Kopyala". */
export function ReferralLinkField({
  link,
  copyLabel,
  onCopy,
  accessibilityLabel,
  testID,
}: ReferralLinkFieldProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.referralLinkField'}
      style={[
        {
          minHeight: 52,
          borderRadius: theme.radius.input,
          paddingLeft: 16,
          paddingRight: 6,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: theme.color.surface,
        },
        theme.elevation('s1'),
      ]}
    >
      <Text
        variant="mono"
        numberOfLines={1}
        ellipsizeMode="middle"
        style={{ flex: 1 }}
        accessibilityLabel={accessibilityLabel}
      >
        {link}
      </Text>
      <Button label={copyLabel} onPress={onCopy} icon="content_copy" variant="tonal" size="sm" />
    </View>
  );
}

export interface InviteRowProps {
  readonly name: string;
  readonly status: string;
  readonly pill: { readonly label: string; readonly tone: StatusTone };
  /** Unmatched invite: `mail` icon instead of initials. */
  readonly unmatched?: boolean;
  readonly testID?: string;
}

/** Referral invite row: avatar 36 + name 15/600 + status 12 + status pill. */
export function InviteRow({
  name,
  status,
  pill,
  unmatched = false,
  testID,
}: InviteRowProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.inviteRow'}
      accessible
      accessibilityLabel={[name, status, pill.label].join(', ')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 }}
    >
      {unmatched ? (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.surfaceSunken,
          }}
        >
          <Icon name="mail" size={18} color={theme.color.icon.default} />
        </View>
      ) : (
        <Avatar name={name} size={36} decorative />
      )}
      <View style={{ flex: 1 }}>
        <Text variant="rowTitle" weight={600}>
          {name}
        </Text>
        <Text variant="meta" tone="tertiaryStrong">
          {status}
        </Text>
      </View>
      <StatusPill label={pill.label} tone={pill.tone} />
    </View>
  );
}

export interface RulePreviewSample {
  readonly key: string;
  readonly text: string;
  readonly date: string;
}

export interface RulePreviewCardProps {
  /** "{N} mail bu kurala uydu" */
  readonly kicker: string;
  readonly samples: readonly RulePreviewSample[];
  /** "{a}'ü bugün zaten önemli sayılıyordu; {b} mail yukarı taşınacak." */
  readonly footer?: string;
  /** "Son 30 günde bu kurala uyan mail yok." (0 matches). */
  readonly emptyText?: string;
  readonly loading?: boolean;
  readonly error?: string;
  readonly testID?: string;
}

/** Priority rule preview (7.10): AI glow r18 padding 14/16; 3 sample rows; footer 12. */
export function RulePreviewCard({
  kicker,
  samples,
  footer,
  emptyText,
  loading = false,
  error,
  testID,
}: RulePreviewCardProps): JSX.Element {
  const theme = useTheme();
  return (
    <AiGlowSurface testID={testID ?? 'ui.rulePreviewCard'} radius="list" padding={[14, 16]}>
      <AiKicker label={kicker} busy={loading} />
      {loading ? (
        <SkeletonGroup style={{ marginTop: 10, gap: 8 }}>
          <SkeletonBlock width="90%" height={12} />
          <SkeletonBlock width="80%" height={12} />
          <SkeletonBlock width="70%" height={12} />
        </SkeletonGroup>
      ) : error !== undefined ? (
        <Text variant="bodyXs" tone="critical" style={{ marginTop: 10 }}>
          {error}
        </Text>
      ) : samples.length === 0 ? (
        <Text variant="bodyXs" tone="onAiGlow" style={{ marginTop: 10 }}>
          {emptyText}
        </Text>
      ) : (
        <View style={{ marginTop: 10, gap: 6 }}>
          {samples.slice(0, 3).map((sample) => (
            <View key={sample.key} accessible style={{ flexDirection: 'row', gap: 8 }}>
              <Text variant="bodyXs" numberOfLines={1} style={{ flex: 1 }}>
                {sample.text}
              </Text>
              <Text variant="bodyXs" tone="onAiGlow" numeric>
                {sample.date}
              </Text>
            </View>
          ))}
        </View>
      )}
      {footer === undefined || loading ? null : (
        <Text variant="meta" tone="onAiGlow" style={{ marginTop: theme.space[2.5] }}>
          {footer}
        </Text>
      )}
    </AiGlowSurface>
  );
}
