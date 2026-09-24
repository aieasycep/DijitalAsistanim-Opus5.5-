/**
 * `ApprovalCard` (DESIGN_AUDIT §3.7.1, M§33, R-03, R-06). Contract: "Ne yapılacak · Neden · Ne
 * değişecek" plus Kaynak (tappable), Hesap (destination) and Yan etki (side effect). Every approval
 * is a tap — a spoken "onayla" never approves; the compact voice card shows the hint
 * "Onaylamak için karta dokun." Status changes are announced; the success haptic fires only when
 * the server reports `executed`. Variants: `full` (Onay Merkezi), `compact` (voice: Onayla /
 * Düzenle / İptal) and `row` (capture batch sheet, with a selection toggle).
 */
import { useEffect, useRef, type JSX } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { IconName } from '../../icons/generated/index.ts';
import { IconTile } from '../../primitives/IconTile.tsx';
import { PressableScale } from '../../primitives/PressableScale.tsx';
import { Card } from '../../primitives/Surface.tsx';
import { Text } from '../../primitives/Text.tsx';
import { useExitAnimation } from '../../primitives/useExitAnimation.ts';
import { announce } from '../../theme/a11y.ts';
import { useHaptic } from '../../theme/preferences.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import { approvalStatusTone, StatusPill, type ApprovalStatus } from '../badges/Badge.tsx';
import { Button } from '../buttons/Button.tsx';
import { CheckIndicator } from '../inputs/Controls.tsx';
import { KeyValueGrid, type KeyValueItem } from '../lists/Lists.tsx';
import { ErrorCard } from '../../states/ErrorCard.tsx';

export const APPROVAL_ACTION_TYPES = [
  'email_send',
  'calendar_create',
  'calendar_update',
  'task_create',
  'reminder_create',
  'commitment_create',
] as const;
export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number];

export const APPROVAL_TYPE_ICON: Readonly<Record<ApprovalActionType, IconName>> = {
  email_send: 'send',
  calendar_create: 'event',
  calendar_update: 'event_repeat',
  task_create: 'add_task',
  reminder_create: 'notifications',
  commitment_create: 'handshake',
};

interface Action {
  readonly label: string;
  readonly onPress: () => void;
}

export interface ApprovalCardProps {
  readonly actionType: ApprovalActionType;
  /** "Mail gönder" (upper-cased). */
  readonly typeLabel: string;
  readonly status: ApprovalStatus;
  /** "Bekliyor", "İşleniyor", "Onaylandı", "Başarısız", "Reddedildi", "Süresi doldu". */
  readonly statusLabel: string;
  /** Time meta shown while pending ("09:12"). */
  readonly time?: string;
  /** What will happen (`h3`). */
  readonly title: string;
  /** Neden · Değişim · Kaynak · Hesap · Yan etki. */
  readonly details: readonly KeyValueItem[];
  readonly approve: Action & {
    /** "İşleniyor…" / "Gönderiliyor…" while approved/executing. */
    readonly busyLabel?: string;
    /** "Onaylandı" after execution. */
    readonly doneLabel?: string;
  };
  readonly edit?: Action;
  /** Reddet (full) or İptal (compact voice card). */
  readonly reject?: Action;
  /** Failure reason and "Tekrar dene" (same idempotency key). */
  readonly failure?: { readonly reason: string; readonly retry?: Action };
  /** "Süresi doldu · 16:00 geçti" */
  readonly expiredNote?: string;
  /** Warning inline: "Etkinlik öneriden sonra değişti" → "Yeniden oluştur". */
  readonly conflict?: { readonly title: string; readonly body?: string; readonly action: Action };
  readonly variant?: 'full' | 'compact';
  /** Compact voice card hint ("Onaylamak için karta dokun."). */
  readonly hint?: string;
  /** Plays the move-to-history exit (320 ms). */
  readonly exiting?: boolean;
  readonly onExited?: () => void;
  /** "Mail gönder: …. Neden: …" */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

export function ApprovalCard({
  actionType,
  typeLabel,
  status,
  statusLabel,
  time,
  title,
  details,
  approve,
  edit,
  reject,
  failure,
  expiredNote,
  conflict,
  variant = 'full',
  hint,
  exiting = false,
  onExited,
  accessibilityLabel,
  testID,
}: ApprovalCardProps): JSX.Element {
  const theme = useTheme();
  const haptic = useHaptic();
  const exit = useExitAnimation(exiting, onExited, theme.motion.duration.cardToHistory);
  const lastStatus = useRef(status);
  useEffect(() => {
    if (lastStatus.current === status) return;
    lastStatus.current = status;
    announce(statusLabel);
    if (status === 'executed') haptic('approveExecuted');
  }, [status, statusLabel, haptic]);
  const { tone, busy } = approvalStatusTone(status);
  const inFlight = status === 'approved' || status === 'executing';
  const faded = status === 'rejected' || status === 'expired';
  const showButtons = status === 'pending' || inFlight;
  const why = details.find((d) => d.key === 'why');
  const reason = why === undefined ? undefined : `${why.label}: ${why.value}`;
  const label =
    accessibilityLabel ??
    [`${typeLabel}: ${title}`, reason, statusLabel].filter(Boolean).join('. ');
  return (
    <Animated.View style={[exit, faded ? { opacity: theme.opacity.rejected } : null]}>
      <Card
        testID={testID ?? `ui.approvalCard.${variant}.${status}`}
        style={variant === 'compact' ? theme.elevation('page') : undefined}
      >
        <View accessible accessibilityLabel={label} accessibilityLiveRegion="polite">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2.5] }}>
            <IconTile icon={APPROVAL_TYPE_ICON[actionType]} size={28} tone="primary" />
            <Text variant="kickerAi" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
              {typeLabel}
            </Text>
            {status === 'pending' && time !== undefined ? (
              <Text variant="meta" tone="tertiaryStrong" numeric>
                {time}
              </Text>
            ) : (
              <StatusPill label={statusLabel} tone={tone} busy={busy} />
            )}
          </View>
          <Text variant="h3" style={{ marginTop: 10 }}>
            {title}
          </Text>
        </View>
        <KeyValueGrid items={details} style={{ marginTop: 10 }} />
        {status === 'failed' && failure !== undefined ? (
          <Text
            variant="bodyXs"
            tone="critical"
            style={{ marginTop: 10 }}
            accessibilityRole="alert"
          >
            {failure.reason}
          </Text>
        ) : null}
        {status === 'expired' && expiredNote !== undefined ? (
          <Text variant="bodyXs" tone="tertiaryStrong" style={{ marginTop: 10 }}>
            {expiredNote}
          </Text>
        ) : null}
        {conflict === undefined ? null : (
          <View style={{ marginTop: 12 }}>
            <ErrorCard
              tone="warning"
              icon="sync_problem"
              title={conflict.title}
              body={conflict.body}
              primaryAction={conflict.action}
            />
          </View>
        )}
        {showButtons ? (
          <View style={{ flexDirection: 'row', gap: theme.space[2], marginTop: 14 }}>
            <Button
              label={approve.label}
              onPress={approve.onPress}
              loading={inFlight}
              loadingLabel={approve.busyLabel}
              size="inline"
              flex
              testID="ui.approvalCard.approve"
            />
            {edit === undefined ? null : (
              <Button
                label={edit.label}
                onPress={edit.onPress}
                variant="tonal"
                size="inline"
                disabled={inFlight}
                testID="ui.approvalCard.edit"
              />
            )}
            {reject === undefined ? null : (
              <Button
                label={reject.label}
                onPress={reject.onPress}
                variant="neutralTonal"
                size="inline"
                disabled={inFlight}
                testID="ui.approvalCard.reject"
              />
            )}
          </View>
        ) : null}
        {status === 'executed' && approve.doneLabel !== undefined ? (
          <View style={{ marginTop: 14 }}>
            <StatusPill label={approve.doneLabel} tone="success" caps={false} />
          </View>
        ) : null}
        {status === 'failed' && failure?.retry !== undefined ? (
          <View style={{ flexDirection: 'row', gap: theme.space[2], marginTop: 14 }}>
            <Button
              label={failure.retry.label}
              onPress={failure.retry.onPress}
              size="inline"
              flex
              testID="ui.approvalCard.retry"
            />
            {edit === undefined ? null : (
              <Button label={edit.label} onPress={edit.onPress} variant="tonal" size="inline" />
            )}
          </View>
        ) : null}
        {variant === 'compact' && hint !== undefined ? (
          <Text variant="meta" tone="tertiaryStrong" align="center" style={{ marginTop: 10 }}>
            {hint}
          </Text>
        ) : null}
      </Card>
    </Animated.View>
  );
}

export interface ApprovalRowProps {
  readonly actionType: ApprovalActionType;
  readonly typeLabel: string;
  readonly title: string;
  readonly meta?: string;
  readonly details?: readonly KeyValueItem[];
  readonly selected: boolean;
  readonly onToggle: () => void;
  readonly testID?: string;
}

/** Capture batch row (4.12d/4.13d): tile + type 11/700 + title 15/600 + meta + check toggle. */
export function ApprovalRow({
  actionType,
  typeLabel,
  title,
  meta,
  details,
  selected,
  onToggle,
  testID,
}: ApprovalRowProps): JSX.Element {
  const theme = useTheme();
  return (
    <PressableScale
      testID={testID ?? 'ui.approvalRow'}
      feedback="none"
      accessibilityRole="checkbox"
      accessibilityLabel={[`${typeLabel}: ${title}`, meta].filter(Boolean).join(', ')}
      accessibilityState={{ checked: selected }}
      haptic="select"
      onPress={onToggle}
      style={{ paddingVertical: 12, gap: 8 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <IconTile icon={APPROVAL_TYPE_ICON[actionType]} size={30} tone="primary" />
        <View style={{ flex: 1 }}>
          <Text variant="typeLabel" tone="secondary">
            {typeLabel}
          </Text>
          <Text variant="rowTitle" weight={600}>
            {title}
          </Text>
          {meta === undefined ? null : (
            <Text variant="meta" tone="tertiaryStrong">
              {meta}
            </Text>
          )}
        </View>
        <CheckIndicator selected={selected} />
      </View>
      {details === undefined ? null : <KeyValueGrid items={details} labelWidth={56} />}
    </PressableScale>
  );
}
