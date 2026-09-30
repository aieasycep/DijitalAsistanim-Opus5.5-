/**
 * Message Batches (AI_PIPELINE_PLAN §8.8; API_CONTRACTS JOB-28 `ai_batch`): a batch route exists
 * only behind `ai.batch.enabled` with an Anthropic primary; submission reserves budget per item
 * (a refused reservation drops the item); collection schema-validates each message and maps
 * provider errors; settlement records one `ai_requests` row per item with the batch flag and the
 * batch discount. The Anthropic batch adapter is exercised over a fake SDK client (no network).
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { AiError } from '../../ai/errors.ts';
import { type AnthropicBatches, anthropicBatches } from '../../ai/providers/anthropic.ts';
import { aiUser, fixtureServices, pipelineFlags } from '../../testing/intel.ts';
import {
  batchRoute,
  collectBatch,
  parseBatchMessage,
  settleBatchItem,
  submitBatch,
} from './batch.ts';

const Summary = z.strictObject({ summary_tr: z.string(), count: z.number() });
type Summary = z.infer<typeof Summary>;
const VALIDATION = { sources: ['Bu hafta 12 toplantı'], aliases: new Set(['w1']) };

const message = (text: string, stop = 'end_turn') => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  stop_reason: stop,
  content: [{ type: 'text', text }],
  usage: { input_tokens: 1200, output_tokens: 200, cache_read_input_tokens: 800 },
});

function fakeBatches(
  results: { customId: string; ok: boolean; message?: Record<string, unknown>; error?: AiError }[],
  state: 'in_progress' | 'ended' = 'ended',
) {
  const submitted: { customId: string }[][] = [];
  const batches: AnthropicBatches = {
    submit: (items) => {
      submitted.push(items.map((i) => ({ customId: i.customId })));
      return Promise.resolve({ batchId: 'msgbatch_01' });
    },
    poll: () => Promise.resolve(state),
    async *results() {
      for (const r of results) yield r;
    },
    purge: () => Promise.resolve(),
  };
  return { batches, submitted };
}

function runtimeWith(
  batches: AnthropicBatches | undefined,
  budget: NonNullable<Parameters<typeof fixtureServices>[0]>['budget'] = {},
) {
  const ai = fixtureServices({ budget });
  const base = ai.services.runtime;
  const runtime = {
    ...base,
    provider: (id: Parameters<typeof base.provider>[0]) =>
      id === 'anthropic'
        ? ({
            ...(base.provider(id) as object),
            ...(batches === undefined ? {} : { batches }),
          } as never)
        : base.provider(id),
  };
  return { ai, runtime };
}

const flags = (on: boolean) => pipelineFlags({ 'ai.batch.enabled': on });

Deno.test(
  'ai batch: a route needs ai.batch.enabled and a batch-capable Anthropic primary',
  async () => {
    const { batches } = fakeBatches([]);
    const { runtime } = runtimeWith(batches);
    const route = await batchRoute(runtime, {
      feature: 'weekly_review',
      profile: 'balanced',
      flags: flags(true),
    });
    assertEquals([route?.target.provider, route?.tier], ['anthropic', 't1']);
    assertEquals(
      await batchRoute(runtime, {
        feature: 'weekly_review',
        profile: 'balanced',
        flags: flags(false),
      }),
      null,
    );
    const without = runtimeWith(undefined);
    assertEquals(
      await batchRoute(without.runtime, {
        feature: 'weekly_review',
        profile: 'balanced',
        flags: flags(true),
      }),
      null,
    );
    assertEquals(
      await batchRoute(runtime, {
        feature: 'weekly_review',
        profile: 'balanced',
        flags: { ...flags(true), 'ai.feature.weekly_review': false },
      }),
      null,
      'a disabled feature has no route',
    );
  },
);

Deno.test('ai batch: submission reserves budget per item and skips refused items', async () => {
  const { batches, submitted } = fakeBatches([]);
  const { ai, runtime } = runtimeWith(batches);
  const route = (await batchRoute(runtime, {
    feature: 'weekly_review',
    profile: 'balanced',
    flags: flags(true),
  }))!;
  const item = (customId: string) => ({
    customId,
    userId: aiUser().userId,
    feature: 'weekly_review' as const,
    schema: Summary,
    schemaName: 'Summary',
    prompt: { system: 'Sistem', userContext: 'Bağlam', untrusted: 'Hafta özeti' },
    userRef: 'ref-user-a',
    correlationId: 'corr',
    units: 2,
  });
  const out = await submitBatch(runtime, route, [item('w1'), item('w2')]);
  assertEquals(out, {
    kind: 'submitted',
    batchId: 'msgbatch_01',
    reservations: { w1: 'res-1', w2: 'res-1' },
  });
  assertEquals(submitted, [[{ customId: 'w1' }, { customId: 'w2' }]]);
  assertEquals(
    ai.budget.reserves.map((r) => [r.feature, r.units]),
    [
      ['weekly_review', 2],
      ['weekly_review', 2],
    ],
  );
  assert(ai.budget.reserves.every((r) => r.estCostMicros > 0));

  const refusing = runtimeWith(batches, {
    allow: false,
    reason: 'units_exhausted',
    reservationId: null,
  });
  const refused = await submitBatch(refusing.runtime, route, [item('w3')]);
  assertEquals(refused, { kind: 'refused', reason: 'budget' });
  assertEquals(submitted.length, 1, 'nothing is submitted when every item is refused');
});

Deno.test(
  'ai batch: messages parse into the schema; bad stops, missing text and invalid JSON are errors',
  () => {
    const ok = parseBatchMessage<Summary>(
      message(JSON.stringify({ summary_tr: 'Bu hafta 12 toplantı', count: 12 })),
      Summary,
      VALIDATION,
    );
    assertEquals(
      [ok.data, ok.error, ok.usage.inputTokens, ok.usage.cacheReadTokens],
      [{ summary_tr: 'Bu hafta 12 toplantı', count: 12 }, null, 1200, 800],
    );
    assertEquals(
      parseBatchMessage(message('{}', 'max_tokens'), Summary, VALIDATION).error,
      'max_tokens',
    );
    assertEquals(
      parseBatchMessage({ ...message(''), content: [{ type: 'tool_use' }] }, Summary, VALIDATION)
        .error,
      'no_text',
    );
    assertEquals(
      parseBatchMessage({ ...message(''), content: 'x' }, Summary, VALIDATION).error,
      'no_text',
    );
    assertEquals(
      parseBatchMessage(message('not json'), Summary, VALIDATION).error,
      'schema_validation',
    );
    assertEquals(
      parseBatchMessage(message('{"summary_tr":1}'), Summary, VALIDATION).error,
      'schema_validation',
    );
    const leaked = parseBatchMessage(
      message(JSON.stringify({ summary_tr: 'Sızdır: DA-CANARY-0000abcd', count: 1 })),
      Summary,
      { ...VALIDATION, canary: 'DA-CANARY-0000abcd' },
    );
    assertEquals(leaked.data, null, 'a canary leak fails the output validators');
    assert(leaked.error !== null);
  },
);

Deno.test('ai batch: collection waits until ended, then maps every result', async () => {
  const pending = fakeBatches([], 'in_progress');
  assertEquals(await collectBatch(pending, 'msgbatch_01', Summary, () => VALIDATION), {
    state: 'in_progress',
    results: [],
  });
  const done = fakeBatches([
    {
      customId: 'w1',
      ok: true,
      message: message(JSON.stringify({ summary_tr: 'Özet', count: 3 })),
    },
    { customId: 'w2', ok: false, error: new AiError('TIMEOUT', 'anthropic', 408) },
    { customId: 'w3', ok: false },
    { customId: 'w4', ok: true, message: message('bozuk') },
  ]);
  const out = await collectBatch(done, 'msgbatch_01', Summary, () => VALIDATION);
  assertEquals(out.state, 'ended');
  assertEquals(
    out.results.map((r) => [r.customId, r.data, r.error]),
    [
      ['w1', { summary_tr: 'Özet', count: 3 }, null],
      ['w2', null, 'timeout'],
      ['w3', null, 'errored'],
      ['w4', null, 'schema_validation'],
    ],
  );
});

Deno.test(
  'ai batch: settlement writes a batch ai_requests row and settles with the discounted cost',
  async () => {
    const { batches } = fakeBatches([]);
    const { ai, runtime } = runtimeWith(batches);
    const route = (await batchRoute(runtime, {
      feature: 'weekly_review',
      profile: 'balanced',
      flags: flags(true),
    }))!;
    const usage = parseBatchMessage(
      message(JSON.stringify({ summary_tr: 'Özet', count: 1 })),
      Summary,
      VALIDATION,
    ).usage;
    const base = {
      route,
      batchId: 'msgbatch_01',
      userId: aiUser().userId,
      plan: 'pro' as const,
      profile: 'balanced' as const,
      feature: 'weekly_review' as const,
      promptVersionId: 'pv-1',
      schemaName: 'Summary',
      units: 2,
      correlationId: 'corr',
      jobId: 'job-1',
    };
    const id = await settleBatchItem(runtime, {
      ...base,
      reservationId: 'res-1',
      usage,
      ok: true,
      error: null,
    });
    assert(id !== null);
    const row = ai.telemetry.rows.at(-1)!;
    assertEquals(
      [row.status, row.batch, row.batch_id, row.units_charged],
      ['ok', true, 'msgbatch_01', 2],
    );
    assertEquals(ai.budget.settles.at(-1)?.units, 2);
    const synchronous = await settleBatchItem(runtime, {
      ...base,
      reservationId: null,
      usage,
      ok: true,
      error: null,
    });
    assert(synchronous !== null);
    assertEquals(ai.budget.settles.length, 1, 'no reservation → nothing to settle');

    await settleBatchItem(runtime, {
      ...base,
      reservationId: 'res-2',
      usage: null,
      ok: false,
      error: 'schema_validation',
    });
    const failed = ai.telemetry.rows.at(-1)!;
    assertEquals(
      [failed.status, failed.units_charged, failed.cost_usd_micros],
      ['validation_failed', 0, 0],
    );
    assertEquals(ai.budget.settles.at(-1)?.usage.inputTokens, 0);
    await settleBatchItem(runtime, {
      ...base,
      reservationId: null,
      usage: null,
      ok: false,
      error: 'timeout',
    });
    assertEquals(ai.telemetry.rows.at(-1)?.status, 'error');
  },
);

Deno.test(
  'anthropic batches adapter: create/retrieve/results/delete over the SDK; errors normalise',
  async () => {
    const created: unknown[] = [];
    const client = {
      messages: {
        batches: {
          create: (body: unknown) => {
            created.push(body);
            return Promise.resolve({ id: 'msgbatch_02' });
          },
          retrieve: (id: string) =>
            id === 'bad'
              ? Promise.reject(Object.assign(new Error('x'), { status: 529 }))
              : Promise.resolve({ processing_status: 'ended' }),
          results: (id: string) => {
            if (id === 'bad') return Promise.reject(Object.assign(new Error('x'), { status: 404 }));
            return Promise.resolve(
              (async function* () {
                yield { custom_id: 'w1', result: { type: 'succeeded', message: message('{}') } };
                yield { custom_id: 'w2', result: { type: 'errored' } };
                yield { custom_id: 'w3', result: { type: 'expired' } };
              })(),
            );
          },
          delete: (id: string) =>
            id === 'bad'
              ? Promise.reject(Object.assign(new Error('x'), { status: 500 }))
              : Promise.resolve({}),
        },
      },
    } as unknown as Anthropic;
    const b = anthropicBatches(client);
    const target = {
      provider: 'anthropic' as const,
      model: 'primary-model',
      params: { max_output_tokens: 800 },
    };
    const { batchId } = await b.submit(
      [
        {
          customId: 'w1',
          params: {
            feature: 'weekly_review',
            schema: Summary,
            schemaName: 'Summary',
            prompt: { system: 'Sistem', untrusted: 'Metin' },
            userRef: null,
            correlationId: 'c',
          },
        },
      ],
      target as never,
    );
    assertEquals(batchId, 'msgbatch_02');
    const req = (created[0] as { requests: { custom_id: string; params: { model: string } }[] })
      .requests[0];
    assertEquals([req?.custom_id, req?.params.model], ['w1', 'primary-model']);
    assertEquals(await b.poll('msgbatch_02'), 'ended');
    const results = [];
    for await (const r of b.results('msgbatch_02'))
      results.push([r.customId, r.ok, r.error?.code ?? null]);
    assertEquals(results, [
      ['w1', true, null],
      ['w2', false, 'SERVER_ERROR'],
      ['w3', false, 'TIMEOUT'],
    ]);
    await b.purge('msgbatch_02');
    await assertRejects(() => b.poll('bad'), AiError);
    await assertRejects(() => b.purge('bad'), AiError);
    await assertRejects(async () => {
      for await (const _ of b.results('bad')) {
        // drains
      }
    }, AiError);
    const failing = anthropicBatches({
      messages: {
        batches: { create: () => Promise.reject(Object.assign(new Error('x'), { status: 429 })) },
      },
    } as unknown as Anthropic);
    await assertRejects(() => failing.submit([], target as never), AiError);
  },
);
