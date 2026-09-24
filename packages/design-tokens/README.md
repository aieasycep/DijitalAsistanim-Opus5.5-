# @da/design-tokens

The single source of the Dijital Asistan visual language (PRIMARY design, `docs/DESIGN_AUDIT.md` §2,
WBS task T-1.02). Pure TypeScript with relative `.ts` imports and no runtime dependencies, so React
Native, Next.js, Node scripts and tests all import the same typed object.

## Contents (`src/`)

| File                 | Tokens                                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `palette.ts`         | Raw hexes, each exactly once; `alpha()` writes every translucent colour                                                                                                                                                                                                                                                                                             |
| `color.ts`           | Semantic `color.light` / `color.dark` (same shape, checked at compile time): surfaces, `text`, `icon`, `brand`, `tone` (critical/warning/success/info/neutral/primary), `border`, `overlay`, `onGradient` fills, `aiGlow`, `control`, `skeleton`, `inverse`, `button`, `toast`, `tabBar`, `swipe`, `plan`, `mail`, `avatar`; `toneColors()` = the §2.4 tone map API |
| `gradient.ts`        | `dawn`, `dawnFullbleed`, `night`, `dusk`, `prepCardDark`, `lockscreenDawn` (identical in both schemes) and `themedGradients(scheme)`; `gradientToCss()`, `cssAngleToPoints()` for `expo-linear-gradient`                                                                                                                                                            |
| `typography.ts`      | Geist / Lora scale (tracking in em, `letterSpacing()` gives RN points), per-weight RN family names, backoffice density scale, responsive web scale                                                                                                                                                                                                                  |
| `space.ts`           | 4-pt grid with 2-pt half steps: `space[4]` = 16                                                                                                                                                                                                                                                                                                                     |
| `layout.ts`          | Screen edge, card padding, row heights, tab bar and footer constants                                                                                                                                                                                                                                                                                                |
| `size.ts`            | Buttons, tiles, avatars, hit targets (44 pt / 48 dp), icon sizes                                                                                                                                                                                                                                                                                                    |
| `radius.ts`          | 3 … 999                                                                                                                                                                                                                                                                                                                                                             |
| `shadow.ts`          | Light drop shadows; dark hairline rings instead of shadows; `shadowToCss()` (also the RN `boxShadow` string); `androidElevation` fallback for API < 28                                                                                                                                                                                                              |
| `motion.ts`          | Easing curves, durations (all ≤ 600 ms), delays, loops, holds, swipe spring, haptic kind per event                                                                                                                                                                                                                                                                  |
| `opacity.ts`, `z.ts` | Opacity levels and stacking order                                                                                                                                                                                                                                                                                                                                   |
| `aliases.ts`         | The design's verbatim names (`ink/tertiary-strong`, `caption / kicker`, `kart`, `shadow-2 · kart`, …) mapped to code keys                                                                                                                                                                                                                                           |
| `contrast.ts`        | Colour parsing, 8-bit compositing, WCAG contrast ratio                                                                                                                                                                                                                                                                                                              |
| `contrast-pairs.ts`  | The explicit contrast pair list (below)                                                                                                                                                                                                                                                                                                                             |

Components read semantic keys only (`color[scheme].text.tertiaryStrong`), never palette entries.
`da/no-raw-color` allows colour literals in this package only.

## Generated outputs

`pnpm --filter @da/design-tokens generate` (or `pnpm generate` at the root, through Turbo) runs
`node scripts/generate.ts` and writes:

| File                                  | Consumer                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generated/tokens.css`                | Web and backoffice (`import '@da/design-tokens/tokens.css'`): `--da-*` variables on `:root`, `[data-theme="dark"]` overrides, the same overrides under `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`, reduced-motion durations, and a Tailwind v4 `@theme inline` block (`bg-surface`, `text-ink-3`, `shadow-card`, `text-kicker`, `rounded-card`, …) |
| `generated/native-colors.json`        | Light/dark colour pairs (`#RRGGBB`, or `#RRGGBBAA` when translucent) keyed by token path (`import '@da/design-tokens/native.json'`)                                                                                                                                                                                                                                           |
| `generated/native/WidgetColors.swift` | iOS WidgetKit target: `WidgetColors.<token>` SwiftUI colours resolving light/dark through `UITraitCollection`                                                                                                                                                                                                                                                                 |
| `generated/native/DaColors.kt`        | Android Glance widgets: `DaColors.<token>` day/night `ColorProvider`s in package `expo.modules.dawidgets.generated`                                                                                                                                                                                                                                                           |

The output is a pure function of `src/` (declaration order, no timestamps) and is committed; CI
regenerates and fails on drift (`pnpm generate && git diff --exit-code`).

**Widget wiring (T-8.25).** The mobile app does not exist yet, so the native sources are emitted
here. Task T-8.25 (widgets) wires them into the app: `WidgetColors.swift` into
`apps/mobile/targets/widget/Generated/` and `DaColors.kt` into
`apps/mobile/modules/da-widgets/android/src/main/java/expo/modules/dawidgets/generated/`, either by
copying them in the widget build step or by pointing the generator's output there.

## Contrast guarantees

`src/contrast-pairs.ts` lists every placement of a foreground token on a background the product
uses — informational text (4.5:1), large text (3:1) and UI components / meaningful icons (3:1,
WCAG 1.4.11) — including text on the dawn, night and dusk gradients sampled at the deepest allowed
point. The list is scheme-independent and `test/contrast.test.ts` checks every pair in **both**
light and dark, so a component that follows it is accessible in either scheme. The test also:

- reproduces the DESIGN_AUDIT §2.15 ratios within ±0.01 (regression fixtures);
- fails if `text.tertiary`, `text.disabled` or `icon.chevron` (decorative only) is used for text;
- fails if any informational `text.*` token has no pair;
- proves the original design values fail where the audit applied a fix (DEV-01/02/05);
- checks that no dark surface resolves to white.

## Deviations from DESIGN_AUDIT (minimal, accessibility-driven)

- **Dark `ink/tertiary-strong` is `#938F87`, not `#8F8B83`.** The audit states the derived value
  reaches ≥ 4.54:1 on the dark pressed surface `#2A2926`; it measures 4.29:1. Four steps lighter per
  channel restores 4.52:1 there (5.18 on `surface`, 5.76 on `bg`).
- **Tone map icon for `success` is `success/text` (`#1E7A47`) in light.** `#2FA062` on
  `success/soft` is 2.93:1, below 1.4.11 for an icon tile; the same fix the audit applies to warning
  (DEV-09) and info (D-04). `tone.success.solid` stays `#2FA062` for the done icon on cards (3.32:1).
- **Added semantic tokens** so components never branch on the scheme: `text.accent` (hero count:
  primary in light, glow in dark), `tabBar.active` / `tabBar.inactive`, `swipe.completeBg` /
  `swipe.completeText` (DEV-10 track in both schemes), `text.onInk`, `inverse.*`.
- **`editorial-display`** is declared 34/40 in P:01 and maps to `editorialDisplaySm`; the 38/44
  weekly-review style keeps the audit's name `editorialDisplay`.
- Provider tiles are not tokens: official provider logos replace them (D-43).

## Tests

`pnpm --filter @da/design-tokens test` (vitest): contrast pairs in both schemes, fidelity to
`design/tokens/primary-tokens.json` (every declared colour, dark value, type style, spacing and
radius), aliases, typography conversions, motion cap, and generator determinism (two CLI runs are
byte-identical and equal the committed files).
