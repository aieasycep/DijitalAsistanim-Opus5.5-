import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from '@jest/globals';
import { ICON_NAMES, iconComponents } from '../src/icons/index.ts';

interface Manifest {
  package: string;
  style: string;
  groups: Record<string, string[]>;
  aliases: Record<string, { source: string; reason: string }>;
  excluded: Record<string, string>;
}

const PACKAGE_DIR = join(__dirname, '..');
const GENERATED_DIR = join(PACKAGE_DIR, 'src', 'icons', 'generated');
const manifest = JSON.parse(
  readFileSync(join(PACKAGE_DIR, 'icons.manifest.json'), 'utf8'),
) as Manifest;
const names = Object.values(manifest.groups).flat();
const symbolsDir = join(
  dirname(require.resolve(`${manifest.package}/package.json`, { paths: [PACKAGE_DIR] })),
  manifest.style,
);

describe('icons.manifest.json', () => {
  it('lists each icon once', () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it('resolves every manifest name to an outline and a fill SVG', () => {
    const unresolved = names.filter((name) => {
      const source = manifest.aliases[name]?.source ?? name;
      return (
        !existsSync(join(symbolsDir, `${source}.svg`)) ||
        !existsSync(join(symbolsDir, `${source}-fill.svg`))
      );
    });
    expect(unresolved).toEqual([]);
  });

  it('aliases only names missing upstream, each with a reason', () => {
    for (const [name, alias] of Object.entries(manifest.aliases)) {
      expect(names).toContain(name);
      expect(existsSync(join(symbolsDir, `${name}.svg`))).toBe(false);
      expect(alias.reason.length).toBeGreaterThan(10);
    }
  });

  it('accounts for every icon extracted from the design (shipped or excluded with a reason)', () => {
    const used = readFileSync(
      join(PACKAGE_DIR, '..', '..', 'design', 'icons', 'used-icons.txt'),
      'utf8',
    )
      .split('\n')
      .filter((l) => l.trim() !== '');
    const accounted = new Set([
      ...(manifest.groups.design ?? []),
      ...Object.keys(manifest.excluded),
    ]);
    expect(used.filter((n) => !accounted.has(n))).toEqual([]);
    for (const name of Object.keys(manifest.excluded)) expect(names).not.toContain(name);
  });
});

describe('generated output', () => {
  it('emits exactly one component per manifest icon', () => {
    const components = readdirSync(GENERATED_DIR).filter((f) => f.endsWith('.tsx'));
    expect(components).toHaveLength(names.length);
    expect([...ICON_NAMES]).toEqual([...names].sort());
    expect(Object.keys(iconComponents)).toHaveLength(names.length);
  });

  it('icons.data.json holds viewBox, outline and fill path data for exactly the manifest icons', () => {
    const data = JSON.parse(readFileSync(join(PACKAGE_DIR, 'icons.data.json'), 'utf8')) as {
      icons: Record<string, { viewBox: string; regular: string; fill: string }>;
    };
    expect(Object.keys(data.icons)).toEqual([...names].sort());
    const pathData = /^[Mm][-\d.,A-Za-z ]+$/;
    const malformed = Object.entries(data.icons)
      .filter(
        ([, icon]) =>
          icon.viewBox !== '0 -960 960 960' ||
          !pathData.test(icon.regular) ||
          !pathData.test(icon.fill),
      )
      .map(([name]) => name);
    expect(malformed).toEqual([]);
  });
});

describe('gen-icons is deterministic', () => {
  const tempDirs: string[] = [];
  afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  function generateInto(): string {
    const dir = mkdtempSync(join(tmpdir(), 'da-icons-'));
    tempDirs.push(dir);
    execFileSync(process.execPath, [join(PACKAGE_DIR, 'scripts', 'gen-icons.ts'), '--out', dir], {
      stdio: 'pipe',
    });
    return dir;
  }

  it('two runs are byte-identical and match the committed files', () => {
    const first = generateInto();
    const second = generateInto();
    const files = [
      'icons.data.json',
      ...readdirSync(join(first, 'src', 'icons', 'generated')).map(
        (f) => `src/icons/generated/${f}`,
      ),
    ];
    expect(files).toHaveLength(names.length + 2);
    for (const rel of files) {
      const a = readFileSync(join(first, rel));
      expect(a.equals(readFileSync(join(second, rel)))).toBe(true);
      expect(a.equals(readFileSync(join(PACKAGE_DIR, rel)))).toBe(true);
    }
  });
});
