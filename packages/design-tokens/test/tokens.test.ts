import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COLOR_SCHEMES,
  MAX_DURATION,
  TONES,
  colorAliases,
  colorAt,
  colorByAlias,
  cssAngleToPoints,
  duration,
  flattenColors,
  gradient,
  gradientAliases,
  gradientToCss,
  letterSpacing,
  nativeFontFamily,
  parseColor,
  radius,
  radiusAliases,
  shadow,
  shadowAliases,
  shadowToCss,
  space,
  themedGradients,
  toneColors,
  typography,
  typographyAliases,
  type ColorPath,
} from '../src/index.ts';

interface DesignTokens {
  colors: Record<string, { value: string }>;
  dark: Record<string, string>;
  typography: Record<
    string,
    {
      fontSize: string;
      lineHeight: string;
      fontWeight: number;
      letterSpacing: string;
      textTransform: string;
    }
  >;
  space: number[];
  radius: Record<string, number>;
}

const design = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../design/tokens/primary-tokens.json', import.meta.url)),
    'utf8',
  ),
) as DesignTokens;

const sameColor = (x: string, y: string): boolean => {
  const a = parseColor(x);
  const b = parseColor(y);
  return a.r === b.r && a.g === b.g && a.b === b.b && Math.abs(a.a - b.a) < 1e-9;
};

describe('schemes', () => {
  it('light and dark define exactly the same colour keys', () => {
    const light = flattenColors('light').map(([p]) => p);
    const dark = flattenColors('dark').map(([p]) => p);
    expect(dark).toEqual(light);
    expect(light.length).toBeGreaterThan(100);
  });

  it('every colour value parses', () => {
    for (const scheme of COLOR_SCHEMES) {
      for (const [path, value] of flattenColors(scheme)) {
        expect(() => parseColor(value), `${scheme} ${path}`).not.toThrow();
      }
    }
  });

  it('tone map uses critical/text-strong for text (DEV-02)', () => {
    expect(toneColors('light', 'critical').text).toBe('#BE3F2C');
    for (const scheme of COLOR_SCHEMES) {
      for (const tone of TONES) {
        const t = toneColors(scheme, tone);
        expect(t.soft).toBe(colorAt(scheme, `tone.${tone}.soft`));
      }
    }
  });
});

describe('fidelity to design/tokens/primary-tokens.json (PRIMARY P:01)', () => {
  it('every declared colour equals its aliased light token', () => {
    for (const [name, { value }] of Object.entries(design.colors)) {
      if (name.startsWith('gradient/')) {
        const token = gradient[gradientAliases[name as keyof typeof gradientAliases]];
        expect(gradientToCss(token), name).toBe(value);
        continue;
      }
      expect(name in colorAliases, `alias for ${name}`).toBe(true);
      const token = colorByAlias('light', name as keyof typeof colorAliases);
      expect(sameColor(token, value), `${name}: ${token} ≠ ${value}`).toBe(true);
    }
  });

  it('every declared DARK value equals the dark token', () => {
    const darkMap: Record<string, ColorPath> = {
      bg: 'bg',
      surface: 'surface',
      'surface-2': 'surfaceSunken',
      text: 'text.primary',
      secondary: 'text.secondary',
      tertiary: 'text.tertiary',
      primary: 'brand.primary',
      'primary-glow': 'brand.glow',
      'critical-text': 'tone.critical.text',
      'warning-text': 'tone.warning.text',
      'success-text': 'tone.success.text',
      'on-primary': 'text.onPrimary',
    };
    expect(Object.keys(darkMap).sort()).toEqual(Object.keys(design.dark).sort());
    for (const [name, value] of Object.entries(design.dark)) {
      const path = darkMap[name];
      if (!path) throw new Error(`unmapped DARK.${name}`);
      expect(sameColor(colorAt('dark', path), value), `DARK.${name}`).toBe(true);
    }
  });

  it('declared type styles match the scale', () => {
    for (const [name, spec] of Object.entries(design.typography)) {
      const key = typographyAliases[name as keyof typeof typographyAliases];
      expect(key, name).toBeDefined();
      const token = typography[key];
      expect(token.size, name).toBe(parseFloat(spec.fontSize));
      expect(token.lineHeight, name).toBe(parseFloat(spec.lineHeight));
      expect(token.weight, name).toBe(spec.fontWeight);
      expect(token.tracking, name).toBeCloseTo(parseFloat(spec.letterSpacing), 6);
      expect(token.caps === true, name).toBe(spec.textTransform === 'uppercase');
    }
  });

  it('declared spacing and radii exist', () => {
    const values = new Set<number>(Object.values(space));
    for (const v of design.space) expect(values.has(v), String(v)).toBe(true);
    for (const [name, v] of Object.entries(design.radius)) {
      expect(radius[radiusAliases[name as keyof typeof radiusAliases]], name).toBe(v);
    }
  });
});

describe('aliases', () => {
  it('every colour alias resolves in both schemes', () => {
    for (const scheme of COLOR_SCHEMES) {
      for (const name of Object.keys(colorAliases) as (keyof typeof colorAliases)[]) {
        expect(typeof colorByAlias(scheme, name), name).toBe('string');
      }
    }
  });

  it('shadow aliases point at the declared shadows', () => {
    expect(shadowToCss(shadow.light[shadowAliases['shadow-2 · kart']])).toBe(
      '0 1px 2px rgba(27,25,23,0.04), 0 6px 20px rgba(27,25,23,0.05)',
    );
    expect(shadowToCss(shadow.light[shadowAliases['shadow-1']])).toBe(
      '0 1px 2px rgba(27,25,23,0.06)',
    );
  });
});

describe('typography', () => {
  it('converts em tracking to React Native points', () => {
    expect(letterSpacing(typography.display)).toBe(-0.85);
    expect(letterSpacing(typography.kicker)).toBe(0.96);
    expect(letterSpacing(typography.badge)).toBe(0.55);
    expect(letterSpacing(typography.body)).toBe(0);
  });

  it('maps weights to per-weight family names', () => {
    expect(nativeFontFamily(typography.h1, 'ios')).toBe('Geist_600SemiBold');
    expect(nativeFontFamily(typography.editorialQuote, 'android')).toBe('Lora_400Regular_Italic');
    expect(nativeFontFamily(typography.mono, 'android')).toBe('monospace');
  });

  it('keeps UI body text at 15 pt or larger (P:01 "Gövde min. 15px")', () => {
    expect(typography.body.size).toBeGreaterThanOrEqual(15);
  });
});

describe('spacing, motion, elevation, gradients', () => {
  it('space keys are 4-pt steps on a 2-pt sub-grid', () => {
    for (const [step, value] of Object.entries(space)) {
      expect(value, step).toBe(Number(step) * 4);
      expect(value % 2, step).toBe(0);
    }
  });

  it('no transition exceeds 600 ms', () => {
    for (const [name, ms] of Object.entries(duration)) {
      expect(ms, name).toBeLessThanOrEqual(MAX_DURATION);
    }
  });

  it('dark cards use a hairline ring instead of a shadow', () => {
    expect(shadowToCss(shadow.dark.card)).toBe('0 0 0 1px rgba(255,255,255,0.06)');
    expect(shadowToCss(shadow.dark.sheet)).toBe('none');
  });

  it('maps CSS angles to linear-gradient points', () => {
    expect(cssAngleToPoints(180)).toEqual({ start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } });
    expect(cssAngleToPoints(90)).toEqual({ start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } });
    const p = cssAngleToPoints(160);
    expect(p.start.x).toBeLessThan(0.5);
    expect(p.end.y).toBeGreaterThan(1);
  });

  it('dawn, night and dusk are identical in both schemes; themed gradients follow the scheme', () => {
    expect(gradientToCss(gradient.night)).toBe(
      'linear-gradient(180deg,#15153A 0%,#25266A 60%,#3B3CA8 100%)',
    );
    expect(gradientToCss(themedGradients('dark').fadeToBg)).toBe(
      'linear-gradient(180deg,rgba(20,19,17,0) 0%,#141311 45%)',
    );
    expect(gradientToCss(themedGradients('light').aiGlowTopLeft)).toBe(
      'radial-gradient(140% 100% at 0% 0%,#E4E4FA 0%,#FFFFFF 60%)',
    );
  });
});
