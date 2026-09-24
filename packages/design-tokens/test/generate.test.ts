import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { kebab, renderAll } from '../scripts/generate.ts';
import { flattenColors } from '../src/index.ts';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(PACKAGE_DIR, 'scripts', 'generate.ts');
const tempDirs: string[] = [];

function generateInto(): string {
  const dir = mkdtempSync(join(tmpdir(), 'da-tokens-'));
  tempDirs.push(dir);
  execFileSync(process.execPath, [SCRIPT, '--out', dir], { stdio: 'pipe' });
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('generate is deterministic', () => {
  const files = Object.keys(renderAll());

  it('renders the same bytes twice in-process', () => {
    expect(renderAll()).toEqual(renderAll());
  });

  it('two CLI runs produce byte-identical files', () => {
    const first = generateInto();
    const second = generateInto();
    for (const rel of files) {
      expect(readFileSync(join(second, rel)).equals(readFileSync(join(first, rel))), rel).toBe(
        true,
      );
    }
  });

  it('the committed generated files are up to date', () => {
    const rendered = renderAll();
    for (const rel of files) {
      expect(
        readFileSync(join(PACKAGE_DIR, rel), 'utf8'),
        `${rel} is stale; run pnpm generate`,
      ).toBe(rendered[rel]);
    }
  });
});

describe('tokens.css', () => {
  const css = renderAll()['generated/tokens.css'] ?? '';

  it('has the light, dark, system-dark, reduced-motion and Tailwind blocks', () => {
    expect(css).toContain(':root {\n  color-scheme: light;');
    expect(css).toContain('[data-theme="dark"] {\n  color-scheme: dark;');
    expect(css).toContain(
      '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n    color-scheme: dark;',
    );
    expect(css).toContain('@media (prefers-reduced-motion: reduce) {');
    expect(css).toContain('@theme inline {');
  });

  it('declares every colour in :root and overrides it for dark', () => {
    const [rootBlock = '', rest = ''] = css.split('[data-theme="dark"] {');
    const darkBlock = rest.split('}')[0] ?? '';
    for (const [path, value] of flattenColors('light')) {
      expect(rootBlock, path).toContain(`--da-${kebab(path)}: ${value};`);
      expect(css, path).toContain(`--color-${kebab(path)}: var(--da-${kebab(path)});`);
    }
    for (const [path, value] of flattenColors('dark')) {
      expect(darkBlock, path).toContain(`--da-${kebab(path)}: ${value};`);
    }
  });

  it('exposes the audit short names to Tailwind', () => {
    expect(css).toContain('--color-ink-3: var(--da-text-tertiary-strong);');
    expect(css).toContain('--shadow-card: var(--da-shadow-card);');
    expect(css).toContain('--text-kicker--letter-spacing: 0.08em;');
    expect(css).toContain('--ease-standard: var(--da-ease-standard);');
  });
});

describe('native outputs', () => {
  const out = renderAll();
  const paths = flattenColors('light').map(([p]) => p);

  it('native-colors.json lists every colour as light/dark hex', () => {
    const doc = JSON.parse(out['generated/native-colors.json'] ?? '{}') as {
      colors: Record<string, { light: string; dark: string }>;
    };
    expect(Object.keys(doc.colors)).toEqual(paths);
    for (const [path, c] of Object.entries(doc.colors)) {
      expect(c.light, path).toMatch(/^#[0-9A-F]{6}([0-9A-F]{2})?$/);
      expect(c.dark, path).toMatch(/^#[0-9A-F]{6}([0-9A-F]{2})?$/);
    }
    expect(doc.colors.surfaceSunken).toEqual({ light: '#F0EFEB', dark: '#FFFFFF14' });
  });

  it('WidgetColors.swift and DaColors.kt define one member per colour', () => {
    const swift = out['generated/native/WidgetColors.swift'] ?? '';
    const kotlin = out['generated/native/DaColors.kt'] ?? '';
    expect(swift.match(/public static let /g)?.length).toBe(paths.length);
    expect(kotlin.match(/ val /g)?.length).toBe(paths.length);
    expect(swift).toContain(
      'public static let textTertiaryStrong = dynamic(rgba(111, 108, 102, 255), rgba(147, 143, 135, 255))',
    );
    expect(kotlin).toContain('package expo.modules.dawidgets.generated');
    expect(kotlin).toContain(
      'val surfaceSunken = ColorProvider(day = Color(0xFFF0EFEB), night = Color(0x14FFFFFF))',
    );
  });
});
