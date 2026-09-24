/**
 * Layout constants (DESIGN_AUDIT §2.8). Verbatim rule from P:01: "Ekran kenarı 20 · kart içi
 * 16 · kartlar arası 12 · bölümler arası 18–22 · liste satırı min 50." Paddings given as
 * `[top, horizontal, bottom]` follow the CSS shorthand of the design.
 */
export const layout = {
  screenX: 20,
  onboardingX: 28,
  readingX: 24,
  sheetX: 20,
  destructiveSheetX: 24,
  contentTopRoot: 14,
  contentTopSub: 6,
  sectionGap: { today: 18, plan: 16, subList: 14, brief: 22, weekly: 26 },
  cardGap: 12,
  cardPad: 16,
  cardPadCompact: [14, 16, 10],
  heroPad: [22, 22, 20],
  inkCardPad: 20,
  errorCardPad: [14, 16, 14],
  groupedListPadX: 16,
  groupedListPadY: 4,
  rowMinHeight: 50,
  rowSettingsMinHeight: 52,
  rowTwoLineMinHeight: 56,
  rowTwoLineTrailingMinHeight: 60,
  rowPadY: 11,
  cardActionRow: { marginTop: 6, padY: 8, gap: 14, ghostOffset: -10 },
  buttonRowGap: 8,
  stickyFooterPad: [16, 20, 10],
  stickyFooterMinBottom: 20,
  stickyFooterContentGap: 16,
  tabBar: { height: 62, itemPad: 8, icon: 26, gap: 3 },
  toastGap: 14,
  chipRow: { edge: 20, gap: 8, gapCompact: 6 },
} as const;
