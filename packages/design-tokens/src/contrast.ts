/**
 * Colour maths used by the generators and the contrast tests: parsing of the token formats
 * (`#RRGGBB`, `#RRGGBBAA`, `rgba(r,g,b,a)`), alpha compositing and WCAG 2.2 contrast ratios.
 */

export interface Rgba {
  /** 0–255 */
  readonly r: number;
  /** 0–255 */
  readonly g: number;
  /** 0–255 */
  readonly b: number;
  /** 0–1 */
  readonly a: number;
}

const HEX = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;
const RGBA = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i;

export function parseColor(value: string): Rgba {
  const hex = HEX.exec(value);
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16);
    const alphaByte = hex[2] === undefined ? 255 : parseInt(hex[2], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: alphaByte / 255 };
  }
  const rgba = RGBA.exec(value);
  if (rgba?.[1] && rgba[2] && rgba[3]) {
    const channel = (s: string): number => {
      const n = Number(s);
      if (n > 255) throw new Error(`Colour channel out of range in ${value}`);
      return n;
    };
    const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
    if (!(a >= 0 && a <= 1)) throw new Error(`Alpha out of range in ${value}`);
    return { r: channel(rgba[1]), g: channel(rgba[2]), b: channel(rgba[3]), a };
  }
  throw new Error(`Unsupported colour format: ${value}`);
}

/**
 * Source-over compositing of `top` on an opaque `bottom`; the result is opaque and quantised to
 * 8-bit channels, as a display renders it.
 */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  if (bottom.a !== 1) throw new Error('composite(): the bottom colour must be opaque');
  const mix = (t: number, u: number): number => Math.round(t * top.a + u * (1 - top.a));
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

/**
 * Interpolation between two opaque colours in sRGB (the CSS gradient default), quantised to
 * 8-bit channels.
 */
export function mixColors(from: Rgba, to: Rgba, t: number): Rgba {
  const lerp = (x: number, y: number): number => Math.round(x + (y - x) * t);
  return { r: lerp(from.r, to.r), g: lerp(from.g, to.g), b: lerp(from.b, to.b), a: 1 };
}

function linear(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an opaque colour. */
export function relativeLuminance(color: Rgba): number {
  if (color.a !== 1) throw new Error('relativeLuminance(): composite the colour first');
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/** WCAG contrast ratio between two opaque colours (1–21). */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** `#RRGGBB` (opaque) or `#RRGGBBAA` (translucent), upper-case, alpha rounded to 8 bits. */
export function toHex(color: Rgba): string {
  const byte = (n: number): string => Math.round(n).toString(16).padStart(2, '0').toUpperCase();
  const alphaByte = Math.round(color.a * 255);
  const rgb = `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`;
  return alphaByte === 255 ? rgb : `${rgb}${byte(alphaByte)}`;
}
