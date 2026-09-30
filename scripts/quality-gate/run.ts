/**
 * Quality gate (DELIVERY_CHECKLIST §5, QG-01…QG-27 with QG-16b, SG-1…SG-2 source checks; M§100,
 * M§133, R-17).
 * Runs every module in `checks/`, prints a console report and writes `quality-gate.json`
 * (`[{id, file, line, match}]`). Exits 1 when anything is found.
 *
 * `--self-test` runs each check against its fixture tree `fixtures/<ID>/` and requires exactly one
 * finding, with that ID, per fixture (§5.4); every declared ID must have a fixture. `pnpm quality-gate`
 * runs the self-test first.
 *
 * Usage: node scripts/quality-gate/run.ts [--self-test] [--root <dir>] [--json <file>] [--no-json]
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { code } from './checks/code.ts';
import { copy } from './checks/copy.ts';
import { database } from './checks/database.ts';
import { enforcement } from './checks/enforcement.ts';
import { i18nKeys } from './checks/i18n-keys.ts';
import { inventoryCheck } from './checks/inventory.ts';
import { markers } from './checks/markers.ts';
import { product } from './checks/product.ts';
import { repo } from './checks/repo.ts';
import { retired } from './checks/retired.ts';
import { secrets } from './checks/secrets.ts';
import { ui } from './checks/ui.ts';
import { type Check, Context, type Finding } from './lib.ts';

export type { Finding } from './lib.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, 'fixtures');

export const CHECKS: readonly Check[] = [
  markers,
  copy,
  ui,
  secrets,
  database,
  code,
  enforcement,
  repo,
  product,
  retired,
  i18nKeys,
  inventoryCheck,
];

/** Every finding of every check over the repository at `root`, sorted by id, file, line. */
export async function scan(root: string, checks: readonly Check[] = CHECKS): Promise<Finding[]> {
  const ctx = new Context(root);
  const out: Finding[] = [];
  for (const check of checks) out.push(...(await check.run(ctx)));
  return out.sort(
    (a, b) => a.id.localeCompare(b.id) || a.file.localeCompare(b.file) || a.line - b.line,
  );
}

export interface SelfTestResult {
  readonly id: string;
  readonly ok: boolean;
  readonly findings: readonly Finding[];
}

/** One run per fixture: the checks declaring the ID must report exactly one finding with that ID. */
export async function selfTest(fixtures: string = FIXTURES): Promise<SelfTestResult[]> {
  const ids = CHECKS.flatMap((c) => c.ids);
  const dirs = existsSync(fixtures) ? readdirSync(fixtures) : [];
  const results: SelfTestResult[] = [];
  for (const id of ids) {
    if (!dirs.includes(id)) {
      results.push({ id, ok: false, findings: [] });
      continue;
    }
    const owners = CHECKS.filter((c) => c.ids.includes(id));
    const findings = await scan(join(fixtures, id), owners);
    results.push({ id, ok: findings.length === 1 && findings[0]?.id === id, findings });
  }
  for (const dir of dirs)
    if (!ids.includes(dir)) results.push({ id: dir, ok: false, findings: [] });
  return results;
}

function report(findings: readonly Finding[]): void {
  let current = '';
  for (const f of findings) {
    if (f.id !== current) {
      current = f.id;
      const title = CHECKS.find((c) => c.ids.includes(f.id))?.title ?? '';
      console.error(`\n${f.id} · ${title}`);
    }
    console.error(`  ${f.file}:${f.line}  ${f.match}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i > -1 ? args[i + 1] : undefined;
  };
  const root = opt('--root') ?? join(HERE, '..', '..');
  if (args.includes('--self-test')) {
    const results = await selfTest();
    for (const r of results.filter((x) => !x.ok)) {
      const got = r.findings.map((f) => `${f.id} ${f.file}:${f.line} ${f.match}`).join('; ');
      console.error(
        `self-test ${r.id}: expected exactly one ${r.id} finding, got ${r.findings.length}${got === '' ? '' : ` (${got})`}`,
      );
    }
    const failed = results.filter((x) => !x.ok).length;
    if (failed > 0) {
      console.error(`\nquality-gate self-test: ${failed} of ${results.length} fixture(s) failed.`);
      process.exit(1);
    }
    console.info(`quality-gate self-test: ${results.length} fixtures, one finding each`);
    return;
  }
  const findings = await scan(root);
  if (!args.includes('--no-json'))
    writeFileSync(
      opt('--json') ?? join(root, 'quality-gate.json'),
      `${JSON.stringify(findings, null, 2)}\n`,
    );
  report(findings);
  if (findings.length > 0) {
    console.error(`\nquality-gate: ${findings.length} finding(s).`);
    process.exit(1);
  }
  console.info(`quality-gate: clean (${CHECKS.flatMap((c) => c.ids).length} checks)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
