/**
 * Env split and security-header audit (IMPLEMENTATION_PLAN T-11.06; SECURITY_AND_PRIVACY_PLAN
 * CTL-3.9 "Enforcement", CTL-3.18; TEST_PLAN QG-09, TST-CI-02; M§7, M§152).
 *
 * 1. `.env.example` tags: no `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` key is tagged SERVER-ONLY, and every
 *    SERVER-ONLY key name is collected for the checks below.
 * 2. Client env schemas never name a SERVER-ONLY key: the `expo_client` / `next_client` key lists of
 *    `@da/validation` (`ENV_KEYS`), the web client schema (`apps/web/src/env/client*.ts`), the
 *    mobile env reader and the backoffice `CLIENT_SHAPE`.
 * 3. Client code never names a SERVER-ONLY key: every mobile source file and every web / backoffice
 *    module marked `'use client'`.
 * 4. Both Next apps set the CTL-3.18 headers in their config / proxy sources (HSTS, nosniff,
 *    X-Frame-Options DENY, COOP, Permissions-Policy, Referrer-Policy, a CSP with
 *    `frame-ancestors 'none'`; the backoffice also `noindex`, `no-store` and CORP).
 *
 * Findings name files, rules and key names, never values. Exits 1 on any finding.
 *
 * Usage: node scripts/security/check-env-split.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverOnlyKeys } from './scan-bundles.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');

export interface EnvFinding {
  readonly file: string;
  readonly rule: string;
  readonly detail: string;
}

const PUBLIC_PREFIX = /^(NEXT_PUBLIC_|EXPO_PUBLIC_)/;

/** Tag of every key in `.env.example` (the comment line right above it). */
export function envTags(envExample: string): Map<string, string> {
  const tags = new Map<string, string>();
  const lines = envExample.split('\n');
  lines.forEach((line, index) => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match?.[1] === undefined) return;
    const tag = /^#\s*(SERVER-ONLY|client-safe|build-time)\s*$/.exec(lines[index - 1] ?? '');
    tags.set(match[1], tag?.[1] ?? 'untagged');
  });
  return tags;
}

export function checkEnvExample(envExample: string): EnvFinding[] {
  const findings: EnvFinding[] = [];
  for (const [key, tag] of envTags(envExample)) {
    if (PUBLIC_PREFIX.test(key) && tag === 'SERVER-ONLY') {
      findings.push({ file: '.env.example', rule: 'public-key-tagged-server-only', detail: key });
    } else if (tag === 'untagged') {
      findings.push({ file: '.env.example', rule: 'untagged-key', detail: key });
    }
  }
  return findings;
}

/** Source without comments (they never reach a bundle); URLs inside strings survive. */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** SERVER-ONLY names used in `text` outside comments (whole identifiers only). */
export function serverNamesIn(text: string, serverKeys: readonly string[]): string[] {
  const code = stripComments(text);
  return serverKeys.filter((key) => new RegExp(`(?<![A-Z0-9_])${key}(?![A-Z0-9_])`).test(code));
}

/** Client key lists (schema keys) that contain a SERVER-ONLY name. */
export function checkClientKeys(
  source: string,
  keys: readonly string[],
  serverKeys: readonly string[],
): EnvFinding[] {
  const server = new Set(serverKeys);
  return keys
    .filter((key) => server.has(key))
    .map((key) => ({ file: source, rule: 'client-schema-server-key', detail: key }));
}

/** The text of `export const NAME = { … };` / `const NAME = { … };` (brace-balanced). */
export function objectBlock(text: string, name: string): string | null {
  const start = new RegExp(
    `(?:export\\s+)?const\\s+${name}\\s*(?::[^=]+)?=\\s*(?:z\\.object\\()?\\{`,
  ).exec(text);
  if (start === null) return null;
  let depth = 0;
  for (let i = start.index + start[0].length - 1; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(start.index, i + 1);
    }
  }
  return null;
}

export const REQUIRED_HEADERS: Readonly<Record<'web' | 'backoffice', readonly string[]>> = {
  web: [
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Cross-Origin-Opener-Policy',
    'Permissions-Policy',
    'Referrer-Policy',
    'Content-Security-Policy',
    "frame-ancestors 'none'",
  ],
  backoffice: [
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Cross-Origin-Opener-Policy',
    'Cross-Origin-Resource-Policy',
    'Permissions-Policy',
    'Referrer-Policy',
    'X-Robots-Tag',
    'no-store',
    'Content-Security-Policy',
    "frame-ancestors 'none'",
  ],
};

export function checkHeaders(app: 'web' | 'backoffice', sources: readonly string[]): EnvFinding[] {
  const text = sources.join('\n');
  const findings: EnvFinding[] = REQUIRED_HEADERS[app]
    .filter((header) => !text.toLowerCase().includes(header.toLowerCase()))
    .map((header) => ({ file: `apps/${app}`, rule: 'security-header-missing', detail: header }));
  if (!/X-Frame-Options['"]?\s*[,:]\s*(?:value:\s*)?['"]DENY['"]/i.test(text)) {
    findings.push({
      file: `apps/${app}`,
      rule: 'security-header-value',
      detail: 'X-Frame-Options DENY',
    });
  }
  if (!text.includes('nosniff')) {
    findings.push({ file: `apps/${app}`, rule: 'security-header-value', detail: 'nosniff' });
  }
  return findings;
}

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') || name === '__tests__' || name === 'test')
      continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|jsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) yield full;
  }
}

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

export async function runChecks(root: string = ROOT): Promise<EnvFinding[]> {
  const envExample = read(join(root, '.env.example'));
  const serverKeys = serverOnlyKeys(envExample);
  const findings: EnvFinding[] = [...checkEnvExample(envExample)];

  // 2. Client env schemas.
  const validation = (await import(join(root, 'packages/validation/src/env.ts'))) as {
    ENV_KEYS: Readonly<Record<string, readonly string[]>>;
  };
  for (const scope of ['expo_client', 'next_client']) {
    findings.push(
      ...checkClientKeys(
        `@da/validation ENV_KEYS.${scope}`,
        validation.ENV_KEYS[scope] ?? [],
        serverKeys,
      ),
    );
  }
  const clientSources = [
    'apps/web/src/env/client-schema.ts',
    'apps/web/src/env/client.ts',
    'apps/mobile/src/lib/env.ts',
  ];
  for (const file of clientSources) {
    for (const key of serverNamesIn(read(join(root, file)), serverKeys)) {
      findings.push({ file, rule: 'client-schema-server-key', detail: key });
    }
  }
  const backofficeClient = objectBlock(
    read(join(root, 'apps/backoffice/src/env.ts')),
    'CLIENT_SHAPE',
  );
  for (const key of serverNamesIn(backofficeClient ?? '', serverKeys)) {
    findings.push({
      file: 'apps/backoffice/src/env.ts',
      rule: 'client-schema-server-key',
      detail: key,
    });
  }

  // 3. Client code.
  const clientFiles = [
    ...walk(join(root, 'apps/mobile/src')),
    ...walk(join(root, 'apps/mobile/app')),
    ...[...walk(join(root, 'apps/web/src')), ...walk(join(root, 'apps/backoffice/src'))].filter(
      (file) => /^\s*['"]use client['"];?/.test(read(file)),
    ),
  ];
  for (const file of clientFiles) {
    for (const key of serverNamesIn(read(file), serverKeys)) {
      findings.push({ file: relative(root, file), rule: 'client-code-server-key', detail: key });
    }
  }

  // 4. Security headers.
  findings.push(
    ...checkHeaders('web', [
      read(join(root, 'apps/web/next.config.ts')),
      read(join(root, 'apps/web/src/proxy.ts')),
      read(join(root, 'apps/web/src/lib/csp.ts')),
    ]),
    ...checkHeaders('backoffice', [
      read(join(root, 'apps/backoffice/next.config.ts')),
      read(join(root, 'apps/backoffice/src/proxy.ts')),
      read(join(root, 'apps/backoffice/src/server/security-headers.ts')),
    ]),
  );
  return findings;
}

async function main(): Promise<void> {
  const findings = await runChecks();
  for (const f of findings) console.error(`${f.file}  [${f.rule}]  ${f.detail}`);
  if (findings.length > 0) {
    console.error(`\ncheck-env-split: ${String(findings.length)} finding(s).`);
    process.exit(1);
  }
  console.info('check-env-split: clean · client env schemas, client code and security headers');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
