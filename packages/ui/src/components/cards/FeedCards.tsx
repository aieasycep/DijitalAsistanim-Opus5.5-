/**
 * Feed cards (DESIGN_AUDIT §3.6). Rule (verbatim): "rozet (yalnızca anlam), başlık, kaynak satırı,
 * en fazla 2 aksiyon"; raw mail text never appears in lists. Each card is one accessible element
 * with a composed label; its controls and gesture verbs are exposed as `accessibilityActions`.
 */
import type { JSX } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Icon } from '../../icons/Icon.tsx';
import type { IconName } from '../../icons/generated/index.ts';
import { IconTile } from '../../primitives/IconTile.tsx';
import { Card } from '../../primitives/Surface.tsx';
import { Text } from '../../primitives/Text.tsx';
import { useExitAnimation } from '../../primitives/useExitAnimation.ts';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import { Avatar } from '../avatar/Avatar.tsx';
import { Badge, type BadgeCategory } from '../badges/Badge.tsx';
import { CardIconAction } from '../buttons/IconButton.tsx';
import { TextAction } from '../buttons/ActionButtons.tsx';
import { SourceLine, type SourceLineProps } from '../provenance/Provenance.tsx';
import { cardA11y, CardTextActions, type A11yAction, type CardAction } from './shared.tsx';

export interface CardBadge {
  readonly label: string;
  readonly category?: BadgeCategory;
}

export type CardSource = Pick<
  SourceLineProps,
  'icon' | 'parts' | 'onPress' | 'accessibilityLabel' | 'accessibilityHint' | 'variant'
>;

export interface InlineCardErrorProps {
  /** "Bu kart yüklenemedi." */
  readonly message: string;
  /** "Tekrar dene" */
  readonly retryLabel: string;
  readonly onRetry: () => void;
}

/** 08 `state/error` inside a card: `error` 20 critical + message + brand retry. */
export function InlineCardError({
  message,
  retryLabel,
  onRetry,
}: InlineCardErrorProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID="ui.inlineCardError"
      accessibilityRole="alert"
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexWrap: 'wrap' }}
    >
      <Icon name="error" size={20} color={theme.tone.critical.icon} />
      <Text variant="secondary" tone="secondary">
        {message}
      </Text>
      <TextAction label={retryLabel} onPress={onRetry} />
    </View>
  );
}

export interface PriorityCardProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly badge?: CardBadge;
  /** "08:42" */
  readonly time?: string;
  readonly source?: CardSource;
  /** At most two text actions. */
  readonly actions?: readonly CardAction[];
  /** Opens the source detail. */
  readonly onPress?: () => void;
  /** ✓ complete (also the swipe-right verb). */
  readonly onComplete?: () => void;
  readonly completeLabel?: string;
  /** ··· more (correction sheet). */
  readonly onMore?: () => void;
  readonly moreLabel?: string;
  /** Extra screen-reader verbs (snooze, dismiss, why) mirroring gestures and menus. */
  readonly a11yActions?: readonly A11yAction[];
  /** Done: filled success check + strikethrough title. */
  readonly done?: boolean;
  /** Plays the exit (scale .96 + fade + −6) and then calls `onExited`. */
  readonly exiting?: boolean;
  readonly onExited?: () => void;
  readonly error?: InlineCardErrorProps;
  /** Composed label ("ACİL, 08:42. {başlık}. Kaynak: Gmail, Ahmet Yılmaz, 08:42"). */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

function composeLabel(parts: readonly (string | undefined)[]): string {
  return parts.filter((p): p is string => p !== undefined && p !== '').join('. ');
}

/** Today priority card (3.1): surface r20, padding 14/16/10, `shadow.card`. */
export function PriorityCard({
  title,
  subtitle,
  badge,
  time,
  source,
  actions,
  onPress,
  onComplete,
  completeLabel,
  onMore,
  moreLabel,
  a11yActions = [],
  done = false,
  exiting = false,
  onExited,
  error,
  accessibilityLabel,
  testID,
}: PriorityCardProps): JSX.Element {
  const theme = useTheme();
  const exit = useExitAnimation(exiting, onExited);
  const verbs: (CardAction | A11yAction)[] = [];
  if (onComplete !== undefined && completeLabel !== undefined) {
    verbs.push({ key: 'complete', label: completeLabel, onPress: onComplete });
  }
  verbs.push(...a11yActions);
  if (onMore !== undefined && moreLabel !== undefined) {
    verbs.push({ key: 'more', label: moreLabel, onPress: onMore });
  }
  if (source !== undefined) {
    verbs.push({
      key: 'source',
      label: source.accessibilityHint ?? source.parts.join(', '),
      onPress: source.onPress,
    });
  }
  verbs.push(...(actions ?? []).slice(0, 2));
  const a11y = cardA11y(verbs);
  const label =
    accessibilityLabel ??
    composeLabel([
      badge === undefined ? undefined : [badge.label, time].filter(Boolean).join(', '),
      title,
      subtitle,
      source?.accessibilityLabel ?? source?.parts.join(', '),
    ]);
  return (
    <Animated.View style={exit}>
      <Card
        testID={testID ?? 'ui.priorityCard'}
        padding={[14, 16, 10]}
        onPress={onPress}
        accessibilityLabel={label}
        {...a11y}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          {badge === undefined ? null : <Badge label={badge.label} category={badge.category} />}
          {time === undefined ? null : (
            <Text variant="meta" tone="tertiaryStrong" numeric>
              {time}
            </Text>
          )}
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', marginRight: -8 }}>
            {onComplete === undefined || completeLabel === undefined ? null : (
              <CardIconAction
                kind="complete"
                done={done}
                accessibilityLabel={completeLabel}
                onPress={onComplete}
              />
            )}
            {onMore === undefined || moreLabel === undefined ? null : (
              <CardIconAction kind="more" accessibilityLabel={moreLabel} onPress={onMore} />
            )}
          </View>
        </View>
        <Text
          variant="h3"
          tone={done ? 'secondary' : 'primary'}
          strike={done}
          style={{ marginTop: 6 }}
        >
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text variant="secondary" style={{ marginTop: 4 }}>
            {subtitle}
          </Text>
        )}
        {source === undefined ? null : <SourceLine {...source} style={{ marginTop: 10 }} />}
        {error === undefined ? (
          <CardTextActions actions={actions} />
        ) : (
          <View style={{ marginTop: 8 }}>
            <InlineCardError {...error} />
          </View>
        )}
      </Card>
    </Animated.View>
  );
}

export interface AttentionCardProps {
  readonly title: string;
  /** AI summary; when unavailable pass `summaryUnavailable` ("Özet hazırlanamadı"). */
  readonly summary?: string;
  readonly summaryUnavailable?: string;
  /** Source name ("Gmail · Ahmet Yılmaz"), ellipsised. */
  readonly sourceName: string;
  readonly sourceIcon: IconName;
  /** Security cards use the critical tile. */
  readonly tileTone?: 'neutral' | 'critical';
  readonly badge?: CardBadge;
  readonly time?: string;
  /** One action (feed rule). */
  readonly action?: CardAction;
  readonly onPress?: () => void;
  readonly a11yActions?: readonly A11yAction[];
  readonly done?: boolean;
  readonly exiting?: boolean;
  readonly onExited?: () => void;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/** Flow card (4.1): "tek kart kalıbında (kaynak · rozet · başlık · AI özeti · aksiyon)". */
export function AttentionCard({
  title,
  summary,
  summaryUnavailable,
  sourceName,
  sourceIcon,
  tileTone = 'neutral',
  badge,
  time,
  action,
  onPress,
  a11yActions = [],
  done = false,
  exiting = false,
  onExited,
  accessibilityLabel,
  testID,
}: AttentionCardProps): JSX.Element {
  const theme = useTheme();
  const exit = useExitAnimation(exiting, onExited);
  const a11y = cardA11y([...a11yActions, ...(action === undefined ? [] : [action])]);
  const body = summary ?? summaryUnavailable;
  const label = accessibilityLabel ?? composeLabel([sourceName, badge?.label, time, title, body]);
  return (
    <Animated.View style={exit}>
      <Card
        testID={testID ?? 'ui.attentionCard'}
        padding={[14, 16, 10]}
        onPress={onPress}
        accessibilityLabel={label}
        {...a11y}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <IconTile icon={sourceIcon} size={28} tone={tileTone} />
          <Text variant="meta" tone="tertiaryStrong" numberOfLines={1} style={{ flex: 1 }}>
            {sourceName}
          </Text>
          {badge === undefined ? null : <Badge label={badge.label} category={badge.category} />}
          {time === undefined ? null : (
            <Text variant="meta" tone="tertiaryStrong" numeric>
              {time}
            </Text>
          )}
        </View>
        <Text
          variant="h3Sm"
          tone={done ? 'secondary' : 'primary'}
          strike={done}
          style={{ marginTop: 10 }}
        >
          {title}
        </Text>
        {body === undefined ? null : (
          <Text
            variant="secondary"
            tone={summary === undefined ? 'tertiaryStrong' : 'secondary'}
            style={{ marginTop: 4 }}
          >
            {body}
          </Text>
        )}
        {action === undefined ? null : (
          <View style={{ paddingTop: 2 }}>
            <CardTextActions actions={[action]} max={1} />
          </View>
        )}
      </Card>
    </Animated.View>
  );
}

export interface MailSummaryCardProps {
  readonly senderName: string;
  readonly senderId?: string;
  readonly time?: string;
  /** AI summary (never the raw body). */
  readonly summary: string;
  readonly badge?: CardBadge;
  readonly unread?: boolean;
  readonly action?: CardAction;
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/** Mail summary card (4.3): avatar 28 + name 13/600 + badge + time; body 15/21; one action. */
export function MailSummaryCard({
  senderName,
  senderId,
  time,
  summary,
  badge,
  unread = false,
  action,
  onPress,
  accessibilityLabel,
  testID,
}: MailSummaryCardProps): JSX.Element {
  const theme = useTheme();
  const a11y = cardA11y(action === undefined ? [] : [action]);
  return (
    <Card
      testID={testID ?? 'ui.mailSummaryCard'}
      padding={[14, 16, 10]}
      onPress={onPress}
      accessibilityLabel={
        accessibilityLabel ?? composeLabel([senderName, badge?.label, time, summary])
      }
      {...a11y}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Avatar name={senderName} id={senderId} size={28} decorative />
        <Text variant="labelSm" weight={unread ? 700 : 600} numberOfLines={1} style={{ flex: 1 }}>
          {senderName}
        </Text>
        {badge === undefined ? null : <Badge label={badge.label} category={badge.category} />}
        {time === undefined ? null : (
          <Text variant="meta" tone="tertiaryStrong" numeric>
            {time}
          </Text>
        )}
      </View>
      <Text variant="bodySm" style={{ marginTop: 8 }}>
        {summary}
      </Text>
      {action === undefined ? null : <CardTextActions actions={[action]} max={1} />}
    </Card>
  );
}

export interface AnnouncementCardProps {
  readonly title: string;
  readonly body?: string;
  readonly severity?: 'info' | 'warning';
  readonly onDismiss: () => void;
  /** "Duyuruyu kapat" */
  readonly dismissLabel: string;
  /** Optional CTA when the announcement has a route. */
  readonly action?: CardAction;
  readonly exiting?: boolean;
  readonly onExited?: () => void;
  /** "Duyuru: {başlık}" */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/** Today announcement banner card (R-25): no gradient, no indigo fill. */
export function AnnouncementCard({
  title,
  body,
  severity = 'info',
  onDismiss,
  dismissLabel,
  action,
  exiting = false,
  onExited,
  accessibilityLabel,
  testID,
}: AnnouncementCardProps): JSX.Element {
  const theme = useTheme();
  const exit = useExitAnimation(exiting, onExited);
  return (
    <Animated.View style={exit}>
      <Card testID={testID ?? `ui.announcementCard.${severity}`} padding={[14, 16, 12]}>
        <View
          accessible
          accessibilityLabel={accessibilityLabel ?? composeLabel([title, body])}
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2.5] }}
        >
          <IconTile
            icon="campaign"
            size={28}
            tone={severity === 'warning' ? 'warning' : 'neutral'}
          />
          <Text variant="h3Sm" numberOfLines={2} style={{ flex: 1, marginTop: 3 }}>
            {title}
          </Text>
        </View>
        <View style={{ position: 'absolute', top: 8, right: 8 }}>
          <CardIconAction kind="close" accessibilityLabel={dismissLabel} onPress={onDismiss} />
        </View>
        {body === undefined ? null : (
          <Text variant="secondary" numberOfLines={3} style={{ marginTop: 4 }}>
            {body}
          </Text>
        )}
        {action === undefined ? null : <CardTextActions actions={[action]} compact max={1} />}
      </Card>
    </Animated.View>
  );
}

export interface LifeCardProps {
  readonly icon: IconName;
  /** "Kargo", "Uçuş", … (upper-cased type label). */
  readonly typeLabel: string;
  readonly time?: string;
  readonly title: string;
  readonly subtitle?: string;
  /** Security events use the critical tile; all other life tiles are neutral. */
  readonly security?: boolean;
  /** ≤ 2 actions, only when the data exists in the source (DEV-64). */
  readonly actions?: readonly CardAction[];
  readonly onPress?: () => void;
  readonly a11yActions?: readonly A11yAction[];
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/** Life-intelligence card (4.9): tile 44 r14, type label, title `h3`, ≤ 2 compact actions. */
export function LifeCard({
  icon,
  typeLabel,
  time,
  title,
  subtitle,
  security = false,
  actions,
  onPress,
  a11yActions = [],
  accessibilityLabel,
  testID,
}: LifeCardProps): JSX.Element {
  const theme = useTheme();
  const a11y = cardA11y([...a11yActions, ...(actions ?? []).slice(0, 2)]);
  return (
    <Card
      testID={testID ?? 'ui.lifeCard'}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? composeLabel([typeLabel, time, title, subtitle])}
      {...a11y}
      style={{ flexDirection: 'row', gap: 14 }}
    >
      <IconTile icon={icon} size={44} tone={security ? 'critical' : 'neutral'} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Text variant="typeLabelLife" tone={security ? 'critical' : 'tertiaryStrong'}>
            {typeLabel}
          </Text>
          {time === undefined ? null : (
            <Text variant="meta" tone="tertiaryStrong" numeric>
              {time}
            </Text>
          )}
        </View>
        <Text variant="h3" style={{ marginTop: 4 }}>
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text variant="secondary" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        )}
        <CardTextActions actions={actions} compact />
      </View>
    </Card>
  );
}
