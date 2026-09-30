/**
 * Raw colour palette. Every hex used by a semantic token lives here exactly once; semantic
 * tokens (color.ts) reference these entries and never repeat a literal. Values come from the
 * PRIMARY design (`design/tokens/primary-tokens.json`, DESIGN_AUDIT §2.2–§2.3); entries marked
 * "derived" are the audit's accessibility fixes (DEV-01…DEV-14).
 */

export const palette = {
  warm: {
    white: '#FFFFFF',
    paper: '#FBFAF7',
    pressed: '#F7F6F2',
    bg: '#F5F4F0',
    sunken: '#F0EFEB',
    skeleton: '#EFEDE7',
    track: '#E9E7E1',
    grabber: '#E0DED7',
    switchOff: '#D9D6D0',
    quaternary: '#C9C5BC',
    disabled: '#B8B4AA',
    tertiary: '#9B978E',
    /** derived: actionable idle icons, radio-off ring, switch-off border (DEV-06/07/08). */
    idle: '#8F8B83',
    /** derived: ink/tertiary-strong, informational meta text (DEV-01). */
    tertiaryStrong: '#6F6C66',
    secondary: '#6B6860',
    /** derived: secondary text on the segmented track (DEV-05). */
    secondaryOnTrack: '#67645C',
    /** derived: secondary text on the AI glow (DEV-04). */
    onAiGlow: '#65625B',
    ink: '#1A1917',
    /** The design's hairline/shadow ink, always used with alpha (`rgba(27,25,23,…)`). */
    shadowInk: '#1B1917',
    black: '#000000',
  },
  warmDark: {
    text: '#F2F0EB',
    /** derived: dark secondary text on the AI glow (DEV-04). */
    onAiGlow: '#B5B1A8',
    secondary: '#A39F96',
    /**
     * derived: dark ink/tertiary-strong (DEV-01). The audit's #8F8B83 reaches only 4.29:1 on the
     * dark pressed surface #2A2926; +4 per channel restores ≥ 4.5:1 there.
     */
    tertiaryStrong: '#938F87',
    /** derived: dark actionable idle icons and control rings. */
    idle: '#85827A',
    tertiary: '#7A776F',
    disabled: '#5E5B54',
    pastDot: '#3A3936',
    /** derived: dark pressed surface and toast. */
    pressed: '#2A2926',
    surface: '#1F1E1B',
    bg: '#141311',
  },
  indigo: {
    suggested: '#F7F7FE',
    soft: '#EDEDFC',
    glowStart: '#E4E4FA',
    softPressed: '#DCDCF8',
    weekMeeting: '#D9D6F7',
    band: '#C9C7F3',
    countOnDawn: '#C9C9FF',
    kickerOnIndigo: '#D6D6FB',
    tonalTextDark: '#C3C4F8',
    glow: '#A9AAF5',
    /** derived: dark pressed primary. */
    primaryPressedDark: '#9596F5',
    primaryDark: '#8586F2',
    dawnEnd: '#7071EA',
    /** derived: full-bleed dawn end stop (DEV-12). */
    dawnFullbleedEnd: '#5A5BD6',
    primary: '#5B5CE2',
    primaryPressed: '#4B4CCB',
    prepEnd: '#4A4BC8',
    onSoft: '#4547C9',
    dawnMid: '#3B3CA8',
    prepStart: '#2C2C7A',
    nightMid: '#25266A',
    dawnStart: '#1E1E4C',
    nightStart: '#15153A',
    onPrimaryDark: '#0F0F2A',
  },
  dusk: {
    start: '#2A1E3F',
    mid: '#4A3A8A',
    end: '#8C6BD6',
  },
  coral: {
    soft: '#FCEDE9',
    busy: '#F3B7AE',
    /** derived: dark pressed destructive. */
    pressedDark: '#F4A393',
    light: '#F08B78',
    base: '#E0553F',
    text: '#C7432F',
    /** derived: critical text on soft and bg (DEV-02). */
    textStrong: '#BE3F2C',
    pressed: '#A83726',
  },
  amber: {
    lifeSurface: '#FDF6EC',
    soft: '#FDF2DC',
    light: '#F0B85A',
    base: '#E09A1C',
    /** The design's dark soft tint base (`rgba(217,139,11,.18)`). */
    tint: '#D98B0B',
    text: '#9A6300',
  },
  green: {
    onGradient: '#A9F0C1',
    soft: '#E4F5EA',
    light: '#6FCF97',
    base: '#2FA062',
    text: '#1E7A47',
    deep: '#1E5A36',
  },
  blue: {
    soft: '#E7F0FD',
    /** derived: dark info tone. */
    light: '#8DB8F5',
    base: '#3B82E6',
    text: '#2262BE',
  },
  avatar: {
    peachBg: '#F5E1D6',
    peachFg: '#7A3E1F',
    blueBg: '#DCE4F5',
    blueFg: '#2B3F73',
    greenBg: '#E3EFE6',
    greenFg: '#1E5A36',
  },
} as const;

/** `rgba(r,g,b,a)` from a `#RRGGBB` palette entry — the only way alpha colours are written. */
export function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m?.[1] || !m[2] || !m[3]) throw new Error(`alpha(): expected #RRGGBB, got ${hex}`);
  if (!(a >= 0 && a <= 1)) throw new Error(`alpha(): alpha out of range: ${String(a)}`);
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${String(r)},${String(g)},${String(b)},${String(a)})`;
}
