/**
 * AI-authored cards (DESIGN_AUDIT §3.6): `AiCard` (alias `AICard`), `BriefingHero`, `ProGateCard`,
 * `TalkingPointsCard`, `RichAnswerCard`, `DraftCard`, `DraftEditorCard`, `SourceResultCard`.
 * Indigo appears only as the AI marker, the primary action and links (Kural 2); the count is
 * coloured only in the hero.
 */
import type { JSX, ReactNode } from 'react';
import { TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Icon } from '../../icons/Icon.tsx';
import type { IconName } from '../../icons/generated/index.ts';
import { IconTile } from '../../primitives/IconTile.tsx';
import { PressableScale } from '../../primitives/PressableScale.tsx';
import { SkeletonBlock, SkeletonGroup } from '../../primitives/Skeleton.tsx';
import { Spinner } from '../../primitives/Spinner.tsx';
import { AiGlowSurface, Card, GradientSurface, InkSurface } from '../../primitives/Surface.tsx';
import { Text } from '../../primitives/Text.tsx';
import { useExitAnimation } from '../../primitives/useExitAnimation.ts';
import { textStyle } from '../../theme/fonts.ts';
import { hiddenFromA11y } from '../../theme/a11y.ts';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import { Avatar } from '../avatar/Avatar.tsx';
import { Badge, StatusPill, type BadgeCategory, type StatusTone } from '../badges/Badge.tsx';
import { Button } from '../buttons/Button.tsx';
import { TextAction } from '../buttons/ActionButtons.tsx';
import { Divider } from '../../primitives/Surface.tsx';

export interface AiKickerProps {
  readonly label: string;
  /** Spinner instead of the sparkle (generating). */
  readonly busy?: boolean;
  /** `history` glyph for the offline brief. */
  readonly icon?: IconName;
  readonly onInk?: boolean;
}

/** `auto_awesome` FILL 16 + `kickerAi` (brand on-soft; glow on ink). */
export function AiKicker({ label, busy = false, icon, onInk = false }: AiKickerProps): JSX.Element {
  const theme = useTheme();
  const iconColor = onInk ? theme.color.brand.glow : theme.color.icon.ai;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1.5] }}>
      {busy ? (
        <Spinner size={14} tone="primary" />
      ) : (
        <Icon
          name={icon ?? 'auto_awesome'}
          filled={icon === undefined}
          size={16}
          color={iconColor}
        />
      )}
      <Text
        variant="kickerAi"
        heading
        style={{ color: onInk ? theme.color.brand.glow : theme.color.brand.onSoft, flexShrink: 1 }}
      >
        {label}
      </Text>
    </View>
  );
}

export type AiCardState = 'default' | 'accepted' | 'pendingApproval' | 'loading';

export interface AiCardProps {
  readonly kicker: string;
  readonly title: string;
  readonly body?: string;
  readonly bullets?: readonly string[];
  /** Primary action (40 h with icon) and optional ghost secondary. */
  readonly primaryAction?: {
    readonly label: string;
    readonly icon?: IconName;
    readonly onPress: () => void;
    readonly loading?: boolean;
    readonly loadingLabel?: string;
  };
  readonly secondaryAction?: { readonly label: string; readonly onPress: () => void };
  readonly state?: AiCardState;
  /** Pill label for `accepted` ("Planlandı") or `pendingApproval` ("Onay bekliyor"). */
  readonly stateLabel?: string;
  /** Collapses (300 ms) then calls `onExited`. */
  readonly exiting?: boolean;
  readonly onExited?: () => void;
  readonly children?: ReactNode;
  readonly testID?: string;
}

/** AI insight card: `AiGlowSurface` tl, r20, padding 16, `shadow.card`. */
export function AiCard({
  kicker,
  title,
  body,
  bullets,
  primaryAction,
  secondaryAction,
  state = 'default',
  stateLabel,
  exiting = false,
  onExited,
  children,
  testID,
}: AiCardProps): JSX.Element {
  const theme = useTheme();
  const exit = useExitAnimation(exiting, onExited);
  if (state === 'loading') {
    return (
      <AiGlowSurface testID={testID ?? 'ui.aiCard.loading'}>
        <SkeletonGroup>
          <AiKicker label={kicker} busy />
          <SkeletonBlock width="70%" height={16} style={{ marginTop: 12 }} />
          <SkeletonBlock width="92%" height={12} style={{ marginTop: 8 }} />
        </SkeletonGroup>
      </AiGlowSurface>
    );
  }
  return (
    <Animated.View style={exit}>
      <AiGlowSurface testID={testID ?? `ui.aiCard.${state}`}>
        <AiKicker label={kicker} />
        <Text variant="h3Sm" style={{ marginTop: 8, lineHeight: 23 }}>
          {title}
        </Text>
        {body === undefined ? null : (
          <Text variant="secondary" tone="onAiGlow" style={{ marginTop: 4 }}>
            {body}
          </Text>
        )}
        {bullets === undefined ? null : (
          <View style={{ marginTop: 8, gap: 6 }}>
            {bullets.map((bullet) => (
              <View
                key={bullet}
                style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'flex-start' }}
              >
                <View
                  {...hiddenFromA11y}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    marginTop: 7,
                    backgroundColor: theme.color.brand.primary,
                  }}
                />
                <Text variant="secondary" tone="onAiGlow" style={{ flex: 1 }}>
                  {bullet}
                </Text>
              </View>
            ))}
          </View>
        )}
        {children}
        {state === 'accepted' || state === 'pendingApproval' ? (
          stateLabel === undefined ? null : (
            <StatusPill
              label={stateLabel}
              tone={state === 'accepted' ? 'success' : 'warning'}
              caps={false}
              style={{ marginTop: 12 }}
            />
          )
        ) : primaryAction === undefined && secondaryAction === undefined ? null : (
          <View style={{ flexDirection: 'row', gap: theme.space[2], marginTop: 12 }}>
            {primaryAction === undefined ? null : (
              <Button
                label={primaryAction.label}
                icon={primaryAction.icon}
                onPress={primaryAction.onPress}
                loading={primaryAction.loading}
                loadingLabel={primaryAction.loadingLabel}
                size="sm"
              />
            )}
            {secondaryAction === undefined ? null : (
              <Button
                label={secondaryAction.label}
                onPress={secondaryAction.onPress}
                variant="ghost"
                size="sm"
              />
            )}
          </View>
        )}
      </AiGlowSurface>
    </Animated.View>
  );
}

export const AICard = AiCard;

export interface HeroSentence {
  /** Text before the coloured count ("Bugün bilmen gereken "). */
  readonly before: string;
  readonly count?: string;
  readonly after?: string;
}

export interface BriefingHeroProps {
  /** `ready` covers morning/midday/evening/night/done/weekly/first-day texts; `generating` shows
   *  the kicker spinner and skeleton bars; `offline` uses the `history` kicker glyph. */
  readonly mode?: 'ready' | 'generating' | 'offline';
  readonly kicker: string;
  readonly sentence: HeroSentence;
  /** Day overview ("3 önemli mail · 4 etkinlik · 2 takip"). */
  readonly context?: string;
  readonly primaryAction?: { readonly label: string; readonly onPress: () => void };
  /** "Dinle · 2 dk"; `locked` shows `lock` (Pro gate), `disabled` e.g. "İndirilmedi" offline. */
  readonly listenAction?: {
    readonly label: string;
    readonly onPress: () => void;
    readonly accessibilityLabel?: string;
    readonly locked?: boolean;
    readonly disabled?: boolean;
  };
  readonly testID?: string;
}

/** Today hero: `AiGlowSurface` tr (58%), r28, padding 22/22/20, `shadow.heroAi`. */
export function BriefingHero({
  mode = 'ready',
  kicker,
  sentence,
  context,
  primaryAction,
  listenAction,
  testID,
}: BriefingHeroProps): JSX.Element {
  const sentenceText = `${sentence.before}${sentence.count ?? ''}${sentence.after ?? ''}`;
  return (
    <AiGlowSurface
      origin="tr"
      radius="hero"
      elevation="heroAi"
      padding={[22, 22, 20]}
      testID={testID ?? `ui.briefingHero.${mode}`}
    >
      <AiKicker
        label={kicker}
        busy={mode === 'generating'}
        icon={mode === 'offline' ? 'history' : undefined}
      />
      {mode === 'generating' ? (
        <SkeletonGroup style={{ marginTop: 14, gap: 10 }}>
          <SkeletonBlock width="85%" height={22} />
          <SkeletonBlock width="55%" height={22} />
          <SkeletonBlock width="40%" height={12} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <SkeletonBlock width="auto" height={48} radius={14} style={{ flex: 1 }} />
            <SkeletonBlock width={110} height={48} radius={14} tone="bg" />
          </View>
        </SkeletonGroup>
      ) : (
        <>
          <Text variant="hero" heading accessibilityLabel={sentenceText} style={{ marginTop: 10 }}>
            {sentence.before}
            {sentence.count === undefined ? null : (
              <Text variant="hero" tone="accent">
                {sentence.count}
              </Text>
            )}
            {sentence.after}
          </Text>
          {context === undefined ? null : (
            <Text variant="secondary" tone="onAiGlow" style={{ marginTop: 6 }}>
              {context}
            </Text>
          )}
          {primaryAction === undefined && listenAction === undefined ? null : (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              {primaryAction === undefined ? null : (
                <Button
                  label={primaryAction.label}
                  onPress={primaryAction.onPress}
                  variant={mode === 'offline' ? 'ink' : 'primary'}
                  flex
                />
              )}
              {listenAction === undefined ? null : (
                <Button
                  label={listenAction.label}
                  accessibilityLabel={listenAction.accessibilityLabel}
                  onPress={listenAction.onPress}
                  variant="tonal"
                  icon={
                    listenAction.locked === true
                      ? 'lock'
                      : mode === 'offline' && listenAction.disabled === true
                        ? 'download_for_offline'
                        : 'play_arrow'
                  }
                  iconFilled={listenAction.locked !== true && listenAction.disabled !== true}
                  disabled={listenAction.disabled}
                  paddingHorizontal={16}
                />
              )}
            </View>
          )}
        </>
      )}
    </AiGlowSurface>
  );
}

export interface ProGateCardProps {
  /** "Öğle Nabzı · Pro" */
  readonly kicker: string;
  /** Value sentence with real counts (`h2`). */
  readonly title: string;
  readonly body?: string;
  /** Trial CTA only when the store offer is eligible, otherwise "Pro'yu Gör". */
  readonly primaryAction: { readonly label: string; readonly onPress: () => void };
  /** "Şimdi değil" (7-day dismissal). */
  readonly dismissAction?: { readonly label: string; readonly onPress: () => void };
  readonly testID?: string;
}

/** Contextual Pro gate (7.6): surface r28 padding 22; two neutral bars, never blurred real data. */
export function ProGateCard({
  kicker,
  title,
  body,
  primaryAction,
  dismissAction,
  testID,
}: ProGateCardProps): JSX.Element {
  const theme = useTheme();
  return (
    <Card testID={testID ?? 'ui.proGateCard'} radius="hero" padding={22}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1.5] }}>
        <Icon name="lock" size={16} color={theme.color.text.tertiaryStrong} />
        <Text variant="kicker" tone="tertiaryStrong">
          {kicker}
        </Text>
      </View>
      <Text variant="h2" heading style={{ marginTop: 10 }}>
        {title}
      </Text>
      {body === undefined ? null : (
        <Text variant="secondary" style={{ marginTop: 6 }}>
          {body}
        </Text>
      )}
      <View {...hiddenFromA11y} style={{ gap: 8, marginTop: 16 }}>
        <View style={{ height: 44, borderRadius: 12, backgroundColor: theme.color.bg }} />
        <View
          style={{ height: 44, width: '70%', borderRadius: 12, backgroundColor: theme.color.bg }}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space[2], marginTop: 16 }}>
        <Button
          label={primaryAction.label}
          onPress={primaryAction.onPress}
          size="md"
          flex
          style={{ minHeight: 44, borderRadius: theme.radius.button }}
        />
        {dismissAction === undefined ? null : (
          <Button
            label={dismissAction.label}
            onPress={dismissAction.onPress}
            variant="neutralTonal"
            size="md"
            style={{ minHeight: 44, borderRadius: theme.radius.button }}
          />
        )}
      </View>
    </Card>
  );
}

export interface TalkingPoint {
  readonly key: string;
  readonly title: string;
  readonly body?: string;
}

export interface TalkingPointsCardProps {
  readonly kicker: string;
  readonly points: readonly TalkingPoint[];
  /** Long-press → "Bu nereden çıktı?" */
  readonly onPointLongPress?: (key: string) => void;
  readonly pointLongPressLabel?: string;
  readonly loading?: boolean;
  readonly testID?: string;
}

/** "3 şey" / meeting-prep talking points: ink card (dark: `prep-card-dark` gradient). */
export function TalkingPointsCard({
  kicker,
  points,
  onPointLongPress,
  pointLongPressLabel,
  loading = false,
  testID,
}: TalkingPointsCardProps): JSX.Element {
  const theme = useTheme();
  const content = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1.5] }}>
        <Icon name="auto_awesome" filled size={16} color={theme.color.brand.glow} />
        <Text
          variant="kickerAi"
          heading
          style={{ color: theme.isDark ? theme.color.text.kickerOnIndigo : theme.color.brand.glow }}
        >
          {kicker}
        </Text>
      </View>
      {loading ? (
        <SkeletonGroup style={{ marginTop: 14, gap: 10 }}>
          <SkeletonBlock width="80%" height={16} />
          <SkeletonBlock width="60%" height={16} />
          <SkeletonBlock width="70%" height={16} />
        </SkeletonGroup>
      ) : (
        <View style={{ marginTop: 14, gap: 14 }}>
          {points.map((point, i) => {
            const row = (
              <>
                <View
                  {...hiddenFromA11y}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.color.onGradient.fill12,
                  }}
                >
                  <Text variant="labelSm" tone="onGradient" numeric>
                    {String(i + 1)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="h3" tone="onGradient">
                    {point.title}
                  </Text>
                  {point.body === undefined ? null : (
                    <Text
                      variant="secondary"
                      tone={theme.isDark ? 'onGradientSecondary' : 'onGradientTertiary'}
                      style={{ marginTop: 2 }}
                    >
                      {point.body}
                    </Text>
                  )}
                </View>
              </>
            );
            return onPointLongPress === undefined ? (
              <View key={point.key} accessible style={{ flexDirection: 'row', gap: 12 }}>
                {row}
              </View>
            ) : (
              <PressableScale
                key={point.key}
                testID={`ui.talkingPoints.${point.key}`}
                feedback="card"
                accessibilityLabel={[point.title, point.body].filter(Boolean).join('. ')}
                accessibilityActions={
                  pointLongPressLabel === undefined
                    ? undefined
                    : [{ name: 'longpress', label: pointLongPressLabel }]
                }
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === 'longpress') onPointLongPress(point.key);
                }}
                onLongPress={() => {
                  onPointLongPress(point.key);
                }}
                style={{ flexDirection: 'row', gap: 12 }}
              >
                {row}
              </PressableScale>
            );
          })}
        </View>
      )}
    </>
  );
  if (theme.isDark) {
    return (
      <GradientSurface
        gradient="prepCardDark"
        radius="panel"
        padding={20}
        testID={testID ?? 'ui.talkingPointsCard'}
        style={theme.elevation('inkCard')}
      >
        {content}
      </GradientSurface>
    );
  }
  return (
    <InkSurface
      radius="panel"
      padding={20}
      elevation="inkCard"
      testID={testID ?? 'ui.talkingPointsCard'}
    >
      {content}
    </InkSurface>
  );
}

export interface RichAnswerRow {
  readonly key: string;
  readonly title: string;
  readonly meta?: string;
  /** Person rows show an avatar; other rows an icon. */
  readonly person?: { readonly name: string; readonly id?: string };
  readonly icon?: IconName;
  readonly badge?: { readonly label: string; readonly category?: BadgeCategory };
  readonly actionLabel?: string;
  readonly onPress: () => void;
  readonly loading?: boolean;
}

export interface RichAnswerCardProps {
  readonly kicker: string;
  readonly rows: readonly RichAnswerRow[];
  readonly testID?: string;
}

/** Assistant rich answer (6.2): kicker + tappable rows (hairlines between). */
export function RichAnswerCard({ kicker, rows, testID }: RichAnswerCardProps): JSX.Element {
  const theme = useTheme();
  return (
    <Card testID={testID ?? 'ui.richAnswerCard'} radius="cardSm" padding={[12, 14]}>
      <Text variant="kicker" tone="tertiaryStrong" heading>
        {kicker}
      </Text>
      {rows.map((row, i) => (
        <View key={row.key}>
          {i > 0 ? <Divider /> : null}
          <PressableScale
            testID={`ui.richAnswerCard.${row.key}`}
            feedback="none"
            accessibilityLabel={[row.title, row.meta, row.badge?.label].filter(Boolean).join(', ')}
            busy={row.loading}
            onPress={row.onPress}
            pressedStyle={{ opacity: 0.7 }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }}
          >
            {row.person === undefined ? (
              <Icon name={row.icon ?? 'article'} size={18} color={theme.color.icon.ai} />
            ) : (
              <Avatar name={row.person.name} id={row.person.id} size={32} decorative />
            )}
            <View style={{ flex: 1 }}>
              <Text variant="label">{row.title}</Text>
              {row.meta === undefined ? null : (
                <Text variant="meta" tone="tertiaryStrong">
                  {row.meta}
                </Text>
              )}
            </View>
            {row.badge === undefined ? null : (
              <Badge label={row.badge.label} category={row.badge.category} />
            )}
            {row.loading === true ? <Spinner size={16} /> : null}
            {row.actionLabel === undefined || row.loading === true ? null : (
              <Text variant="labelSm" tone="link">
                {row.actionLabel}
              </Text>
            )}
          </PressableScale>
        </View>
      ))}
    </Card>
  );
}

export interface DraftCardProps {
  /** "Taslak · Mehmet Yılmaz" */
  readonly kicker: string;
  readonly preview: string;
  /** "Göndermeyi Onayla" (never "Gönder"). */
  readonly approveAction: { readonly label: string; readonly onPress: () => void };
  readonly editAction: { readonly label: string; readonly onPress: () => void };
  /** Mirrors the approval lifecycle once submitted. */
  readonly status?: { readonly label: string; readonly tone: StatusTone; readonly busy?: boolean };
  readonly testID?: string;
}

/** Compact chat draft card (6.2): r16 padding 12/14, 2-line preview, 36 buttons. */
export function DraftCard({
  kicker,
  preview,
  approveAction,
  editAction,
  status,
  testID,
}: DraftCardProps): JSX.Element {
  const theme = useTheme();
  const locked = status !== undefined;
  return (
    <Card testID={testID ?? 'ui.draftCard'} radius="cardSm" padding={[12, 14]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <View style={{ flex: 1 }}>
          <AiKicker label={kicker} />
        </View>
        {status === undefined ? null : (
          <StatusPill label={status.label} tone={status.tone} busy={status.busy} />
        )}
      </View>
      <Text variant="secondary" tone="primary" numberOfLines={2} style={{ marginTop: 8 }}>
        {preview}
      </Text>
      {locked ? null : (
        <View style={{ flexDirection: 'row', gap: theme.space[2], marginTop: 10 }}>
          <Button label={approveAction.label} onPress={approveAction.onPress} size="xs" />
          <Button label={editAction.label} onPress={editAction.onPress} size="xs" variant="tonal" />
        </View>
      )}
    </Card>
  );
}

export interface DraftEditorCardProps {
  /** "AI taslağı · Profesyonel" */
  readonly kicker: string;
  /** "Düzenlenebilir" */
  readonly editableHint?: string;
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  /** Accessibility label of the text area ("Yanıt taslağı"). */
  readonly accessibilityLabel: string;
  readonly editable?: boolean;
  /** Shimmer while regenerating (tone switch). */
  readonly loading?: boolean;
  /** Tool chips ("Teklif_v3.pdf ekle", "Kısalt"). */
  readonly tools?: ReactNode;
  readonly testID?: string;
}

/** AI reply draft editor (4.5): r20 padding 18, 15/23 text, primary caret. */
export function DraftEditorCard({
  kicker,
  editableHint,
  value,
  onChangeText,
  accessibilityLabel,
  editable = true,
  loading = false,
  tools,
  testID,
}: DraftEditorCardProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  return (
    <Card testID={testID ?? 'ui.draftEditorCard'} padding={18}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <View style={{ flex: 1 }}>
          <AiKicker label={kicker} busy={loading} />
        </View>
        {editableHint === undefined ? null : (
          <Text variant="meta" tone="tertiaryStrong">
            {editableHint}
          </Text>
        )}
      </View>
      {loading ? (
        <SkeletonGroup style={{ marginTop: 12, gap: 8 }}>
          <SkeletonBlock width="95%" height={14} />
          <SkeletonBlock width="88%" height={14} />
          <SkeletonBlock width="60%" height={14} />
        </SkeletonGroup>
      ) : (
        <TextInput
          testID="ui.draftEditorCard.input"
          multiline
          value={value}
          onChangeText={onChangeText}
          editable={editable}
          accessibilityLabel={accessibilityLabel}
          allowFontScaling
          maxFontSizeMultiplier={2}
          selectionColor={c.brand.primary}
          cursorColor={c.brand.primary}
          style={[
            textStyle('body'),
            { lineHeight: 23, color: c.text.primary, marginTop: 10, minHeight: 120, padding: 0 },
          ]}
        />
      )}
      {tools === undefined ? null : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {tools}
        </View>
      )}
    </Card>
  );
}

export interface SourceResultCardProps {
  readonly sourceIcon: IconName;
  readonly sourceName: string;
  readonly date?: string;
  readonly title: string;
  readonly excerpt?: string;
  /** "Orijinali Aç" */
  readonly openLabel: string;
  readonly onOpen: () => void;
  readonly onPress?: () => void;
  readonly testID?: string;
}

/** Memory / search result (6.5): r18 padding 14/16; tile 28 + source + date; "Orijinali Aç". */
export function SourceResultCard({
  sourceIcon,
  sourceName,
  date,
  title,
  excerpt,
  openLabel,
  onOpen,
  onPress,
  testID,
}: SourceResultCardProps): JSX.Element {
  const theme = useTheme();
  return (
    <Card
      testID={testID ?? 'ui.sourceResultCard'}
      radius="list"
      padding={[14, 16]}
      onPress={onPress}
      accessibilityLabel={[sourceName, date, title, excerpt].filter(Boolean).join('. ')}
      accessibilityActions={[{ name: 'open', label: openLabel }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'open') onOpen();
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <IconTile icon={sourceIcon} size={28} />
        <Text variant="meta" tone="tertiaryStrong" style={{ flex: 1 }} numberOfLines={1}>
          {sourceName}
        </Text>
        {date === undefined ? null : (
          <Text variant="meta" tone="tertiaryStrong" numeric>
            {date}
          </Text>
        )}
      </View>
      <Text variant="rowTitle" style={{ marginTop: 8, lineHeight: 21 }}>
        {title}
      </Text>
      {excerpt === undefined ? null : (
        <Text variant="secondary" style={{ marginTop: 4 }}>
          {excerpt}
        </Text>
      )}
      <View style={{ marginTop: 6, marginLeft: -10 }}>
        <TextAction label={openLabel} onPress={onOpen} compact trailingIcon="open_in_new" />
      </View>
    </Card>
  );
}
