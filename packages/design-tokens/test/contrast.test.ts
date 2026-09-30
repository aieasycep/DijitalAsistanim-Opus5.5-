import { describe, expect, it } from 'vitest';
import {
  COLOR_SCHEMES,
  DECORATIVE_ONLY,
  MIN_CONTRAST,
  colorAt,
  composite,
  contrastPairs,
  contrastRatio,
  flattenColors,
  pairContrast,
  parseColor,
  toHex,
  type ColorPath,
  type ColorSchemeName,
  type ContrastPair,
} from '../src/index.ts';

const cases = contrastPairs.flatMap((pair) =>
  COLOR_SCHEMES.map((scheme): [string, ContrastPair, ColorSchemeName] => [
    `${scheme} · ${pair.id}`,
    pair,
    scheme,
  ]),
);

describe('WCAG contrast of every listed pair, both schemes', () => {
  it.each(cases)('%s', (_label, pair, scheme) => {
    const ratio = pairContrast(scheme, pair);
    expect(ratio, `${pair.kind} needs ${String(MIN_CONTRAST[pair.kind])}:1`).toBeGreaterThanOrEqual(
      MIN_CONTRAST[pair.kind],
    );
  });
});

describe('pair list integrity', () => {
  it('has unique ids', () => {
    const ids = contrastPairs.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reproduces the DESIGN_AUDIT §2.15 ratios within ±0.01', () => {
    const withFixtures = contrastPairs.filter((p) => p.expected);
    expect(withFixtures.length).toBeGreaterThan(40);
    for (const pair of withFixtures) {
      for (const scheme of COLOR_SCHEMES) {
        const expected = pair.expected?.[scheme];
        if (expected === undefined) continue;
        const delta = Math.abs(pairContrast(scheme, pair) - expected);
        expect(delta, `${scheme} · ${pair.id}`).toBeLessThanOrEqual(0.01);
      }
    }
  });

  it('never uses a decorative-only token for text', () => {
    const textFg = new Set(contrastPairs.filter((p) => p.kind !== 'nontext').map((p) => p.fg));
    for (const token of DECORATIVE_ONLY) expect(textFg.has(token), token).toBe(false);
  });

  it('covers every text.* token that may carry information', () => {
    const covered = new Set(contrastPairs.filter((p) => p.kind !== 'nontext').map((p) => p.fg));
    const textTokens = flattenColors('light')
      .map(([path]) => path)
      .filter((path) => path.startsWith('text.') && !DECORATIVE_ONLY.includes(path));
    for (const token of textTokens) expect(covered.has(token), token).toBe(true);
  });

  it('checks every tone text on its own soft background', () => {
    for (const tone of ['critical', 'warning', 'success', 'info', 'neutral', 'primary']) {
      const soft = `tone.${tone}.soft` as ColorPath;
      const hit = contrastPairs.some(
        (p) =>
          p.kind === 'text' &&
          'color' in p.bg &&
          p.bg.color === soft &&
          p.fg.startsWith(`tone.${tone}.`),
      );
      expect(hit, tone).toBe(true);
    }
  });
});

describe('the accessibility fixes are needed (DESIGN_AUDIT §2.15)', () => {
  const ratio = (scheme: 'light' | 'dark', fg: ColorPath, bg: ColorPath): number =>
    contrastRatio(parseColor(colorAt(scheme, fg)), parseColor(colorAt(scheme, bg)));

  it('ink/tertiary fails AA as text in both schemes (DEV-01)', () => {
    expect(ratio('light', 'text.tertiary', 'bg')).toBeLessThan(4.5);
    expect(ratio('dark', 'text.tertiary', 'surface')).toBeLessThan(4.5);
    expect(ratio('light', 'text.tertiaryStrong', 'bg')).toBeGreaterThanOrEqual(4.5);
  });

  it('critical/text fails on critical/soft, critical/text-strong passes (DEV-02)', () => {
    expect(ratio('light', 'tone.critical.text', 'tone.critical.soft')).toBeLessThan(4.5);
    expect(ratio('light', 'tone.critical.textStrong', 'tone.critical.soft')).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it('ink/secondary fails on the segmented track (DEV-05)', () => {
    expect(ratio('light', 'text.secondary', 'surfaceTrack')).toBeLessThan(4.5);
  });
});

describe('dark mode surfaces', () => {
  it('no dark surface resolves to white', () => {
    const surfaces: ColorPath[] = [
      'bg',
      'bgEditorial',
      'surface',
      'surfaceSunken',
      'surfacePressed',
      'surfaceInk',
      'surfaceTrack',
      'plan.event',
      'toast.bg',
      'overlay.tabBar',
      'overlay.tabBarOpaque',
      'overlay.glassCard',
    ];
    for (const path of surfaces) {
      const c = composite(parseColor(colorAt('dark', path)), parseColor(colorAt('dark', 'bg')));
      expect(toHex(c), path).not.toBe('#FFFFFF');
    }
  });
});

describe('colour maths', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio(parseColor('#FFFFFF'), parseColor('#000000'))).toBeCloseTo(21, 5);
    expect(contrastRatio(parseColor('#777777'), parseColor('#777777'))).toBe(1);
  });

  it('parses the token formats and composites to 8-bit channels', () => {
    expect(parseColor('#5B5CE2')).toEqual({ r: 91, g: 92, b: 226, a: 1 });
    expect(parseColor('rgba(255,255,255,0.08)')).toEqual({ r: 255, g: 255, b: 255, a: 0.08 });
    expect(parseColor('#FFFFFF14').a).toBeCloseTo(20 / 255, 6);
    expect(toHex(composite(parseColor('rgba(255,255,255,0.08)'), parseColor('#1F1E1B')))).toBe(
      '#31302D',
    );
    expect(() => parseColor('hsl(0, 0%, 0%)')).toThrow();
  });
});
