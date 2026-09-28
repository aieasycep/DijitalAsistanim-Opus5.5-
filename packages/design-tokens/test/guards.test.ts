/**
 * Input guards and fallbacks of the token helpers (TEST_PLAN §16: design-tokens 100/95/100).
 * Every helper that can be handed a malformed value must fail loudly instead of producing a
 * wrong colour, and the platform accessors must pick the right native family.
 */
import { describe, expect, it } from 'vitest';
import {
  alpha,
  boxShadow,
  colorAt,
  composite,
  gradient,
  nativeFontFamily,
  pairBackground,
  parseColor,
  relativeLuminance,
  sampleGradient,
  shadow,
  shadowToCss,
  typography,
  type ColorPath,
  type LinearGradientToken,
  type TextStyleToken,
} from '../src/index.ts';

const WHITE = { r: 255, g: 255, b: 255, a: 1 };

describe('parseColor', () => {
  it('reads #RRGGBB as opaque and #RRGGBBAA with its alpha byte', () => {
    expect(parseColor('#112233')).toEqual({ r: 17, g: 34, b: 51, a: 1 });
    expect(parseColor('#11223380').a).toBeCloseTo(128 / 255, 5);
  });

  it('reads rgb(…) without alpha as opaque', () => {
    expect(parseColor('rgb(1,2,3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });

  it('rejects out-of-range channels, out-of-range alpha and unknown formats', () => {
    expect(() => parseColor('rgba(256,0,0,1)')).toThrow(/channel out of range/);
    expect(() => parseColor('rgba(0,0,0,1.5)')).toThrow(/Alpha out of range/);
    expect(() => parseColor('hsl(0 0% 0%)')).toThrow(/Unsupported colour format/);
  });
});

describe('compositing and luminance need opaque inputs', () => {
  it('composite() refuses a translucent bottom colour', () => {
    expect(() => composite(WHITE, { ...WHITE, a: 0.5 })).toThrow(/must be opaque/);
  });

  it('relativeLuminance() refuses a translucent colour', () => {
    expect(() => relativeLuminance({ ...WHITE, a: 0.2 })).toThrow(/composite the colour first/);
  });
});

describe('alpha()', () => {
  it('writes rgba() from a palette hex', () => {
    expect(alpha('#FF0000', 0.5)).toBe('rgba(255,0,0,0.5)');
  });

  it('rejects a non-#RRGGBB input and an alpha outside 0–1', () => {
    expect(() => alpha('#F00', 0.5)).toThrow(/expected #RRGGBB/);
    expect(() => alpha('#FF0000', 2)).toThrow(/alpha out of range/);
  });
});

describe('colorAt()', () => {
  it('throws for a path that is not a colour leaf', () => {
    expect(() => colorAt('light', 'text' as ColorPath)).toThrow(/Unknown colour path/);
  });
});

describe('pairBackground()', () => {
  it('composites over the page background when no base is given', () => {
    const over = pairBackground('light', { color: 'border.hairline' });
    const explicit = pairBackground('light', { color: 'border.hairline', over: 'bg' });
    expect(over).toEqual(explicit);
  });

  it('refuses a translucent base colour', () => {
    expect(() =>
      pairBackground('light', { color: 'surface', over: 'text.onGradientSecondary' }),
    ).toThrow(/must be opaque/);
  });
});

describe('sampleGradient()', () => {
  it('throws for a gradient without stops', () => {
    const empty: LinearGradientToken = { kind: 'linear', angle: 180, stops: [] };
    expect(() => sampleGradient(empty, 0.5)).toThrow(/without stops/);
  });

  it('falls back to the last stop when the position cannot be placed (NaN)', () => {
    const token: LinearGradientToken = {
      kind: 'linear',
      angle: 90,
      stops: [
        { at: 0, color: '#000000' },
        { at: 1, color: '#FFFFFF' },
      ],
    };
    expect(sampleGradient(token, Number.NaN)).toEqual(WHITE);
    expect(sampleGradient(token, 0.5)).toEqual({ r: 128, g: 128, b: 128, a: 1 });
  });

  it('samples a declared gradient at both ends', () => {
    const token = gradient.dawn;
    const first = token.stops[0];
    const last = token.stops[token.stops.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(sampleGradient(token, -1)).toEqual(parseColor(first?.color ?? ''));
    expect(sampleGradient(token, 2)).toEqual(parseColor(last?.color ?? ''));
  });
});

describe('boxShadow()', () => {
  it('returns the CSS string of a named token in a scheme', () => {
    expect(boxShadow('light', 's1')).toBe(shadowToCss(shadow.light.s1));
    expect(boxShadow('dark', 'card')).toBe(shadowToCss(shadow.dark.card));
    expect(shadowToCss([])).toBe('none');
  });
});

describe('nativeFontFamily()', () => {
  it('uses the platform monospace family', () => {
    expect(nativeFontFamily(typography.mono, 'ios')).toBe('Menlo');
    expect(nativeFontFamily(typography.mono, 'android')).toBe('monospace');
  });

  it('maps serif weights, italics and the missing bold to SemiBold', () => {
    expect(nativeFontFamily(typography.editorial, 'ios')).toBe('Lora_400Regular');
    expect(nativeFontFamily(typography.editorialQuote, 'ios')).toBe('Lora_400Regular_Italic');
    const bold: TextStyleToken = { ...typography.editorialTitle, weight: 700 };
    expect(nativeFontFamily(bold, 'android')).toBe('Lora_600SemiBold');
  });

  it('maps sans weights to their per-weight family', () => {
    expect(nativeFontFamily(typography.badge, 'ios')).toBe('Geist_700Bold');
  });
});
