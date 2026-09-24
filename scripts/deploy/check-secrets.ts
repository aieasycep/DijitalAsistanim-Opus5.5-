/**
 * Deploy secret check (IMPLEMENTATION_PLAN T-12.03). Compares the secret NAMES the Edge Functions
 * read with the names set on the hosted project (`supabase secrets list -o json`), and the names
 * the deploy job itself needs with the job environment. Values are never read or printed: the
 * secrets list carries digests only and this script looks at `name` alone.
 *
 * Sources, so the list cannot drift from the code:
 * - boot keys: every `serverEnvShape` key in `packages/validation/src/env.ts` without `.optional()`
 *   or `.default(…)`, plus the active `TOKEN_ENC_KEY_V{n}`;
 * - credential groups: `CREDENTIALS` in `supabase/functions/_shared/env.ts`, each classified below
 *   as `production` (MASTER_PLAN §19 "Production required") or `optional`; an unclassified group
 *   fails the check;
 * - every name must exist in `.env.example`.
 * `SUPABASE_*` names are injected by the platform (the CLI refuses to set them) and are skipped.
 *
 * Usage: node scripts/deploy/check-secrets.ts --secrets <file.json> [--report-only]
 *   --report-only  print the report and exit 0 (the workflow's dry run)
 * Exit 1 when a boot, production or deploy-job name is missing (unless --report-only), 2 on bad input.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Credential groups the product needs in production (§19); the others degrade gracefully. */
export const PRODUCTION_GROUPS = [
  'supabase_secret',
  'anthropic',
  'voyage',
  'ai_hash_pepper',
  'google_oauth',
  'google_pubsub',
  'google_calendar_webhook',
  'microsoft_oauth',
  'microsoft_graph_webhook',
  'apple_siwa',
  'revenuecat',
  'revenuecat_webhook',
  'expo_push',
  'cron_secret',
  'webhook_hmac',
  'admin_bff',
  'email_delivery',
] as const;

/** Fallbacks and extras: OpenAI fallback/DR, cost reconciliation, premium voice, Sentry, Turnstile. */
export const OPTIONAL_GROUPS = [
  'anthropic_admin',
  'openai',
  'openai_admin',
  'deepgram',
  'tts_premium',
  'sentry',
  'turnstile',
] as const;

/** App URLs, admin boundary and peppers the functions read in production. */
export const PRODUCTION_KEYS = [
  'APP_ENV',
  'PUBLIC_WEB_URL',
  'API_PUBLIC_BASE_URL',
  'OAUTH_RESULT_REDIRECT_URI',
  'MAIL_MESSAGE_ID_DOMAIN',
  'ADMIN_ORIGIN',
  'RECOVERY_CODE_PEPPER',
] as const;

/** Names the deploy job reads from the GitHub `production` environment (not Edge secrets). */
export const DEPLOY_JOB_KEYS = [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_DB_URL',
  'CRON_SECRET',
  'SUPABASE_AUTH_SMTP_HOST',
  'SUPABASE_AUTH_SMTP_PORT',
  'SUPABASE_AUTH_SMTP_USER',
  'SUPABASE_AUTH_SMTP_PASS',
  'SUPABASE_AUTH_SMTP_SENDER',
  'SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID',
  'SUPABASE_AUTH_EXTERNAL_APPLE_SECRET',
  'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID',
  'SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET',
  'SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID',
  'SUPABASE_AUTH_EXTERNAL_AZURE_SECRET',
] as const;

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function block(source: string, start: string, end: RegExp, file: string): string {
  const from = source.indexOf(start);
  if (from < 0) throw new Error(`${file}: "${start}" not found`);
  const rest = source.slice(from + start.length);
  const stop = rest.search(end);
  if (stop < 0) throw new Error(`${file}: end of "${start}" not found`);
  return rest.slice(0, stop);
}

/** `serverEnvShape` keys with neither `.optional()` nor `.default(…)`. */
export function bootKeys(envSource: string): string[] {
  const shape = block(envSource, 'export const serverEnvShape = {', /^\};/m, 'env.ts');
  const entries = shape.split(/^(?= {2}[A-Z][A-Z0-9_]*:)/m);
  const keys: string[] = [];
  for (const entry of entries) {
    const key = /^ {2}([A-Z][A-Z0-9_]*):/.exec(entry)?.[1];
    if (key === undefined) continue;
    if (!entry.includes('.optional()') && !entry.includes('.default(')) keys.push(key);
  }
  return keys;
}

/** `CREDENTIALS` groups and their key names. */
export function credentialGroups(credSource: string): Map<string, string[]> {
  const body = block(credSource, 'export const CREDENTIALS = {', /^\} as const/m, '_shared/env.ts');
  const groups = new Map<string, string[]>();
  for (const [, group = '', list = ''] of body.matchAll(
    /(\w+):\s*\{\s*required:\s*\[([^\]]*)\]/g,
  )) {
    groups.set(
      group,
      [...list.matchAll(/'([A-Z0-9_]+)'/g)].map(([, name = '']) => name),
    );
  }
  if (groups.size === 0) throw new Error('_shared/env.ts: no CREDENTIALS groups parsed');
  return groups;
}

export function envExampleNames(example: string): Set<string> {
  return new Set([...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(([, name = '']) => name));
}

/** Names from `supabase secrets list -o json` (array of `{name, value}`; values ignored). */
export function secretNames(json: string): Set<string> {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) throw new Error('secrets list: expected a JSON array');
  const names = new Set<string>();
  for (const item of parsed) {
    const name =
      typeof item === 'string'
        ? item
        : typeof item === 'object' && item !== null && 'name' in item
          ? (item as { name: unknown }).name
          : null;
    if (typeof name === 'string' && name !== '') names.add(name);
  }
  return names;
}

export interface Requirement {
  readonly name: string;
  readonly tier: 'boot' | 'production' | 'optional';
  readonly group: string;
}

export interface Plan {
  readonly requirements: readonly Requirement[];
  /** Setup errors (drift between the code, this script and `.env.example`). */
  readonly errors: readonly string[];
}

const platformInjected = (name: string) => name.startsWith('SUPABASE_');

export function buildPlan(sources: {
  envSource: string;
  credSource: string;
  example: string;
  activeTokenVersion: number;
}): Plan {
  const errors: string[] = [];
  const example = envExampleNames(sources.example);
  const groups = credentialGroups(sources.credSource);
  const requirements = new Map<string, Requirement>();
  const add = (name: string, tier: Requirement['tier'], group: string) => {
    if (platformInjected(name)) return;
    const rank = { boot: 0, production: 1, optional: 2 } as const;
    const existing = requirements.get(name);
    if (existing === undefined || rank[tier] < rank[existing.tier]) {
      requirements.set(name, { name, tier, group });
    }
  };

  for (const key of bootKeys(sources.envSource)) add(key, 'boot', 'server env');
  add(`TOKEN_ENC_KEY_V${String(sources.activeTokenVersion)}`, 'boot', 'token encryption');
  for (const key of PRODUCTION_KEYS) add(key, 'production', 'app');

  const classified = new Set<string>([...PRODUCTION_GROUPS, ...OPTIONAL_GROUPS]);
  for (const [group, names] of groups) {
    if (!classified.has(group)) {
      errors.push(
        `credential group "${group}" is not classified in scripts/deploy/check-secrets.ts`,
      );
      continue;
    }
    const tier = (PRODUCTION_GROUPS as readonly string[]).includes(group)
      ? 'production'
      : 'optional';
    for (const name of names) add(name, tier, group);
  }
  for (const group of classified) {
    if (!groups.has(group)) errors.push(`classified credential group "${group}" no longer exists`);
  }
  for (const name of [...requirements.keys(), ...DEPLOY_JOB_KEYS]) {
    if (!/^TOKEN_ENC_KEY_V\d+$/.test(name) && !example.has(name)) {
      errors.push(`${name} is not listed in .env.example`);
    }
  }
  return {
    requirements: [...requirements.values()].sort((a, b) => a.name.localeCompare(b.name)),
    errors,
  };
}

export interface Report {
  readonly missing: {
    readonly boot: string[];
    readonly production: string[];
    readonly optional: string[];
  };
  readonly missingDeployJob: string[];
  readonly extra: string[];
  readonly errors: readonly string[];
  readonly text: string;
}

export function report(
  plan: Plan,
  present: ReadonlySet<string>,
  jobEnv: Readonly<Record<string, string | undefined>>,
): Report {
  const missing = { boot: [] as string[], production: [] as string[], optional: [] as string[] };
  for (const req of plan.requirements) if (!present.has(req.name)) missing[req.tier].push(req.name);
  const known = new Set(plan.requirements.map((r) => r.name));
  const extra = [...present].filter((n) => !known.has(n) && !platformInjected(n)).sort();
  const missingDeployJob = DEPLOY_JOB_KEYS.filter((k) => (jobEnv[k] ?? '').trim() === '');
  const byGroup = (tier: Requirement['tier']) =>
    plan.requirements
      .filter((r) => r.tier === tier && !present.has(r.name))
      .map((r) => `  - ${r.name} (${r.group})`);
  const lines = [
    '# Supabase secret check (names only)',
    '',
    `Edge secrets set: ${String(present.size)} · required by the code: ${String(plan.requirements.length)}`,
    '',
    `## Missing boot secrets (functions refuse to start): ${String(missing.boot.length)}`,
    ...byGroup('boot'),
    '',
    `## Missing production secrets (features report external_credential_required): ${String(missing.production.length)}`,
    ...byGroup('production'),
    '',
    `## Missing optional secrets (fallbacks and extras): ${String(missing.optional.length)}`,
    ...byGroup('optional'),
    '',
    `## Missing deploy-job environment names (GitHub "production" environment): ${String(missingDeployJob.length)}`,
    ...missingDeployJob.map((k) => `  - ${k}`),
    '',
    `## Set on the project but not read by the code: ${String(extra.length)}`,
    ...extra.map((k) => `  - ${k}`),
  ];
  if (plan.errors.length > 0) {
    lines.push(
      '',
      `## Check setup errors: ${String(plan.errors.length)}`,
      ...plan.errors.map((e) => `  - ${e}`),
    );
  }
  return { missing, missingDeployJob, extra, errors: plan.errors, text: `${lines.join('\n')}\n` };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const secretsFile = arg('--secrets');
  if (secretsFile === undefined) {
    process.stderr.write('usage: check-secrets.ts --secrets <file.json> [--report-only]\n');
    process.exit(2);
  }
  const reportOnly = process.argv.includes('--report-only');
  const activeTokenVersion = Number.parseInt(process.env.TOKEN_ENC_ACTIVE_VERSION ?? '1', 10) || 1;
  const plan = buildPlan({
    envSource: read('packages/validation/src/env.ts'),
    credSource: read('supabase/functions/_shared/env.ts'),
    example: read('.env.example'),
    activeTokenVersion,
  });
  let present: Set<string>;
  try {
    present = secretNames(readFileSync(secretsFile, 'utf8'));
  } catch (error) {
    process.stderr.write(
      `check-secrets: cannot read ${secretsFile}: ${(error as Error).message}\n`,
    );
    process.exit(2);
  }
  const result = report(plan, present, process.env);
  process.stdout.write(result.text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.text);
  const failing =
    result.errors.length +
    result.missing.boot.length +
    result.missing.production.length +
    result.missingDeployJob.length;
  if (failing > 0 && !reportOnly) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
