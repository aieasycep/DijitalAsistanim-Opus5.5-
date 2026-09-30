/**
 * Provenance and explainability (DESIGN_AUDIT §3.7, SREQ-03/04, M§131). "Her AI çıkarımının altında
 * kaynak satırı vardır (Gmail · kişi · saat). Orijinal içerik her zaman bir dokunuş uzakta."
 * - `SourceLine` (alias `SourceTag`): always tappable → the explain sheet or the source.
 * - `MetaLine`, `ProvenanceFooter`, `ConfidenceText` (textual confidence; < 70% switches to the
 *   "Emin değilim" wording), `ConfidenceChip`, `AssuranceNote` (alias `TrustLine`), `AIHint`
 *   (alias `HintRow`), `PrivacyNote`, `FeedbackActions`, `WhySheetContent` (alias
 *   `ExplainSheetContent`).
 */
import type { JSX, ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../../icons/Icon.tsx';
import type { IconName } from '../../icons/generated/index.ts';
import { PressableScale } from '../../primitives/PressableScale.tsx';
import { Text } from '../../primitives/Text.tsx';
import { hiddenFromA11y } from '../../theme/a11y.ts';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import { TextAction } from '../buttons/ActionButtons.tsx';
import { OptionRow, type OptionRowProps } from '../lists/Lists.tsx';

const SEPARATOR = ' · ';

export interface SourceLineProps {
  /** Source-type icon (`mail`, `event`, `mobile`, `description`, …). */
  readonly icon: IconName;
  /** Visible parts joined with " · " ("Gmail", "Ahmet Yılmaz", "08:42", "cihaz eşitlemesi 09:40"). */
  readonly parts: readonly string[];
  /** Opens the explain sheet (default) or the source. Required: the line is always tappable. */
  readonly onPress: () => void;
  /** `verified` uses the `verified` glyph and reads as "Kaynak: …" (prefix supplied in parts). */
  readonly variant?: 'default' | 'verified';
  /** Full spoken label ("Kaynak: Gmail, Ahmet Yılmaz, 08:42"); defaults to the parts. */
  readonly accessibilityLabel?: string;
  /** "Bu nereden çıktı?" */
  readonly accessibilityHint?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

export function SourceLine({
  icon,
  parts,
  onPress,
  variant = 'default',
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: SourceLineProps): JSX.Element {
  const theme = useTheme();
  const color = theme.color.text.tertiaryStrong;
  return (
    <PressableScale
      testID={testID ?? `ui.sourceLine.${variant}`}
      feedback="none"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? parts.join(', ')}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      hitSlop={{ top: 12, bottom: 12, left: 0, right: 0 }}
      pressedStyle={{ opacity: 0.6 }}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1.5] }, style]}
    >
      <Icon name={variant === 'verified' ? 'verified' : icon} size={16} color={color} />
      <Text variant="meta" tone="tertiaryStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
        {parts.join(SEPARATOR)}
      </Text>
    </PressableScale>
  );
}

export const SourceTag = SourceLine;

export interface MetaLineProps {
  readonly parts: readonly string[];
  readonly icon?: IconName;
  readonly numberOfLines?: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/** A non-interactive meta line ("60 dk · Ofis · Son görüşme 4 gün önce"). */
export function MetaLine({
  parts,
  icon,
  numberOfLines = 1,
  style,
  testID,
}: MetaLineProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.metaLine'}
      accessible
      accessibilityLabel={parts.join(', ')}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1] }, style]}
    >
      {icon === undefined ? null : (
        <Icon name={icon} size={15} color={theme.color.text.tertiaryStrong} />
      )}
      <Text
        variant="meta"
        tone="tertiaryStrong"
        numberOfLines={numberOfLines}
        style={{ flexShrink: 1 }}
      >
        {parts.join(SEPARATOR)}
      </Text>
    </View>
  );
}

export interface ProvenanceFooterProps {
  /** "46 mail, 1 takvim, 3 gün geçmiş analiz edildi · 07:58" */
  readonly text: string;
  readonly testID?: string;
}

/** `verified` 16 + meta line under briefings and analyses. */
export function ProvenanceFooter({ text, testID }: ProvenanceFooterProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.provenanceFooter'}
      accessible
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1.5] }}
    >
      <Icon name="verified" size={16} color={theme.color.text.tertiaryStrong} />
      <Text variant="meta" tone="tertiaryStrong" style={{ flexShrink: 1 }}>
        {text}
      </Text>
    </View>
  );
}

export interface ConfidenceTextProps {
  /** Grounding coverage 0–1 (share of claims backed by cited evidence spans). */
  readonly coverage: number;
  /** "3 kaynaktan · %92 eşleşme" */
  readonly label: string;
  /** "Emin değilim" / "Kaynakta kesinleşmiyor." shown below the threshold. */
  readonly uncertainLabel: string;
  /** Default 0.7 ("%70 altında 'emin değilim' dili kullanılır"). */
  readonly threshold?: number;
  readonly testID?: string;
}

/** Textual confidence (PRIMARY has no meter). */
export function ConfidenceText({
  coverage,
  label,
  uncertainLabel,
  threshold = 0.7,
  testID,
}: ConfidenceTextProps): JSX.Element {
  const theme = useTheme();
  const uncertain = coverage < threshold;
  return (
    <View
      testID={testID ?? `ui.confidenceText.${uncertain ? 'uncertain' : 'confident'}`}
      accessible
      accessibilityLabel={uncertain ? `${uncertainLabel}, ${label}` : label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1] }}
    >
      {uncertain ? <Icon name="info" size={14} color={theme.color.text.secondary} /> : null}
      <Text variant="meta" tone={uncertain ? 'secondary' : 'tertiaryStrong'}>
        {uncertain ? `${uncertainLabel}${SEPARATOR}${label}` : label}
      </Text>
    </View>
  );
}

export interface ConfidenceChipProps {
  /** "Emin değilim · onayla" */
  readonly label: string;
  readonly onConfirm: () => void;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

/** Warning-soft chip on an extracted value below the confidence threshold; requires a tap. */
export function ConfidenceChip({
  label,
  onConfirm,
  accessibilityHint,
  testID,
}: ConfidenceChipProps): JSX.Element {
  const theme = useTheme();
  return (
    <PressableScale
      testID={testID ?? 'ui.confidenceChip'}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={onConfirm}
      visualSize={{ width: 44, height: 26 }}
      style={{
        minHeight: 26,
        paddingHorizontal: 9,
        borderRadius: theme.radius.pill,
        alignSelf: 'flex-start',
        justifyContent: 'center',
        backgroundColor: theme.tone.warning.soft,
      }}
    >
      <Text variant="labelXs" style={{ color: theme.tone.warning.text }}>
        {label}
      </Text>
    </PressableScale>
  );
}

interface NoteProps {
  readonly text: string;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
}

/** `verified_user` 18 success + 13 secondary ("Sen onaylamadan hiçbir mail gönderilmez."). */
export function AssuranceNote({ text, testID, style }: NoteProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.assuranceNote'}
      accessible
      style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }, style]}
    >
      <Icon name="verified_user" filled size={18} color={theme.color.tone.success.text} />
      <Text variant="bodyXs" tone="secondary" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

export const TrustLine = AssuranceNote;

/** `psychology` 18 primary + 13/19 secondary. Only data-backed hints (DEV-52). */
export function AIHint({ text, testID, style }: NoteProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.aiHint'}
      accessible
      style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }, style]}
    >
      <Icon name="psychology" size={18} color={theme.color.icon.ai} />
      <Text variant="bodyXs" tone="secondary" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

export const HintRow = AIHint;

/** `lock` 16 + 12 tertiary-strong privacy footnote. */
export function PrivacyNote({ text, testID, style }: NoteProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.privacyNote'}
      accessible
      style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[1.5] }, style]}
    >
      <Icon name="lock" size={16} color={theme.color.text.tertiaryStrong} />
      <Text variant="meta" tone="tertiaryStrong" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

export type FeedbackValue = 'positive' | 'negative' | null;

export interface FeedbackActionsProps {
  /** "Doğru" */
  readonly positiveLabel: string;
  /** "Önemli değil" */
  readonly negativeLabel: string;
  readonly value: FeedbackValue;
  readonly onPositive: () => void;
  readonly onNegative: () => void;
  /** Optional prompt before the buttons ("Bu yanıt işine yaradı mı?"). */
  readonly prompt?: string;
  readonly disabled?: boolean;
  readonly testID?: string;
}

/** 👍 / 👎 feedback pair (thumb icons, never emoji) writing `ai_feedback` through the app. */
export function FeedbackActions({
  positiveLabel,
  negativeLabel,
  value,
  onPositive,
  onNegative,
  prompt,
  disabled = false,
  testID,
}: FeedbackActionsProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const button = (
    kind: 'positive' | 'negative',
    label: string,
    onPress: () => void,
  ): JSX.Element => {
    const selected = value === kind;
    const fg = selected ? c.brand.onSoft : c.text.secondary;
    return (
      <PressableScale
        testID={`${testID ?? 'ui.feedbackActions'}.${kind}`}
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        disabled={disabled}
        onPress={onPress}
        visualSize={{ width: 44, height: 36 }}
        pressedStyle={{ backgroundColor: c.surfaceSunken }}
        style={{
          minHeight: 36,
          paddingHorizontal: 12,
          borderRadius: theme.radius.pill,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[1.5],
          backgroundColor: selected ? c.brand.soft : c.surfaceSunken,
        }}
      >
        <Icon
          name={kind === 'positive' ? 'thumb_up' : 'thumb_down'}
          filled={selected}
          size={18}
          color={fg}
        />
        <Text variant="labelSm" style={{ color: fg }}>
          {label}
        </Text>
      </PressableScale>
    );
  };
  return (
    <View
      testID={testID ?? 'ui.feedbackActions'}
      style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space[2] }}
    >
      {prompt === undefined ? null : (
        <Text variant="bodyXs" tone="secondary" style={{ marginRight: theme.space[1] }}>
          {prompt}
        </Text>
      )}
      {button('positive', positiveLabel, onPositive)}
      {button('negative', negativeLabel, onNegative)}
    </View>
  );
}

export type DecisionTierKind =
  'explicit_rule' | 'learned_preference' | 'deterministic_signal' | 'ai_classification';

const TIER_ICON: Record<DecisionTierKind, IconName> = {
  explicit_rule: 'tune',
  learned_preference: 'psychology',
  deterministic_signal: 'bolt',
  ai_classification: 'auto_awesome',
};

export interface WhySheetContentProps {
  /** "Neden önemli?" */
  readonly title: string;
  /** The stored reason sentence. */
  readonly reason: string;
  /** Precedence tier row ("Senin kuralın: …", "Sinyal: VIP kişi · son tarih içeriyor", …). */
  readonly tier: { readonly kind: DecisionTierKind; readonly text: string };
  readonly source?: {
    readonly icon: IconName;
    readonly parts: readonly string[];
    /** "Orijinalini aç" */
    readonly openLabel: string;
    readonly onOpen: () => void;
  };
  /** Correction options (Önemli değil · Bunu daha sık göster · Bu kişiyi VIP yap · Takip etme). */
  readonly options?: readonly (OptionRowProps & { readonly key: string })[];
  /** "Kural oluştur" */
  readonly ruleAction?: { readonly label: string; readonly onPress: () => void };
  readonly children?: ReactNode;
  readonly testID?: string;
}

/** The explain sheet body (put it inside `BottomSheet`); alias `ExplainSheetContent`. */
export function WhySheetContent({
  title,
  reason,
  tier,
  source,
  options,
  ruleAction,
  children,
  testID,
}: WhySheetContentProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  return (
    <View testID={testID ?? 'ui.whySheetContent'} style={{ gap: theme.space[3.5] }}>
      <Text variant="sheetTitle" heading>
        {title}
      </Text>
      <Text variant="body">{reason}</Text>
      <View
        accessible
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[2.5],
          padding: theme.space[3],
          borderRadius: theme.radius.button,
          backgroundColor: c.bg,
        }}
      >
        <View {...hiddenFromA11y}>
          <Icon
            name={TIER_ICON[tier.kind]}
            filled={tier.kind === 'ai_classification'}
            size={20}
            color={tier.kind === 'ai_classification' ? c.icon.ai : c.icon.default}
          />
        </View>
        <Text variant="bodyXs" style={{ flex: 1 }}>
          {tier.text}
        </Text>
      </View>
      {source === undefined ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <MetaLine icon={source.icon} parts={source.parts} style={{ flex: 1 }} />
          <TextAction
            label={source.openLabel}
            onPress={source.onOpen}
            compact
            trailingIcon="open_in_new"
          />
        </View>
      )}
      {options === undefined || options.length === 0 ? null : (
        <View>
          {options.map(({ key, ...option }) => (
            <OptionRow key={key} {...option} />
          ))}
        </View>
      )}
      {children}
      {ruleAction === undefined ? null : (
        <TextAction label={ruleAction.label} onPress={ruleAction.onPress} icon="tune" />
      )}
    </View>
  );
}

export const ExplainSheetContent = WhySheetContent;
