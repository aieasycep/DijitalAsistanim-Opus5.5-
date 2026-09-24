/**
 * Deno tasks for the Edge Functions (IMPLEMENTATION_PLAN T-3.01 `C-FN`), using the repo-pinned Deno
 * (`node_modules/.bin/deno`, 2.1.4 = the Supabase edge runtime):
 * - `check`: `deno check` of each function entrypoint with its own generated `deno.json`, then of
 *   every module and test with the workspace config;
 * - `lint`:  `deno lint` plus `check-guards.ts` (service-client allow-list, model-ID literals);
 * - `test`:  `deno test` with env and read permissions only — no network, so a test can never reach
 *   a real provider.
 *
 * Usage: node scripts/functions/deno-tasks.ts <check|lint|test> [extra deno args]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
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

function main(): void {
  const [task, ...extra] = process.argv.slice(2);
  if (task === 'check') check(extra);
  else if (task === 'lint') lint(extra);
  else if (task === 'test') test(extra);
  else {
    console.error('usage: node scripts/functions/deno-tasks.ts <check|lint|test>');
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
