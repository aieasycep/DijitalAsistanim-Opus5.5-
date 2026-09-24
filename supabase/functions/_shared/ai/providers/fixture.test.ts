import { assert, assertEquals, assertFalse, assertNotEquals } from '@std/assert';
import { AI_SCHEMAS } from '@da/validation';
import type { z } from 'zod';
import { testEnv } from '../../testing/env.ts';
import type { GenerateStructuredParams } from '../types.ts';
import {
  createFixtureProvider,
  fixtureInputKey,
  fixtureProviderEnabled,
  fixtureVector,
  STRUCTURED_FIXTURES,
} from './fixture.ts';
import { createAiProviders } from './index.ts';

const target = { provider: 'fixture' as const, model: 'fixture', params: {} };

function paramsFor(
  schemaName: string,
  untrusted = 'm1: toplantı yarın',
): GenerateStructuredParams<unknown> {
  const entry = AI_SCHEMAS[schemaName as keyof typeof AI_SCHEMAS];
  return {
    feature: 'thread_summary',
    schema: entry.schema as z.ZodType<unknown>,
    schemaName,
    prompt: { system: 's', untrusted },
    userRef: null,
    correlationId: 'c',
  };
}

Deno.test(
  'the fixture provider is gated: tests/CI outside production, or an allowed demo stack',
  () => {
    assertFalse(fixtureProviderEnabled(testEnv()));
    assert(fixtureProviderEnabled(testEnv({ AI_FIXTURE_PROVIDER_ENABLED: 'true' })));
    assertFalse(
      fixtureProviderEnabled(
        testEnv({ AI_FIXTURE_PROVIDER_ENABLED: 'true', APP_ENV: 'production' }),
      ),
    );
    assert(fixtureProviderEnabled(testEnv({ DEMO_MODE: 'true' })));
    assertFalse(fixtureProviderEnabled(testEnv({ DEMO_MODE: 'true', APP_ENV: 'production' })));
  },
);

Deno.test(
  'every structured fixture validates against its schema and answers deterministically',
  async () => {
    const provider = createFixtureProvider();
    assertEquals(Object.keys(STRUCTURED_FIXTURES).length, 15);
    for (const name of Object.keys(STRUCTURED_FIXTURES)) {
      const first = await provider.generateStructured?.(paramsFor(name), target);
      const second = await provider.generateStructured?.(paramsFor(name), target);
      assertEquals(first?.stopReason, 'end', name);
      assertEquals(first?.data, second?.data, name);
    }
  },
);

Deno.test(
  'fixture keys hash the user turn; embeddings are deterministic and normalised',
  async () => {
    const a = await fixtureInputKey(paramsFor('EmailTriageV1', 'a'));
    assertEquals(a, await fixtureInputKey(paramsFor('EmailTriageV1', 'a')));
    assertNotEquals(a, await fixtureInputKey(paramsFor('EmailTriageV1', 'b')));
    const v = fixtureVector('İstanbul toplantısı yarın', 64);
    assertEquals(v, fixtureVector('istanbul TOPLANTISI yarın', 64));
    assertEquals(Math.round(Math.sqrt(v.reduce((s, x) => s + x * x, 0)) * 1e6) / 1e6, 1);
    const provider = createFixtureProvider();
    const embedded = await provider.embed?.(
      { inputs: ['a', 'b'], kind: 'query' },
      { ...target, params: { output_dimension: 16 } },
    );
    assertEquals(embedded?.dimensions, 16);
    const stt = await provider.transcribe?.(
      { audio: new Uint8Array(1), mime: 'audio/m4a', language: 'tr' },
      target,
    );
    assert((stt?.text ?? '').length > 0);
    const tts = await provider.synthesize?.(
      { text: 'x', language: 'tr-TR', format: 'mp3' },
      target,
    );
    assertEquals([tts?.bytes[0], tts?.bytes[1]], [0xff, 0xfb]);
  },
);

Deno.test('provider set: no keys means no adapters; fixture mode serves every provider id', () => {
  const none = createAiProviders(testEnv());
  assertFalse(none.fixtureMode);
  assertFalse(none.available('anthropic'));
  assertEquals(none.get('openai'), null);
  const keyed = createAiProviders(
    testEnv({ ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', VOYAGE_API_KEY: 'k' }),
  );
  assert(keyed.available('anthropic') && keyed.available('openai') && keyed.available('voyage'));
  assertFalse(keyed.available('deepgram'));
  assert(typeof keyed.get('openai')?.transcribe === 'function');
  assert(typeof keyed.get('openai')?.generateStructured === 'function');
  const fixtures = createAiProviders(testEnv({ AI_FIXTURE_PROVIDER_ENABLED: 'true' }));
  assert(fixtures.fixtureMode);
  assertEquals(fixtures.get('anthropic')?.id, 'fixture');
});
