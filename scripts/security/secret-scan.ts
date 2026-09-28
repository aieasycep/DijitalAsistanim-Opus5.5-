/**
 * Secret scan over the full git history (DELIVERY_CHECKLIST SG-2, TEST_PLAN TST-CI-01): gitleaks
 * from its pinned GitHub release tarball, verified against the release SHA-256 before it runs, and
 * cached under `node_modules/.cache/gitleaks/<version>/`. `gitleaks git` walks every commit
 * reachable in the checkout, so CI checks out with `fetch-depth: 0`; a shallow clone is refused.
 * Findings are printed redacted (rule, file, line, commit), never the secret. Exits 1 on any
 * finding or when the binary cannot be verified.
 *
 * Usage: node scripts/security/secret-scan.ts [--report <file.json>]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const GITLEAKS_VERSION = '8.30.1';

/** Release assets and their SHA-256 (`gitleaks_<version>_checksums.txt` of the release). */
export const GITLEAKS_ASSETS: Readonly<
  Record<string, { readonly asset: string; readonly sha256: string }>
> = {
  'linux-x64': {
    asset: `gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`,
    sha256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
  },
  'linux-arm64': {
    asset: `gitleaks_${GITLEAKS_VERSION}_linux_arm64.tar.gz`,
    sha256: 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080',
  },
  'darwin-x64': {
    asset: `gitleaks_${GITLEAKS_VERSION}_darwin_x64.tar.gz`,
    sha256: 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
  },
  'darwin-arm64': {
    asset: `gitleaks_${GITLEAKS_VERSION}_darwin_arm64.tar.gz`,
    sha256: 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
  },
};

export function assetFor(
  platform: string,
  arch: string,
): { asset: string; sha256: string; url: string } {
  const entry = GITLEAKS_ASSETS[`${platform}-${arch}`];
  if (entry === undefined)
    throw new Error(`gitleaks: no pinned release asset for ${platform}-${arch}`);
  return {
    ...entry,
    url: `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${entry.asset}`,
  };
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export interface LeakFinding {
  readonly RuleID?: string;
  readonly File?: string;
  readonly StartLine?: number;
  readonly Commit?: string;
}

/** One redacted line per finding (the report is written with `--redact`; values are never printed). */
export function summarize(findings: readonly LeakFinding[]): string[] {
  return findings.map(
    (f) =>
      `${f.File ?? '?'}:${String(f.StartLine ?? 0)}  [${f.RuleID ?? 'unknown'}]  commit ${(f.Commit ?? '').slice(0, 12)}`,
  );
}

/** The verified gitleaks binary (downloaded and checked on first use). */
function gitleaksBinary(): string {
  const { asset, sha256: expected, url } = assetFor(process.platform, process.arch);
  const dir = join(ROOT, 'node_modules', '.cache', 'gitleaks', GITLEAKS_VERSION);
  const bin = join(dir, 'gitleaks');
  const marker = join(dir, 'tarball.sha256');
  if (existsSync(bin) && existsSync(marker) && readFileSync(marker, 'utf8').trim() === expected)
    return bin;
  mkdirSync(dir, { recursive: true });
  const tarball = join(dir, asset);
  // curl honours HTTPS_PROXY and the system CA bundle (CI runners and the dev container).
  execFileSync('curl', ['-sSfL', '--retry', '3', '-o', tarball, url], { stdio: 'inherit' });
  const actual = sha256(readFileSync(tarball));
  if (actual !== expected) {
    rmSync(tarball, { force: true });
    throw new Error(
      `gitleaks: checksum mismatch for ${asset} (expected ${expected}, got ${actual})`,
    );
  }
  execFileSync('tar', ['-xzf', tarball, '-C', dir, 'gitleaks']);
  chmodSync(bin, 0o755);
  rmSync(tarball, { force: true });
  writeFileSync(marker, `${expected}\n`);
  return bin;
}

function main(): void {
  const args = process.argv.slice(2);
  const i = args.indexOf('--report');
  const report =
    i > -1 ? (args[i + 1] ?? '') : join(tmpdir(), `gitleaks-${String(process.pid)}.json`);
  const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  if (shallow === 'true') {
    console.error('secret-scan: shallow clone; the full history is required (fetch-depth: 0).');
    process.exit(1);
  }
  const bin = gitleaksBinary();
  const config = join(ROOT, '.gitleaks.toml');
  const ignore = join(ROOT, '.gitleaksignore');
  const run = spawnSync(
    bin,
    [
      'git',
      '--no-banner',
      '--redact',
      '--exit-code',
      '1',
      '--report-format',
      'json',
      '--report-path',
      report,
      ...(existsSync(config) ? ['--config', config] : []),
      ...(existsSync(ignore) ? ['--gitleaks-ignore-path', ignore] : []),
      ROOT,
    ],
    { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  const findings = existsSync(report)
    ? (JSON.parse(readFileSync(report, 'utf8') || '[]') as LeakFinding[])
    : [];
  if (i === -1) rmSync(report, { force: true });
  for (const line of summarize(findings)) console.error(line);
  if (run.status !== 0 || findings.length > 0) {
    console.error(
      `\nsecret-scan: ${String(findings.length)} finding(s) (gitleaks v${GITLEAKS_VERSION}).`,
    );
    process.exit(1);
  }
  console.info(`secret-scan: clean (gitleaks v${GITLEAKS_VERSION}, full history)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
