/**
 * Static guards for the Edge Functions, run by `pnpm functions:lint`:
 * 1. `serviceClient()` (the secret-key client that bypasses RLS) may only be imported by allow-listed
 *    modules (SECURITY_AND_PRIVACY_PLAN CTL-3.6, TST-CI-10).
 * 2. No model-ID literals (`claude-…`, `gpt-…`, `voyage-…`) in function code: models come from
 *    `ai_model_config` (AI_PIPELINE_PLAN §3.7). Adapter tests and recorded fixtures are exempt.
 *
 * Usage: node scripts/functions/check-guards.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FUNCTIONS_DIR } from './sync-import-maps.ts';

export interface GuardFinding {
  readonly file: string;
  readonly line: number;
  readonly rule: 'service-client-import' | 'model-id-literal';
  readonly text: string;
}

/** Paths (relative to `supabase/functions/`) that may import `serviceClient`. */
export const SERVICE_CLIENT_ALLOW: readonly RegExp[] = [
  /^_shared\/db\/clients(\.test)?\.ts$/,
  /^_shared\/system\//,
  /^worker\//,
  /^oauth\//,
  /^webhooks-[a-z]+\//,
  /^admin-api\//,
  /^public-api\//,
  /^health\//,
  /^api\/repos\/system\//,
];

/** Any reference to `serviceClient`, or a namespace import of the clients module that could reach it. */
const SERVICE_CLIENT_IMPORT =
  /\bserviceClient\b|import\s*\*\s*as\s+\w+\s+from\s*['"][^'"]*db\/clients\.ts['"]/;
const MODEL_LITERAL = /\b(?:claude|gpt|voyage)-[a-z0-9]/i;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (name.endsWith('.ts')) yield full;
  }
}

function isAdapterTestOrFixture(rel: string): boolean {
  return (
    rel.endsWith('.test.ts') || rel.includes('/__fixtures__/') || rel.startsWith('_shared/testing/')
  );
}

export function scanFunctions(root: string = FUNCTIONS_DIR): GuardFinding[] {
  const findings: GuardFinding[] = [];
  for (const file of walk(root)) {
    const rel = relative(root, file).split('\\').join('/');
    const source = readFileSync(file, 'utf8');
    const match = SERVICE_CLIENT_IMPORT.exec(source);
    if (match !== null && !SERVICE_CLIENT_ALLOW.some((re) => re.test(rel))) {
      const line = source.slice(0, match.index).split('\n').length;
      findings.push({
        file: rel,
        line,
        rule: 'service-client-import',
        text: match[0].replace(/\s+/g, ' ').slice(0, 120),
      });
    }
    if (!isAdapterTestOrFixture(rel)) {
      source.split('\n').forEach((text, i) => {
        if (MODEL_LITERAL.test(text))
          findings.push({
            file: rel,
            line: i + 1,
            rule: 'model-id-literal',
            text: text.trim().slice(0, 120),
          });
      });
    }
  }
  return findings;
}

function main(): void {
  const findings = scanFunctions();
  for (const f of findings)
    console.error(`supabase/functions/${f.file}:${f.line}  [${f.rule}]  ${f.text}`);
  if (findings.length > 0) {
    console.error(`\nfunctions guards: ${findings.length} finding(s).`);
    process.exit(1);
  }
  console.info('functions guards: clean');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
