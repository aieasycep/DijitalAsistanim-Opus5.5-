/**
 * Plan and info cards (DESIGN_AUDIT §3.6, §2.5 rule 5):
 * - `SuggestedSurface`: the dashed "proposed / not yet real" block ("Önerilen · henüz gerçek
 *   değil"); solid (`plan.aiPlanned`) only after approval and execution.
 * - `GapBlock`: dashed empty time.
 * - `ConflictPair`, `CalendarIntelCard`, `InkCallout`, `StatTile`, `HeroStat`.
 */
import type { JSX, ReactNode } from 'react';
import { View } from 'react-native';
import { Icon } from '../../icons/Icon.tsx';
import type { IconName } from '../../icons/generated/index.ts';
import { PressableScale } from '../../primitives/PressableScale.tsx';
import { Spinner } from '../../primitives/Spinner.tsx';
import { Card, InkSurface } from '../../primitives/Surface.tsx';
import { Text, type TextTone } from '../../primitives/Text.tsx';
import { hiddenFromA11y } from '../../theme/a11y.ts';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import { StatusPill } from '../badges/Badge.tsx';
import { TextAction } from '../buttons/ActionButtons.tsx';
import { CardTextActions, cardA11y, type CardAction } from './shared.tsx';

export type SuggestedState = 'proposed' | 'pendingApproval' | 'executing' | 'executed' | 'failed';

export interface SuggestedSurfaceProps {
  readonly title: string;
  /** "Önerilen · 45 dk · AI görev bloğu" */
  readonly meta?: string;
  /** "Önerilen · henüz gerçek değil" */
  readonly proposedLabel?: string;
  readonly state?: SuggestedState;
  /** Pill for `pendingApproval` ("Onay bekliyor"). */
  readonly pendingLabel?: string;
  /** `failed`: "Takvime eklenemedi" + "Tekrar dene". */
  readonly failure?: {
    readonly message: string;
    readonly retryLabel: string;
    readonly onRetry: () => void;
  };
  readonly onPress?: () => void;
  /** "Önerilen, henüz takvimde değil: …" */
  readonly accessibilityLabel: string;
  readonly testID?: string;
}

export function SuggestedSurface({
  title,
  meta,
  proposedLabel,
  state = 'proposed',
  pendingLabel,
  failure,
  onPress,
  accessibilityLabel,
  testID,
}: SuggestedSurfaceProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const executed = state === 'executed';
  const content = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        {state === 'executing' ? (
          <Spinner size={16} />
        ) : (
          <Icon name="auto_awesome" filled size={18} color={c.icon.ai} />
        )}
        <Text variant="rowTitle" weight={600} style={{ flex: 1 }}>
          {title}
        </Text>
        {state === 'pendingApproval' && pendingLabel !== undefined ? (
          <StatusPill label={pendingLabel} tone="warning" caps={false} />
        ) : null}
      </View>
      {meta === undefined ? null : (
        <Text variant="meta" tone="brand" style={{ marginTop: 2 }}>
          {meta}
        </Text>
      )}
      {!executed && proposedLabel !== undefined ? (
        <Text variant="meta" tone="tertiaryStrong" style={{ marginTop: 2 }}>
          {proposedLabel}
        </Text>
      ) : null}
      {state === 'failed' && failure !== undefined ? (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: theme.space[1] }}
        >
          <Text variant="meta" tone="critical">
            {failure.message}
          </Text>
          <TextAction label={failure.retryLabel} onPress={failure.onRetry} compact />
        </View>
      ) : null}
    </>
  );
  const style = {
    borderRadius: theme.radius.button,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderStyle: executed ? ('solid' as const) : ('dashed' as const),
    borderColor: executed ? c.border.planned : c.border.suggested,
    backgroundColor: executed ? c.plan.aiPlanned : c.plan.ai,
  };
  if (onPress === undefined) {
    return (
      <View
        testID={testID ?? `ui.suggestedSurface.${state}`}
        accessible
        accessibilityLabel={accessibilityLabel}
        style={style}
      >
        {content}
      </View>
    );
  }
  return (
    <PressableScale
      testID={testID ?? `ui.suggestedSurface.${state}`}
      feedback="card"
      accessibilityLabel={accessibilityLabel}
      busy={state === 'executing'}
      onPress={onPress}
      style={style}
    >
      {content}
    </PressableScale>
  );
}

export interface GapBlockProps {
  /** "2 saat boşluk" */
  readonly label: string;
  readonly meta?: string;
  /** Opens "Odak bloğu öner / Görev yerleştir". */
  readonly onPress: () => void;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/** Empty time: transparent, 1 px dashed `border.gapDashed`, r14; tap opens the suggestion sheet. */
export function GapBlock({
  label,
  meta,
  onPress,
  accessibilityLabel,
  testID,
}: GapBlockProps): JSX.Element {
  const theme = useTheme();
  return (
    <PressableScale
      testID={testID ?? 'ui.gapBlock'}
      feedback="card"
      accessibilityLabel={accessibilityLabel ?? [label, meta].filter(Boolean).join(', ')}
      onPress={onPress}
      pressedStyle={{ backgroundColor: theme.color.surfacePressed }}
      style={{
        borderRadius: theme.radius.button,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.color.border.gapDashed,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
      }}
    >
      <Icon name="self_improvement" size={18} color={theme.color.text.disabled} />
      <Text variant="rowTitle" tone="secondary">
        {label}
      </Text>
      {meta === undefined ? null : (
        <Text variant="meta" tone="tertiaryStrong">
          {meta}
        </Text>
      )}
    </PressableScale>
  );
}

export interface ConflictItem {
  readonly time: string;
  readonly title: string;
  readonly meta?: string;
  readonly icon?: IconName;
}

export interface ConflictPairProps {
  readonly first: ConflictItem;
  /** The overlapping (life/personal) item, inset 24. */
  readonly second: ConflictItem;
  /** "Çakışma: 14:00 Müşteri toplantısı ve 14:30 Doktor randevusu" */
  readonly accessibilityLabel: string;
  /** "Çözüldü · 13:00'e taşındı" / "Bu çakışma artık yok" banner. */
  readonly resolvedLabel?: string;
  readonly onPress?: () => void;
  readonly testID?: string;
}

/** Conflict (5.3): two stacked items with a coral overlap marker. */
export function ConflictPair({
  first,
  second,
  accessibilityLabel,
  resolvedLabel,
  onPress,
  testID,
}: ConflictPairProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const item = (it: ConflictItem, life: boolean): JSX.Element => (
    <View
      style={[
        {
          borderRadius: theme.radius.cardSm,
          paddingVertical: 14,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[2],
          backgroundColor: life ? c.plan.life : c.surface,
        },
        life
          ? { borderWidth: 1, borderColor: c.border.hairline, marginLeft: 24 }
          : theme.elevation('s1Soft'),
      ]}
    >
      <Text variant="label" numeric style={{ width: 48 }}>
        {it.time}
      </Text>
      <View style={{ flex: 1 }}>
        <Text variant="rowTitle" weight={600}>
          {it.title}
        </Text>
        {it.meta === undefined ? null : (
          <Text variant="meta" tone="tertiaryStrong">
            {it.meta}
          </Text>
        )}
      </View>
      {it.icon === undefined ? null : <Icon name={it.icon} size={18} color={c.icon.default} />}
    </View>
  );
  const body = (
    <>
      {item(first, false)}
      <View
        {...hiddenFromA11y}
        style={{
          height: 2,
          width: 16,
          marginLeft: 12,
          marginVertical: 4,
          backgroundColor: c.tone.critical.solid,
        }}
      />
      {item(second, true)}
      {resolvedLabel === undefined ? null : (
        <StatusPill label={resolvedLabel} tone="success" caps={false} style={{ marginTop: 8 }} />
      )}
    </>
  );
  if (onPress === undefined) {
    return (
      <View testID={testID ?? 'ui.conflictPair'} accessible accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  }
  return (
    <PressableScale
      testID={testID ?? 'ui.conflictPair'}
      feedback="card"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
    >
      {body}
    </PressableScale>
  );
}

export interface CalendarIntelCardProps {
  readonly icon: IconName;
  /** Meaning tint (text tones): density warning, travel info, focus primary, conflict critical. */
  readonly iconTone?: 'warning' | 'info' | 'brand' | 'critical' | 'neutral';
  readonly title: string;
  readonly body?: string;
  readonly actions?: readonly CardAction[];
  /** Pending approval / failure pill. */
  readonly status?: { readonly label: string; readonly tone: 'warning' | 'critical' | 'success' };
  readonly testID?: string;
}

/** Calendar intelligence card (5.2): surface r16 padding 14/16. */
export function CalendarIntelCard({
  icon,
  iconTone = 'neutral',
  title,
  body,
  actions,
  status,
  testID,
}: CalendarIntelCardProps): JSX.Element {
  const theme = useTheme();
  const color =
    iconTone === 'brand'
      ? theme.color.icon.ai
      : iconTone === 'neutral'
        ? theme.color.icon.default
        : theme.tone[iconTone].text;
  const a11y = cardA11y((actions ?? []).slice(0, 2));
  return (
    <Card
      testID={testID ?? 'ui.calendarIntelCard'}
      radius="cardSm"
      padding={[14, 16]}
      accessibilityLabel={[title, body, status?.label].filter(Boolean).join('. ')}
      {...a11y}
      style={{ flexDirection: 'row', gap: theme.space[3] }}
    >
      <View style={{ marginTop: 1 }}>
        <Icon name={icon} size={20} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="rowTitle" weight={600}>
          {title}
        </Text>
        {body === undefined ? null : (
          <Text variant="bodyXs" tone="secondary" style={{ marginTop: 2 }}>
            {body}
          </Text>
        )}
        {status === undefined ? null : (
          <StatusPill
            label={status.label}
            tone={status.tone}
            caps={false}
            style={{ marginTop: 8 }}
          />
        )}
        <CardTextActions actions={actions} compact />
      </View>
    </Card>
  );
}

export interface InkCalloutProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly icon?: IconName;
  /** `callout` (default), `promise` (privacy promises: r24 padding 20, success glyphs), `banner`. */
  readonly variant?: 'callout' | 'promise' | 'banner';
  /** Promise rows (15/21 with `verified_user`). */
  readonly rows?: readonly string[];
  readonly onPress?: () => void;
  readonly children?: ReactNode;
  readonly testID?: string;
}

/** Ink callout: light ink surface; dark surface + .08 ring (DEV-14). */
export function InkCallout({
  title,
  subtitle,
  icon,
  variant = 'callout',
  rows,
  onPress,
  children,
  testID,
}: InkCalloutProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const promise = variant === 'promise';
  const content = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        {icon === undefined ? null : (
          <Icon
            name={icon}
            size={20}
            filled={promise}
            color={promise ? c.tone.success.onGradient : c.brand.glow}
          />
        )}
        <View style={{ flex: 1 }}>
          <Text variant="rowTitle" weight={600} tone="onInk">
            {title}
          </Text>
          {subtitle === undefined ? null : (
            <Text variant="meta" tone="onGradientTertiary">
              {subtitle}
            </Text>
          )}
        </View>
        {onPress === undefined ? null : (
          <Icon name="chevron_right" size={18} color={c.text.onGradientTertiary} />
        )}
      </View>
      {rows === undefined ? null : (
        <View style={{ gap: 10, marginTop: 14 }}>
          {rows.map((row) => (
            <View
              key={row}
              style={{ flexDirection: 'row', gap: theme.space[2.5], alignItems: 'flex-start' }}
            >
              <Icon name="verified_user" filled size={18} color={c.tone.success.onGradient} />
              <Text variant="bodySm" tone="onInk" style={{ flex: 1 }}>
                {row}
              </Text>
            </View>
          ))}
        </View>
      )}
      {children}
    </>
  );
  const radius = promise ? 'panel' : variant === 'banner' ? 'button' : 'list';
  const padding = promise ? 20 : variant === 'banner' ? ([10, 14] as const) : ([14, 16] as const);
  if (onPress === undefined) {
    return (
      <InkSurface
        testID={testID ?? `ui.inkCallout.${variant}`}
        radius={radius}
        padding={padding}
        accessible
      >
        {content}
      </InkSurface>
    );
  }
  return (
    <PressableScale
      testID={testID ?? `ui.inkCallout.${variant}`}
      feedback="card"
      accessibilityLabel={[title, subtitle].filter(Boolean).join(', ')}
      onPress={onPress}
    >
      <InkSurface radius={radius} padding={padding}>
        {content}
      </InkSurface>
    </PressableScale>
  );
}

export interface StatTileProps {
  readonly label: string;
  readonly value: string;
  readonly tone?: Extract<TextTone, 'primary' | 'critical' | 'warning' | 'success' | 'accent'>;
  readonly onPress?: () => void;
  readonly testID?: string;
}

/** Stat tile: label 12 tertiary-strong + value 16/600; surface r16 padding 12/14, `s1Soft`. */
export function StatTile({
  label,
  value,
  tone = 'primary',
  onPress,
  testID,
}: StatTileProps): JSX.Element {
  const theme = useTheme();
  return (
    <Card
      testID={testID ?? 'ui.statTile'}
      radius="cardSm"
      elevation="s1Soft"
      padding={[12, 14]}
      onPress={onPress}
      accessibilityLabel={`${label}: ${value}`}
      style={{ flex: 1, gap: theme.space[1] }}
    >
      <Text variant="meta" tone="tertiaryStrong">
        {label}
      </Text>
      <Text variant="h3Sm" tone={tone} numeric>
        {value}
      </Text>
    </Card>
  );
}

export interface HeroStatProps {
  readonly value: string;
  readonly label: string;
  readonly testID?: string;
}

/** Large numeric headline ("83" in Mail Intelligence): `numericXl` + secondary label. */
export function HeroStat({ value, label, testID }: HeroStatProps): JSX.Element {
  return (
    <View testID={testID ?? 'ui.heroStat'} accessible accessibilityLabel={`${value} ${label}`}>
      <Text variant="numericXl">{value}</Text>
      <Text variant="secondary">{label}</Text>
    </View>
  );
}
