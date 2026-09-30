/**
 * Client bundle secret scan (SECURITY_AND_PRIVACY_PLAN "Bundle scan", TST-CI-02; DELIVERY_CHECKLIST
 * QG-09; BACKOFFICE_PLAN §2.7). Greps browser-delivered build output for secret-shaped values and
 * for the name of every SERVER-ONLY key in `.env.example`. Findings print the file, the rule and a
 * redacted excerpt, never the value. Exits 1 on any finding or when a scanned directory is missing.
 *
 * Server output (`.next/server/app`, T-11.06) is checked for secret-shaped values only: its route
 * code legitimately names server-only keys, and non-production prerenders list the missing launch
 * keys by name (the web "Harici kimlik bilgisi gerekli" notice). Key names in browser code are
 * caught in `.next/static`; a secret value in a prerendered page or route is caught here.
 *
 * Usage:
 *   node scripts/security/scan-bundles.ts --dir apps/backoffice/.next/static [--dir …]
 *   node scripts/security/scan-bundles.ts --server-dir apps/web/.next/server/app [--server-dir …]
 *   node scripts/security/scan-bundles.ts            # every known app output that exists
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const TEXT_FILE = /\.(js|mjs|cjs|css|html|json|map|txt|rsc|body)$/i;
const KNOWN_OUTPUTS = [
  'apps/backoffice/.next/static',
  'apps/web/.next/static',
  'apps/mobile/.expo-export',
];
const KNOWN_SERVER_OUTPUTS = ['apps/backoffice/.next/server/app', 'apps/web/.next/server/app'];

export interface BundleFinding {
  readonly file: string;
  readonly rule: string;
  readonly excerpt: string;
}

/** Secret-shaped values (QG-09 bundle patterns). Allowed public prefixes are not matched. */
export const VALUE_PATTERNS: readonly { rule: string; pattern: RegExp }[] = [
  { rule: 'supabase-secret-key', pattern: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  { rule: 'anthropic-key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { rule: 'openai-key', pattern: /\bsk-(proj-)?[A-Za-z0-9_-]{20,}/ },
  { rule: 'revenuecat-secret', pattern: /\bsk_[A-Za-z0-9]{20,}/ },
  { rule: 'private-key', pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
  { rule: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;

/** SERVER-ONLY key names from `.env.example` (the line after a `# SERVER-ONLY` tag). */
export function serverOnlyKeys(envExample: string): string[] {
  const keys: string[] = [];
  const lines = envExample.split('\n');
  lines.forEach((line, index) => {
    if (line.trim() !== '# SERVER-ONLY') return;
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(lines[index + 1] ?? '');
    if (match?.[1] !== undefined) keys.push(match[1]);
  });
  return keys;
}

function redact(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 20);
  const before = text.slice(start, index).replace(/\s+/g, ' ');
  const hit = text.slice(index, index + length);
  const shown = hit.length <= 8 ? hit : `${hit.slice(0, 6)}…`;
  return `${before}[${shown}]`;
}

function serviceRoleJwt(text: string): { index: number; length: number } | null {
  for (const match of text.matchAll(JWT)) {
    const payload = match[1];
    if (payload === undefined) continue;
    try {
      const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
        'utf8',
      );
      if (/"role"\s*:\s*"service_role"/.test(json))
        return { index: match.index, length: match[0].length };
    } catch {
      // Not a decodable JWT payload.
    }
  }
  return null;
}

/** Scans one file's text. */
export function scanText(text: string, file: string, keyNames: readonly string[]): BundleFinding[] {
  const findings: BundleFinding[] = [];
  for (const { rule, pattern } of VALUE_PATTERNS) {
    const match = pattern.exec(text);
    if (match !== null)
      findings.push({ file, rule, excerpt: redact(text, match.index, match[0].length) });
  }
  const jwt = serviceRoleJwt(text);
  if (jwt !== null)
    findings.push({ file, rule: 'service-role-jwt', excerpt: redact(text, jwt.index, jwt.length) });
  for (const key of keyNames) {
    const match = new RegExp(`\\b${key}\\b`).exec(text);
    if (match !== null) {
      findings.push({
        file,
        rule: `server-only-name:${key}`,
        excerpt: redact(text, match.index, key.length),
      });
    }
  }
  return findings;
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (TEXT_FILE.test(name)) yield full;
  }
}

export function scanDirectories(
  dirs: readonly string[],
  keyNames: readonly string[],
  serverDirs: readonly string[] = [],
): { findings: BundleFinding[]; missing: string[]; files: number } {
  const findings: BundleFinding[] = [];
  const missing: string[] = [];
  let files = 0;
  const targets = [
    ...dirs.map((dir) => ({ dir, server: false })),
    ...serverDirs.map((dir) => ({ dir, server: true })),
  ];
  for (const { dir, server } of targets) {
    if (!existsSync(dir)) {
      missing.push(dir);
      continue;
    }
    for (const file of walk(dir)) {
      files += 1;
      const names = server ? [] : keyNames;
      findings.push(...scanText(readFileSync(file, 'utf8'), relative(ROOT, file), names));
    }
  }
  return { findings, missing, files };
}

function main(): void {
  const args = process.argv.slice(2);
  const explicit: string[] = [];
  const explicitServer: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i + 1];
    if ((args[i] === '--dir' || args[i] === '--server-dir') && value !== undefined) {
      (args[i] === '--dir' ? explicit : explicitServer).push(resolve(process.cwd(), value));
      i += 1;
    }
  }
  const useKnown = explicit.length === 0 && explicitServer.length === 0;
  const existing = (list: readonly string[]) =>
    list.map((dir) => join(ROOT, dir)).filter((dir) => existsSync(dir));
  const dirs = useKnown ? existing(KNOWN_OUTPUTS) : explicit;
  const serverDirs = useKnown ? existing(KNOWN_SERVER_OUTPUTS) : explicitServer;
  if (dirs.length === 0 && serverDirs.length === 0) {
    console.error('scan-bundles: no build output to scan (build an app first).');
    process.exit(1);
  }
  const keys = serverOnlyKeys(readFileSync(join(ROOT, '.env.example'), 'utf8'));
  const { findings, missing, files } = scanDirectories(dirs, keys, serverDirs);
  for (const dir of missing) console.error(`scan-bundles: missing ${relative(ROOT, dir)}`);
  for (const f of findings) console.error(`${f.file}  [${f.rule}]  …${f.excerpt}`);
  if (findings.length > 0 || missing.length > 0) {
    console.error(`\nscan-bundles: ${String(findings.length)} finding(s).`);
    process.exit(1);
  }
  console.info(
    `scan-bundles: clean · ${String(files)} files · ${String(keys.length)} server-only names · ${[...dirs, ...serverDirs].map((d) => relative(ROOT, d)).join(', ')}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
