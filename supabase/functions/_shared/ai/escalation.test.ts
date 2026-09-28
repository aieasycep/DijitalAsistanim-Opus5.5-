/**
 * T3 escalation (AI_PIPELINE_PLAN §1.1 "T3Q", §1.2 T3 row, §11.4 step 4; R-10
 * `ai.model.opus_escalation`): the call layer runs only the route's escalation target, budget-reserved
 * at its price and recorded with tier `t3`; deep extraction re-asks once when grounding dropped a
 * field; grounded QA re-asks once below 0.8 coverage and keeps the higher-coverage answer.
 */
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { EmailDeepExtractV1 } from '@da/validation';
import { z } from 'zod';
import { deepExtract } from '../services/ai/deep-extract.ts';
import { answerGroundedEscalating, planQa } from '../services/assistant/answer.ts';
import { configRow } from '../testing/ai.ts';
import { aiUser, fixtureServices, messageRow, NOW, pipelineFlags } from '../testing/intel.ts';
import { generateStructured } from './call.ts';
import type {
  GenerateStructuredParams,
  GenerateStructuredResult,
  LLMProvider,
  ModelConfigRow,
  ModelTarget,
  StreamEvent,
  StreamParams,
} from './types.ts';
import { emptyUsage } from './types.ts';

const ESCALATION = { provider: 'anthropic' as const, model: 'escalation-model', params: {} };

function flags(escalation: boolean) {
  return pipelineFlags({
    'ai.model.opus_escalation': escalation,
    'ai.model.large.enabled': true,
    'ai.feature.email_deep_extract': true,
    'ai.feature.assistant_qa': true,
  });
}

function rows(): ModelConfigRow[] {
  return [
    configRow({
      id: 'cfg-deep',
      feature: 'email_deep_extract',
      role: 'reasoning',
      tier: 't2',
      model: 'primary-model',
      fallback_targets: [],
      escalation_target: ESCALATION,
    }),
    configRow({
      id: 'cfg-qa',
      feature: 'assistant_qa',
      role: 'assistant',
      tier: 't2',
      model: 'primary-model',
      fallback_targets: [],
      escalation_target: ESCALATION,
    }),
  ];
}

/** A provider answering per model: `by[model]` builds the structured result. */
function stubProvider(by: Record<string, () => unknown>, calls: string[]): LLMProvider {
  return {
    id: 'anthropic',
    generateStructured<T>(
      _params: GenerateStructuredParams<T>,
      target: ModelTarget,
    ): Promise<GenerateStructuredResult<T>> {
      calls.push(target.model);
      return Promise.resolve({
        data: by[target.model]!() as T,
        usage: { ...emptyUsage(), inputTokens: 100, outputTokens: 20 },
        stopReason: 'end',
        latencyMs: 5,
      });
    },
  };
}

function services(escalation: boolean, provider: LLMProvider) {
  const fx = fixtureServices({ user: { flags: flags(escalation) }, configs: rows() });
  const runtime = { ...fx.services.runtime, provider: () => provider };
  return { fx, runtime };
}

// ── Call layer ──────────────────────────────────────────────────────────────────────────────

const Tiny = z.strictObject({ answer: z.string() });

function tinyInput(escalate: boolean) {
  return {
    feature: 'email_deep_extract' as const,
    userId: aiUser().userId,
    plan: 'pro' as const,
    profile: 'balanced' as const,
    flags: flags(true),
    schema: Tiny,
    schemaName: 'EmailDeepExtractV1',
    buildPrompt: () => ({ system: 'S', instruction: 'I' }),
    cacheContent: 'same content',
    sources: ['kaynak'],
    aliases: new Set(['m1']),
    units: 1,
    correlationId: crypto.randomUUID(),
    ...(escalate ? { escalate: true } : {}),
  };
}

Deno.test(
  'T3: an escalated call runs only the escalation target, recorded with tier t3',
  async () => {
    const calls: string[] = [];
    const { fx, runtime } = services(
      true,
      stubProvider(
        { 'primary-model': () => ({ answer: 'T2' }), 'escalation-model': () => ({ answer: 'T3' }) },
        calls,
      ),
    );
    const t2 = await generateStructured(runtime, tinyInput(false));
    const t3 = await generateStructured(runtime, tinyInput(true));
    assert(t2.kind === 'ai' && t3.kind === 'ai');
    assertEquals([t2.data.answer, t3.data.answer], ['T2', 'T3']);
    assertEquals(calls, ['primary-model', 'escalation-model']);
    const rowsOut = fx.telemetry.rows.filter((r) => r.status === 'ok');
    assertEquals(
      rowsOut.map((r) => [r.tier, r.model]),
      [
        ['t2', 'primary-model'],
        ['t3', 'escalation-model'],
      ],
    );
    // Budget-aware: each call reserved before the provider was reached.
    assertEquals(fx.budget.reserves.length, 2);
    // The T3 result is cached under its own key: the T2 cache entry does not answer it.
    const again = await generateStructured(runtime, tinyInput(true));
    assert(again.kind === 'ai' && again.cached && again.data.answer === 'T3');
  },
);

Deno.test(
  'T3: without ai.model.opus_escalation the escalation is not resolved (T0 no_target)',
  async () => {
    const calls: string[] = [];
    const { runtime } = services(
      false,
      stubProvider({ 'primary-model': () => ({ answer: 'x' }) }, calls),
    );
    const out = await generateStructured(runtime, { ...tinyInput(true), flags: flags(false) });
    assertEquals(out, { kind: 't0', reason: 'no_target' });
    assertEquals(calls, []);
  },
);

Deno.test(
  'T3: a refused budget blocks the escalation (the caller keeps its T2 result)',
  async () => {
    const calls: string[] = [];
    const fx = fixtureServices({
      user: { flags: flags(true) },
      configs: rows(),
      budget: { allow: false, reason: 'hard_cap_day' },
    });
    const runtime = {
      ...fx.services.runtime,
      provider: () => stubProvider({ 'escalation-model': () => ({ answer: 'x' }) }, calls),
    };
    const out = await generateStructured(runtime, tinyInput(true));
    assertEquals(out.kind, 't0');
    assertEquals(calls, []);
    assert(fx.telemetry.rows.some((r) => r.status === 'budget_blocked' && r.tier === 't3'));
  },
);

// ── Deep extraction ─────────────────────────────────────────────────────────────────────────

const BODY = 'Merhaba, revize teklifi Cuma günü iletebilir misiniz? Sözleşme ekte.';

function deep(quote: string): EmailDeepExtractV1 {
  return {
    ref: 'm1',
    summary_tr: '',
    key_points: [{ text_tr: 'Revize teklif isteniyor', evidence: { ref: 'm1', quote } }],
    deadlines: [],
    schedule_requests: [],
    tasks_for_user: [],
    amounts: [],
    commitments: [],
    people: [],
    injection_suspected: false,
    confidence: 'high',
  };
}

async function runDeep(escalation: boolean) {
  const calls: string[] = [];
  const provider = stubProvider(
    {
      // The T2 read cites a sentence that is not in the mail: the key point is dropped.
      'primary-model': () => deep('Fiyatlar yüzde on artacak.'),
      'escalation-model': () => deep('revize teklifi Cuma günü iletebilir misiniz'),
    },
    calls,
  );
  const { runtime, fx } = services(escalation, provider);
  const user = aiUser({ flags: flags(escalation) });
  const out = await deepExtract(
    { runtime, user, correlationId: crypto.randomUUID() },
    {
      message: messageRow({ subject: 'Revize teklif' }),
      thread: null,
      body: BODY,
      now: NOW,
      senderKnown: true,
    },
  );
  return { out, calls, fx };
}

Deno.test(
  'T3: deep extraction escalates once when grounding dropped a field; the better read wins',
  async () => {
    const { out, calls, fx } = await runDeep(true);
    assertEquals(calls, ['primary-model', 'escalation-model']);
    assertEquals(out.kind, 'ai');
    assertEquals(out.droppedFields, []);
    assertEquals(out.keyPoints.length, 1);
    assert(fx.telemetry.rows.some((r) => r.tier === 't3' && r.model === 'escalation-model'));
  },
);

Deno.test('T3: without the escalation flag deep extraction keeps the T2 result', async () => {
  const { out, calls } = await runDeep(false);
  assertEquals(calls, ['primary-model']);
  assertEquals(out.droppedFields, ['key_points']);
});

// ── Grounded QA (§11.4 step 4) ──────────────────────────────────────────────────────────────

function qaProvider(calls: string[]): LLMProvider {
  return {
    id: 'anthropic',
    async *stream(_params: StreamParams, target: ModelTarget): AsyncIterable<StreamEvent> {
      calls.push(target.model);
      if (target.model === 'escalation-model') {
        yield {
          type: 'text',
          text: 'Teklif Cuma günü bekleniyor.',
          citations: [{ resultIndex: 0, source: 'r1', citedText: 'Teklif Cuma günü bekleniyor' }],
        };
      } else {
        yield { type: 'text', text: 'Teklif Pazartesi 10:00 bekleniyor.', citations: [] };
      }
      yield { type: 'usage', usage: emptyUsage() };
      yield { type: 'stop', stopReason: 'end' };
    },
  };
}

async function ask(escalation: boolean) {
  const calls: string[] = [];
  const { runtime } = services(escalation, qaProvider(calls));
  const user = aiUser({ flags: flags(escalation) });
  const plan = await planQa(runtime, user);
  assert(plan.kind === 'ok');
  let text = '';
  const result = await answerGroundedEscalating(
    runtime,
    plan,
    {
      user,
      question: 'Teklif ne zaman bekleniyor?',
      history: [],
      results: [
        { source: 'r1', title: 'Revize teklif', sentences: ['Teklif Cuma günü bekleniyor.'] },
      ],
      correlationId: crypto.randomUUID(),
    },
    {
      delta: (t) => Promise.resolve(void (text += t)),
      cite: () => Promise.resolve(),
    },
  );
  return { result, text, calls };
}

Deno.test(
  'T3: grounded QA below 0.8 coverage is re-asked on the escalation target; the higher coverage wins',
  async () => {
    const { result, text, calls } = await ask(true);
    assertEquals(calls, ['primary-model', 'escalation-model']);
    assert(result.grounded);
    assertEquals(result.coverage, 1);
    assertStringIncludes(text, 'Cuma');
    assert(!text.includes('Pazartesi'), 'the losing answer was never emitted');
  },
);

Deno.test(
  'T3: without an escalation target the QA answer streams as before (no second call)',
  async () => {
    const { result, calls } = await ask(false);
    assertEquals(calls, ['primary-model']);
    assertEquals(result.grounded, false);
  },
);
