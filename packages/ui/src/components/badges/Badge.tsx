/**
 * Badges and status pills (DESIGN_AUDIT §2.5, §3.3). Rule (verbatim): "Rozet: 11/700, +0.05em,
 * pill, 3×8 dolgu." **Kural 1:** card category badges are coloured only for ACİL (critical),
 * SON TARİH (warning), GÜVENLİK (critical) and ONAYLANDI (success); every other category is
 * neutral — so `Badge` takes a semantic `category`, not a colour. Lifecycle status pills follow the
 * documented tone map (`StatusPill` + the `*StatusTone` helpers). Text is upper-cased with the
 * locale rules; colour never carries meaning alone (the label is always present).
 */
import type { JSX } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Spinner } from '../../primitives/Spinner.tsx';
import { Text } from '../../primitives/Text.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';

export const BADGE_CATEGORIES = ['urgent', 'deadline', 'security', 'approved', 'neutral'] as const;
/** The only badge categories allowed to carry colour, plus `neutral` for everything else. */
export type BadgeCategory = (typeof BADGE_CATEGORIES)[number];

export type StatusTone = 'critical' | 'warning' | 'success' | 'neutral' | 'primary' | 'info';

const CATEGORY_TONE: Record<BadgeCategory, StatusTone> = {
  urgent: 'critical',
  deadline: 'warning',
  security: 'critical',
  approved: 'success',
  neutral: 'neutral',
};

export function badgeTone(category: BadgeCategory): StatusTone {
  return CATEGORY_TONE[category];
}

interface PillProps {
  readonly label: string;
  readonly tone: StatusTone;
  readonly size: 'md' | 'sm' | 'header' | 'wait';
  readonly busy?: boolean;
  readonly caps: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

const PADDING = {
  md: { paddingVertical: 3, paddingHorizontal: 8 },
  sm: { paddingVertical: 2, paddingHorizontal: 6 },
  header: { paddingVertical: 4, paddingHorizontal: 9 },
  wait: { minHeight: 26, paddingHorizontal: 9, justifyContent: 'center' as const },
} as const;

function Pill({ label, tone, size, busy = false, caps, style, testID }: PillProps): JSX.Element {
  const theme = useTheme();
  const colors = theme.tone[tone];
  return (
    <View
      testID={testID}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: theme.space[1],
          borderRadius: theme.radius.pill,
          backgroundColor: colors.soft,
        },
        PADDING[size],
        style,
      ]}
    >
      {busy ? <Spinner size={14} tone="ink" /> : null}
      <Text
        variant={size === 'sm' ? 'badgeSm' : size === 'wait' ? 'labelXs' : 'badge'}
        caps={caps}
        style={{ color: colors.text }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

export interface BadgeProps {
  readonly label: string;
  /** Semantic category (Kural 1); default `neutral`. */
  readonly category?: BadgeCategory;
  /** `sm` 10/700 2×6 (onboarding, widgets); `header` 4×9 (mail detail). */
  readonly size?: 'md' | 'sm' | 'header';
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/** Category badge. It is read as part of its parent's label and is not focusable. */
export function Badge({
  label,
  category = 'neutral',
  size = 'md',
  style,
  testID,
}: BadgeProps): JSX.Element {
  return (
    <Pill
      label={label}
      tone={CATEGORY_TONE[category]}
      size={size}
      caps
      style={style}
      testID={testID ?? `ui.badge.${category}`}
    />
  );
}

export interface StatusPillProps {
  readonly label: string;
  readonly tone: StatusTone;
  /** Leading 12 px spinner (İŞLENİYOR). */
  readonly busy?: boolean;
  /** `wait` = the 26 h follow-up days pill (12/600). */
  readonly size?: 'md' | 'wait';
  /** Upper-case the label (lifecycle badges); off for "3 gün" style pills. Default true. */
  readonly caps?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/** Lifecycle status pill; the parent's label includes the status. */
export function StatusPill({
  label,
  tone,
  busy = false,
  size = 'md',
  caps,
  style,
  testID,
}: StatusPillProps): JSX.Element {
  return (
    <Pill
      label={label}
      tone={tone}
      size={size}
      busy={busy}
      caps={caps ?? size === 'md'}
      style={style}
      testID={testID ?? `ui.statusPill.${tone}`}
    />
  );
}

/** "PRO" plan badge: primary tone, padding 2×8, 11/600. */
export function PlanBadge({
  label,
  testID,
}: {
  readonly label: string;
  readonly testID?: string;
}): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.planBadge'}
      style={{
        alignSelf: 'flex-start',
        borderRadius: theme.radius.pill,
        paddingVertical: 2,
        paddingHorizontal: 8,
        backgroundColor: theme.tone.primary.soft,
      }}
    >
      <Text variant="badge" weight={600} caps style={{ color: theme.tone.primary.text }}>
        {label}
      </Text>
    </View>
  );
}

export type ApprovalStatus =
  'pending' | 'approved' | 'executing' | 'executed' | 'failed' | 'rejected' | 'expired';

/** Approval: BEKLİYOR warning · İŞLENİYOR neutral + spinner · ONAYLANDI/TAMAMLANDI success · BAŞARISIZ critical · REDDEDİLDİ / SÜRESİ DOLDU neutral. */
export function approvalStatusTone(status: ApprovalStatus): { tone: StatusTone; busy: boolean } {
  switch (status) {
    case 'pending':
      return { tone: 'warning', busy: false };
    case 'approved':
    case 'executed':
      return { tone: 'success', busy: false };
    case 'executing':
      return { tone: 'neutral', busy: true };
    case 'failed':
      return { tone: 'critical', busy: false };
    case 'rejected':
    case 'expired':
      return { tone: 'neutral', busy: false };
  }
}

export type CommitmentDisplayStatus = 'open' | 'today' | 'overdue' | 'done';

/** Commitment: AÇIK neutral · BUGÜN warning · GECİKMİŞ critical · TAMAMLANDI success. */
export function commitmentStatusTone(status: CommitmentDisplayStatus): StatusTone {
  switch (status) {
    case 'open':
      return 'neutral';
    case 'today':
      return 'warning';
    case 'overdue':
      return 'critical';
    case 'done':
      return 'success';
  }
}

/**
 * Wait duration: < 3 days neutral · 3–6 warning · ≥ 7 critical. The thresholds are configurable
 * (the defaults mirror `packages/domain`).
 */
export function waitDurationTone(
  days: number,
  thresholds: { readonly warning: number; readonly critical: number } = { warning: 3, critical: 7 },
): StatusTone {
  if (days >= thresholds.critical) return 'critical';
  if (days >= thresholds.warning) return 'warning';
  return 'neutral';
}
