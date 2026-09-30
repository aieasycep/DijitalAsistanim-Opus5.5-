/**
 * docs/AI_PIPELINE.md model tables (IMPLEMENTATION_PLAN T-12.08 "the AI routing and cost model").
 * Renders two generated sections from the seeds that migration 0005 embeds verbatim:
 * - `routing`: every `ai_model_config` row per routing profile (tier, primary, fallback chain, T3
 *   escalation, batch policy, cache TTL, input cap, enabled) from `supabase/seed/ai_model_config.sql`;
 * - `prices`: the price book from `supabase/seed/ai_model_prices.sql`.
 * These are the only generated sections allowed to name models (AI_PIPELINE_PLAN §3.7). The seeds
 * are insert-once defaults: the backoffice owns the rows afterwards, so production may differ.
 *
 * Usage: node scripts/docs/gen-ai-routing.ts [--check]   (--check fails on drift)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODEL_CONFIG_SEED,
  type ModelConfigSeedRow,
  parseModelConfigSeed,
  type SeedTarget,
} from './gen-ai-prompts.ts';
import { type GeneratorRun, code, mainOf, parseInsertRows, ROOT, type SqlValue } from './lib.ts';

export const DOC = join(ROOT, 'docs', 'AI_PIPELINE.md');
export const PRICES_SEED = 'supabase/seed/ai_model_prices.sql';
const SCRIPT = 'scripts/docs/gen-ai-routing.ts';

function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/** `anthropic` `model` · effort low · thinking adaptive · 1,500 out · 20 s */
export function targetLabel(t: SeedTarget): string {
  const p = t.params;
  const parts = [`${code(t.provider)} ${code(t.model)}`];
  if (typeof p.effort === 'string') parts.push(`effort ${p.effort}`);
  const thinking = (p.thinking as { type?: unknown } | undefined)?.type;
  if (typeof thinking === 'string') parts.push(`thinking ${thinking}`);
  const out = num(p.max_output_tokens);
  if (out !== null) parts.push(`${out.toLocaleString('en-US')} out`);
  const timeout = num(p.timeout_ms);
  if (timeout !== null) parts.push(`${timeout / 1000} s`);
  if (typeof p.input_type === 'string') parts.push(p.input_type);
  const dim = num(p.output_dimension);
  if (dim !== null) parts.push(`${dim}-d`);
  if (typeof p.language === 'string') parts.push(p.language);
  return parts.join(' · ');
}

function routeRow(r: ModelConfigSeedRow): string {
  const fallbacks =
    r.fallbackTargets.length === 0
      ? '–'
      : r.fallbackTargets.map((t, i) => `${i + 1}. ${targetLabel(t)}`).join('<br>');
  return [
    '',
    code(r.feature),
    r.role,
    r.tier.toUpperCase(),
    targetLabel(r.primary),
    fallbacks,
    r.escalationTarget === null ? '–' : targetLabel(r.escalationTarget),
    code(r.batchPolicy),
    r.cacheTtl === null ? '–' : code(r.cacheTtl),
    r.maxInputTokens.toLocaleString('en-US'),
    r.enabled ? 'yes' : '**no**',
    '',
  ]
    .join(' | ')
    .trim();
}

export function renderRouting(rows: readonly ModelConfigSeedRow[]): string {
  const profiles = [...new Set(rows.map((r) => r.profile))];
  const out: string[] = [];
  for (const profile of profiles) {
    const list = rows.filter((r) => r.profile === profile);
    out.push(
      `#### Profile \`${profile}\` (${list.length} rows)`,
      '',
      '| Feature | Role | Tier | Primary | Fallback chain (in order) | T3 escalation target | Batch | Cache | Max input tokens | Enabled |',
      '|---|---|---|---|---|---|---|---|---|---|',
      ...list.map(routeRow),
      '',
    );
  }
  return out.join('\n');
}

function usd(value: SqlValue | undefined): string {
  return typeof value === 'number' ? `$${value}` : '–';
}

export function renderPrices(rows: readonly Map<string, SqlValue>[]): string {
  return [
    '| Provider | Model | Input / MTok | Output / MTok | Cache write 5 m / MTok | Cache write 1 h / MTok | Cache read / MTok | Audio / min | Characters / 1 M | Effective from |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => {
      const text = (k: string) => {
        const v = r.get(k);
        return typeof v === 'string' ? v : '';
      };
      return `| ${code(text('provider'))} | ${code(text('model'))} | ${usd(r.get('input_per_mtok_usd'))} | ${usd(r.get('output_per_mtok_usd'))} | ${usd(r.get('cache_write_5m_per_mtok_usd'))} | ${usd(r.get('cache_write_1h_per_mtok_usd'))} | ${usd(r.get('cache_read_per_mtok_usd'))} | ${usd(r.get('audio_per_min_usd'))} | ${usd(r.get('chars_per_million_usd'))} | ${text('effective_from').slice(0, 10)} |`;
    }),
  ].join('\n');
}

export function buildAiRoutingRun(): GeneratorRun {
  const routing = parseModelConfigSeed(readFileSync(join(ROOT, MODEL_CONFIG_SEED), 'utf8'));
  const prices = parseInsertRows(
    readFileSync(join(ROOT, PRICES_SEED), 'utf8'),
    'public.ai_model_prices',
  );
  return {
    file: DOC,
    sections: [
      { name: 'routing', body: renderRouting(routing), allowModelIds: true },
      { name: 'prices', body: renderPrices(prices), allowModelIds: true },
    ],
    script: SCRIPT,
  };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = mainOf(buildAiRoutingRun, process.argv.slice(2));
}
