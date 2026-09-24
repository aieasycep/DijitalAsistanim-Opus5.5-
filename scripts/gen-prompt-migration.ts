/**
 * Prompt-version seed generator (IMPLEMENTATION_PLAN T-5.16; DATABASE_AND_RLS_PLAN §10 row 0005;
 * AI_PIPELINE_PLAN §5.4). The prompt sources live in `supabase/prompts/<prompt_key>.md`:
 *
 *   ---                                   front matter: prompt_key, version, output_schema_ref,
 *   prompt_key: …                         model_role, changelog
 *   ---
 *   # System                              S1, S3–S6 (S2 untrusted rule and S7 canary are appended
 *   …                                     at assembly, `_shared/ai/prompts/assemble.ts`)
 *   # User template                       the instruction with `{{vars}}`
 *   …
 *
 * The generated migration inserts each key's version as `active` only when the key has no row yet
 * (backoffice edits are never overwritten). `schema_hash` = sha256 of the wire JSON schema of the
 * deployed `@da/validation` schema, the value activation compares against.
 *
 * Usage: node scripts/gen-prompt-migration.ts [--check]   (--check fails on drift)
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_SCHEMAS, PROMPT_KEY_VALUES } from '../packages/validation/src/ai/index.ts';
import { toWireJsonSchema } from '../packages/validation/src/ai/wire.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PROMPTS_DIR = join(ROOT, 'supabase', 'prompts');
export const MIGRATION = join(ROOT, 'supabase', 'migrations', '20260924002410_prompt_versions_seed.sql');
const QUOTE_TAG = '$da_prompt$';
const ROLES = new Set(['classifier', 'reasoning', 'assistant']);
/** Static prefix minimums per tier (AI_PIPELINE_PLAN §5.1 activation checks). */
const MIN_PREFIX = { t1: 4096, t2: 1024, t3: 512 };

export interface PromptSource {
  readonly prompt_key: string;
  readonly version: number;
  readonly output_schema_ref: string;
  readonly model_role: string;
  readonly changelog: string;
  readonly system: string;
  readonly userTemplate: string;
}

export function parsePromptFile(text: string, file: string): PromptSource {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (match === null) throw new Error(`${file}: missing front matter`);
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (kv !== null) meta[kv[1]!] = kv[2]!.trim();
  }
  const body = match[2]!;
  const sys = body.indexOf('\n# System\n');
  const usr = body.indexOf('\n# User template\n');
  if (sys === -1 || usr === -1 || usr < sys) throw new Error(`${file}: needs "# System" then "# User template"`);
  const system = body.slice(sys + '\n# System\n'.length, usr).trim();
  const userTemplate = body.slice(usr + '\n# User template\n'.length).trim();
  const source: PromptSource = {
    prompt_key: meta.prompt_key ?? '',
    version: Number(meta.version ?? '0'),
    output_schema_ref: meta.output_schema_ref ?? '',
    model_role: meta.model_role ?? '',
    changelog: meta.changelog ?? '',
    system,
    userTemplate,
  };
  validate(source, file);
  return source;
}

function validate(p: PromptSource, file: string): void {
  if (!(PROMPT_KEY_VALUES as readonly string[]).includes(p.prompt_key)) throw new Error(`${file}: unknown prompt_key`);
  if (`${p.prompt_key}.md` !== file) throw new Error(`${file}: file name must be <prompt_key>.md`);
  if (!Number.isInteger(p.version) || p.version < 1) throw new Error(`${file}: version must be ≥1`);
  if (!(p.output_schema_ref in AI_SCHEMAS)) throw new Error(`${file}: unknown output_schema_ref`);
  if (!ROLES.has(p.model_role)) throw new Error(`${file}: unknown model_role`);
  if (p.system.length === 0 || p.system.length > 40_000) throw new Error(`${file}: system prompt length`);
  if (p.userTemplate.length === 0 || p.userTemplate.length > 20_000) throw new Error(`${file}: user template length`);
  if (p.system.includes(QUOTE_TAG) || p.userTemplate.includes(QUOTE_TAG)) throw new Error(`${file}: reserved quote tag`);
  if (/\b(?:claude|gpt|voyage)-[a-z0-9]/i.test(`${p.system}\n${p.userTemplate}`)) {
    throw new Error(`${file}: model identifiers never appear in prompts`);
  }
}

export function schemaHash(ref: string): string {
  const entry = (AI_SCHEMAS as Record<string, { schema: Parameters<typeof toWireJsonSchema>[0] }>)[ref];
  if (entry === undefined) throw new Error(`unknown schema ${ref}`);
  return createHash('sha256').update(JSON.stringify(toWireJsonSchema(entry.schema))).digest('hex');
}

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function loadPrompts(dir: string = PROMPTS_DIR): PromptSource[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parsePromptFile(readFileSync(join(dir, f), 'utf8'), f));
}

export function renderMigration(prompts: readonly PromptSource[]): string {
  const blocks = prompts.map((p) =>
    [
      `-- ${p.prompt_key} v${p.version} (${p.output_schema_ref})`,
      'insert into public.prompt_versions',
      '  (prompt_key, version, status, system_prompt, user_template, output_schema_ref, schema_hash, model_role,',
      '   model_constraints, eval_dataset_version, eval_report, eval_passed, changelog, activated_at)',
      'select',
      `  ${literal(p.prompt_key)}, ${p.version}, 'active',`,
      `  ${QUOTE_TAG}${p.system}${QUOTE_TAG},`,
      `  ${QUOTE_TAG}${p.userTemplate}${QUOTE_TAG},`,
      `  ${literal(p.output_schema_ref)}, ${literal(schemaHash(p.output_schema_ref))}, ${literal(p.model_role)},`,
      `  ${literal(JSON.stringify({ min_prefix_tokens_by_tier: MIN_PREFIX }))}::jsonb,`,
      `  'fixture-baseline-v1',`,
      `  ${literal(JSON.stringify({ mode: 'fixture_baseline', suite: 'supabase/functions/_shared/ai/evals' }))}::jsonb,`,
      `  true, ${literal(p.changelog)}, now()`,
      `where not exists (select 1 from public.prompt_versions v where v.prompt_key = ${literal(p.prompt_key)});`,
    ].join('\n'),
  );
  return [
    '-- Prompt versions v1 (IMPLEMENTATION_PLAN T-5.16; AI_PIPELINE_PLAN §5.2, §5.4).',
    '-- GENERATED by scripts/gen-prompt-migration.ts from supabase/prompts/*.md — edit the sources and',
    '-- regenerate. A key that already has a version (backoffice edits) is left untouched. The S2',
    '-- untrusted-data rule and the S7 canary are appended at assembly, never stored here.',
    '',
    blocks.join('\n\n'),
    '',
  ].join('\n');
}

function main(): void {
  const check = process.argv.includes('--check');
  const sql = renderMigration(loadPrompts());
  if (check) {
    let current = '';
    try {
      current = readFileSync(MIGRATION, 'utf8');
    } catch {
      current = '';
    }
    if (current !== sql) {
      process.stderr.write('gen-prompt-migration: drift — run `node scripts/gen-prompt-migration.ts`\n');
      process.exit(1);
    }
    process.stdout.write('gen-prompt-migration: no drift\n');
    return;
  }
  writeFileSync(MIGRATION, sql);
  process.stdout.write(`gen-prompt-migration: wrote ${MIGRATION}\n`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main();
