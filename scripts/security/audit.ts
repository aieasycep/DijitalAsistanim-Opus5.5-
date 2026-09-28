/**
 * Dependency audit gate (SECURITY_AND_PRIVACY_PLAN §4.9 "Audit", TEST_PLAN TST-CI-03, DELIVERY_CHECKLIST
 * SG-8): `pnpm audit --json` over the whole workspace; every high or critical advisory must be fixed
 * or listed in `security/audit-allowlist.json` as `{advisory, package, reason, expires}` (see
 * `allowlist.ts`). An expired entry fails the gate even when its advisory is gone; an entry that no
 * longer matches anything is reported for removal.
 *
 * Usage: node scripts/security/audit.ts [--report <audit.json>] (reads a saved report instead of
 * running `pnpm audit`)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAllowlist, splitByExpiry, type AllowEntry } from './allowlist.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ALLOWLIST_PATH = join(ROOT, 'security', 'audit-allowlist.json');
const BLOCKING = new Set(['high', 'critical']);

export interface AuditAdvisory {
  readonly id: number | string;
  readonly github_advisory_id?: string;
  readonly module_name: string;
  readonly severity: string;
  readonly title: string;
  readonly patched_versions?: string;
}

/** `advisory` is the GitHub advisory id (GHSA-…) or the npm advisory id. */
export type AuditAllowEntry = AllowEntry<'advisory' | 'package'>;

export interface AuditVerdict {
  readonly blocking: AuditAdvisory[];
  readonly allowed: AuditAdvisory[];
  readonly expired: AuditAllowEntry[];
  readonly unused: AuditAllowEntry[];
}

/** The advisories of a `pnpm audit --json` report (npm v6 shape: `{advisories: {id: {...}}}`). */
export function advisoriesOf(report: unknown): AuditAdvisory[] {
  const advisories = (report as { advisories?: unknown } | null)?.advisories;
  if (advisories === null || typeof advisories !== 'object') return [];
  return Object.values(advisories as Record<string, AuditAdvisory>);
}

function matches(entry: AuditAllowEntry, advisory: AuditAdvisory): boolean {
  return (
    entry.package === advisory.module_name &&
    (entry.advisory === advisory.github_advisory_id || entry.advisory === String(advisory.id))
  );
}

export function evaluate(
  advisories: readonly AuditAdvisory[],
  allowlist: readonly AuditAllowEntry[],
  now: Date,
): AuditVerdict {
  const { live, expired } = splitByExpiry(allowlist, now);
  const blocking: AuditAdvisory[] = [];
  const allowed: AuditAdvisory[] = [];
  for (const advisory of advisories) {
    if (!BLOCKING.has(advisory.severity)) continue;
    (live.some((e) => matches(e, advisory)) ? allowed : blocking).push(advisory);
  }
  const unused = live.filter((e) => !advisories.some((a) => matches(e, a)));
  return { blocking, allowed, expired, unused };
}

export function describe(advisory: AuditAdvisory): string {
  const id = advisory.github_advisory_id ?? String(advisory.id);
  const fix =
    advisory.patched_versions === undefined ? '' : ` (fixed in ${advisory.patched_versions})`;
  return `${advisory.severity} ${advisory.module_name} ${id}: ${advisory.title}${fix}`;
}

function runAudit(): unknown {
  // `pnpm audit` exits 1 whenever it finds anything; the JSON on stdout is the result.
  const run = spawnSync('pnpm', ['audit', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error !== undefined) throw run.error;
  try {
    return JSON.parse(run.stdout) as unknown;
  } catch {
    throw new Error(`pnpm audit did not return JSON (exit ${String(run.status)}): ${run.stderr}`);
  }
}

function main(): void {
  const i = process.argv.indexOf('--report');
  const path = i === -1 ? undefined : process.argv[i + 1];
  const report =
    path === undefined ? runAudit() : (JSON.parse(readFileSync(path, 'utf8')) as unknown);
  const allowlist = readAllowlist(ALLOWLIST_PATH, ['advisory', 'package'], 'audit');
  const verdict = evaluate(advisoriesOf(report), allowlist, new Date());
  for (const a of verdict.allowed) console.info(`allowed  ${describe(a)}`);
  for (const e of verdict.unused)
    console.warn(`unused allow-list entry ${e.advisory} (${e.package}): remove it`);
  for (const e of verdict.expired)
    console.error(`expired allow-list entry ${e.advisory} (${e.package}) on ${e.expires}`);
  for (const a of verdict.blocking) console.error(`blocking ${describe(a)}`);
  if (verdict.blocking.length > 0 || verdict.expired.length > 0) {
    console.error(
      `\naudit: ${String(verdict.blocking.length)} blocking advisory(ies), ${String(verdict.expired.length)} expired allow-list entry(ies).`,
    );
    process.exit(1);
  }
  console.info(
    `audit: no unapproved high or critical advisories (${String(verdict.allowed.length)} allowed)`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
