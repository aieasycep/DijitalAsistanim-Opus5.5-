/**
 * Universal Capture (DESIGN_AUDIT §3.12, §3.9): `CaptureSourceTiles`, `MediaPreview` +
 * `DetectionBox`, `LinkPreviewCard`, `ExtractedItemRow`, `EntityHighlightText` + `EntityLegend`,
 * `FileRow`, and `AnalysisProgressCard` (alias `ProcessingChecklist`; steps driven only by real
 * job events, never a progress bar).
 */
import type { JSX } from 'react';
import { Image, View, type ImageSourcePropType } from 'react-native';
import { Icon } from '../../icons/Icon.tsx';
import type { IconName } from '../../icons/generated/index.ts';
import { IconTile } from '../../primitives/IconTile.tsx';
import { PressableScale } from '../../primitives/PressableScale.tsx';
import { Spinner } from '../../primitives/Spinner.tsx';
import { Card } from '../../primitives/Surface.tsx';
import { Text } from '../../primitives/Text.tsx';
import { hiddenFromA11y } from '../../theme/a11y.ts';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import type { Tone } from '../../theme/theme.ts';
import { Button } from '../buttons/Button.tsx';
import { AiKicker } from '../cards/AiCards.tsx';
import { CheckIndicator, RadioIndicator } from '../inputs/Controls.tsx';

export interface CaptureSource {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
}

export interface CaptureSourceTilesProps {
  /** Fotoğraf `photo_camera` · Ekran görüntüsü `screenshot` · Dosya `picture_as_pdf` · Link `link`. */
  readonly sources: readonly CaptureSource[];
  readonly selectedKey?: string;
  readonly onSelect: (key: string) => void;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/** Four source tiles: 64 h r16, icon 22 primary; selected soft primary. */
export function CaptureSourceTiles({
  sources,
  selectedKey,
  onSelect,
  accessibilityLabel,
  testID,
}: CaptureSourceTilesProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  return (
    <View
      testID={testID ?? 'ui.captureSourceTiles'}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: 'row', gap: 8 }}
    >
      {sources.map((source) => {
        const selected = source.key === selectedKey;
        return (
          <PressableScale
            key={source.key}
            testID={`ui.captureSourceTiles.${source.key}`}
            accessibilityRole="radio"
            accessibilityLabel={source.label}
            accessibilityState={{ checked: selected }}
            haptic="select"
            onPress={() => {
              onSelect(source.key);
            }}
            style={[
              {
                flex: 1,
                minHeight: 64,
                borderRadius: theme.radius.cardSm,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                backgroundColor: selected ? c.brand.soft : c.surface,
              },
              selected ? null : theme.elevation('s1'),
            ]}
          >
            <Icon name={source.icon} size={22} color={c.icon.ai} />
            <Text
              variant="labelXs"
              style={{ color: selected ? c.brand.onSoft : c.text.secondary }}
              numberOfLines={1}
            >
              {source.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

export interface DetectionBoxProps {
  /** Box position as fractions of the preview (0–1). */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Small tag ("TARİH"). */
  readonly tag?: string;
  readonly small?: boolean;
}

/** 2 px primary box (r8, r6 small) with a 10/700 tag on soft primary. */
export function DetectionBox({
  x,
  y,
  width,
  height,
  tag,
  small = false,
}: DetectionBoxProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  return (
    <View
      {...hiddenFromA11y}
      style={{
        position: 'absolute',
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: `${width * 100}%`,
        height: `${height * 100}%`,
        borderWidth: 2,
        borderColor: c.brand.primary,
        borderRadius: small ? 6 : 8,
      }}
    >
      {tag === undefined ? null : (
        <View
          style={{
            position: 'absolute',
            top: -16,
            left: -2,
            borderRadius: 4,
            paddingHorizontal: 4,
            backgroundColor: c.brand.soft,
          }}
        >
          <Text variant="badgeSm" caps style={{ color: c.brand.primary }}>
            {tag}
          </Text>
        </View>
      )}
    </View>
  );
}

export interface MediaPreviewProps {
  readonly source: ImageSourcePropType;
  /** Description of the captured image or page. */
  readonly accessibilityLabel: string;
  readonly height?: number;
  readonly boxes?: readonly (DetectionBoxProps & { readonly key: string })[];
  readonly testID?: string;
}

/** Real image or PDF page (160–220 h, r20) with detection boxes. */
export function MediaPreview({
  source,
  accessibilityLabel,
  height = 200,
  boxes,
  testID,
}: MediaPreviewProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.mediaPreview'}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{
        height,
        borderRadius: theme.radius.card,
        overflow: 'hidden',
        backgroundColor: theme.color.surfaceSunken,
      }}
    >
      <Image
        source={source}
        resizeMode="cover"
        style={{ width: '100%', height: '100%' }}
        accessibilityIgnoresInvertColors
      />
      {(boxes ?? []).map(({ key, ...box }) => (
        <DetectionBox key={key} {...box} />
      ))}
    </View>
  );
}

export interface LinkPreviewCardProps {
  readonly domain: string;
  readonly title: string;
  readonly image?: ImageSourcePropType;
  readonly variant?: 'compact' | 'hero';
  readonly onPress?: () => void;
  readonly testID?: string;
}

/** Link preview: compact (56 thumb r14) or hero (160 og:image); no image → domain initial tile. */
export function LinkPreviewCard({
  domain,
  title,
  image,
  variant = 'compact',
  onPress,
  testID,
}: LinkPreviewCardProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const initial = domain.charAt(0);
  const thumb =
    image === undefined ? (
      <View
        {...hiddenFromA11y}
        style={{
          width: variant === 'hero' ? '100%' : 56,
          height: variant === 'hero' ? 160 : 56,
          borderRadius: variant === 'hero' ? theme.radius.cardSm : theme.radius.button,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.surfaceSunken,
        }}
      >
        <Text variant="h2" caps tone="secondary">
          {initial}
        </Text>
      </View>
    ) : (
      <Image
        source={image}
        accessibilityIgnoresInvertColors
        style={{
          width: variant === 'hero' ? '100%' : 56,
          height: variant === 'hero' ? 160 : 56,
          borderRadius: variant === 'hero' ? theme.radius.cardSm : theme.radius.button,
        }}
      />
    );
  return (
    <Card
      testID={testID ?? `ui.linkPreviewCard.${variant}`}
      radius="list"
      padding={12}
      onPress={onPress}
      accessibilityLabel={`${domain}, ${title}`}
      style={
        variant === 'hero' ? { gap: 10 } : { flexDirection: 'row', alignItems: 'center', gap: 12 }
      }
    >
      {thumb}
      <View style={{ flex: variant === 'hero' ? undefined : 1 }}>
        <Text variant="meta" tone="tertiaryStrong" numberOfLines={1}>
          {domain}
        </Text>
        <Text variant="rowTitle" weight={600} numberOfLines={2}>
          {title}
        </Text>
      </View>
    </Card>
  );
}

export type ExtractedEntityType =
  | 'event'
  | 'task'
  | 'deadline'
  | 'person'
  | 'payment'
  | 'reservation'
  | 'flight'
  | 'shipment'
  | 'product'
  | 'note'
  | 'reminder';

const ENTITY_TONE: Record<ExtractedEntityType, Tone> = {
  deadline: 'warning',
  reminder: 'warning',
  event: 'info',
  person: 'primary',
  task: 'neutral',
  payment: 'neutral',
  reservation: 'neutral',
  flight: 'neutral',
  shipment: 'neutral',
  product: 'neutral',
  note: 'neutral',
};

const ENTITY_ICON: Record<ExtractedEntityType, IconName> = {
  deadline: 'flag',
  reminder: 'notifications',
  event: 'event',
  person: 'person',
  task: 'add_task',
  payment: 'receipt_long',
  reservation: 'restaurant',
  flight: 'flight',
  shipment: 'package_2',
  product: 'sell',
  note: 'edit_note',
};

export interface ExtractedItemRowProps {
  readonly type: ExtractedEntityType;
  /** "Son tarih" (upper-cased kicker in the tone). */
  readonly typeLabel: string;
  readonly title: string;
  /** "Kaynak: s.14, madde 9.2" */
  readonly sourceRef?: string;
  /** "AI önerisi" chip for suggestions not stated in the source (DEV-62). */
  readonly suggestionLabel?: string;
  readonly selected: boolean;
  readonly onToggle: () => void;
  readonly testID?: string;
}

export function ExtractedItemRow({
  type,
  typeLabel,
  title,
  sourceRef,
  suggestionLabel,
  selected,
  onToggle,
  testID,
}: ExtractedItemRowProps): JSX.Element {
  const theme = useTheme();
  const tone = ENTITY_TONE[type];
  return (
    <PressableScale
      testID={testID ?? `ui.extractedItemRow.${type}`}
      feedback="none"
      accessibilityRole="checkbox"
      accessibilityLabel={[typeLabel, title, suggestionLabel, sourceRef].filter(Boolean).join(', ')}
      accessibilityState={{ checked: selected }}
      haptic="select"
      onPress={onToggle}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}
    >
      <IconTile icon={ENTITY_ICON[type]} size={30} tone={tone} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="typeLabel" style={{ color: theme.tone[tone].text }}>
            {typeLabel}
          </Text>
          {suggestionLabel === undefined ? null : (
            <View
              style={{
                borderRadius: theme.radius.pill,
                paddingHorizontal: 6,
                backgroundColor: theme.tone.primary.soft,
              }}
            >
              <Text variant="badgeSm" style={{ color: theme.tone.primary.text }}>
                {suggestionLabel}
              </Text>
            </View>
          )}
        </View>
        <Text variant="rowTitle" style={{ lineHeight: 21 }}>
          {title}
        </Text>
        {sourceRef === undefined ? null : (
          <Text variant="meta" tone="tertiaryStrong">
            {sourceRef}
          </Text>
        )}
      </View>
      <CheckIndicator selected={selected} />
    </PressableScale>
  );
}

export type HighlightKind = 'time' | 'person' | 'task' | 'reminder';

const HIGHLIGHT_TONE: Record<HighlightKind, Tone> = {
  time: 'info',
  person: 'primary',
  task: 'neutral',
  reminder: 'warning',
};

export interface HighlightSegment {
  readonly key: string;
  readonly text: string;
  readonly kind?: HighlightKind;
}

export interface EntityHighlightTextProps {
  readonly segments: readonly HighlightSegment[];
  readonly testID?: string;
}

/** Inline entity highlights (radius 5, padding 1/4) in the captured text. */
export function EntityHighlightText({ segments, testID }: EntityHighlightTextProps): JSX.Element {
  const theme = useTheme();
  return (
    <Text testID={testID ?? 'ui.entityHighlightText'} variant="body">
      {segments.map((segment) =>
        segment.kind === undefined ? (
          segment.text
        ) : (
          <Text
            key={segment.key}
            variant="body"
            style={{
              backgroundColor: theme.tone[HIGHLIGHT_TONE[segment.kind]].soft,
              color: theme.tone[HIGHLIGHT_TONE[segment.kind]].text,
              borderRadius: 5,
            }}
          >
            {segment.text}
          </Text>
        ),
      )}
    </Text>
  );
}

export interface EntityLegendProps {
  readonly labels: Readonly<Record<HighlightKind, string>>;
  readonly testID?: string;
}

/** Legend swatches (10, r3) with 11 px labels. */
export function EntityLegend({ labels, testID }: EntityLegendProps): JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID={testID ?? 'ui.entityLegend'}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}
    >
      {(Object.keys(HIGHLIGHT_TONE) as HighlightKind[]).map((kind) => (
        <View key={kind} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View
            {...hiddenFromA11y}
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              backgroundColor: theme.tone[HIGHLIGHT_TONE[kind]].soft,
            }}
          />
          <Text variant="badge" weight={500} tone="secondary">
            {labels[kind]}
          </Text>
        </View>
      ))}
    </View>
  );
}

export interface FileRowProps {
  readonly name: string;
  readonly meta?: string;
  readonly icon?: IconName;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly testID?: string;
}

/** File picker row: min 60, tile 36 (selected PDF critical soft), 15/500 name, radio. */
export function FileRow({
  name,
  meta,
  icon = 'picture_as_pdf',
  selected,
  onPress,
  testID,
}: FileRowProps): JSX.Element {
  return (
    <PressableScale
      testID={testID ?? 'ui.fileRow'}
      feedback="none"
      accessibilityRole="radio"
      accessibilityLabel={[name, meta].filter(Boolean).join(', ')}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 }}
    >
      <IconTile icon={icon} size={36} tone={selected ? 'critical' : 'neutral'} />
      <View style={{ flex: 1 }}>
        <Text variant="rowTitle" numberOfLines={1}>
          {name}
        </Text>
        {meta === undefined ? null : (
          <Text variant="meta" tone="tertiaryStrong">
            {meta}
          </Text>
        )}
      </View>
      <RadioIndicator selected={selected} />
    </PressableScale>
  );
}

export type StepState = 'done' | 'active' | 'pending';

export interface ProcessingStep {
  readonly key: string;
  readonly label: string;
  readonly state: StepState;
  /** Page refs ("s.3–5"). */
  readonly meta?: string;
}

export interface AnalysisProgressCardProps {
  /** "PDF analiz ediliyor…" */
  readonly kicker: string;
  readonly steps: readonly ProcessingStep[];
  /** Spoken state names ("tamamlandı", "sürüyor", "bekliyor"). */
  readonly stateLabels: Readonly<Record<StepState, string>>;
  /** "İptal" (always possible). */
  readonly cancel?: { readonly label: string; readonly onPress: () => void };
  /** Render on the night gradient (onboarding analysis). */
  readonly onGradient?: boolean;
  readonly testID?: string;
}

/** Processing checklist (alias `ProcessingChecklist`); no progress bar. */
export function AnalysisProgressCard({
  kicker,
  steps,
  stateLabels,
  cancel,
  onGradient = false,
  testID,
}: AnalysisProgressCardProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const list = (
    <>
      <AiKicker label={kicker} busy />
      <View accessibilityRole="list" style={{ marginTop: 14, gap: 12 }}>
        {steps.map((step) => (
          <View
            key={step.key}
            accessible
            accessibilityLabel={`${step.label}, ${stateLabels[step.state]}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              opacity: step.state === 'pending' ? theme.opacity.disabled : 1,
            }}
          >
            {step.state === 'done' ? (
              <Icon
                name="check_circle"
                filled
                size={22}
                color={onGradient ? c.tone.success.onGradient : c.tone.success.solid}
              />
            ) : step.state === 'active' ? (
              <Spinner size={22} tone={onGradient ? 'onGradient' : 'primary'} />
            ) : (
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  borderWidth: 2,
                  borderColor: onGradient ? c.text.onGradientTertiary : c.control.radioOff,
                }}
              />
            )}
            <Text variant="body" tone={onGradient ? 'onGradient' : 'primary'} style={{ flex: 1 }}>
              {step.label}
            </Text>
            {step.meta === undefined ? null : (
              <Text variant="meta" tone={onGradient ? 'onGradientTertiary' : 'tertiaryStrong'}>
                {step.meta}
              </Text>
            )}
          </View>
        ))}
      </View>
      {cancel === undefined ? null : (
        <Button
          label={cancel.label}
          onPress={cancel.onPress}
          variant="text"
          fullWidth
          style={{ marginTop: 12, minHeight: 48 }}
        />
      )}
    </>
  );
  if (onGradient) {
    return <View testID={testID ?? 'ui.analysisProgressCard.onGradient'}>{list}</View>;
  }
  return <Card testID={testID ?? 'ui.analysisProgressCard'}>{list}</Card>;
}

export const ProcessingChecklist = AnalysisProgressCard;
