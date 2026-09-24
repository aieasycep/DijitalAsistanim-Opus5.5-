# @da/ui

The React Native UI kit of Dijital Asistan (mobile only; WBS T-8.02 foundation + T-8.03 components).
Plain `StyleSheet` with typed `useTheme()` tokens from `@da/design-tokens` (ADR-03), React
Compiler-safe (the tests compile every kit file with the compiler and treat any diagnostic as an
error), accessibility built into the primitives, Reanimated 4.5.1 motion that honours reduce motion,
and injected haptics. Specs: `docs/DESIGN_AUDIT.md` §2–§3, `docs/plan-audits/design-system.md`,
`docs/SCREEN_AND_FLOW_MAP.md` §13 (M-STATE-01…12).

Peers (all pinned in the `expo` catalog, `expo@57.0.24` bundled versions): `react` 19.2.3,
`react-native` 0.86.3, `react-native-reanimated` 4.5.1, `react-native-worklets` 0.10.1,
`react-native-gesture-handler` ~2.32.0, `react-native-safe-area-context` ~5.7.0,
`react-native-svg` 15.15.4. Dependencies: `@da/design-tokens`, `@da/i18n`.

## What the mobile app provides (T-8.01 / T-8.04)

```tsx
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from '@expo-google-fonts/geist';
import {
  Lora_400Regular,
  Lora_400Regular_Italic,
  Lora_500Medium,
  Lora_600SemiBold,
} from '@expo-google-fonts/lora';
import * as Haptics from 'expo-haptics';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DaUiProvider, type HapticKind } from '@da/ui';

const onHaptic = (kind: HapticKind) => {
  if (kind === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else if (kind === 'warning')
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  else if (kind === 'selection') void Haptics.selectionAsync();
  else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    Lora_400Regular,
    Lora_400Regular_Italic,
    Lora_500Medium,
    Lora_600SemiBold,
  });
  if (!fontsLoaded) return null; // keep the splash screen up
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <DaUiProvider
          themePreference={prefs.theme} // 'system' | 'light' | 'dark' (MMKV + user_preferences.theme)
          onThemePreferenceChange={savePreference}
          reduceMotion={prefs.reduceMotion} // OR-ed with the OS setting
          hapticsEnabled={prefs.hapticsEnabled}
          onHaptic={onHaptic}
          locale={locale} // 'tr' | 'en'
          toastBottomOffset={tabBarVisible ? tabBarHeight + 14 : undefined}
        >
          <Stack />
        </DaUiProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

- **Fonts:** the kit references family names only. `REQUIRED_FONTS` / `REQUIRED_FONT_FAMILIES` list
  the exact `useFonts` keys (each is the export of the same name in `@expo-google-fonts/geist` or
  `/lora`; `test/theme.test.tsx` checks the package typings). Every weight is its own family and
  styles never set `fontWeight` (Android ignores it for single-file families). Mono is the platform
  font. Expo config: the `expo-font` plugin (T-8.01).
- **Haptics:** no native module is imported by the kit. `onHaptic` receives `success | warning |
light | selection`; `useHaptic()` gates it with `hapticsEnabled` and swallows failures.
- **Providers:** `GestureHandlerRootView` (sheets, swipes, scrubber) and `SafeAreaProvider` (headers,
  tab bar, sheets, toasts) wrap `DaUiProvider` (= `ThemeProvider` + `UiPreferencesProvider` +
  `ToastProvider`). An app-level zustand store can drive `ToastViewport` directly instead.
- **Babel:** `babel-preset-expo` already adds the React Compiler and the worklets plugin.
- **Strings:** components take every visible string as a prop (i18n in the app). Default
  accessibility labels ("Geri", "Kapat", "Yükleniyor", "Mikrofon") come from the `common`
  namespace of `@da/i18n` for the provider's locale. Kickers, badges and type labels are upper-cased
  with the Turkish rules (`toUpper`, "samimi" → "SAMİMİ"); never with `textTransform`.
- **Tab bar blur:** `TabBar` draws the translucent `overlay.tabBar` fill on iOS; pass an
  `expo-blur` `BlurView` as `background` for the glass effect. Android and iOS Reduce Transparency
  get the opaque bar.

## Theme foundation (`src/theme`)

| Export                                                                                                                                                 | Purpose                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ThemeProvider` `{ preference?, onPreferenceChange?, systemScheme? }`                                                                                  | `system` follows `useColorScheme()`; controlled by the app                                                                                                                                                                |
| `useTheme()`                                                                                                                                           | The active `Theme`: `scheme`, `isDark`, `color` (semantic tokens), `tone` (§2.4 map), `gradients` / `fixedGradients`, `typography`, `space`, `radius`, `size`, `layout`, `motion`, `opacity`, `zIndex`, `elevation(name)` |
| `useThemePreference()`                                                                                                                                 | `{ preference, scheme, setPreference }` for the Appearance screen                                                                                                                                                         |
| `makeStyles(theme => ({…}))`                                                                                                                           | Returns `useStyles()`; one StyleSheet per scheme, built at module load (compiler-safe)                                                                                                                                    |
| `themes.light` / `themes.dark`                                                                                                                         | The two stable theme objects                                                                                                                                                                                              |
| `UiPreferencesProvider` `{ reduceMotion?, followSystemReduceMotion?, hapticsEnabled?, onHaptic?, locale?, screenReaderEnabled?, reduceTransparency? }` | Reduce motion (user OR OS), haptics, locale, screen reader and reduce-transparency state                                                                                                                                  |
| `useMotion()` / `motionControl(reduced)`                                                                                                               | `duration(ms)` (0 when reduced, capped at 600), `fadeDuration(ms)` (120 when reduced), `timing`, `fadeTiming`, `animate`, `fade`, `loops`                                                                                 |
| `useHaptic()`, `hapticKindFor(event)`                                                                                                                  | Product-event haptics (`complete`, `select`, `swipeThreshold`, …)                                                                                                                                                         |
| `useUiStrings()`, `useUpper()`, `useUiPreferences()`                                                                                                   | `common` strings, locale upper-casing, flags                                                                                                                                                                              |
| `textStyleFor(token)`, `textStyle(name, weight?)`, `REQUIRED_FONTS`                                                                                    | Font contract                                                                                                                                                                                                             |
| `minTouchTarget()`, `hitSlopFor(w, h)`, `announce(msg)`, `focusAccessibility(ref)`, `hiddenFromA11y`                                                   | 44 pt iOS / 48 dp Android targets, announcements, focus moves                                                                                                                                                             |
| `DaUiProvider`                                                                                                                                         | All of the above + toasts                                                                                                                                                                                                 |

**Elevation:** `theme.elevation('card')` is a `boxShadow` string — light drop shadows, dark 6%
white hairline rings (§2.16); Android API < 28 falls back to `elevation` / a 1 px border.

## Primitives (`src/primitives`)

| Component                                                        | Key props                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Text`                                                           | `variant` (any type token: `display`, `h1`, `h2`, `h3`, `body`, `secondary`, `kicker`, `badge` (micro), `editorial`, `editorialDisplay`, …), `tone` (`TEXT_TONES`), `weight`, `numeric`, `caps` (default from the token), `heading`, `align`, `strike`. `allowFontScaling` with the token's `maxFontSizeMultiplier`. |
| `PressableScale`                                                 | Base pressable: `feedback` `button` (.97) / `card` (.98) / `none`, `pressedStyle`, `visualSize` (→ `hitSlop`), `disabled`, `busy`, `haptic`, `focusRing`, all accessibility props; `animatedStyle` for selection transitions                                                                                         |
| `Surface`, `Card`                                                | `elevation`, `radius`, `padding`, `background`, `pressed`; `Card` adds `onPress`, `selected`, a11y label/actions                                                                                                                                                                                                     |
| `AiGlowSurface`, `InkSurface`, `GradientSurface`, `GradientFill` | Radial AI glow (`origin` tl/tr), ink callout base, dawn/night/dusk/prep gradients (react-native-svg), `onGradientTone(t, role)`                                                                                                                                                                                      |
| `Divider`, `IllustrationFrame`, `IconTile`                       | Hidden 1 px rules; non-interactive illustrations with one label (tilt off under reduce motion); tone tiles 28–52                                                                                                                                                                                                     |
| `Spinner`, `SkeletonBlock`, `SkeletonGroup`                      | .8 s ring; 1.6 s linear shimmer (static base under reduce motion); busy "Yükleniyor" container                                                                                                                                                                                                                       |
| `useLoop`, `useSelectionBackground`, `useExitAnimation`          | Loops that stop under reduce motion; 150 ms selection colour; card exit (scale .96 + fade + −6, 300 ms)                                                                                                                                                                                                              |

## Components (`src/components`)

**Buttons** — `Button` (`variant`: `BUTTON_VARIANTS` = primary, tonal, neutralTonal, ink, surface,
destructive, inverse, ghost, ghostSecondary, text; `size`: lg 52 · md 48 · inline 42 · sm 40 · card
38 · xs 36 · ghost 36; `loading` + `loadingLabel`, `disabled` (.4), `icon`, `fullWidth`, `flex`,
`pageCta`), `PrimaryButton`, `TonalButton`, `SecondaryButton`, `IconButton` (`icon`, required
`accessibilityLabel`, `variant`: surface, onGradient, onNight, plain, plainOnGradient, mic, send,
play, skip15), `CardIconAction` (`kind` complete/more/close/edit/delete, `done`), `TextAction`,
`CardActions`, `ActionTile`, `ActionTileGrid`, `AuthProviderButton` (`kind` brand/email, `logo`),
`OutlineAddButton`, `HeaderPill` / `PillButton` (`tint`, `compact`).

**Badges and chips** — `Badge` (`category`: urgent, deadline, security, approved, neutral — only
the first four carry colour), `StatusPill` (`tone`, `busy`, `size` md/wait), `PlanBadge`,
`approvalStatusTone`, `commitmentStatusTone`, `waitDurationTone`; `FilterChip` / `FilterChipRow`
(`semantics` tabs/radio, `compact`, `on`), `MetaChip` (`variant` neutral/vip/warning/surface,
editable with `onPress`), `CountdownPill` (`startsAt`, `format`, `startedLabel`, `variant`
countdown/join, injectable `now`), `ConnectPill` (`state` connect/connected/connecting/needsReauth/
error), `AssistChip` / `SuggestionChip`, `TokenChip` (remove or dashed `add`), `ChoiceChip`,
`SourceChip`, `FollowUpChip`, `VoicePromptChip`, `RecipientChip`, `ChipWrap`; `Avatar` (`name`,
`id`, `size` 22…76, `self`, `source`, `decorative`), `AvatarPair`.

**Navigation** — `RootHeader` / `LargeTitleHeader` (`kicker`, `title`, `trailing`, `avatar`),
`DetailHeader` / `NavHeader` (`leading` back/close/collapse, `kicker`, `trailing`, `onGradient`),
`GradientHeader` + `OverlappingSheet`, `StepHeader`, `PageDots` (adjustable), `TabBar` (`items`,
`activeKey`, `onTabPress`, `onReselect`, `background`).

**Lists** — `SectionHeader` / `SectionKicker` (`count`, `variant` plain/dot/tone), `GroupedList`
(hairlines between rows only), `ListRow` (`trailing`: chevron, value, switch, check, radio, link,
custom; `density`; `destructive`; `disabledReason`; switch rows are whole-row switches),
`CategoryRow`, `OptionRow` (`ai`, `recommended`, `role` radio/button), `ChecklistRow`,
`TimelineRow`, `KeyValueGrid` (tappable rows are links), `SwipeableRow` (`right`, `left` ≤ 2,
render-prop children receive the verbs as `A11yAction`s), `swipeA11yActions`.

**Inputs** — `TextField` (`label`, `error` ring + announced helper, `helper`, `prefix`,
`leadingIcon`, `disabled`, `placeholder?`), `UrlField`, `SearchField`, `CaptureTextField`
(`counterText`, 90% warning), `ChatComposer` / `ChatInput` (mic → send morph, `disabledReason`),
`Switch` / `SwitchTrack`, `SegmentedControl` (`semantics`, sliding thumb), `RadioIndicator`,
`CheckIndicator`, `TimeChip`, `PlanOptionCard`, `SelectableTile`, `ThemePreviewTile`, `Accordion`,
`StickyCTABar`.

**Provenance** — `SourceLine` / `SourceTag` (always tappable; `parts`, `variant` verified),
`MetaLine`, `ProvenanceFooter`, `ConfidenceText` (`coverage` < 0.7 → `uncertainLabel`),
`ConfidenceChip`, `AssuranceNote` / `TrustLine`, `AIHint` / `HintRow`, `PrivacyNote`,
`FeedbackActions` (thumb icons, `value`), `WhySheetContent` / `ExplainSheetContent` (`tier` kind:
explicit_rule, learned_preference, deterministic_signal, ai_classification).

**Cards** — every card is one accessible element with a composed label; its controls and gesture
verbs are `accessibilityActions` (`cardA11y`, `A11yAction`, `CardTextActions` ≤ 2).
`PriorityCard`, `AttentionCard`, `MailSummaryCard`, `AnnouncementCard`, `LifeCard`,
`InlineCardError`, `AiKicker`, `AiCard` / `AICard` (`state` default/accepted/pendingApproval/
loading), `BriefingHero` (`mode` ready/generating/offline, coloured count only here),
`ProGateCard`, `TalkingPointsCard` (ink; dark prep gradient), `RichAnswerCard`, `DraftCard`,
`DraftEditorCard`, `SourceResultCard`, `FollowUpCard`, `WaitingCard` / `PersonActionCard`,
`CommitmentCard` (done / confirmation variants), `SuggestedSurface` (dashed "proposed", solid after
execution; states proposed/pendingApproval/executing/executed/failed), `GapBlock`, `ConflictPair`,
`CalendarIntelCard`, `InkCallout` (callout/promise/banner), `StatTile`, `HeroStat`,
`SenderHeader`, `ApprovalCard` (`status` pending/approved/executing/executed/failed/rejected/
expired; `details` Neden · Değişim · Kaynak · Hesap · Yan etki; `variant` full/compact with the
tap-to-approve `hint`; announces status changes; success haptic only on `executed`), `ApprovalRow`.

**Audio and voice** — `MiniPlayer`, `FullPlayer`, `SpeedPill`, `Waveform`, `Scrubber` (drag + ±15 s
adjustable), `TransportControls` / `AudioControls`, `ChapterList`, `NativeTtsNotice`, `VoiceOrb`,
`VoiceWaveform`, `MiniWaveform`, `TranscriptText`, `AnswerBubble`, `TranscriptCard`, `PulsingRing`,
`TypingIndicator`.

**Plan** — `DayStrip`, `DayChip`, `TimelineBlockRow` (now-line), `TimelineBlock`
(event/life/deadline/commitment/task, overlap marker), `WeekDensityChart`, `StackedBar`.

**Capture** — `CaptureSourceTiles`, `MediaPreview` + `DetectionBox`, `LinkPreviewCard`,
`ExtractedItemRow`, `EntityHighlightText` + `EntityLegend`, `FileRow`, `AnalysisProgressCard` /
`ProcessingChecklist` (no progress bar).

**Account and monetisation** — `IntegrationRow` (official `logo` from the app), `PermissionExplainer`,
`ReasonRow`, `AssuranceBox`, `NotificationPreview`, `PlanComparisonTable`, `ReferralLinkField`,
`InviteRow`, `RulePreviewCard`.

**Editorial** — `EditorialParagraph` (Lora, bold spans), `EditorialStatRow`, `HighlightCard`,
`ShareCardTemplate` (1080×1350 / 1080×1920; capture it with react-native-view-shot in the app).

## Overlays (`src/overlays`)

| Component                                                            | Key props                                                                                                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `BottomSheet` / `Sheet`                                              | `visible`, `onDismiss`, `onHidden`, `title`, `subtitle`, `footer`, `variant` default/destructive, `presentation` modal/inline, `dismissible` |
| `ConfirmDialog`                                                      | `visible`, `title`, `body`, `icon`, `confirm`, `cancel` (irreversible single-object actions)                                                 |
| `DestructiveSheet`                                                   | `consequences` ("Silinen: … / Korunan: …"), destructive `lg` + same-size "Vazgeç"                                                            |
| `Toast`, `UndoToast`, `ToastViewport`, `ToastProvider`, `useToast()` | 2.6 s; undo 5 s (10 s and focusable with a screen reader); FIFO, one at a time, `MAX_PENDING_TOASTS` = 3                                     |
| `InAppBanner`                                                        | Foreground push banner: 4 s, swipe up, tap opens the deep link                                                                               |
| `useBackHandler(enabled, handler)`                                   | Android hardware back for in-place overlays                                                                                                  |

**Sheet implementation decision.** The kit ships its own `BottomSheet` on react-native-reanimated
4.5.1 + react-native-gesture-handler 2.32 instead of `@gorhom/bottom-sheet`. The latest gorhom
release (5.2.14, published 2026-05-09) only declares open peer ranges
(`react-native-reanimated >=3.16.0 || >=4.0.0-`, `react-native-gesture-handler >=2.16.1`) and has no
release verified against React Native 0.86 / Reanimated 4.5 / worklets 0.10, which cannot be proven
here without a device build. The kit sheet covers what the design needs — scrim tap, drag the
handle to dismiss with a 35% / velocity snap and spring back, 300/240 ms motion (fade only under
reduce motion), light haptic, `accessibilityViewIsModal`, focus to the title, iOS escape, Android
back (Modal `onRequestClose` or `useBackHandler` inline) — and it is fully testable in Jest. The
default `modal` presentation is an RN `Modal` wrapped in its own `GestureHandlerRootView`, whose
native window confines VoiceOver/TalkBack to the sheet; `inline` is for route sheets presented as
`transparentModal` (DEV-56).

## Global states (`src/states`, M-STATE-01…12)

| M-STATE                | Components                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 Loading             | `SkeletonGroup`, `CardSkeleton`, `TodaySkeleton`, `FeedSkeleton`, `TimelineSkeleton`, `SettingsValueSkeleton`, `MailDetailSkeleton`, `PrepSkeleton`, `ChatStreamingSkeleton`, `AiWorkingKicker` / `AISpinner`, `AiWorkingInline`, `LongRunningNotice`, `SyncLine` (`phase` idle/syncing/done), `StaggerIn` |
| 02 Empty               | `EmptyState` (`icon`, `tone`, `title`, `body`, one `action`)                                                                                                                                                                                                                                               |
| 03 Offline             | `OfflineBanner`, `OfflineScreen`                                                                                                                                                                                                                                                                           |
| 04 Reconnect           | `ReconnectCard` (`variant` expired/adminConsent/declined)                                                                                                                                                                                                                                                  |
| 05 Sync delayed        | `SyncDelayedCard`                                                                                                                                                                                                                                                                                          |
| 06 Partial             | `PartialDataNotice` / `PartialDataStrip`                                                                                                                                                                                                                                                                   |
| 07 AI unavailable      | `AiUnavailableCard`                                                                                                                                                                                                                                                                                        |
| 08 Permission          | `PermissionCard`                                                                                                                                                                                                                                                                                           |
| 09 Entitlement / limit | `EntitlementGate` (`variant` gate/lapse), `LimitCard`                                                                                                                                                                                                                                                      |
| 10 External credential | `ExternalCredentialRequired` / `UnavailableCard` (no CTA)                                                                                                                                                                                                                                                  |
| 11 Error               | `ErrorCard` / `InlineErrorCard`, `ErrorState` (full screen, focus to title, error code, report)                                                                                                                                                                                                            |
| 12 Not found           | `NotFoundState` (`variant` route/entity)                                                                                                                                                                                                                                                                   |
| —                      | `SuccessState`, `sortStateCards` (≤ 2 inline cards, critical → warning → neutral)                                                                                                                                                                                                                          |

Every state takes its copy from `states.*` through props; a request `correlationId` goes into the
testID and accessibility hint only, never into visible text.

## Accessibility and motion rules built in

- Every interactive element has a role and a label (or visible text); icon-only controls require
  `accessibilityLabel`; states (disabled, selected, checked, busy, expanded) are exposed.
- Hit targets reach 44 × 44 pt (iOS) / 48 × 48 dp (Android) via `hitSlop` without changing visuals.
- Keyboard focus (Android, iPad) shows the 2 px `border.focus` ring.
- Swipes, long-presses and card menus are mirrored as `accessibilityActions`, and every swipe verb
  must also exist as a visible control on the card.
- Toasts, banners, error cards and approval status changes are announced.
- Reduce motion: durations 0 for movement, 120 ms opacity only, loops (shimmer, spinner, pulse,
  bars, typing) stop, press scale and illustration tilt are removed.

## Deviations from the design audit (minimal)

- No semantic token exists for the pressed ink CTA (`#000` in P:01) or for `#25266A` text on the
  `inverse` button; the ink CTA keeps its fill and scales when pressed, and `inverse` uses
  `brand.onSoft` (7.0:1 on white). The mini player uses the dawn start stop and the night mid stop
  of the gradient tokens for its deep fill and play glyph.
- Tokens are not added here (design-tokens is out of this package's scope); translucent values that
  have no exact token use the nearest `onGradient.fill*` step (e.g. page-dot idle `waveIdle` .35
  instead of .40, mini player track `.18` instead of `.20`).
- `SwipeableRow` uses `Gesture.Pan()` directly rather than `ReanimatedSwipeable`: it needs the 35%
  threshold haptic and the full-swipe rule, and the prebuilt swipeable mixes worklet and JS
  callbacks under Jest.
- The compact voice approval card uses `shadow.page` (the audit's `0 12px 32px rgba(0,0,0,.25)` has
  no token).

## Icons

```tsx
<Icon name="sunny" filled size={26} color={theme.color.tabBar.active} accessibilityLabel="Bugün" />;
<Icon name="chevron_right" color={theme.color.icon.chevron} />; // decorative: hidden
```

`icons.manifest.json` is the single list of shipped Material Symbols Rounded icons (design canvases,
screen map and audit-only icons, with the `aliases` and `excluded` names documented there).
`pnpm --filter @da/ui icons` regenerates `src/icons/generated/*` and `icons.data.json`
(framework-neutral path data for web and backoffice); the output is deterministic and committed.

## Tests

`pnpm --filter @da/ui test` runs Jest with `@react-native/jest-preset`, React Native Testing Library
14 and `test-renderer`, Reanimated's `setUpTests()`, gesture-handler's mocks and jest-utils, the
worklets Jest resolver, and the same Babel transforms as the app (React Compiler with fatal
diagnostics for `src/`, worklets plugin).

- `contract.test.tsx` — a fixture for every exported component (the test fails when one is
  missing), rendered in light and dark: interactive hosts must expose a role and a label, dark
  renders must not paint hard-coded white (on-gradient contexts excepted), light/dark resolve
  different surface tokens, and no source file contains a hex / rgb / hsl literal.
- `theme`, `primitives`, `controls`, `navigation-lists`, `cards`, `overlays`, `states`,
  `features` — interactions (press handlers fire, disabled and busy block presses), accessibility
  roles/states/actions, swipe gestures and their `accessibilityActions`, sheet dismissal paths,
  toast timing and queueing, reduce motion (no press scale, no shimmer, static spinner, 120 ms
  exits), haptics injection, Turkish upper-casing, and the font contract.
- `icon.test.tsx`, `manifest.test.ts` — icon rendering and code generation determinism.
