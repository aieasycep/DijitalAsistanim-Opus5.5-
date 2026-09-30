/**
 * Synthetic AI checks for the backoffice (API_CONTRACTS ADM-08 `POST /ai/models/:profile/:feature/
 * test`, ADM-09 `POST /ai/prompts/:key/versions/:v/test`): the configured target is called with
 * synthetic fixture cases only — never user data — and the output is checked with the registered
 * zod schema (schema pass) and the grounding guards (`validateOutput`: no URL, e-mail, phone or
 * reference that the case sources do not contain). Costs come from `ai_model_prices`.
 *
 * The fixture sets are fictional (PRIMARY demo names); `fixture_set` selects one.
 */
import type { z } from 'zod';
import { AI_SCHEMAS, type AiSchemaName } from '@da/validation';
import type { AiFeature } from '@da/domain';
import { AiError } from '../../_shared/ai/errors.ts';
import { validateOutput } from '../../_shared/ai/output-validators.ts';
import { costMicros, type ModelPrice } from '../../_shared/ai/pricing.ts';
import type {
  LLMProvider,
  ModelTarget,
  NormalizedUsage,
  PromptParts,
  ProviderId,
} from '../../_shared/ai/types.ts';
import { UNTRUSTED_RULE, type UntrustedDoc, wrapAll } from '../../_shared/ai/untrusted.ts';
import { fieldError } from '../../_shared/errors.ts';

export interface SyntheticCase {
  readonly id: string;
  /** Trusted template variables (`{{name}}` in the user template). */
  readonly context: Readonly<Record<string, string>>;
  readonly documents: readonly UntrustedDoc[];
}

const TODAY = 'local_date: 2026-09-24 · time_zone: Europe/Istanbul';

const MAIL_CASES: readonly SyntheticCase[] = [
  {
    id: 'offer_deadline',
    context: { user_name: 'Deniz', today: TODAY, locale: 'tr' },
    documents: [
      {
        ref: 'm1',
        kind: 'email',
        meta: { from: 'Mehmet Yılmaz · Yılmaz Endüstri', received: '2026-09-24 08:42' },
        text:
          'Merhaba Deniz, geçen hafta konuştuğumuz tedarik teklifini yarın saat 17:00’ye kadar ' +
          'gönderebilir misiniz? Fiyatları güncellersek ekiple perşembe toplantısında onaylayabiliriz.',
      },
    ],
  },
  {
    id: 'meeting_reschedule',
    context: { user_name: 'Deniz', today: TODAY, locale: 'tr' },
    documents: [
      {
        ref: 'm1',
        kind: 'email',
        meta: { from: 'Ahmet Yılmaz · Kuzey Lojistik', received: '2026-09-23 16:10' },
        text:
          'Deniz Hanım merhaba, cuma 10:00 sevkiyat planlama toplantımızı pazartesi 14:00’e ' +
          'alabilir miyiz? Uygunsanız takvim davetini güncelleyeceğim.',
      },
      {
        ref: 'e1',
        kind: 'event',
        meta: { start: '2026-09-26 10:00', end: '2026-09-26 11:00' },
        text: 'Sevkiyat planlama · Kuzey Lojistik',
      },
    ],
  },
  {
    id: 'newsletter_low_priority',
    context: { user_name: 'Deniz', today: TODAY, locale: 'tr' },
    documents: [
      {
        ref: 'm1',
        kind: 'email',
        meta: { from: 'Bülten · Sektör Haberleri', received: '2026-09-24 07:00' },
        text: 'Haftanın öne çıkan lojistik haberleri ve etkinlik takvimi bu bültende.',
      },
    ],
  },
];

/**
 * Registered sets: `synthetic_tr_v1` (every mail case), `reply_tr_basic` (the threads that ask for
 * an answer, for `reply_draft`) and `smoke` (the first case only).
 */
export const SYNTHETIC_FIXTURE_SETS: Readonly<Record<string, readonly SyntheticCase[]>> = {
  synthetic_tr_v1: MAIL_CASES,
  reply_tr_basic: MAIL_CASES.slice(0, 2),
  smoke: MAIL_CASES.slice(0, 1),
};

export function fixtureSet(name: string): readonly SyntheticCase[] {
  const set = SYNTHETIC_FIXTURE_SETS[name];
  if (set === undefined) throw fieldError('fixture_set', 'unknown_fixture_set');
  return set;
}

/** The model-facing output schema of an AI feature (`null` for embeddings and speech). */
export function schemaNameForFeature(feature: AiFeature): AiSchemaName | null {
  for (const [name, entry] of Object.entries(AI_SCHEMAS)) {
    if (entry.kind === 'wire' && (entry.features as readonly string[]).includes(feature)) {
      return name as AiSchemaName;
    }
  }
  return null;
}

/** `{{name}}` placeholders of a user template filled from the case context (missing → empty). */
export function renderTemplate(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(
    /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi,
    (_m, name: string) => vars[name] ?? '',
  );
}

export interface CaseOutcome {
  readonly schemaPass: boolean;
  readonly groundingPass: boolean;
  readonly latencyMs: number;
  readonly costMicros: number;
}

function caseSources(c: SyntheticCase): string[] {
  return [...c.documents.map((d) => d.text), ...Object.values(c.context)];
}

export interface StructuredRun {
  readonly provider: LLMProvider;
  readonly target: ModelTarget;
  readonly feature: AiFeature;
  readonly schemaName: AiSchemaName;
  readonly systemPrompt: string;
  readonly userTemplate: string;
  readonly price: ModelPrice | null;
  readonly correlationId: string;
}

/** Runs one synthetic case; model errors count as a failed case (never a thrown request). */
export async function runStructuredCase(
  run: StructuredRun,
  c: SyntheticCase,
): Promise<CaseOutcome> {
  const schema = AI_SCHEMAS[run.schemaName].schema as unknown as z.ZodType<unknown>;
  const prompt: PromptParts = {
    system: run.systemPrompt.includes('<untrusted_content')
      ? run.systemPrompt
      : `${run.systemPrompt}\n\n${UNTRUSTED_RULE}`,
    userContext: renderTemplate(run.userTemplate, c.context),
    untrusted: wrapAll(c.documents).text,
    cacheTtl: null,
  };
  if (run.provider.generateStructured === undefined) {
    throw fieldError('feature', 'probe_unsupported');
  }
  try {
    const result = await run.provider.generateStructured(
      {
        feature: run.feature,
        schema,
        schemaName: run.schemaName,
        prompt,
        userRef: null,
        correlationId: run.correlationId,
      },
      run.target,
    );
    const parsed = schema.safeParse(result.data);
    const grounding = parsed.success
      ? validateOutput(schema, parsed.data, {
          sources: caseSources(c),
          aliases: new Set(c.documents.map((d) => d.ref)),
        })
      : null;
    return {
      schemaPass: parsed.success,
      groundingPass: grounding?.ok === true,
      latencyMs: Math.max(0, Math.round(result.latencyMs)),
      costMicros: costMicros(run.price, result.usage),
    };
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return { schemaPass: false, groundingPass: false, latencyMs: 0, costMicros: 0 };
  }
}

export interface EmbedOutcome {
  readonly schemaPass: boolean;
  readonly latencyMs: number;
  readonly costMicros: number;
}

/** Embedding probe: the vectors must be 1024-d (R-01), one per synthetic input. */
export async function runEmbeddingProbe(
  provider: LLMProvider,
  target: ModelTarget,
  feature: AiFeature,
  cases: readonly SyntheticCase[],
  price: ModelPrice | null,
  now: () => number,
): Promise<EmbedOutcome> {
  if (provider.embed === undefined) throw fieldError('feature', 'probe_unsupported');
  const inputs = cases.flatMap((c) => c.documents.map((d) => d.text));
  const started = now();
  try {
    const result = await provider.embed(
      { inputs, kind: feature === 'embedding_query' ? 'query' : 'document' },
      target,
    );
    const usage: NormalizedUsage = {
      inputTokens: result.usage.tokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      reasoningTokens: 0,
    };
    return {
      schemaPass:
        result.dimensions === 1024 &&
        result.vectors.length === inputs.length &&
        result.vectors.every((v) => v.length === 1024),
      latencyMs: Math.max(0, now() - started),
      costMicros: costMicros(price, usage),
    };
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return { schemaPass: false, latencyMs: Math.max(0, now() - started), costMicros: 0 };
  }
}

/** The current `ai_model_prices` row of a target from `ai_model_prices_list` rows. */
export function currentPrice(
  rows: readonly Record<string, unknown>[],
  provider: ProviderId,
  model: string,
): ModelPrice | null {
  const row = rows.find((r) => r.provider === provider && r.model === model && r.current === true);
  return (row as unknown as ModelPrice | undefined) ?? null;
}
