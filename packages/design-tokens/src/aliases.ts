/**
 * Verbatim design names (P:01 slash names and DESIGN_AUDIT §2.3 supplementary names) mapped to
 * the typed code keys, for traceability between the canvases and the code. Components use the
 * code keys; these maps exist so a design reference such as `ink/tertiary-strong` can be looked
 * up and so tests can check the tokens against `design/tokens/primary-tokens.json`.
 */
import { colorAt, type ColorPath, type ColorSchemeName } from './color.ts';
import type { GradientName } from './gradient.ts';
import type { RadiusName } from './radius.ts';
import type { ShadowName } from './shadow.ts';
import type { TypographyName } from './typography.ts';

export const colorAliases = {
  'brand/primary': 'brand.primary',
  'brand/primary-pressed': 'brand.primaryPressed',
  'brand/soft': 'brand.soft',
  'brand/soft-pressed': 'brand.softPressed',
  'brand/text-on-soft': 'brand.onSoft',
  'brand/dark-glow': 'brand.glow',
  'brand/suggested-bg': 'plan.ai',
  'brand/suggested-border': 'border.suggested',
  'brand/planned': 'plan.aiPlanned',
  critical: 'tone.critical.solid',
  'critical/soft': 'tone.critical.soft',
  'critical/text': 'tone.critical.text',
  'critical/text-strong': 'tone.critical.textStrong',
  'critical/pressed': 'tone.critical.pressed',
  'destructive-fill': 'button.destructive.bg',
  warning: 'tone.warning.solid',
  'warning/soft': 'tone.warning.soft',
  'warning/text': 'tone.warning.text',
  success: 'tone.success.solid',
  'success/soft': 'tone.success.soft',
  'success/text': 'tone.success.text',
  'success/deep': 'tone.success.deep',
  'success/on-gradient': 'tone.success.onGradient',
  info: 'tone.info.solid',
  'info/soft': 'tone.info.soft',
  'info/text': 'tone.info.text',
  'neutral/bg': 'bg',
  'neutral/surface': 'surface',
  'neutral/surface-2': 'surfaceSunken',
  // The declared swatch is the solid #E9E7E1; the row-divider stroke is `border.hairline`.
  'neutral/hairline': 'surfaceTrack',
  ink: 'text.primary',
  'ink/secondary': 'text.secondary',
  'ink/secondary-on-track': 'text.secondaryOnTrack',
  'ink/tertiary': 'text.tertiary',
  'ink/tertiary-strong': 'text.tertiaryStrong',
  'ink/on-ai-glow': 'text.onAiGlow',
  'ink/quaternary': 'icon.chevron',
  'ink/disabled': 'text.disabled',
  'editorial/paper': 'bgEditorial',
  'on-primary': 'text.onPrimary',
  'icon/default': 'icon.default',
  'icon/idle': 'icon.idle',
  'icon/ai': 'icon.ai',
  'ai-glow/start': 'aiGlow.from',
  'surface/pressed': 'surfacePressed',
  'surface/ink': 'surfaceInk',
  'plan/life': 'plan.life',
  'plan/event': 'plan.event',
  'plan/gap': 'border.gapDashed',
  'plan/week-meeting': 'plan.week.meeting',
  'plan/week-focus': 'plan.week.focus',
  'plan/week-busy': 'plan.week.busy',
  'plan/week-busy-strong': 'plan.week.busyStrong',
  'plan/week-today': 'plan.week.today',
  'plan/week-today-strong': 'plan.week.todayStrong',
  'mail/band-attention': 'mail.band.attention',
  'mail/band-info': 'mail.band.info',
  'mail/band-low': 'mail.band.low',
  'accent/count-on-dawn': 'text.countOnDawn',
  'kicker/on-indigo': 'text.kickerOnIndigo',
  'on-gradient/primary': 'text.onGradient',
  'on-gradient/secondary': 'text.onGradientSecondary',
  'on-gradient/tertiary': 'text.onGradientTertiary',
  'on-gradient/wave-idle': 'onGradient.waveIdle',
  'control/switch-off': 'control.switchOff',
  'control/switch-off-border': 'control.switchOffBorder',
  'control/radio-off': 'control.radioOff',
  'control/grabber': 'control.grabber',
  'control/spinner-track': 'control.spinnerTrack',
  'skeleton/base': 'skeleton.base',
  'skeleton/highlight': 'skeleton.highlight',
  'overlay/scrim': 'overlay.scrim',
  'overlay/tab-bar': 'overlay.tabBar',
  'overlay/glass-card': 'overlay.glassCard',
  'border/row': 'border.row',
  'border/strong': 'border.strong',
  'border/control': 'border.control',
  'border/focus': 'border.focus',
  'border/error': 'border.error',
  'toast/bg': 'toast.bg',
  'toast/text': 'toast.text',
  'toast/icon': 'toast.icon',
  'toast/icon-error': 'toast.iconError',
  'toast/action': 'toast.action',
} as const satisfies Record<string, ColorPath>;

export type ColorAlias = keyof typeof colorAliases;

export const gradientAliases = {
  'gradient/dawn': 'dawn',
  'gradient/dawn-fullbleed': 'dawnFullbleed',
  'gradient/night': 'night',
  'gradient/dusk': 'dusk',
} as const satisfies Record<string, GradientName>;

export const typographyAliases = {
  display: 'display',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  body: 'body',
  secondary: 'secondary',
  'caption / kicker': 'kicker',
  'micro / badge': 'badge',
  editorial: 'editorial',
  // Declared as 34/40 in P:01; the 38/44 weekly variant is `editorialDisplay`.
  'editorial-display': 'editorialDisplaySm',
} as const satisfies Record<string, TypographyName>;

export const radiusAliases = {
  'çip ikon karosu': 'tile',
  'satır içi buton': 'inline',
  buton: 'button',
  'küçük kart': 'cardSm',
  kart: 'card',
  'hero / sayfa': 'hero',
} as const satisfies Record<string, RadiusName>;

export const shadowAliases = {
  'shadow-1': 's1',
  'shadow-2 · kart': 'card',
  'shadow-3 · sayfa': 'page',
} as const satisfies Record<string, ShadowName>;

/** The colour of a design slash name in one scheme, e.g. `colorByAlias('dark', 'ink')`. */
export function colorByAlias(scheme: ColorSchemeName, name: ColorAlias): string {
  return colorAt(scheme, colorAliases[name]);
}
