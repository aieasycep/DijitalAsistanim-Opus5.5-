import { assert, assertEquals, assertFalse, assertNotEquals, assertRejects } from '@std/assert';
import { z } from 'zod';
import { jsonResponse, stubFetch } from '../testing/fetch.ts';
import { testDb } from '../testing/db.ts';
import { PRICES, promptVersion } from '../testing/ai.ts';
import { supabaseBudgetGate } from './budget.ts';
import { contentHash, providerUserRef, supabaseResultCache } from './cache.ts';
import {
  aiErrorFromHttp,
  aiErrorToAppError,
  AiError,
  normalizeAiError,
  telemetryStatus,
} from './errors.ts';
import { validateOutput } from './output-validators.ts';
import {
  costMicros,
  estimateMicros,
  maxOutputTokens,
  supabasePriceSource,
  toScaled,
} from './pricing.ts';
import { cachedPromptSource, FEATURE_PROMPT_KEY, promptCanary } from './prompts/registry.ts';
import { withRetry } from './retry.ts';
import { AI_REQUEST_COLUMNS, buildAiRequestRow, recordAttempt } from './telemetry.ts';
import { emptyUsage } from './types.ts';

const USER = '11111111-1111-4111-8111-111111111111';

Deno.test(
  'pricing: exact decimal arithmetic in µ$ for tokens, cache, batch, audio and characters',
  () => {
    assertEquals(toScaled('3.000000'), 3_000_000n);
    assertEquals(toScaled(0.025), 25_000n);
    assertEquals(toScaled(null), 0n);
    const price = PRICES[0] ?? null;
    const usage = {
      ...emptyUsage(),
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 500_000,
      cacheWriteTokens: 200_000,
      cacheWrite1hTokens: 100_000,
    };
    // 3 + 1.5 + 0.15 + 0.75 + 0.6 = 6.0 $
    assertEquals(costMicros(price, usage), 6_000_000);
    assertEquals(costMicros(price, usage, { batch: true }), 3_000_000);
    assertEquals(costMicros(price, usage, { inferenceGeo: 'us' }), 6_600_000);
    assertEquals(costMicros(null, usage), 0);
    const audio = {
      ...PRICES[0],
      audio_per_min_usd: '0.006000',
      chars_per_million_usd: '15.000000',
    } as NonNullable<typeof price>;
    assertEquals(costMicros(audio, { ...emptyUsage(), audioSeconds: 90 }), 9000);
    assertEquals(costMicros(audio, { ...emptyUsage(), characters: 1000 }), 15_000);
    assertEquals(estimateMicros(price, 4000, 800), 24_000);
    assertEquals(maxOutputTokens({ provider: 'anthropic', model: 'm', params: {} }), 1024);
  },
);

Deno.test(
  'telemetry rows only use allow-listed ai_requests columns and never carry content',
  () => {
    const row = buildAiRequestRow({
      userId: USER,
      plan: 'free',
      profile: 'lean',
      feature: 'capture_extract',
      tier: 't1',
      provider: 'openai',
      model: 'm',
      operation: 'generate',
      status: 'ok',
      usage: { ...emptyUsage(), inputTokens: 10, outputTokens: 5 },
      latencyMs: 12.6,
      correlationId: 'not-a-uuid',
      contentHash: new Uint8Array([1, 2]),
      ...({ prompt: 'secret prompt', output: 'secret output' } as Record<string, unknown>),
    } as Parameters<typeof buildAiRequestRow>[0]);
    const allowed = new Set<string>(AI_REQUEST_COLUMNS);
    assert(Object.keys(row).every((k) => allowed.has(k)));
    assertFalse(JSON.stringify(row).includes('secret'));
    assertEquals(row.latency_ms, 13);
    assertEquals(row.correlation_id, null);
    assertEquals(row.content_hash, '\\x0102');
  },
);

Deno.test('telemetry failures never break the AI call', async () => {
  const id = await recordAttempt(
    { insert: () => Promise.reject(new Error('db down')) },
    {
      userId: null,
      plan: null,
      profile: null,
      feature: 'thread_summary',
      tier: null,
      provider: 'native',
      model: 't0',
      operation: 'generate',
      status: 'killed',
      latencyMs: 0,
      correlationId: null,
    },
  );
  assertEquals(id, null);
});

Deno.test('AI errors: HTTP mapping, SDK normalisation, telemetry status and API codes', () => {
  assertEquals(aiErrorFromHttp('anthropic', 429).code, 'RATE_LIMITED');
  assertEquals(aiErrorFromHttp('anthropic', 529).code, 'OVERLOADED');
  assertEquals(aiErrorFromHttp('openai', 401).code, 'AUTH');
  assertEquals(aiErrorFromHttp('openai', 404).code, 'MODEL_UNAVAILABLE');
  assertEquals(aiErrorFromHttp('openai', 504).code, 'TIMEOUT');
  assertEquals(aiErrorFromHttp('openai', 400).code, 'BAD_REQUEST');
  const sdk = normalizeAiError('anthropic', {
    status: 429,
    headers: new Headers({ 'retry-after': '3' }),
    requestID: 'req_1',
  });
  assertEquals(
    [sdk.code, sdk.retryAfterMs, sdk.requestId, sdk.retryable],
    ['RATE_LIMITED', 3000, 'req_1', true],
  );
  assertEquals(normalizeAiError('openai', new TypeError('fetch failed')).code, 'NETWORK');
  assertEquals(normalizeAiError('openai', { name: 'AbortError' }).code, 'TIMEOUT');
  assertEquals(telemetryStatus(new AiError('REFUSAL')), 'refused');
  assertEquals(telemetryStatus(new AiError('SCHEMA_VALIDATION')), 'validation_failed');
  assertEquals(
    aiErrorToAppError(new AiError('OUTPUT_REJECTED'), 'capture_extract').code,
    'AI_OUTPUT_INVALID',
  );
  assertEquals(
    aiErrorToAppError(new AiError('OVERLOADED'), 'capture_extract').code,
    'AI_UNAVAILABLE',
  );
  assertEquals(
    aiErrorToAppError(new AiError('CREDENTIAL_MISSING'), 'x').code,
    'EXTERNAL_CREDENTIAL_REQUIRED',
  );
  assert(new AiError('SCHEMA_VALIDATION').triggersFallback);
  assertFalse(new AiError('SCHEMA_VALIDATION').retryable);
});

Deno.test(
  'withRetry: full jitter, Retry-After floor, deadline and non-retryable errors',
  async () => {
    const waits: number[] = [];
    let n = 0;
    const value = await withRetry(
      () =>
        ++n < 3
          ? Promise.reject(new AiError('OVERLOADED', 'anthropic', 529, 2000))
          : Promise.resolve('ok'),
      {
        provider: 'anthropic',
        random: () => 0.5,
        sleep: (ms) => Promise.resolve(void waits.push(ms)),
      },
    );
    assertEquals(value, 'ok');
    assertEquals(waits, [2000, 2000]);
    let calls = 0;
    await assertRejects(
      () =>
        withRetry(() => (calls++, Promise.reject(new AiError('BAD_REQUEST', 'openai', 400))), {
          provider: 'openai',
          sleep: () => Promise.resolve(),
        }),
      AiError,
    );
    assertEquals(calls, 1);
    let late = 0;
    await assertRejects(
      () =>
        withRetry(() => (late++, Promise.reject(new AiError('SERVER_ERROR', 'openai', 500))), {
          provider: 'openai',
          deadline: 1000,
          now: () => 999,
          random: () => 0.9,
          sleep: () => Promise.resolve(),
        }),
      AiError,
    );
    assertEquals(late, 1);
  },
);

Deno.test(
  'prompt registry: active version cached for 60 s; a missing version is NOT_CONFIGURED; canary from constraints',
  async () => {
    let t = 0;
    let loads = 0;
    const source = cachedPromptSource(
      (key) => {
        loads++;
        return Promise.resolve(key === 'thread_summary' ? promptVersion() : null);
      },
      { now: () => t },
    );
    assertEquals((await source.active('thread_summary')).id, 'pv-1');
    await source.active('thread_summary');
    assertEquals(loads, 1);
    t = 60_000;
    await source.active('thread_summary');
    assertEquals(loads, 2);
    assertEquals(
      (await assertRejects(() => source.active('weekly_review'), AiError)).code,
      'NOT_CONFIGURED',
    );
    assertEquals(promptCanary(promptVersion()), 'CANARY-7f3a9c2e');
    assertEquals(promptCanary(promptVersion({ model_constraints: {} })), undefined);
    assertEquals(FEATURE_PROMPT_KEY.email_triage, 'email_classification');
  },
);

Deno.test(
  'cache keys: per-user HMAC over Turkish-normalised content; provider pseudonyms differ from hashes',
  async () => {
    const pepper = 'x'.repeat(44);
    const a = await contentHash(pepper, USER, 'İstanbul toplantısı');
    const b = await contentHash(pepper, USER, '  istanbul   TOPLANTISI ');
    const other = await contentHash(
      pepper,
      '22222222-2222-4222-8222-222222222222',
      'İstanbul toplantısı',
    );
    assertEquals(a, b);
    assertNotEquals(a, other);
    assertEquals(a.byteLength, 32);
    const ref = await providerUserRef(pepper, USER);
    assertEquals(ref.length, 32);
    assertFalse(ref.includes(USER));
  },
);

Deno.test('output validator rejects UUID-like identifiers and reparses after cleaning', () => {
  const schema = z.strictObject({ reason_tr: z.string().min(3) });
  const leak = validateOutput(
    schema,
    { reason_tr: 'Kayıt 9f1c1b4e-0000-4000-8000-000000000000 bulundu' },
    { sources: [], aliases: new Set() },
  );
  assertEquals(leak.ok, false);
  const empty = validateOutput(
    schema,
    { reason_tr: 'https://x.example' },
    { sources: [], aliases: new Set() },
  );
  assertEquals(empty, { ok: false, reason: 'schema_after_cleaning', path: 'reason_tr' });
  const kept = validateOutput(
    schema,
    { reason_tr: 'Bkz. https://docs.example/a' },
    { sources: ['link https://docs.example/a'], aliases: new Set() },
  );
  assert(kept.ok);
  assertEquals(kept.data.reason_tr, 'Bkz. https://docs.example/a');
});

Deno.test(
  'supabase adapters: budget reserve/settle RPCs via public wrappers, telemetry insert, result cache, price source',
  async () => {
    const stub = stubFetch((call) => {
      if (call.url.includes('/rpc/ai_budget_reserve'))
        return jsonResponse({ allow: true, level: 'l1', reason: null, reservation_id: 'r-1' });
      if (call.url.includes('/rpc/ai_budget_settle')) return jsonResponse(null);
      if (call.url.includes('/ai_result_cache') && call.method === 'GET') {
        return jsonResponse({
          id: 'c1',
          result: { a: 1 },
          model: 'm',
          hit_count: 2,
          expires_at: null,
        });
      }
      if (call.url.includes('/ai_model_prices')) return jsonResponse(PRICES);
      return jsonResponse([], 201);
    });
    const client = testDb(stub.fetch);
    const budget = supabaseBudgetGate(client);
    const reservation = await budget.reserve({
      userId: USER,
      feature: 'thread_summary',
      estCostMicros: 1234.4,
      units: 1,
    });
    assertEquals(reservation, { allow: true, level: 'l1', reason: null, reservationId: 'r-1' });
    assertEquals(stub.calls[0]?.headers.get('Content-Profile'), 'public');
    assertEquals(JSON.parse(stub.calls[0]?.body ?? '{}'), {
      p_user: USER,
      p_feature: 'thread_summary',
      p_est_cost_micros: 1234,
      p_units: 1,
    });
    await budget.settle({
      reservationId: 'r-1',
      aiRequestId: 'req-1',
      actualCostMicros: 99.6,
      units: 1,
      usage: { ...emptyUsage(), inputTokens: 5 },
    });
    assertEquals(JSON.parse(stub.calls[1]?.body ?? '{}').p_actual_cost_micros, 100);

    const cache = supabaseResultCache(client, () => Date.parse('2026-09-23T07:00:00Z'));
    const key = {
      userId: USER,
      feature: 'thread_summary' as const,
      contentHash: new Uint8Array([0xab]),
      promptVersionId: 'pv-1',
    };
    assertEquals(await cache.get(key), { result: { a: 1 }, model: 'm' });
    const read = decodeURIComponent(stub.calls[2]?.url ?? '');
    assert(read.includes('content_hash=eq.\\xab'));
    assertEquals(JSON.parse(stub.calls[3]?.body ?? '{}').hit_count, 3);
    await cache.put(key, { result: { a: 1 }, model: 'm' });
    assert(
      decodeURIComponent(stub.calls[4]?.url ?? '').includes(
        'on_conflict=user_id,feature,content_hash,prompt_version_id',
      ),
    );

    const prices = supabasePriceSource(client);
    assertEquals((await prices.price('openai', 'fallback-model'))?.output_per_mtok_usd, 2);
    assertEquals(await prices.price('openai', 'unknown'), null);
  },
);
