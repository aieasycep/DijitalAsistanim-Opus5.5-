import { assert, assertEquals, assertFalse, assertRejects } from '@std/assert';
import { z } from 'zod';
import { jsonResponse, stubFetch } from '../../testing/fetch.ts';
import { AiError } from '../errors.ts';
import type { GenerateStructuredParams, ModelTarget } from '../types.ts';
import { buildResponsesRequest, createOpenAIProvider, openaiUsage } from './openai.ts';
import { createOpenAIAudioProvider } from './openai-audio.ts';

const Out = z.strictObject({ category: z.enum(['a', 'b']), note_tr: z.string() });
type Out = z.infer<typeof Out>;
const API_KEY = `test-${crypto.randomUUID()}`;

function params(): GenerateStructuredParams<Out> {
  return {
    feature: 'email_triage',
    schema: Out,
    schemaName: 'EmailTriageV1',
    prompt: {
      system: 'Sınıflandır.',
      untrusted: '<untrusted_content id="m1">x</untrusted_content>',
      images: [{ ref: 'i1', mime: 'image/png', b64: 'iVBORw0KGgo=' }],
      pdf: { ref: 'd1', b64: 'JVBERi0=' },
    },
    userRef: 'f'.repeat(32),
    correlationId: 'c',
  };
}

const target = (p: ModelTarget['params'] = {}): ModelTarget => ({
  provider: 'openai',
  model: 'test-model',
  params: p,
});

function response(content: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return {
    id: 'resp_1',
    object: 'response',
    created_at: 1,
    status: 'completed',
    model: 'test-model',
    output: [{ type: 'message', id: 'msg_1', status: 'completed', role: 'assistant', content }],
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 40 },
      output_tokens: 20,
      output_tokens_details: { reasoning_tokens: 5 },
      total_tokens: 120,
    },
    ...extra,
  };
}

Deno.test(
  'Responses request: strict json_schema format, effort, safety_identifier, store false, no sampling by default',
  () => {
    const request = buildResponsesRequest(
      params(),
      target({ effort: 'minimal', temperature: 0.3, max_output_tokens: 300 }),
    );
    const format = (request.text as { format: { type: string; strict: boolean; name: string } })
      .format;
    assertEquals([format.type, format.strict, format.name], ['json_schema', true, 'EmailTriageV1']);
    assertEquals(request.reasoning, { effort: 'minimal' });
    assertEquals(request.safety_identifier, 'f'.repeat(32));
    assertEquals(request.store, false);
    assertEquals(request.max_output_tokens, 300);
    assertFalse('temperature' in request);
    const user = (request.input as { role: string; content: { type: string }[] }[])[1];
    assertEquals(
      user?.content.map((c) => c.type),
      ['input_image', 'input_file', 'input_text'],
    );
    const sampled = buildResponsesRequest(
      { ...params(), userRef: null },
      target({ temperature: 0.3, capabilities: { sampling: true } }),
    );
    assertEquals(sampled.temperature, 0.3);
    assertFalse('safety_identifier' in sampled);
    assertFalse('reasoning' in sampled);
  },
);

Deno.test('usage: cached input tokens are split out of input_tokens', () => {
  assertEquals(openaiUsage(response([]).usage), {
    inputTokens: 60,
    outputTokens: 20,
    cacheReadTokens: 40,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    reasoningTokens: 5,
  });
});

Deno.test(
  'structured call parses output_text through responses.parse over a stubbed fetch',
  async () => {
    const stub = stubFetch(() =>
      jsonResponse(
        response([
          {
            type: 'output_text',
            text: JSON.stringify({ category: 'a', note_tr: 'Not' }),
            annotations: [],
          },
        ]),
        200,
        { 'x-request-id': 'req_oa' },
      ),
    );
    const provider = createOpenAIProvider({ apiKey: API_KEY, fetch: stub.fetch });
    const result = await provider.generateStructured?.(params(), target());
    assertEquals(result?.data, { category: 'a', note_tr: 'Not' });
    assertEquals(result?.stopReason, 'end');
    assertEquals(result?.requestId, 'req_oa');
    assert(stub.calls[0]?.url.endsWith('/v1/responses'));
    assertEquals(stub.calls[0]?.headers.get('Authorization'), `Bearer ${API_KEY}`);
  },
);

Deno.test(
  'refusals, truncation, invalid JSON and HTTP errors map to stop reasons and AiError codes',
  async () => {
    const refusal = createOpenAIProvider({
      apiKey: API_KEY,
      fetch: stubFetch(() => jsonResponse(response([{ type: 'refusal', refusal: 'no' }]))).fetch,
    });
    assertEquals((await refusal.generateStructured?.(params(), target()))?.stopReason, 'refusal');
    const truncated = createOpenAIProvider({
      apiKey: API_KEY,
      fetch: stubFetch(() =>
        jsonResponse(
          response([], {
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: [],
          }),
        ),
      ).fetch,
    });
    assertEquals(
      (await truncated.generateStructured?.(params(), target()))?.stopReason,
      'max_tokens',
    );
    const invalid = createOpenAIProvider({
      apiKey: API_KEY,
      fetch: stubFetch(() =>
        jsonResponse(
          response([
            { type: 'output_text', text: '{"category":"z","note_tr":"x"}', annotations: [] },
          ]),
        ),
      ).fetch,
    });
    assertEquals(
      (
        await assertRejects(
          () => invalid.generateStructured?.(params(), target()) ?? Promise.resolve(),
          AiError,
        )
      ).code,
      'SCHEMA_VALIDATION',
    );
    const limited = createOpenAIProvider({
      apiKey: API_KEY,
      fetch: stubFetch(() =>
        jsonResponse({ error: { type: 'rate_limit_error', message: 'x' } }, 429, {
          'retry-after': '2',
        }),
      ).fetch,
    });
    const error = await assertRejects(
      () => limited.generateStructured?.(params(), target()) ?? Promise.resolve(),
      AiError,
    );
    assertEquals([error.code, error.retryAfterMs], ['RATE_LIMITED', 2000]);
  },
);

Deno.test('embeddings send the configured dimensions and check the returned size', async () => {
  const ok = stubFetch(() =>
    jsonResponse({
      object: 'list',
      data: [
        { object: 'embedding', index: 1, embedding: [0, 1] },
        { object: 'embedding', index: 0, embedding: [1, 0] },
      ],
      model: 'test-embed',
      usage: { prompt_tokens: 4, total_tokens: 4 },
    }),
  );
  const provider = createOpenAIProvider({ apiKey: API_KEY, fetch: ok.fetch });
  const result = await provider.embed?.(
    { inputs: ['a', 'b'], kind: 'document' },
    { provider: 'openai', model: 'test-embed', params: { output_dimension: 2 } },
  );
  assertEquals(result?.vectors, [
    [1, 0],
    [0, 1],
  ]);
  assertEquals(JSON.parse(ok.calls[0]?.body ?? '{}').dimensions, 2);
  const wrong = createOpenAIProvider({
    apiKey: API_KEY,
    fetch: stubFetch(() =>
      jsonResponse({
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding: [1] }],
        model: 'm',
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }),
    ).fetch,
  });
  const error = await assertRejects(
    () =>
      wrong.embed?.(
        { inputs: ['a'], kind: 'query' },
        { provider: 'openai', model: 'm', params: { output_dimension: 2 } },
      ) ?? Promise.resolve(),
    AiError,
  );
  assertEquals(error.code, 'SCHEMA_VALIDATION');
});

Deno.test(
  'audio: transcription maps text and seconds; unknown MIME is refused; speech returns bytes',
  async () => {
    const stub = stubFetch((call) =>
      call.url.endsWith('/audio/transcriptions')
        ? jsonResponse({ text: 'Yarın 10:00 toplantı', usage: { type: 'duration', seconds: 3 } })
        : new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x64]), {
            headers: { 'Content-Type': 'audio/mpeg' },
          }),
    );
    const audio = createOpenAIAudioProvider({ apiKey: API_KEY, fetch: stub.fetch });
    const stt = await audio.transcribe?.(
      {
        audio: new Uint8Array([1, 2, 3]),
        mime: 'audio/m4a',
        language: 'tr',
        keyterms: ['Dijital Asistan'],
      },
      { provider: 'openai', model: 'test-stt', params: {} },
    );
    assertEquals(stt, {
      text: 'Yarın 10:00 toplantı',
      confidence: null,
      usage: { audioSeconds: 3 },
    });
    const bad = await assertRejects(
      () =>
        audio.transcribe?.(
          { audio: new Uint8Array([1]), mime: 'video/mp4', language: 'tr' },
          { provider: 'openai', model: 'm', params: {} },
        ) ?? Promise.resolve(),
      AiError,
    );
    assertEquals(bad.code, 'BAD_REQUEST');
    const tts = await audio.synthesize?.(
      { text: 'Günaydın', language: 'tr-TR', format: 'mp3' },
      { provider: 'openai', model: 'test-tts', params: { voice: 'alloy' } },
    );
    assertEquals(tts?.mime, 'audio/mpeg');
    assertEquals(tts?.bytes.byteLength, 4);
    assertEquals(tts?.usage.characters, 8);
    const speech = stub.calls.find((c) => c.url.endsWith('/audio/speech'));
    assertEquals(JSON.parse(speech?.body ?? '{}'), {
      model: 'test-tts',
      voice: 'alloy',
      input: 'Günaydın',
      response_format: 'mp3',
    });
    const noVoice = await assertRejects(
      () =>
        audio.synthesize?.(
          { text: 'x', language: 'tr-TR', format: 'mp3' },
          { provider: 'openai', model: 'm', params: {} },
        ) ?? Promise.resolve(),
      AiError,
    );
    assertEquals(noVoice.code, 'NOT_CONFIGURED');
  },
);
