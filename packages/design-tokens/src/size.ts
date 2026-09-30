/**
 * Component and icon sizes (DESIGN_AUDIT §2.8, §2.12.1). Visual sizes stay as designed; hit
 * targets reach 44 pt (iOS) / 48 dp (Android) through `hitSlop` or `minHeight` (DEV-22).
 */
export const size = {
  button: { lg: 52, md: 48, inline: 40, inlineApproval: 42, card: 38, ghost: 36 },
  iconButton: 36,
  chip: { filter: 34, meta: 30 },
  segment: 32,
  switch: { width: 50, height: 30, knob: 26 },
  input: 52,
  search: 44,
  composer: 52,
  avatar: { xs: 22, sm: 28, md: 32, lg: 40, xl: 44, xxl: 56 },
  tile: { xs: 28, sm: 30, md: 36, lg: 44, xl: 48, state: 52 },
  hitMin: { ios: 44, android: 48 },
  icon: {
    meta: 15,
    source: 16,
    tile: 17,
    chip: 18,
    default: 20,
    action: 22,
    grid: 24,
    tab: 26,
    empty: 30,
    mic: 36,
    play: 40,
    success: 44,
    ring: 48,
  },
} as const;
