import { assert, assertEquals, assertFalse, assertRejects } from '@std/assert';
import { z } from 'zod';
import { jsonResponse, stubFetch } from '../../testing/fetch.ts';
import { AiError } from '../errors.ts';
import type { GenerateStructuredParams, ModelTarget, StreamEvent, StreamParams } from '../types.ts';
import {
  anthropicUsage,
  buildGroundedRequest,
  buildStructuredRequest,
  createAnthropicProvider,
  systemBlocks,
} from './anthropic.ts';

const Out = z.strictObject({ summary_tr: z.string(), refs: z.array(z.string()) });
type Out = z.infer<typeof Out>;

const API_KEY = `test-${crypto.randomUUID()}`;

function params(
  overrides: Partial<GenerateStructuredParams<Out>['prompt']> = {},
): GenerateStructuredParams<Out> {
  return {
    feature: 'thread_summary',
    schema: Out,
    schemaName: 'ThreadSummaryV1',
    prompt: {
      system: 'Kısa sistem.',
      userContext: 'Bağlam',
      untrusted: '<untrusted_content id="m1">x</untrusted_content>',
      instruction: 'Özetle.',
      ...overrides,
    },
    userRef: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    correlationId: '7b0c8f0e-3a1d-4d2e-9f5b-0c1d2e3f4a5b',
  };
}

const target = (params: ModelTarget['params'] = {}): ModelTarget => ({
  provider: 'anthropic',
  model: 'test-model',
  params,
});

function message(
  text: string,
  stop = 'end_turn',
  usage: Record<string, unknown> = { input_tokens: 100, output_tokens: 20 },
) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'test-model',
    content: [{ type: 'text', text }],
    stop_reason: stop,
    stop_sequence: null,
    usage,
  };
}

Deno.test(
  'request shape follows capability flags: no sampling, prefill or inference_geo by default',
  () => {
    const request = buildStructuredRequest(
      params(),
      target({
        max_output_tokens: 500,
        temperature: 0.2,
        inference_geo: 'eu',
        effort: 'low',
        thinking: { type: 'adaptive' },
      }),
    );
    assertEquals(request.model, 'test-model');
    assertEquals(request.max_tokens, 500);
    assertFalse('temperature' in request);
    assertFalse('inference_geo' in request);
    assertEquals(request.thinking, { type: 'adaptive' });
    assertEquals(request.metadata, { user_id: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' });
    const config = request.output_config as {
      effort?: string;
      format?: { type?: string; schema?: unknown };
    };
    assertEquals(config.effort, 'low');
    assertEquals(config.format?.type, 'json_schema');
    const messages = request.messages as {
      role: string;
      content: { type: string; text?: string }[];
    }[];
    assertEquals(messages.length, 1);
    assertEquals(
      messages[0]?.content.map((c) => c.text),
      ['Bağlam', '<untrusted_content id="m1">x</untrusted_content>', 'Özetle.'],
    );
    assertFalse(JSON.stringify(messages).includes('cache_control'));
  },
);

Deno.test(
  'capability flags opt in to sampling and inference_geo; effort can be disabled; minimal is never sent',
  () => {
    const opted = buildStructuredRequest(
      params(),
      target({
        temperature: 0.2,
        inference_geo: 'eu',
        effort: 'high',
        capabilities: { sampling: true, inference_geo: true, effort: false },
      }),
    );
    assertEquals(opted.temperature, 0.2);
    assertEquals(opted.inference_geo, 'eu');
    assertFalse('effort' in (opted.output_config as Record<string, unknown>));
    const minimal = buildStructuredRequest(params(), target({ effort: 'minimal' }));
    assertFalse('effort' in (minimal.output_config as Record<string, unknown>));
  },
);

Deno.test('a cache breakpoint is placed only on a long enough static system prefix', () => {
  const long = 'Kurallar. '.repeat(400);
  assertEquals(systemBlocks({ system: 'kısa' }, target())[0]?.cache_control, undefined);
  assertEquals(systemBlocks({ system: long }, target())[0]?.cache_control, { type: 'ephemeral' });
  assertEquals(systemBlocks({ system: long, cacheTtl: '1h' }, target())[0]?.cache_control, {
    type: 'ephemeral',
    ttl: '1h',
  });
  assertEquals(
    systemBlocks({ system: long, cacheTtl: null }, target())[0]?.cache_control,
    undefined,
  );
  assertEquals(
    systemBlocks({ system: long }, target({ capabilities: { min_cache_prefix_tokens: 4096 } }))[0]
      ?.cache_control,
    undefined,
  );
});

Deno.test('usage normalisation separates 5-minute and 1-hour cache writes', () => {
  assertEquals(
    anthropicUsage({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 300,
      cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 100 },
    }),
    {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 100,
      cacheWriteTokens: 200,
      cacheWrite1hTokens: 100,
      reasoningTokens: 0,
    },
  );
});

Deno.test(
  'structured call: parsed output, usage and request id through the SDK over a stubbed fetch',
  async () => {
    const stub = stubFetch(() =>
      jsonResponse(
        message(JSON.stringify({ summary_tr: 'Özet', refs: ['m1'] }), 'end_turn', {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 50,
        }),
        200,
        {
          'request-id': 'req_011',
        },
      ),
    );
    const provider = createAnthropicProvider({ apiKey: API_KEY, fetch: stub.fetch });
    const result = await provider.generateStructured?.(params(), target());
    assertEquals(result?.data, { summary_tr: 'Özet', refs: ['m1'] });
    assertEquals(result?.stopReason, 'end');
    assertEquals(result?.usage.cacheReadTokens, 50);
    assertEquals(result?.requestId, 'req_011');
    const call = stub.calls[0];
    assert(call?.url.endsWith('/v1/messages'));
    assertEquals(call?.headers.get('x-api-key'), API_KEY);
    const body = JSON.parse(call?.body ?? '{}');
    assertEquals(body.output_config.format.type, 'json_schema');
    assertFalse('temperature' in body);
  },
);

Deno.test(
  'refusal and max_tokens stop reasons are surfaced; malformed output is SCHEMA_VALIDATION',
  async () => {
    const refusal = createAnthropicProvider({
      apiKey: API_KEY,
      fetch: stubFetch(() => jsonResponse(message('', 'refusal'))).fetch,
    });
    assertEquals((await refusal.generateStructured?.(params(), target()))?.stopReason, 'refusal');
    const truncated = createAnthropicProvider({
      apiKey: API_KEY,
      fetch: stubFetch(() => jsonResponse(message('{"summ', 'max_tokens'))).fetch,
    });
    assertEquals(
      (await truncated.generateStructured?.(params(), target()))?.stopReason,
      'max_tokens',
    );
    const malformed = createAnthropicProvider({
      apiKey: API_KEY,
      fetch: stubFetch(() => jsonResponse(message('not json'))).fetch,
    });
    const error = await assertRejects(
      () => malformed.generateStructured?.(params(), target()) ?? Promise.resolve(),
      AiError,
    );
    assertEquals(error.code, 'SCHEMA_VALIDATION');
  },
);

Deno.test(
  'HTTP errors are normalised: 429 with retry-after, 529 overloaded, 401 auth',
  async () => {
    const cases: [number, string, string][] = [
      [429, 'rate_limit_error', 'RATE_LIMITED'],
      [529, 'overloaded_error', 'OVERLOADED'],
      [401, 'authentication_error', 'AUTH'],
    ];
    for (const [status, type, code] of cases) {
      const stub = stubFetch(() =>
        jsonResponse({ type: 'error', error: { type, message: 'x' } }, status, {
          'retry-after': '4',
          'request-id': 'req_err',
        }),
      );
      const provider = createAnthropicProvider({ apiKey: API_KEY, fetch: stub.fetch });
      const error = await assertRejects(
        () => provider.generateStructured?.(params(), target()) ?? Promise.resolve(),
        AiError,
      );
      assertEquals(error.code, code);
      assertEquals(error.httpStatus, status);
      if (status === 429) assertEquals(error.retryAfterMs, 4000);
      assertEquals(stub.calls.length, 1);
    }
  },
);

function sse(events: Record<string, unknown>[]): Response {
  const text = events
    .map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('');
  return new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
}

Deno.test('grounded streaming: search_result blocks in, text and citations_delta out', async () => {
  const streamParams: StreamParams = {
    system: 'Kaynaklara dayan.',
    history: [
      { role: 'user', text: 'önceki' },
      { role: 'assistant', text: 'cevap' },
    ],
    question: 'Toplantı ne zaman?',
    results: [{ source: 'r1', title: 'Toplantı', sentences: ['Toplantı perşembe 10:00.'] }],
    userRef: null,
    correlationId: 'c',
  };
  const request = buildGroundedRequest(streamParams, target());
  const last = (request.messages as { content: { type: string; citations?: unknown }[] }[]).at(-1);
  assertEquals(last?.content[0]?.type, 'search_result');
  assertEquals(last?.content[0]?.citations, { enabled: true });
  assertFalse('metadata' in request);

  const stub = stubFetch(() =>
    sse([
      {
        type: 'message_start',
        message: { ...message(''), content: [], usage: { input_tokens: 40, output_tokens: 1 } },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '', citations: [] },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Perşembe 10:00.' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'citations_delta',
          citation: {
            type: 'search_result_location',
            search_result_index: 0,
            source: 'r1',
            title: 'Toplantı',
            cited_text: 'Toplantı perşembe 10:00.',
            start_block_index: 0,
            end_block_index: 1,
          },
        },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 12 },
      },
      { type: 'message_stop' },
    ]),
  );
  const provider = createAnthropicProvider({ apiKey: API_KEY, fetch: stub.fetch });
  const events: StreamEvent[] = [];
  for await (const event of provider.stream?.(streamParams, target()) ?? []) events.push(event);
  assertEquals(events[0], { type: 'text', text: 'Perşembe 10:00.', citations: [] });
  assertEquals(events[1], {
    type: 'text',
    text: '',
    citations: [{ resultIndex: 0, source: 'r1', citedText: 'Toplantı perşembe 10:00.' }],
  });
  const usage = events.find((e) => e.type === 'usage');
  assert(usage?.type === 'usage');
  assertEquals([usage.usage.inputTokens, usage.usage.outputTokens], [40, 12]);
  assertEquals(events.at(-1), { type: 'stop', stopReason: 'end' });
  assertEquals(JSON.parse(stub.calls[0]?.body ?? '{}').stream, true);
});

Deno.test(
  'message batches: submit, poll, results (succeeded / errored / expired) and purge',
  async () => {
    const batch = {
      id: 'msgbatch_1',
      type: 'message_batch',
      processing_status: 'ended',
      results_url: 'https://api.anthropic.com/v1/messages/batches/msgbatch_1/results',
    };
    const stub = stubFetch((call) => {
      if (call.url.endsWith('/v1/messages/batches') && call.method === 'POST')
        return jsonResponse({ ...batch, processing_status: 'in_progress' });
      if (call.url.endsWith('/results')) {
        const lines = [
          {
            custom_id: 'a',
            result: { type: 'succeeded', message: message('{"summary_tr":"x","refs":[]}') },
          },
          {
            custom_id: 'b',
            result: {
              type: 'errored',
              error: { type: 'error', error: { type: 'api_error', message: 'x' } },
            },
          },
          { custom_id: 'c', result: { type: 'expired' } },
        ];
        return new Response(lines.map((l) => JSON.stringify(l)).join('\n'), {
          headers: { 'Content-Type': 'application/binary' },
        });
      }
      if (call.method === 'DELETE')
        return jsonResponse({ id: 'msgbatch_1', type: 'message_batch_deleted' });
      return jsonResponse(batch);
    });
    const provider = createAnthropicProvider({ apiKey: API_KEY, fetch: stub.fetch });
    const submitted = await provider.batches.submit(
      [{ customId: 'a', params: params() }],
      target(),
    );
    assertEquals(submitted.batchId, 'msgbatch_1');
    const sent = JSON.parse(stub.calls[0]?.body ?? '{}');
    assertEquals(sent.requests[0].custom_id, 'a');
    assertEquals(sent.requests[0].params.output_config.format.type, 'json_schema');
    assertEquals(await provider.batches.poll('msgbatch_1'), 'ended');
    const results: { customId: string; ok: boolean; code?: string }[] = [];
    for await (const r of provider.batches.results('msgbatch_1'))
      results.push({ customId: r.customId, ok: r.ok, ...(r.error ? { code: r.error.code } : {}) });
    assertEquals(results, [
      { customId: 'a', ok: true },
      { customId: 'b', ok: false, code: 'SERVER_ERROR' },
      { customId: 'c', ok: false, code: 'TIMEOUT' },
    ]);
    await provider.batches.purge('msgbatch_1');
    assert(
      stub.calls.some(
        (c) => c.method === 'DELETE' && c.url.endsWith('/v1/messages/batches/msgbatch_1'),
      ),
    );
  },
);
