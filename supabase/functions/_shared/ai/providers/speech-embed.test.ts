import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';
import { jsonResponse, stubFetch } from '../../testing/fetch.ts';
import { AiError } from '../errors.ts';
import { azureEndpoint, azureSsml, createAzureTtsProvider } from './azure-tts.ts';
import { createDeepgramProvider, deepgramUrl } from './deepgram.ts';
import { createElevenLabsProvider, elevenLabsRequest } from './elevenlabs.ts';
import { buildVoyageRequest, createVoyageProvider, VOYAGE_ENDPOINT } from './voyage.ts';

const KEY = `test-${crypto.randomUUID()}`;

Deno.test(
  'voyage: input_type and output_dimension from the target; order restored; dimensions checked',
  async () => {
    const target = {
      provider: 'voyage' as const,
      model: 'test-embed',
      params: { output_dimension: 3 },
    };
    assertEquals(buildVoyageRequest({ inputs: ['a'], kind: 'query' }, target), {
      model: 'test-embed',
      input: ['a'],
      input_type: 'query',
      output_dimension: 3,
    });
    const stub = stubFetch(() =>
      jsonResponse({
        data: [
          { index: 1, embedding: [0, 1, 0] },
          { index: 0, embedding: [1, 0, 0] },
        ],
        usage: { total_tokens: 7 },
      }),
    );
    const provider = createVoyageProvider({ apiKey: KEY, fetch: stub.fetch });
    const result = await provider.embed?.({ inputs: ['bir', 'iki'], kind: 'document' }, target);
    assertEquals(result, {
      vectors: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      usage: { tokens: 7 },
      dimensions: 3,
    });
    assertEquals(stub.calls[0]?.url, VOYAGE_ENDPOINT);
    assertEquals(stub.calls[0]?.headers.get('Authorization'), `Bearer ${KEY}`);

    const wrong = createVoyageProvider({
      apiKey: KEY,
      fetch: stubFetch(() => jsonResponse({ data: [{ index: 0, embedding: [1] }] })).fetch,
    });
    assertEquals(
      (
        await assertRejects(
          () => wrong.embed?.({ inputs: ['x'], kind: 'query' }, target) ?? Promise.resolve(),
          AiError,
        )
      ).code,
      'SCHEMA_VALIDATION',
    );
    const limited = createVoyageProvider({
      apiKey: KEY,
      fetch: stubFetch(() => new Response('', { status: 429, headers: { 'Retry-After': '5' } }))
        .fetch,
    });
    const error = await assertRejects(
      () => limited.embed?.({ inputs: ['x'], kind: 'query' }, target) ?? Promise.resolve(),
      AiError,
    );
    assertEquals([error.code, error.retryAfterMs], ['RATE_LIMITED', 5000]);
    const tooMany = await assertRejects(
      () =>
        provider.embed?.(
          { inputs: Array.from({ length: 129 }, () => 'x'), kind: 'document' },
          target,
        ) ?? Promise.resolve(),
      AiError,
    );
    assertEquals(tooMany.code, 'BAD_REQUEST');
  },
);

Deno.test(
  'deepgram: model, language and keyterms in the query; Token auth; transcript and duration mapped',
  async () => {
    const params = {
      audio: new Uint8Array([1, 2]),
      mime: 'audio/m4a',
      language: 'tr' as const,
      keyterms: ['Dijital Asistan', 'Ayşe'],
    };
    const target = { provider: 'deepgram' as const, model: 'test-stt', params: {} };
    const url = new URL(deepgramUrl(params, target));
    assertEquals(url.searchParams.get('model'), 'test-stt');
    assertEquals(url.searchParams.get('language'), 'tr');
    assertEquals(url.searchParams.getAll('keyterm'), ['Dijital Asistan', 'Ayşe']);
    const stub = stubFetch(() =>
      jsonResponse({
        metadata: { duration: 4.2 },
        results: { channels: [{ alternatives: [{ transcript: 'yarın ara', confidence: 0.93 }] }] },
      }),
    );
    const result = await createDeepgramProvider({ apiKey: KEY, fetch: stub.fetch }).transcribe?.(
      params,
      target,
    );
    assertEquals(result, { text: 'yarın ara', confidence: 0.93, usage: { audioSeconds: 4.2 } });
    assertEquals(stub.calls[0]?.headers.get('Authorization'), `Token ${KEY}`);
    assertEquals(stub.calls[0]?.headers.get('Content-Type'), 'audio/m4a');
    const down = createDeepgramProvider({
      apiKey: KEY,
      fetch: stubFetch(() => new Response('', { status: 503 })).fetch,
    });
    assertEquals(
      (await assertRejects(() => down.transcribe?.(params, target) ?? Promise.resolve(), AiError))
        .code,
      'SERVER_ERROR',
    );
  },
);

Deno.test(
  'azure TTS: SSML is escaped, the region is validated, the key is sent as a header',
  async () => {
    assertEquals(
      azureSsml(
        { text: 'Toplantı <saat 10> & "oda"', language: 'tr-TR', format: 'mp3' },
        'tr-TR-EmelNeural',
      ),
      '<speak version="1.0" xml:lang="tr-TR"><voice name="tr-TR-EmelNeural">Toplantı &lt;saat 10&gt; &amp; &quot;oda&quot;</voice></speak>',
    );
    assertEquals(
      azureEndpoint('westeurope'),
      'https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1',
    );
    assertThrows(() => azureEndpoint('evil.example/'), AiError);
    const stub = stubFetch(
      () =>
        new Response(new Uint8Array([0xff, 0xfb]), { headers: { 'Content-Type': 'audio/mpeg' } }),
    );
    const provider = createAzureTtsProvider({ apiKey: KEY, fetch: stub.fetch });
    const result = await provider.synthesize?.(
      { text: 'Günaydın', language: 'tr-TR', format: 'mp3' },
      {
        provider: 'azure_speech',
        model: 'neural',
        params: { region: 'westeurope', voice: 'tr-TR-EmelNeural' },
      },
    );
    assertEquals(result?.bytes.byteLength, 2);
    assertEquals(stub.calls[0]?.headers.get('Ocp-Apim-Subscription-Key'), KEY);
    const missing = await assertRejects(
      () =>
        provider.synthesize?.(
          { text: 'x', language: 'tr-TR', format: 'mp3' },
          { provider: 'azure_speech', model: 'n', params: {} },
        ) ?? Promise.resolve(),
      AiError,
    );
    assertEquals(missing.code, 'NOT_CONFIGURED');
  },
);

Deno.test(
  'elevenlabs: voice id validated, model and language in the body, xi-api-key header',
  async () => {
    const target = {
      provider: 'elevenlabs' as const,
      model: 'test-tts',
      params: { voice: 'Voice1234abcd' },
    };
    const request = elevenLabsRequest(
      { text: 'Merhaba', language: 'tr-TR', format: 'mp3' },
      target,
    );
    assertEquals(
      request.url,
      'https://api.elevenlabs.io/v1/text-to-speech/Voice1234abcd?output_format=mp3_44100_128',
    );
    assertEquals(request.body, { text: 'Merhaba', model_id: 'test-tts', language_code: 'tr' });
    assertThrows(
      () =>
        elevenLabsRequest(
          { text: 'x', language: 'tr-TR', format: 'mp3' },
          { ...target, params: { voice: '../x' } },
        ),
      AiError,
    );
    const stub = stubFetch(() => new Response(new Uint8Array([1, 2, 3])));
    const result = await createElevenLabsProvider({ apiKey: KEY, fetch: stub.fetch }).synthesize?.(
      { text: 'Merhaba', language: 'tr-TR', format: 'mp3' },
      target,
    );
    assertEquals(result?.usage.characters, 7);
    assertEquals(stub.calls[0]?.headers.get('xi-api-key'), KEY);
    assert(stub.calls[0]?.headers.get('Accept') === 'audio/mpeg');
  },
);
