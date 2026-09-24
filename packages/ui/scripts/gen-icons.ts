/**
 * Material Symbols code generation (T-1.03). Reads icons.manifest.json, resolves every name to
 * `@material-symbols/svg-400/rounded/{source}.svg` and `{source}-fill.svg` and emits:
 *   src/icons/generated/<Name>.tsx   one react-native-svg component per manifest icon
 *   src/icons/generated/index.ts     ICON_NAMES, the IconName union and the name → component map
 *   icons.data.json                  framework-neutral path data for the web/backoffice generators
 * Fails loudly (exit 1) when a name does not resolve, the SVG shape is unexpected, or the
 * manifest drifts from design/icons/used-icons.txt. Output is deterministic (sorted by name).
 *
 * Usage: node scripts/gen-icons.ts [--out <dir>]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_DIR, '..', '..');
const GENERATED_DIR = 'src/icons/generated';
const DATA_FILE = 'icons.data.json';

interface AliasEntry {
  readonly source: string;
  readonly reason: string;
}

export interface IconManifest {
  readonly package: string;
  readonly style: string;
  readonly groups: Readonly<Record<string, readonly string[]>>;
  readonly aliases: Readonly<Record<string, AliasEntry>>;
  readonly excluded: Readonly<Record<string, string>>;
}

export interface ResolvedIcon {
  readonly name: string;
  readonly source: string;
  readonly component: string;
  readonly file: string;
  readonly viewBox: string;
  readonly regular: string;
  readonly fill: string;
}

class IconError extends Error {}

const NAME = /^[a-z][a-z0-9_]*$/;
const SVG =
  /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+" viewBox="([-\d. ]+)"><path d="([^"]+)"\/><\/svg>\s*$/;

export function readManifest(packageDir = PACKAGE_DIR): IconManifest {
  return JSON.parse(readFileSync(join(packageDir, 'icons.manifest.json'), 'utf8')) as IconManifest;
}

/** All shipped icon names, sorted. Validates the manifest's internal consistency. */
export function manifestNames(manifest: IconManifest): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const [group, names] of Object.entries(manifest.groups)) {
    for (const name of names) {
      if (!NAME.test(name)) problems.push(`invalid icon name "${name}" in group ${group}`);
      const previous = seen.get(name);
      if (previous !== undefined) problems.push(`"${name}" is listed in ${previous} and ${group}`);
      seen.set(name, group);
    }
  }
  for (const [name, alias] of Object.entries(manifest.aliases)) {
    if (!seen.has(name)) problems.push(`alias "${name}" is not a manifest icon`);
    if (!NAME.test(alias.source)) problems.push(`alias "${name}" has an invalid source`);
    if (alias.reason.trim() === '') problems.push(`alias "${name}" needs a reason`);
  }
  for (const [name, reason] of Object.entries(manifest.excluded)) {
    if (seen.has(name)) problems.push(`"${name}" is both shipped and excluded`);
    if (reason.trim() === '') problems.push(`excluded "${name}" needs a reason`);
  }
  if (problems.length > 0) throw new IconError(`icons.manifest.json:\n  ${problems.join('\n  ')}`);
  return [...seen.keys()].sort();
}

/** The design extraction must be fully accounted for: shipped (group "design") or excluded. */
export function checkDesignCoverage(manifest: IconManifest, repoRoot = REPO_ROOT): void {
  const used = readFileSync(join(repoRoot, 'design', 'icons', 'used-icons.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const accounted = new Set([...(manifest.groups.design ?? []), ...Object.keys(manifest.excluded)]);
  const missing = used.filter((n) => !accounted.has(n));
  const extra = [...accounted].filter((n) => !used.includes(n));
  if (missing.length > 0 || extra.length > 0) {
    throw new IconError(
      `icons.manifest.json is out of sync with design/icons/used-icons.txt` +
        (missing.length > 0 ? `\n  not in the manifest: ${missing.join(', ')}` : '') +
        (extra.length > 0 ? `\n  not in used-icons.txt: ${extra.join(', ')}` : ''),
    );
  }
}

export function symbolsDir(manifest: IconManifest): string {
  const require = createRequire(join(PACKAGE_DIR, 'package.json'));
  return join(dirname(require.resolve(`${manifest.package}/package.json`)), manifest.style);
}

export function componentName(name: string): string {
  return `Icon${name
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}`;
}

function parseSvg(file: string): { viewBox: string; d: string } {
  const m = SVG.exec(readFileSync(file, 'utf8'));
  if (!m?.[1] || !m[2])
    throw new IconError(`unexpected SVG structure (expected one <path>): ${file}`);
  return { viewBox: m[1], d: m[2] };
}

/** Resolves every manifest icon to its outline and fill SVGs; throws listing every failure. */
export function resolveIcons(manifest: IconManifest): ResolvedIcon[] {
  const dir = symbolsDir(manifest);
  const names = manifestNames(manifest);
  const missing: string[] = [];
  const icons: ResolvedIcon[] = [];
  const components = new Map<string, string>();
  for (const name of names) {
    const source = manifest.aliases[name]?.source ?? name;
    const regularFile = join(dir, `${source}.svg`);
    const fillFile = join(dir, `${source}-fill.svg`);
    const absent = [regularFile, fillFile].filter((f) => !existsSync(f));
    if (absent.length > 0) {
      const hint = source === name ? ' (add an alias with a justified equivalent)' : '';
      missing.push(`${name} → ${absent.map((f) => f.slice(dir.length + 1)).join(', ')}${hint}`);
      continue;
    }
    const regular = parseSvg(regularFile);
    const fill = parseSvg(fillFile);
    if (regular.viewBox !== fill.viewBox) throw new IconError(`viewBox mismatch for ${name}`);
    const component = componentName(name);
    const clash = components.get(component);
    if (clash !== undefined) throw new IconError(`${name} and ${clash} both map to ${component}`);
    components.set(component, name);
    icons.push({
      name,
      source,
      component,
      file: `${component.slice('Icon'.length)}.tsx`,
      viewBox: regular.viewBox,
      regular: regular.d,
      fill: fill.d,
    });
  }
  if (missing.length > 0) {
    throw new IconError(
      `${String(missing.length)} icon(s) not found in ${manifest.package}/${manifest.style}:\n  ${missing.join('\n  ')}`,
    );
  }
  return icons;
}

function packageVersion(manifest: IconManifest): string {
  const pkg = JSON.parse(
    readFileSync(join(dirname(symbolsDir(manifest)), 'package.json'), 'utf8'),
  ) as {
    version: string;
  };
  return pkg.version;
}

function header(manifest: IconManifest, version: string): string {
  return `// Generated by @da/ui scripts/gen-icons.ts from ${manifest.package}@${version} (${manifest.style}). Do not edit; run \`pnpm --filter @da/ui icons\`.`;
}

function renderComponent(icon: ResolvedIcon, head: string): string {
  const files =
    icon.source === icon.name
      ? `\`${icon.name}\``
      : `\`${icon.name}\` (drawn from \`${icon.source}\`)`;
  const paths =
    icon.regular === icon.fill
      ? [`const PATH = '${icon.regular}';`, '']
      : [`const REGULAR = '${icon.regular}';`, `const FILLED = '${icon.fill}';`, ''];
  const d = icon.regular === icon.fill ? 'PATH' : 'filled ? FILLED : REGULAR';
  const signature =
    icon.regular === icon.fill
      ? '{ size, color, filled: _filled, ...rest }: IconGlyphProps'
      : '{ size, color, filled = false, ...rest }: IconGlyphProps';
  return [
    head,
    "import type { JSX } from 'react';",
    "import Svg, { Path } from 'react-native-svg';",
    "import type { IconGlyphProps } from '../types.ts';",
    '',
    ...paths,
    `/** Material Symbols Rounded ${files}. */`,
    `export function ${icon.component}(${signature}): JSX.Element {`,
    '  return (',
    `    <Svg width={size} height={size} viewBox="${icon.viewBox}" {...rest}>`,
    `      <Path d={${d}} fill={color} />`,
    '    </Svg>',
    '  );',
    '}',
    '',
  ].join('\n');
}

function renderRegistry(icons: ResolvedIcon[], manifest: IconManifest, head: string): string {
  const upstreamAliases = icons
    .filter((i) => i.source !== i.name)
    .map((i) => ({ icon: i, alias: componentName(i.source) }))
    .filter(({ alias }) => !icons.some((i) => i.component === alias));
  return [
    head,
    "import type { IconGlyph } from '../types.ts';",
    ...icons.map((i) => `import { ${i.component} } from './${i.file}';`),
    '',
    ...icons.map((i) => `export { ${i.component} };`),
    '',
    `/** Upstream ${manifest.package} names of aliased icons (DESIGN_AUDIT §2.12.3). */`,
    ...upstreamAliases.map(({ icon, alias }) => `export { ${icon.component} as ${alias} };`),
    '',
    '/** Every icon the product ships (icons.manifest.json), sorted. */',
    'export const ICON_NAMES = [',
    ...icons.map((i) => `  '${i.name}',`),
    '] as const;',
    '',
    'export type IconName = (typeof ICON_NAMES)[number];',
    '',
    'export const iconComponents: Readonly<Record<IconName, IconGlyph>> = {',
    ...icons.map((i) => `  ${i.name}: ${i.component},`),
    '};',
    '',
  ].join('\n');
}

function renderData(icons: ResolvedIcon[], manifest: IconManifest, version: string): string {
  const data: Record<string, { source: string; viewBox: string; regular: string; fill: string }> =
    {};
  for (const i of icons) {
    data[i.name] = { source: i.source, viewBox: i.viewBox, regular: i.regular, fill: i.fill };
  }
  const doc = {
    generatedBy: '@da/ui scripts/gen-icons.ts (do not edit; run `pnpm --filter @da/ui icons`)',
    package: manifest.package,
    version,
    style: manifest.style,
    license: 'Apache-2.0',
    icons: data,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Every generated file keyed by its path relative to the package directory. */
export function renderAll(manifest = readManifest()): Record<string, string> {
  checkDesignCoverage(manifest);
  const icons = resolveIcons(manifest);
  const version = packageVersion(manifest);
  const head = header(manifest, version);
  const files: Record<string, string> = {};
  for (const icon of icons) files[`${GENERATED_DIR}/${icon.file}`] = renderComponent(icon, head);
  files[`${GENERATED_DIR}/index.ts`] = renderRegistry(icons, manifest, head);
  files[DATA_FILE] = renderData(icons, manifest, version);
  return files;
}

function write(outDir: string, files: Record<string, string>): void {
  const generated = join(outDir, GENERATED_DIR);
  mkdirSync(generated, { recursive: true });
  const keep = new Set(Object.keys(files).map((rel) => join(outDir, rel)));
  for (const entry of readdirSync(generated)) {
    const full = join(generated, entry);
    if (!keep.has(full)) rmSync(full, { recursive: true, force: true });
  }
  for (const [rel, content] of Object.entries(files)) {
    const target = join(outDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function main(): void {
  const idx = process.argv.indexOf('--out');
  const outDir = idx > -1 ? resolve(process.argv[idx + 1] ?? '.') : PACKAGE_DIR;
  try {
    const files = renderAll();
    write(outDir, files);
    const count = Object.keys(files).filter((f) => f.endsWith('.tsx')).length;
    console.info(`gen-icons: ${String(count)} icons written to ${outDir}`);
  } catch (error) {
    if (!(error instanceof IconError)) throw error;
    console.error(`gen-icons: ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
