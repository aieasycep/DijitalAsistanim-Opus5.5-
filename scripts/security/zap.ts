/**
 * DAST gate (SECURITY_AND_PRIVACY_PLAN §4.9 "Scanning", TEST_PLAN TST-CI-08, DELIVERY_CHECKLIST
 * SG-8): the OWASP ZAP baseline scan (passive, spider + AJAX-free) against a running web or
 * backoffice server. High-risk alerts fail unless listed in `security/dast-allowlist.json` as
 * `{plugin, target, reason, expires}` (`target` is `web` or `backoffice`, or `*`).
 *
 * The scans run from `apps/{web,backoffice}/e2e/dast.spec.ts` with `DA_DAST=1`
 * (`security-nightly`), so Playwright starts each app exactly as its E2E suite does. The image is
 * pinned by digest; the container shares the host network to reach the server on 127.0.0.1.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAllowlist, splitByExpiry, type AllowEntry } from './allowlist.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DAST_ALLOWLIST_PATH = join(ROOT, 'security', 'dast-allowlist.json');
export const ZAP_IMAGE =
  'ghcr.io/zaproxy/zaproxy:2.17.0@sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef';
const REPORT_DIR = join(ROOT, 'build', 'zap');

export interface ZapAlert {
  readonly pluginid: string;
  readonly alert: string;
  /** '0' informational … '3' high. */
  readonly riskcode: string;
  readonly instances?: readonly { readonly uri?: string }[];
}

export type DastAllowEntry = AllowEntry<'plugin' | 'target'>;

export interface DastVerdict {
  readonly blocking: ZapAlert[];
  readonly allowed: ZapAlert[];
  readonly expired: DastAllowEntry[];
  readonly summary: string;
}

/** The alerts of a ZAP JSON report (`-J`): `{site: [{alerts: [...]}]}`. */
export function alertsOf(report: unknown): ZapAlert[] {
  const sites = (report as { site?: unknown } | null)?.site;
  if (!Array.isArray(sites)) return [];
  return sites.flatMap((s) => {
    const alerts = (s as { alerts?: unknown }).alerts;
    return Array.isArray(alerts) ? (alerts as ZapAlert[]) : [];
  });
}

export function evaluateZap(
  alerts: readonly ZapAlert[],
  target: string,
  allowlist: readonly DastAllowEntry[],
  now: Date,
): DastVerdict {
  const { live, expired } = splitByExpiry(allowlist, now);
  const blocking: ZapAlert[] = [];
  const allowed: ZapAlert[] = [];
  for (const alert of alerts) {
    if (alert.riskcode !== '3') continue;
    const excused = live.some(
      (e) => e.plugin === alert.pluginid && (e.target === target || e.target === '*'),
    );
    (excused ? allowed : blocking).push(alert);
  }
  const lines = [
    ...blocking.map(
      (a) =>
        `blocking ${a.pluginid} ${a.alert} (${String(a.instances?.length ?? 0)} instance(s), e.g. ${a.instances?.[0]?.uri ?? '-'})`,
    ),
    ...allowed.map((a) => `allowed  ${a.pluginid} ${a.alert}`),
    ...expired.map((e) => `expired allow-list entry ${e.plugin} (${e.target}) on ${e.expires}`),
  ];
  return { blocking, allowed, expired, summary: lines.join('\n') || 'no high-risk alerts' };
}

/** Runs the baseline scan against `url` and evaluates its report (`build/zap/<target>.json`). */
export function zapBaseline(options: {
  readonly url: string;
  readonly target: 'web' | 'backoffice';
  readonly minutes?: number;
}): DastVerdict {
  mkdirSync(REPORT_DIR, { recursive: true });
  // The image runs as its own `zap` user and writes the report into the mounted directory.
  chmodSync(REPORT_DIR, 0o777);
  const report = `${options.target}.json`;
  const run = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'host',
      '-v',
      `${REPORT_DIR}:/zap/wrk:rw`,
      ZAP_IMAGE,
      'zap-baseline.py',
      '-t',
      options.url,
      '-m',
      String(options.minutes ?? 2),
      '-J',
      report,
      '-I',
    ],
    { stdio: ['ignore', 'inherit', 'inherit'], timeout: 20 * 60_000 },
  );
  if (run.error !== undefined) throw run.error;
  // 0 pass, 1 FAIL rules, 2 warnings (ignored with -I); 3 = the scan itself failed.
  if (run.status === 3 || !existsSync(join(REPORT_DIR, report)))
    throw new Error(
      `ZAP baseline did not complete for ${options.url} (exit ${String(run.status)})`,
    );
  const alerts = alertsOf(JSON.parse(readFileSync(join(REPORT_DIR, report), 'utf8')) as unknown);
  return evaluateZap(
    alerts,
    options.target,
    readAllowlist(DAST_ALLOWLIST_PATH, ['plugin', 'target'], 'dast'),
    new Date(),
  );
}
