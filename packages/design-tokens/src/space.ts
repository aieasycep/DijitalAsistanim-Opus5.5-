/**
 * Spacing (DESIGN_AUDIT §2.8). The declared grid is 4 pt (`SPACE` 4…40); the canvases use a
 * 2-pt sub-grid, so half steps exist. Keys are 4-pt steps: `space[4]` = 16, `space[2.5]` = 10.
 */
export const space = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  3.5: 14,
  4: 16,
  4.5: 18,
  5: 20,
  5.5: 22,
  6: 24,
  6.5: 26,
  7: 28,
  8: 32,
  9: 36,
  10: 40,
  11: 44,
} as const;

export type SpaceStep = keyof typeof space;

/** The 4-pt grid unit. */
export const GRID = 4;
