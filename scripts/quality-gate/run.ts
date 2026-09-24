/**
 * Quality gate (master prompt §100, §133; plan ruling R-17).
 * Scans product sources for work markers, unfinished-feature copy, banned product claims and
 * positive "unlimited" claims. Exits 1 when anything is found.
 *
 * Usage: node scripts/quality-gate/run.ts [--root <dir>]
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCOPES = ['apps', 'packages', 'supabase', 'scripts', '.github'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  '.expo',
  'dist',
  'coverage',
  'generated',
  'ios',
  'android',
  '.expo-export',
  'playwright-report',
  'test-results',
  '.temp',
  '.branches',
]);
const SKIP_PATHS = ['scripts/quality-gate/'];
const TEXT_EXT =
  /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|sql|md|yml|yaml|toml|swift|kt|kts|xml|html|css|txt|sh)$/i;

/** JSX/TS prop names and CSS selectors that contain the word but are not copy. */
const NON_COPY_PLACEHOLDER =
  /\bplaceholder(TextColor)?\s*[=:?]|::placeholder|\bplaceholder:[a-z-]/g;

export interface Finding {
  file: string;
  line: number;
  rule: string;
  text: string;
}

function loadList(file: string): RegExp[] {
  return readFileSync(join(HERE, file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map((l) => new RegExp(l, 'iu'));
}

const RETIRED_SCOPES = ['apps/', 'packages/', 'supabase/'];

interface AllowEntry {
  path: string;
  line: string;
}

function loadAllow(): AllowEntry[] {
  return readFileSync(join(HERE, 'quality-gate.allow'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'))
    .map((l) => {
      const [path = '', line = '', why = ''] = l.split('|').map((s) => s.trim());
      if (why === '') throw new Error(`quality-gate.allow entry without justification: ${l}`);
      return { path, line };
    });
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (TEXT_EXT.test(name)) yield full;
  }
}

/** "sınırsız"/"unlimited" are allowed only when negated (fair-use copy). */
const UNLIMITED = /\b(sınırsız|unlimited)\b/iu;
const NEGATION = /(değil|olmayan|yok|never|not|no\s|isn't|aren't|asla|hiçbir)/iu;

export function scan(root: string): Finding[] {
  const patterns = loadList('banned-markers.txt');
  const retired = loadList('retired-names.txt');
  const allow = loadAllow();
  const findings: Finding[] = [];
  for (const scope of SCOPES) {
    const base = join(root, scope);
    if (!existsSync(base)) continue;
    for (const file of walk(base)) {
      const rel = relative(root, file).replaceAll('\\', '/');
      if (SKIP_PATHS.some((p) => rel.startsWith(p))) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((raw, i) => {
        const allowed = allow.some((a) => rel.includes(a.path) && raw.includes(a.line));
        if (allowed) return;
        const line = raw.replace(NON_COPY_PLACEHOLDER, '');
        const hit = patterns.find((re) => re.test(line));
        const retiredHit = RETIRED_SCOPES.some((p) => rel.startsWith(p))
          ? retired.find((re) => re.test(line))
          : undefined;
        if (retiredHit) {
          findings.push({
            file: rel,
            line: i + 1,
            rule: `retired-name:${retiredHit.source}`,
            text: raw.trim().slice(0, 160),
          });
        } else if (hit) {
          findings.push({
            file: rel,
            line: i + 1,
            rule: hit.source,
            text: raw.trim().slice(0, 160),
          });
        } else if (UNLIMITED.test(line) && !NEGATION.test(line)) {
          findings.push({
            file: rel,
            line: i + 1,
            rule: 'positive-unlimited-claim',
            text: raw.trim().slice(0, 160),
          });
        }
      });
    }
  }
  return findings;
}

function main(): void {
  const idx = process.argv.indexOf('--root');
  const root = idx > -1 ? (process.argv[idx + 1] ?? process.cwd()) : join(HERE, '..', '..');
  const findings = scan(root);
  for (const f of findings) console.error(`${f.file}:${f.line}  [${f.rule}]  ${f.text}`);
  if (findings.length > 0) {
    console.error(`\nquality-gate: ${findings.length} finding(s).`);
    process.exit(1);
  }
  console.info('quality-gate: clean');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
