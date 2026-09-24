/**
 * Corner radii (DESIGN_AUDIT §2.9). Declared in P:01: 10 çip ikon karosu · 12 satır içi buton ·
 * 14 buton · 16 küçük kart · 20 kart · 28 hero / sayfa; the rest are observed on the canvases.
 */
export const radius = {
  xs: 3,
  text: 5,
  tileXs: 9,
  tile: 10,
  tileMd: 11,
  inline: 12,
  button: 14,
  buttonLg: 16,
  input: 16,
  cardSm: 16,
  list: 18,
  card: 20,
  widgetIos: 22,
  panel: 24,
  modal: 24,
  hero: 28,
  sheet: 28,
  pill: 999,
} as const;

export type RadiusName = keyof typeof radius;
