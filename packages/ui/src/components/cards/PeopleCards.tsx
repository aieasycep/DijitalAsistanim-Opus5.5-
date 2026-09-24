/**
 * Person-centred cards (DESIGN_AUDIT §3.6): `FollowUpCard` (4.6), `WaitingCard` (4.7; alias
 * `PersonActionCard` for the VIP person card) and `CommitmentCard` (4.8). Wait pills use the
 * < 3 / 3–6 / ≥ 7 day tone thresholds; commitment quotes are Lora italic.
 */
import type { JSX } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Icon } from '../../icons/Icon.tsx';
import { Card } from '../../primitives/Surface.tsx';
import { Text } from '../../primitives/Text.tsx';
import { useExitAnimation } from '../../primitives/useExitAnimation.ts';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import { Avatar } from '../avatar/Avatar.tsx';
import { StatusPill, type StatusTone } from '../badges/Badge.tsx';
import { Button } from '../buttons/Button.tsx';
import { TextAction } from '../buttons/ActionButtons.tsx';
import { KeyValueGrid, type KeyValueItem } from '../lists/Lists.tsx';
import { SourceLine } from '../provenance/Provenance.tsx';
import type { CardSource } from './FeedCards.tsx';
import { cardA11y, type A11yAction } from './shared.tsx';

interface ButtonAction {
  readonly label: string;
  readonly onPress: () => void;
  readonly loading?: boolean;
  readonly loadingLabel?: string;
  /** Pro-gated actions show `lock` and open the gate. */
  readonly locked?: boolean;
}

export interface FollowUpCardProps {
  readonly personName: string;
  readonly personId?: string;
  readonly topic: string;
  /** "3 gün" */
  readonly waitLabel: string;
  readonly waitTone: StatusTone;
  /** "Teklifine 3 gündür yanıt gelmedi." */
  readonly status: string;
  readonly source?: CardSource;
  /** "Takip Mesajı Hazırla" (tonal). */
  readonly draftAction: ButtonAction;
  /** "Yarın Hatırlat" (neutral tonal). */
  readonly remindAction?: ButtonAction;
  /** "Kapat" (ghost, right). */
  readonly closeAction?: ButtonAction;
  readonly a11yActions?: readonly A11yAction[];
  readonly exiting?: boolean;
  readonly onExited?: () => void;
  readonly onPress?: () => void;
  readonly testID?: string;
}

export function FollowUpCard({
  personName,
  personId,
  topic,
  waitLabel,
  waitTone,
  status,
  source,
  draftAction,
  remindAction,
  closeAction,
  a11yActions = [],
  exiting = false,
  onExited,
  onPress,
  testID,
}: FollowUpCardProps): JSX.Element {
  const theme = useTheme();
  const exit = useExitAnimation(exiting, onExited);
  const a11y = cardA11y([
    ...a11yActions,
    { key: 'draft', label: draftAction.label, onPress: draftAction.onPress },
    ...(remindAction === undefined
      ? []
      : [{ key: 'remind', label: remindAction.label, onPress: remindAction.onPress }]),
    ...(closeAction === undefined
      ? []
      : [{ key: 'close', label: closeAction.label, onPress: closeAction.onPress }]),
  ]);
  return (
    <Animated.View style={exit}>
      <Card
        testID={testID ?? 'ui.followUpCard'}
        onPress={onPress}
        accessibilityLabel={[personName, topic, waitLabel, status].join('. ')}
        {...a11y}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Avatar name={personName} id={personId} size={40} decorative />
          <View style={{ flex: 1 }}>
            <Text variant="h3Sm">{personName}</Text>
            <Text variant="bodyXs" tone="secondary" numberOfLines={1}>
              {topic}
            </Text>
          </View>
          <StatusPill label={waitLabel} tone={waitTone} size="wait" />
        </View>
        <Text variant="bodySm" style={{ marginTop: 12 }}>
          {status}
        </Text>
        {source === undefined ? null : <SourceLine {...source} style={{ marginTop: 10 }} />}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[2],
            marginTop: 12,
            flexWrap: 'wrap',
          }}
        >
          <Button
            label={draftAction.label}
            onPress={draftAction.onPress}
            loading={draftAction.loading}
            loadingLabel={draftAction.loadingLabel}
            icon={draftAction.locked === true ? 'lock' : undefined}
            variant="tonal"
            size="card"
          />
          {remindAction === undefined ? null : (
            <Button
              label={remindAction.label}
              onPress={remindAction.onPress}
              variant="neutralTonal"
              size="card"
            />
          )}
          <View style={{ flex: 1 }} />
          {closeAction === undefined ? null : (
            <TextAction
              label={closeAction.label}
              onPress={closeAction.onPress}
              emphasis="secondary"
              compact
            />
          )}
        </View>
      </Card>
    </Animated.View>
  );
}

export interface WaitingCardProps {
  readonly personName: string;
  readonly personId?: string;
  /** "3 gündür bekliyor" / "3 gün" */
  readonly waitMeta: string;
  readonly topic: string;
  /** What they expect ("Revize teklifi bekliyor."). */
  readonly expectation?: string;
  /** Footer deadline ("Yarın 17:00'ye kadar"); omitted for undated items. */
  readonly deadline?: {
    readonly label: string;
    readonly tone: Extract<StatusTone, 'critical' | 'warning' | 'neutral'>;
  };
  /** "Yanıtla" / "Takip Et" */
  readonly action?: { readonly label: string; readonly onPress: () => void };
  /** VIP person card: `star` FILL after the name. */
  readonly vip?: boolean;
  readonly vipLabel?: string;
  readonly onPress?: () => void;
  readonly a11yActions?: readonly A11yAction[];
  readonly testID?: string;
}

/** Waiting-on-you card (4.7) and VIP person card: r18 padding 14/16. */
export function WaitingCard({
  personName,
  personId,
  waitMeta,
  topic,
  expectation,
  deadline,
  action,
  vip = false,
  vipLabel,
  onPress,
  a11yActions = [],
  testID,
}: WaitingCardProps): JSX.Element {
  const theme = useTheme();
  const a11y = cardA11y([
    ...a11yActions,
    ...(action === undefined
      ? []
      : [{ key: 'action', label: action.label, onPress: action.onPress }]),
  ]);
  const deadlineTone = deadline?.tone === 'neutral' ? 'secondary' : deadline?.tone;
  return (
    <Card
      testID={testID ?? (vip ? 'ui.personActionCard' : 'ui.waitingCard')}
      radius="list"
      padding={[14, 16]}
      onPress={onPress}
      accessibilityLabel={[
        personName,
        vip ? vipLabel : undefined,
        waitMeta,
        topic,
        expectation,
        deadline?.label,
      ]
        .filter(Boolean)
        .join('. ')}
      {...a11y}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Avatar name={personName} id={personId} size={40} decorative />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1] }}>
            <Text variant="rowTitle" weight={600}>
              {personName}
            </Text>
            {vip ? <Icon name="star" filled size={15} color={theme.color.brand.primary} /> : null}
          </View>
          <Text variant="meta" tone="tertiaryStrong">
            {waitMeta}
          </Text>
        </View>
      </View>
      <Text variant="bodyXs" tone="secondary" style={{ marginTop: 10 }}>
        {topic}
      </Text>
      {expectation === undefined ? null : (
        <Text variant="secondary" tone="primary" style={{ marginTop: 4 }}>
          {expectation}
        </Text>
      )}
      {deadline === undefined && action === undefined ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          {deadline === undefined ? null : (
            <Text variant="labelXs" tone={deadlineTone} style={{ flex: 1 }}>
              {deadline.label}
            </Text>
          )}
          {deadline === undefined ? <View style={{ flex: 1 }} /> : null}
          {action === undefined ? null : (
            <TextAction label={action.label} onPress={action.onPress} compact />
          )}
        </View>
      )}
    </Card>
  );
}

export const PersonActionCard = WaitingCard;

export interface CommitmentCardProps {
  readonly status: { readonly label: string; readonly tone: StatusTone };
  readonly date?: string;
  /** Verbatim commitment quote (rendered in typographic quotes, Lora italic). */
  readonly quote: string;
  /** Taahhüt / Kime / Kaynak rows (52 px labels). */
  readonly details: readonly KeyValueItem[];
  readonly completeAction?: ButtonAction;
  readonly snoozeAction?: ButtonAction;
  /** "Kaynağı Gör" (ghost right; the only action when done). */
  readonly sourceAction: { readonly label: string; readonly onPress: () => void };
  readonly done?: boolean;
  /** "Bu bir söz mü?" confirmation variant (M§18). */
  readonly confirmation?: {
    readonly kicker: string;
    readonly confirm: ButtonAction;
    readonly reject: ButtonAction;
  };
  readonly a11yActions?: readonly A11yAction[];
  readonly exiting?: boolean;
  readonly onExited?: () => void;
  readonly testID?: string;
}

export function CommitmentCard({
  status,
  date,
  quote,
  details,
  completeAction,
  snoozeAction,
  sourceAction,
  done = false,
  confirmation,
  a11yActions = [],
  exiting = false,
  onExited,
  testID,
}: CommitmentCardProps): JSX.Element {
  const theme = useTheme();
  const exit = useExitAnimation(exiting, onExited);
  const quoted = `“${quote}”`;
  const buttons =
    confirmation === undefined
      ? [
          ...(done || completeAction === undefined
            ? []
            : [{ key: 'complete', label: completeAction.label, onPress: completeAction.onPress }]),
          ...(done || snoozeAction === undefined
            ? []
            : [{ key: 'snooze', label: snoozeAction.label, onPress: snoozeAction.onPress }]),
        ]
      : [
          {
            key: 'confirm',
            label: confirmation.confirm.label,
            onPress: confirmation.confirm.onPress,
          },
          { key: 'reject', label: confirmation.reject.label, onPress: confirmation.reject.onPress },
        ];
  const a11y = cardA11y([
    ...a11yActions,
    ...buttons,
    { key: 'source', label: sourceAction.label, onPress: sourceAction.onPress },
  ]);
  return (
    <Animated.View style={exit}>
      <Card
        testID={
          testID ?? (confirmation === undefined ? 'ui.commitmentCard' : 'ui.commitmentCard.confirm')
        }
        accessibilityLabel={[status.label, date, quote].filter(Boolean).join('. ')}
        {...a11y}
      >
        {confirmation === undefined ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <StatusPill label={status.label} tone={status.tone} />
            {date === undefined ? null : (
              <Text variant="meta" tone="tertiaryStrong" numeric>
                {date}
              </Text>
            )}
          </View>
        ) : (
          <Text variant="kicker" tone="tertiaryStrong" heading>
            {confirmation.kicker}
          </Text>
        )}
        <Text variant="editorialQuote" style={{ marginTop: 10 }}>
          {quoted}
        </Text>
        <KeyValueGrid items={details} labelWidth={52} style={{ marginTop: 10 }} />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[2],
            marginTop: 12,
            flexWrap: 'wrap',
          }}
        >
          {confirmation !== undefined ? (
            <>
              <Button
                label={confirmation.confirm.label}
                onPress={confirmation.confirm.onPress}
                loading={confirmation.confirm.loading}
                variant="tonal"
                size="card"
              />
              <Button
                label={confirmation.reject.label}
                onPress={confirmation.reject.onPress}
                variant="neutralTonal"
                size="card"
              />
            </>
          ) : done ? null : (
            <>
              {completeAction === undefined ? null : (
                <Button
                  label={completeAction.label}
                  onPress={completeAction.onPress}
                  loading={completeAction.loading}
                  icon="check"
                  variant="tonal"
                  size="card"
                />
              )}
              {snoozeAction === undefined ? null : (
                <Button
                  label={snoozeAction.label}
                  onPress={snoozeAction.onPress}
                  variant="neutralTonal"
                  size="card"
                />
              )}
            </>
          )}
          <View style={{ flex: 1 }} />
          <TextAction
            label={sourceAction.label}
            onPress={sourceAction.onPress}
            emphasis="secondary"
            compact
          />
        </View>
      </Card>
    </Animated.View>
  );
}
