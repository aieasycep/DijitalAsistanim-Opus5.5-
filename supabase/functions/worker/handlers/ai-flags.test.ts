/**
 * R-10 switches and the disaster-recovery embeddings in the worker:
 * - `ai.backfill.enabled` (AI_PIPELINE_PLAN §3, INTEGRATION_PLAN §3.15 stage B): backfilled mail
 *   (`origin: 'backfill'`) gets model work only for Pro users with the flag on;
 * - JOB-16 `embedding {mode:'reembed'}` (AI_PIPELINE_PLAN §10.8): batches into `embedding_dr`
 *   through the configured DR target, honours Data Source Controls and the setting, and chains;
 * - the query embedding follows `ai.embedding_dr.search` (`embedQueryText`).
 */
import { assert, assertEquals } from '@std/assert';
import { DEFAULT_AI_DATA_ACCESS } from '../../_shared/policy/data-access.ts';
import type { AiDataAccess } from '../../_shared/policy/data-access.ts';
import {
  type DrChunk,
  type EmbeddingDrConfig,
  type EmbeddingDrStore,
  embedQueryText,
  parseEmbeddingDr,
} from '../../_shared/services/memory/dr.ts';
import { embedTexts } from '../../_shared/services/memory/embed.ts';
import { intelDepsOf } from '../../_shared/testing/assist.ts';
import {
  ACCOUNT_ID,
  aiUser,
  fixtureServices,
  jobContext,
  MemoryIntel,
  messageRow,
  pipelineFlags,
  threadRow,
  uuid,
} from '../../_shared/testing/intel.ts';
import { USER_A } from '../../_shared/testing/jwt.ts';
import type { AiUser } from '../../_shared/services/ai/runtime.ts';
import { DR_BATCH, runEmbeddingDr } from './embedding_dr.ts';
import { runEmailTriage } from './email_triage.ts';

// ── ai.backfill.enabled ─────────────────────────────────────────────────────────────────────

async function backfillTriage(user: Partial<AiUser>) {
  const mem = new MemoryIntel();
  const t = threadRow({ subject: 'Sözleşme' });
  const m = messageRow({
    thread_id: t.id,
    subject: 'Sözleşme',
    from_email: 'selin@musteri.example',
  });
  mem.threads.push(t);
  mem.messages.push(m);
  mem.bodies.set(m.provider_message_id, {
    text: "Merhaba, imzalı sözleşmeyi en geç 30 Eylül'e kadar göndermeniz gerekiyor.",
    html: null,
  });
  const ai = fixtureServices({ user });
  const ctx = jobContext({
    connected_account_id: ACCOUNT_ID,
    email_message_ids: [m.id],
    origin: 'backfill' as const,
  });
  const r = await runEmailTriage(intelDepsOf(mem, ai), ctx);
  return { r, ai, mem, ctx, id: m.id };
}

Deno.test('ai.backfill.enabled on (Pro): backfilled mail is triaged by the model', async () => {
  const { r, ai } = await backfillTriage({ flags: pipelineFlags({ 'ai.backfill.enabled': true }) });
  assertEquals(r.t1, 1);
  assert(ai.calls.includes('EmailTriageV1'));
});

Deno.test(
  'ai.backfill.enabled off: backfilled mail keeps the T0 result, no model work follows',
  async () => {
    const { r, ai, mem, ctx, id } = await backfillTriage({
      flags: pipelineFlags({ 'ai.backfill.enabled': false }),
    });
    assertEquals([r.t1, r.skipped], [0, 1]);
    assertEquals(ai.calls, []);
    assertEquals(mem.messages.find((m) => m.id === id)?.ai_status, 'skipped_flag');
    assert(!ctx.enqueued.some((j) => j.type === 'email_analysis' || j.type === 'embedding'));
  },
);

Deno.test('ai.backfill.enabled: Free users get no model work on backfilled mail', async () => {
  const { r, ai, mem, id } = await backfillTriage({
    isPro: false,
    plan: 'free',
    profile: 'lean',
    flags: pipelineFlags({ 'ai.backfill.enabled': true }),
  });
  assertEquals(r.t1, 0);
  assertEquals(ai.calls, []);
  assertEquals(mem.messages.find((m) => m.id === id)?.ai_status, 't0_final');
});

// ── Disaster-recovery re-embed ──────────────────────────────────────────────────────────────

const DR_SETTING = {
  reembed: true,
  search: false,
  provider: 'openai',
  model: 'dr-embedding-model',
  dimensions: 1024,
};

function drStore(
  chunks: DrChunk[],
  options: { config?: EmbeddingDrConfig | null; access?: Map<string, AiDataAccess> } = {},
) {
  const written = new Map<string, number>();
  const store: EmbeddingDrStore & { written: Map<string, number> } = {
    written,
    get: () =>
      Promise.resolve(options.config === undefined ? parseEmbeddingDr(DR_SETTING) : options.config),
    pending: (afterId, limit) =>
      Promise.resolve(
        chunks
          .filter((c) => !written.has(c.id) && (afterId === null || c.id > afterId))
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, limit),
      ),
    access: () => Promise.resolve(options.access ?? new Map()),
    write: (rows) => {
      for (const r of rows) written.set(r.id, r.embedding.length);
      return Promise.resolve();
    },
    flags: () => Promise.resolve(pipelineFlags()),
  };
  return store;
}

function chunk(i: number, over: Partial<DrChunk> = {}): DrChunk {
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`,
    user_id: USER_A,
    chunk_kind: 'thread_summary',
    source_type: 'email_thread',
    content: `Parça ${i}`,
    ...over,
  };
}

Deno.test(
  'DR re-embed: chunks get 1024-d DR vectors through the DR target; the next batch is queued',
  async () => {
    const ai = fixtureServices();
    const chunks = Array.from({ length: DR_BATCH + 2 }, (_, i) => chunk(i + 1));
    const dr = drStore(chunks);
    const ctx = jobContext({ mode: 'reembed' as const }, { type: 'embedding' });
    const first = await runEmbeddingDr({ ...intelDepsOf(new MemoryIntel(), ai), dr }, ctx);
    assertEquals([first.embedded, first.done], [DR_BATCH, false]);
    assertEquals(
      [...dr.written.values()].every((n) => n === 1024),
      true,
    );
    const next = ctx.enqueued.find((j) => j.type === 'embedding');
    assertEquals((next?.payload as { after_id: string }).after_id, chunks[DR_BATCH - 1]!.id);
    // System call: no user budget, one ai_requests row per attempt on the DR model.
    assertEquals(ai.budget.reserves.length, 0);
    assert(ai.telemetry.rows.some((r) => r.model === 'dr-embedding-model' && r.user_id === null));
    const second = await runEmbeddingDr(
      { ...intelDepsOf(new MemoryIntel(), ai), dr },
      jobContext(next!.payload as never, { type: 'embedding' }),
    );
    assertEquals([second.embedded, second.done], [2, true]);
  },
);

Deno.test('DR re-embed: a chunk whose owner turned its class off is never sent', async () => {
  const ai = fixtureServices();
  const other = '22222222-2222-4222-8222-222222222222';
  const dr = drStore(
    [
      chunk(1, { source_type: 'contact', chunk_kind: 'person_fact', content: 'Selin Kaya' }),
      chunk(2, { user_id: other }),
    ],
    { access: new Map([[USER_A, { ...DEFAULT_AI_DATA_ACCESS, contacts: false }]]) },
  );
  const r = await runEmbeddingDr(
    { ...intelDepsOf(new MemoryIntel(), ai), dr },
    jobContext({ mode: 'reembed' as const }, { type: 'embedding' }),
  );
  assertEquals([r.embedded, r.withheld], [1, 1]);
  assert(!ai.prompts.some((p) => p.text.includes('Selin')));
});

Deno.test('DR re-embed: turned off (or not configured) the chain stops', async () => {
  const ai = fixtureServices();
  const off = drStore([chunk(1)], { config: parseEmbeddingDr({ ...DR_SETTING, reembed: false }) });
  const r = await runEmbeddingDr(
    { ...intelDepsOf(new MemoryIntel(), ai), dr: off },
    jobContext({ mode: 'reembed' as const }, { type: 'embedding' }),
  );
  assertEquals(r.skipped, 'disabled');
  assertEquals(parseEmbeddingDr({ ...DR_SETTING, dimensions: 1536 }), null);
  assertEquals(parseEmbeddingDr(null), null);
});

Deno.test('DR target: kill switches and a missing credential keep it off', async () => {
  const ai = fixtureServices();
  const target = parseEmbeddingDr(DR_SETTING)!.target;
  const base = {
    feature: 'embedding_doc' as const,
    userId: null,
    plan: null,
    profile: 'balanced' as const,
    inputs: ['x'],
    correlationId: uuid(),
    target,
  };
  const killed = await embedTexts(ai.services.runtime, {
    ...base,
    flags: pipelineFlags({ 'ai.provider.openai.enabled': false }),
  });
  assertEquals(killed.kind, 'unavailable');
  const missing = await embedTexts(
    {
      ...ai.services.runtime,
      router: { ...ai.services.runtime.router, providerAvailable: () => false },
    },
    { ...base, flags: pipelineFlags() },
  );
  assert(missing.kind === 'unavailable' && missing.reason === 'no_target');
});

Deno.test(
  'embedQueryText: DR search on → the query uses the DR model; off → the embedding_query route',
  async () => {
    const run = async (search: boolean) => {
      const ai = fixtureServices();
      const services = {
        ...ai.services,
        embeddingDr: { get: () => Promise.resolve(parseEmbeddingDr({ ...DR_SETTING, search })) },
      };
      const out = await embedQueryText(services, aiUser(), 'teklif', uuid());
      return { out, rows: ai.telemetry.rows };
    };
    const on = await run(true);
    assert(on.out.kind === 'ok' && on.out.model === 'dr-embedding-model@1024');
    const off = await run(false);
    assert(off.out.kind === 'ok' && off.out.model === 'primary-model@1024');
  },
);
