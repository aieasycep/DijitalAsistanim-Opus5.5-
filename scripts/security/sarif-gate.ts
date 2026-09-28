/**
 * SAST gate (TEST_PLAN TST-CI-08, DELIVERY_CHECKLIST SG-8): CodeQL uploads its SARIF to code
 * scanning, and this gate fails the nightly run on any result whose rule has a
 * `security-severity` of 7.0 or more (GitHub's high and critical), unless the rule and path are in
 * `security/sast-allowlist.json` as `{rule, path, reason, expires}` (`path` may end with `*`).
 *
 * Usage: node scripts/security/sarif-gate.ts <file.sarif> [...]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAllowlist, splitByExpiry, type AllowEntry } from './allowlist.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SAST_ALLOWLIST_PATH = join(ROOT, 'security', 'sast-allowlist.json');
export const HIGH_SEVERITY = 7.0;

export interface SastFinding {
  readonly rule: string;
  readonly severity: number;
  readonly path: string;
  readonly line: number | null;
  readonly message: string;
}

export type SastAllowEntry = AllowEntry<'rule' | 'path'>;

interface SarifRule {
  readonly id?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}

interface SarifRun {
  readonly tool?: {
    readonly driver?: { readonly rules?: readonly SarifRule[] };
    readonly extensions?: readonly { readonly rules?: readonly SarifRule[] }[];
  };
  readonly results?: readonly {
    readonly ruleId?: string;
    readonly rule?: { readonly id?: string };
    readonly message?: { readonly text?: string };
    readonly locations?: readonly {
      readonly physicalLocation?: {
        readonly artifactLocation?: { readonly uri?: string };
        readonly region?: { readonly startLine?: number };
      };
    }[];
  }[];
}

/** Every result with its rule's numeric `security-severity` (0 when the rule has none). */
export function findingsOf(sarif: unknown): SastFinding[] {
  const runs = (sarif as { runs?: readonly SarifRun[] } | null)?.runs ?? [];
  return runs.flatMap((run) => {
    const severity = new Map<string, number>();
    const rules = [
      ...(run.tool?.driver?.rules ?? []),
      ...(run.tool?.extensions ?? []).flatMap((e) => e.rules ?? []),
    ];
    for (const rule of rules) {
      if (rule.id === undefined) continue;
      severity.set(rule.id, Number(rule.properties?.['security-severity'] ?? 0) || 0);
    }
    return (run.results ?? []).map((r) => {
      const rule = r.ruleId ?? r.rule?.id ?? '';
      const location = r.locations?.[0]?.physicalLocation;
      return {
        rule,
        severity: severity.get(rule) ?? 0,
        path: location?.artifactLocation?.uri ?? '',
        line: location?.region?.startLine ?? null,
        message: r.message?.text ?? '',
      };
    });
  });
}

function pathMatches(pattern: string, path: string): boolean {
  return pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : pattern === path;
}

export function evaluateSarif(
  findings: readonly SastFinding[],
  allowlist: readonly SastAllowEntry[],
  now: Date,
): { blocking: SastFinding[]; allowed: SastFinding[]; expired: SastAllowEntry[] } {
  const { live, expired } = splitByExpiry(allowlist, now);
  const blocking: SastFinding[] = [];
  const allowed: SastFinding[] = [];
  for (const f of findings) {
    if (f.severity < HIGH_SEVERITY) continue;
    const excused = live.some((e) => e.rule === f.rule && pathMatches(e.path, f.path));
    (excused ? allowed : blocking).push(f);
  }
  return { blocking, allowed, expired };
}

function main(): void {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new Error('usage: sarif-gate.ts <file.sarif> [...]');
  const findings = files.flatMap((f) => findingsOf(JSON.parse(readFileSync(f, 'utf8')) as unknown));
  const verdict = evaluateSarif(
    findings,
    readAllowlist(SAST_ALLOWLIST_PATH, ['rule', 'path'], 'sast'),
    new Date(),
  );
  const where = (f: SastFinding) => `${f.path}${f.line === null ? '' : `:${String(f.line)}`}`;
  for (const f of verdict.allowed) console.info(`allowed  ${f.rule} ${where(f)}`);
  for (const e of verdict.expired)
    console.error(`expired allow-list entry ${e.rule} (${e.path}) on ${e.expires}`);
  for (const f of verdict.blocking)
    console.error(`blocking ${f.rule} (${String(f.severity)}) ${where(f)}: ${f.message}`);
  if (verdict.blocking.length > 0 || verdict.expired.length > 0) process.exit(1);
  console.info(
    `sarif-gate: no high-severity results in ${String(findings.length)} (${String(verdict.allowed.length)} allowed)`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
