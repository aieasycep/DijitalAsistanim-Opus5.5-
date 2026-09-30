/**
 * Editorial and sharing (DESIGN_AUDIT §3.14). Lora scope: briefing narrative, reading view, weekly
 * review and share card, commitment quotes — never controls or lists.
 * - `EditorialParagraph`: Lora 18/29 (reading 17/28) with bold spans (Lora 600).
 * - `EditorialStatRow`: Lora 34/36 number (min-width 84; highlighted in primary) + 15 label.
 * - `HighlightCard`: ink r24 padding 22 with a Lora figure.
 * - `ShareCardTemplate`: 1080×1350 / 1080×1920 dawn card rendered off-screen by the app
 *   (react-native-view-shot); aggregates only, no names (M§12); fonts must be loaded first.
 */
import type { JSX } from 'react';
import { View } from 'react-native';
import { Icon } from '../../icons/Icon.tsx';
import { GradientSurface, InkSurface } from '../../primitives/Surface.tsx';
import { Text } from '../../primitives/Text.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';

export interface EditorialSpan {
  readonly key: string;
  readonly text: string;
  readonly bold?: boolean;
}

export interface EditorialParagraphProps {
  readonly spans: readonly EditorialSpan[];
  readonly variant?: 'narrative' | 'reading';
  readonly testID?: string;
}

export function EditorialParagraph({
  spans,
  variant = 'narrative',
  testID,
}: EditorialParagraphProps): JSX.Element {
  const token = variant === 'reading' ? 'editorialReading' : 'editorial';
  return (
    <Text
      testID={testID ?? `ui.editorialParagraph.${variant}`}
      variant={token}
      textBreakStrategy="highQuality"
    >
      {spans.map((span) =>
        span.bold === true ? (
          <Text key={span.key} variant={token} weight={600}>
            {span.text}
          </Text>
        ) : (
          span.text
        ),
      )}
    </Text>
  );
}

export interface EditorialStatRowProps {
  readonly value: string;
  readonly label: string;
  readonly highlighted?: boolean;
  /** Top rule `.12` for the first row, `.08` otherwise. */
  readonly first?: boolean;
  readonly testID?: string;
}

export function EditorialStatRow({
  value,
  label,
  highlighted = false,
  first = false,
  testID,
}: EditorialStatRowProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.editorialStatRow'}
      accessible
      accessibilityLabel={`${value} ${label}`}
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 12,
        paddingVertical: 14,
        borderTopWidth: 1,
        borderTopColor: first ? theme.color.border.strong : theme.color.border.hairline,
      }}
    >
      <Text
        variant="editorialNumber"
        tone={highlighted ? 'accent' : 'primary'}
        style={{ minWidth: 84 }}
      >
        {value}
      </Text>
      <Text variant="body" tone="secondary" style={{ flex: 1 }}>
        {label}
      </Text>
    </View>
  );
}

export interface HighlightCardProps {
  readonly kicker: string;
  readonly figure: string;
  readonly note?: string;
  readonly testID?: string;
}

export function HighlightCard({ kicker, figure, note, testID }: HighlightCardProps): JSX.Element {
  const theme = useTheme();
  return (
    <InkSurface
      testID={testID ?? 'ui.highlightCard'}
      radius="panel"
      padding={22}
      accessible
      accessibilityLabel={[kicker, figure, note].filter(Boolean).join('. ')}
    >
      <Text variant="kicker" style={{ color: theme.color.brand.glow }}>
        {kicker}
      </Text>
      <Text
        variant="editorialDisplay"
        tone="onInk"
        style={{ fontSize: 36, lineHeight: 40, marginTop: 8 }}
      >
        {figure}
      </Text>
      {note === undefined ? null : (
        <Text variant="bodyXs" tone="onGradientTertiary" style={{ marginTop: 6 }}>
          {note}
        </Text>
      )}
    </InkSurface>
  );
}

export interface ShareCardStat {
  readonly key: string;
  readonly value: string;
  readonly label: string;
}

export interface ShareCardTemplateProps {
  /** `4:5` = 1080×1350, `9:16` = 1080×1920 (pixels; render at scale 1 off-screen). */
  readonly format: '4:5' | '9:16';
  readonly brandName: string;
  readonly kicker: string;
  /** Aggregates-only headline; auto-shrinks from 96 to 80 px when it is long. */
  readonly headline: string;
  readonly stats: readonly ShareCardStat[];
  readonly tagline: string;
  readonly testID?: string;
}

/** Weekly share card on the dawn gradient (padding 96). */
export function ShareCardTemplate({
  format,
  brandName,
  kicker,
  headline,
  stats,
  tagline,
  testID,
}: ShareCardTemplateProps): JSX.Element {
  const theme = useTheme();
  const height = format === '4:5' ? 1350 : 1920;
  const headlineSize = headline.length > 60 ? 80 : 96;
  return (
    <GradientSurface
      gradient="dawn"
      radius="none"
      testID={testID ?? `ui.shareCardTemplate.${format}`}
      style={{ width: 1080, height, padding: 96, justifyContent: 'space-between' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24 }}>
        <View
          style={{
            width: 84,
            height: 84,
            borderRadius: 26,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brand.primary,
          }}
        >
          <Icon name="auto_awesome" filled size={48} color={theme.color.text.onGradient} />
        </View>
        <Text
          variant="display"
          tone="onGradient"
          allowFontScaling={false}
          style={{ fontSize: 34, lineHeight: 40 }}
        >
          {brandName}
        </Text>
      </View>
      <View style={{ gap: 32 }}>
        <Text
          variant="kicker"
          tone="onGradientTertiary"
          allowFontScaling={false}
          style={{ fontSize: 30, lineHeight: 36, letterSpacing: 3 }}
        >
          {kicker}
        </Text>
        <Text
          variant="editorialDisplay"
          tone="onGradient"
          allowFontScaling={false}
          numberOfLines={3}
          style={{
            fontSize: headlineSize,
            lineHeight: headlineSize + 8,
            letterSpacing: -headlineSize * 0.03,
          }}
        >
          {headline}
        </Text>
        <View style={{ flexDirection: 'row', gap: 48 }}>
          {stats.map((stat) => (
            <View key={stat.key} style={{ gap: 8 }}>
              <Text
                variant="editorialNumber"
                tone="onGradient"
                allowFontScaling={false}
                style={{ fontSize: 80, lineHeight: 84 }}
              >
                {stat.value}
              </Text>
              <Text
                variant="body"
                tone="onGradientSecondary"
                allowFontScaling={false}
                style={{ fontSize: 28, lineHeight: 34 }}
              >
                {stat.label}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <Text
        variant="body"
        tone="onGradientSecondary"
        allowFontScaling={false}
        style={{ fontSize: 28, lineHeight: 34 }}
      >
        {tagline}
      </Text>
    </GradientSurface>
  );
}
