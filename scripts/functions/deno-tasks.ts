/**
 * Deno tasks for the Edge Functions (IMPLEMENTATION_PLAN T-3.01 `C-FN`), using the repo-pinned Deno
 * (`node_modules/.bin/deno`, 2.1.4 = the Supabase edge runtime):
 * - `check`: `deno check` of each function entrypoint with its own generated `deno.json`, then of
 *   every module and test with the workspace config;
 * - `lint`:  `deno lint` plus `check-guards.ts` (service-client allow-list, model-ID literals);
 * - `test`:  `deno test` with env and read permissions only — no network, so a test can never reach
 *   a real provider;
 * - `coverage`: `test` with `--coverage`, then the line coverage of `_shared/` (tests and test
 *   helpers excluded) from the lcov report; exits 1 below `SHARED_LINE_THRESHOLD` (T-12.04).
 *
 * Usage: node scripts/functions/deno-tasks.ts <check|lint|test|coverage> [extra deno args]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFunctions } from './check-guards.ts';
import { FUNCTION_NAMES, FUNCTIONS_DIR, REPO_ROOT } from './sync-import-maps.ts';

const DENO = join(
  REPO_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'deno.cmd' : 'deno',
);
const WORKSPACE_CONFIG = join(FUNCTIONS_DIR, 'deno.json');

function deno(args: string[]): void {
  const result = spawnSync(existsSync(DENO) ? DENO : 'deno', args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, DENO_NO_UPDATE_CHECK: '1', NO_COLOR: process.env.NO_COLOR ?? '' },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (name.endsWith('.ts')) out.push(relative(REPO_ROOT, full));
  }
  return out.sort();
}

function check(extra: string[]): void {
  for (const fn of FUNCTION_NAMES) {
    const dir = join(FUNCTIONS_DIR, fn);
    deno([
      'check',
      '--config',
      join(dir, 'deno.json'),
      relative(REPO_ROOT, join(dir, 'index.ts')),
      ...extra,
    ]);
  }
  deno(['check', '--config', WORKSPACE_CONFIG, ...tsFiles(FUNCTIONS_DIR), ...extra]);
}

function lint(extra: string[]): void {
  deno(['lint', '--config', WORKSPACE_CONFIG, relative(REPO_ROOT, FUNCTIONS_DIR), ...extra]);
  const findings = scanFunctions();
  for (const f of findings)
    console.error(`supabase/functions/${f.file}:${f.line}  [${f.rule}]  ${f.text}`);
  if (findings.length > 0) process.exit(1);
  console.info('functions guards: clean');
}

function test(extra: string[]): void {
  deno([
    'test',
    '--config',
    WORKSPACE_CONFIG,
    '--allow-env',
    '--allow-read',
    '--no-prompt',
    relative(REPO_ROOT, FUNCTIONS_DIR),
    ...extra,
  ]);
}

/** T-12.04: minimum line coverage of `supabase/functions/_shared` (percent). */
export const SHARED_LINE_THRESHOLD = 80;

/** Line totals per source file from an lcov report (`SF:` … `LF:` / `LH:` … `end_of_record`). */
export function lcovLines(lcov: string): Map<string, { found: number; hit: number }> {
  const files = new Map<string, { found: number; hit: number }>();
  let current: { found: number; hit: number } | null = null;
  for (const line of lcov.split('\n')) {
    if (line.startsWith('SF:')) {
      current = { found: 0, hit: 0 };
      files.set(line.slice(3).replace(/^file:\/\//, ''), current);
    } else if (current !== null && line.startsWith('LF:')) {
      current.found = Number(line.slice(3));
    } else if (current !== null && line.startsWith('LH:')) {
      current.hit = Number(line.slice(3));
    } else if (line === 'end_of_record') {
      current = null;
    }
  }
  return files;
}

/** `_shared` product sources only: no tests, no test doubles, no fixtures. */
export function isSharedSource(path: string): boolean {
  const rel = relative(join(FUNCTIONS_DIR, '_shared'), path);
  if (rel.startsWith('..')) return false;
  return !/(^|\/)(testing|fixtures|evals)\//.test(rel) && !rel.endsWith('.test.ts');
}

function coverage(extra: string[]): void {
  const dir = mkdtempSync(join(tmpdir(), 'da-deno-cov-'));
  try {
    test([`--coverage=${dir}`, ...extra]);
    const lcovFile = join(dir, 'shared.lcov');
    deno(['coverage', dir, '--lcov', `--output=${lcovFile}`]);
    let found = 0;
    let hit = 0;
    for (const [path, totals] of lcovLines(readFileSync(lcovFile, 'utf8'))) {
      if (!isSharedSource(path)) continue;
      found += totals.found;
      hit += totals.hit;
    }
    const pct = found === 0 ? 0 : (hit / found) * 100;
    console.info(
      `functions _shared line coverage: ${pct.toFixed(2)}% (${String(hit)}/${String(found)}), threshold ${String(SHARED_LINE_THRESHOLD)}%`,
    );
    if (pct < SHARED_LINE_THRESHOLD) process.exit(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(): void {
  const [task, ...extra] = process.argv.slice(2);
  if (task === 'check') check(extra);
  else if (task === 'lint') lint(extra);
  else if (task === 'test') test(extra);
  else if (task === 'coverage') coverage(extra);
  else {
    console.error('usage: node scripts/functions/deno-tasks.ts <check|lint|test|coverage>');
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
