/**
 * docs/AI_PROMPTS.md generator (IMPLEMENTATION_PLAN T-12.09 "AI_PROMPTS: generated from the prompt
 * registry"). Sources, so the page cannot drift from the code:
 * - the prompt sources `supabase/prompts/<prompt_key>.md` (front matter, system prompt, user
 *   template), read with the loader of `scripts/gen-prompt-migration.ts`, which also renders the
 *   `prompt_versions` seed migrations from them;
 * - `FEATURE_PROMPT_KEY` of `supabase/functions/_shared/ai/prompts/registry.ts` (feature → key);
 * - the routing seed `supabase/seed/ai_model_config.sql` (tier per routing profile);
 * - the wire JSON schema hash of the `@da/validation` output schema (`schema_hash`).
 * Model identifiers are never written (they live in the AI_PIPELINE.md model tables).
 *
 * Usage: node scripts/docs/gen-ai-prompts.ts [--check]   (--check fails on drift)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPrompts, type PromptSource, schemaHash } from '../gen-prompt-migration.ts';
import { type GeneratorRun, cell, code, mainOf, parseInsertRows, repoLink, ROOT } from './lib.ts';

export const DOC = join(ROOT, 'docs', 'AI_PROMPTS.md');
export const REGISTRY = 'supabase/functions/_shared/ai/prompts/registry.ts';
export const MODEL_CONFIG_SEED = 'supabase/seed/ai_model_config.sql';
export const CAPTURE_EXTRACT = 'supabase/functions/_shared/services/capture/extract.ts';
const SCRIPT = 'scripts/docs/gen-ai-prompts.ts';

/**
 * Prompt keys that a feature picks per input instead of through `FEATURE_PROMPT_KEY`: the capture
 * extractor chooses `capture_vision` for photos and `capture_pdf` for PDFs (see CAPTURE_EXTRACT).
 */
export const VARIANT_FEATURE: Readonly<Record<string, string>> = {
  capture_pdf: 'capture_extract',
  capture_vision: 'capture_extract',
};

/** `FEATURE_PROMPT_KEY` of the registry: feature → prompt key. */
export function parseFeatureMap(source: string): Map<string, string> {
  const start = source.indexOf('export const FEATURE_PROMPT_KEY');
  if (start === -1) throw new Error(`${REGISTRY}: FEATURE_PROMPT_KEY not found`);
  const open = source.indexOf('= {', start);
  const close = source.indexOf('};', open);
  const map = new Map<string, string>();
  for (const m of source.slice(open, close).matchAll(/^\s*([a-z_]+):\s*'([a-z_]+)',?\s*$/gm)) {
    const [, feature = '', key = ''] = m;
    map.set(feature, key);
  }
  if (map.size === 0) throw new Error(`${REGISTRY}: FEATURE_PROMPT_KEY is empty`);
  return map;
}

export interface SeedTarget {
  readonly provider: string;
  readonly model: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface ModelConfigSeedRow {
  readonly profile: string;
  readonly role: string;
  readonly feature: string;
  readonly tier: string;
  readonly primary: SeedTarget;
  readonly fallbackTargets: readonly SeedTarget[];
  readonly escalationTarget: SeedTarget | null;
  readonly escalation: boolean;
  readonly fallbacks: number;
  readonly batchPolicy: string;
  readonly cacheTtl: string | null;
  readonly maxInputTokens: number;
  readonly retiresNotBefore: string | null;
  readonly enabled: boolean;
}

function target(value: unknown): SeedTarget {
  const t = value as { provider?: unknown; model?: unknown; params?: unknown };
  if (typeof t.provider !== 'string' || typeof t.model !== 'string') {
    throw new Error(`${MODEL_CONFIG_SEED}: a target without provider or model`);
  }
  return {
    provider: t.provider,
    model: t.model,
    params: (t.params ?? {}) as Readonly<Record<string, unknown>>,
  };
}

/** The rows of the `insert into public.ai_model_config (…) values (…), …` seed. */
export function parseModelConfigSeed(sql: string): ModelConfigSeedRow[] {
  return parseInsertRows(sql, 'public.ai_model_config').map((row) => {
    const text = (key: string): string => {
      const v = row.get(key);
      if (typeof v !== 'string') throw new Error(`${MODEL_CONFIG_SEED}: ${key} is not text`);
      return v;
    };
    const optional = (key: string): string | null => {
      const v = row.get(key);
      return typeof v === 'string' ? v : null;
    };
    const fallbackTargets = (JSON.parse(text('fallback_targets')) as unknown[]).map(target);
    const escalation = optional('escalation_target');
    const maxInput = row.get('max_input_tokens');
    return {
      profile: text('profile'),
      role: text('role'),
      feature: text('feature'),
      tier: text('tier'),
      primary: {
        provider: text('provider'),
        model: text('model'),
        params: JSON.parse(text('params')) as Readonly<Record<string, unknown>>,
      },
      fallbackTargets,
      escalationTarget: escalation === null ? null : target(JSON.parse(escalation)),
      escalation: escalation !== null,
      fallbacks: fallbackTargets.length,
      batchPolicy: text('batch_policy'),
      cacheTtl: optional('cache_ttl'),
      maxInputTokens: typeof maxInput === 'number' ? maxInput : 0,
      retiresNotBefore: optional('retires_not_before'),
      enabled: row.get('enabled') === true,
    };
  });
}

/** The first two sentences of the system prompt (role and task), without the product tagline. */
export function purposeOf(system: string): string {
  const paragraph = system.split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  const sentences = /^(.*?[.!?])(?:\s+(.*?[.!?]))?(?:\s|$)/.exec(paragraph);
  const text = sentences === null ? paragraph : [sentences[1], sentences[2]].filter(Boolean).join(' ');
  return text.replace(/, a Turkish-first personal command center/g, '');
}

export function templateVars(template: string): string[] {
  return [...new Set([...template.matchAll(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi)].map((m) => m[1] ?? ''))];
}

export interface PromptDoc {
  readonly prompt: PromptSource;
  readonly feature: string;
  readonly balanced: ModelConfigSeedRow | null;
  readonly lean: ModelConfigSeedRow | null;
}

/** The routing row of a prompt: the feature's row, or the one whose role matches when several. */
function routeFor(
  rows: readonly ModelConfigSeedRow[],
  profile: string,
  feature: string,
  role: string,
): ModelConfigSeedRow | null {
  const matches = rows.filter((r) => r.profile === profile && r.feature === feature);
  if (matches.length <= 1) return matches[0] ?? null;
  return matches.find((r) => r.role === role) ?? null;
}

export function describePrompts(
  prompts: readonly PromptSource[],
  featureMap: ReadonlyMap<string, string>,
  rows: readonly ModelConfigSeedRow[],
): PromptDoc[] {
  const byKey = new Map<string, string>();
  for (const [feature, key] of featureMap) byKey.set(key, feature);
  return prompts.map((prompt) => {
    const feature = byKey.get(prompt.prompt_key) ?? VARIANT_FEATURE[prompt.prompt_key];
    if (feature === undefined) {
      throw new Error(
        `prompt ${prompt.prompt_key} has no feature: add it to FEATURE_PROMPT_KEY or VARIANT_FEATURE`,
      );
    }
    return {
      prompt,
      feature,
      balanced: routeFor(rows, 'balanced', feature, prompt.model_role),
      lean: routeFor(rows, 'lean', feature, prompt.model_role),
    };
  });
}

export function tierLabel(row: ModelConfigSeedRow | null): string {
  if (row === null) return 'not routed';
  const tier = row.tier.toUpperCase() + (row.escalation ? ' → T3' : '');
  return row.enabled ? tier : `${tier} (disabled)`;
}

function fallbackLabel(row: ModelConfigSeedRow | null): string {
  if (row === null) return '–';
  if (row.fallbacks === 0) return 'primary only, then the T0 path';
  return `primary + ${row.fallbacks} fallback target${row.fallbacks === 1 ? '' : 's'}, then the T0 path`;
}

export function renderPrompts(docs: readonly PromptDoc[]): string {
  const link = (path: string, label?: string) => repoLink(DOC, path, label);
  const lines: string[] = [];
  lines.push(
    `${docs.length} prompt keys. Tier columns come from the \`ai_model_config\` seed (${link(MODEL_CONFIG_SEED, 'routing seed')}); \`→ T3\` marks an escalation target, \`(disabled)\` a seeded row with \`enabled = false\`.`,
    '',
    '| Key | Version | Feature | Output schema | Role | Tier · balanced (Pro) | Tier · lean (Free) | Purpose |',
    '|---|---|---|---|---|---|---|---|',
  );
  for (const d of docs) {
    const p = d.prompt;
    lines.push(
      `| [${code(p.prompt_key)}](#${p.prompt_key}) | ${p.version} | ${code(d.feature)} | ${code(p.output_schema_ref)} | ${p.model_role} | ${tierLabel(d.balanced)} | ${tierLabel(d.lean)} | ${cell(purposeOf(p.system))} |`,
    );
  }
  for (const d of docs) {
    const p = d.prompt;
    const vars = templateVars(p.userTemplate);
    lines.push(
      '',
      `### ${p.prompt_key}`,
      '',
      `| Field | Value |`,
      `|---|---|`,
      `| Source | ${link(`supabase/prompts/${p.prompt_key}.md`)} |`,
      `| Version | ${p.version} (${cell(p.changelog)}) |`,
      `| Feature | ${code(d.feature)} |`,
      `| Output schema | ${code(p.output_schema_ref)} · \`schema_hash\` ${code(schemaHash(p.output_schema_ref).slice(0, 12))}… |`,
      `| Model role | ${p.model_role} |`,
      `| Tier (balanced · lean) | ${tierLabel(d.balanced)} · ${tierLabel(d.lean)} |`,
      `| Fallback chain (balanced) | ${fallbackLabel(d.balanced)} |`,
      `| Batch policy · cache TTL (balanced) | ${d.balanced === null ? '–' : `${code(d.balanced.batchPolicy)} · ${d.balanced.cacheTtl === null ? '–' : code(d.balanced.cacheTtl)}`} |`,
      `| System prompt | ${p.system.length.toLocaleString('en-US')} characters |`,
      `| Template variables | ${vars.length === 0 ? 'none' : vars.map((v) => code(`{{${v}}}`)).join(', ')} |`,
      '',
      `> ${cell(purposeOf(p.system))}`,
    );
  }
  return lines.join('\n');
}

export function buildAiPromptsRun(): GeneratorRun {
  const docs = describePrompts(
    loadPrompts(),
    parseFeatureMap(readFileSync(join(ROOT, REGISTRY), 'utf8')),
    parseModelConfigSeed(readFileSync(join(ROOT, MODEL_CONFIG_SEED), 'utf8')),
  );
  return { file: DOC, sections: [{ name: 'prompts', body: renderPrompts(docs) }], script: SCRIPT };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = mainOf(buildAiPromptsRun, process.argv.slice(2));
}
