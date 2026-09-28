/**
 * Data Source Controls in the background pipeline (SECURITY_AND_PRIVACY_PLAN §4.4, API_CONTRACTS
 * §4.5, SCREEN_AND_FLOW_MAP M-SET-32 tests): with a class of `user_preferences.ai_data_access`
 * off, its data never appears in a rendered prompt (the fixture provider records every request)
 * and is never embedded. Each case has an "on" control proving the data would otherwise be sent.
 */
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { AiDataAccess } from '../../_shared/policy/data-access.ts';
import { briefingChapters } from '../../_shared/services/briefings/audio.ts';
import { fromEvent } from '../../_shared/services/briefings/items.ts';
import { polishDrafts } from '../../_shared/services/briefings/polish.ts';
import type { MemorySource, MemoryStore } from '../../_shared/services/intel/store.ts';
import type { BriefingItemRow, MemoryChunkRow } from '../../_shared/services/intel/types.ts';
import { assistFixture, intelDepsOf } from '../../_shared/testing/assist.ts';
import {
  ACCOUNT_ID,
  briefingRow,
  eventRow,
  fixtureServices,
  jobContext,
  MemoryIntel,
  messageRow,
  NOW,
  pipelineFlags,
  threadRow,
  uuid,
} from '../../_shared/testing/intel.ts';
import { USER_A } from '../../_shared/testing/jwt.ts';
import { runBriefing } from './briefing.ts';
import { runCaptureAnalysis } from './capture_analysis.ts';
import { runEmailTriage } from './email_triage.ts';
import { runEmbedding } from './embedding.ts';
import { runInsightRefresh } from './insight_refresh.ts';

const ON: AiDataAccess = {
  mailBody: true,
  attachments: true,
  calendar: true,
  contacts: true,
  locationCoarse: false,
};

function access(patch: Partial<AiDataAccess>): AiDataAccess {
  return { ...ON, ...patch };
}

function sent(ai: ReturnType<typeof fixtureServices>, name?: string): string {
  return ai.prompts
    .filter((p) => name === undefined || p.name === name)
    .map((p) => p.text)
    .join('\n');
}

// ── Triage ──────────────────────────────────────────────────────────────────────────────────

async function triage(patch: Partial<AiDataAccess>) {
  const mem = new MemoryIntel();
  const t = threadRow({ subject: 'Revize teklif' });
  const m = messageRow({
    thread_id: t.id,
    subject: 'Revize teklif',
    snippet: 'Merhaba, gizli fiyat listesini ekte bulabilirsiniz',
  });
  mem.threads.push(t);
  mem.messages.push(m);
  mem.bodies.set(m.provider_message_id, {
    text: 'Merhaba, gizli fiyat listesini ekte bulabilirsiniz. Revize teklifi Cuma günü iletebilir misiniz?',
    html: null,
  });
  const ai = fixtureServices({ user: { dataAccess: access(patch) } });
  await runEmailTriage(
    intelDepsOf(mem, ai),
    jobContext({
      connected_account_id: ACCOUNT_ID,
      email_message_ids: [m.id],
      origin: 'incremental' as const,
    }),
  );
  return sent(ai, 'EmailTriageV1');
}

Deno.test('Data Source Controls: triage sends the body with mail_body on (control)', async () => {
  const prompt = await triage({});
  assertStringIncludes(prompt, 'gizli fiyat listesini');
  assertStringIncludes(prompt, 'vip ');
});

Deno.test(
  'Data Source Controls: mail_body off → triage sends sender and subject only (no body, no snippet)',
  async () => {
    const prompt = await triage({ mailBody: false });
    assertStringIncludes(prompt, 'Revize teklif');
    assert(!prompt.includes('gizli fiyat'), 'body or snippet reached the prompt');
  },
);

Deno.test(
  'Data Source Controls: contacts off → the triage context drops the contact-book VIP mark',
  async () => {
    const prompt = await triage({ contacts: false });
    assertStringIncludes(prompt, 'Revize teklif');
    assert(!prompt.includes('vip '), 'the VIP mark reached the prompt');
  },
);

// ── Briefings ───────────────────────────────────────────────────────────────────────────────

async function morning(patch: Partial<AiDataAccess>) {
  const mem = new MemoryIntel();
  const ai = fixtureServices({ user: { dataAccess: access(patch) } });
  const deps = intelDepsOf(mem, ai);
  for (let i = 0; i < 3; i++) {
    const t = threadRow({ subject: `Teklif ${i + 1}` });
    const m = messageRow({
      thread_id: t.id,
      subject: `Teklif ${i + 1}`,
      from_email: `musteri${i}@firma${i}.example`,
    });
    mem.threads.push(t);
    mem.messages.push(m);
    mem.bodies.set(m.provider_message_id, {
      text: `Merhaba, teklif ${i + 1} için bugün 17:00'ye kadar dönüş yapabilir misiniz?`,
      html: null,
    });
  }
  await runEmailTriage(
    deps,
    jobContext({
      connected_account_id: ACCOUNT_ID,
      email_message_ids: mem.messages.map((m) => m.id),
      origin: 'incremental' as const,
    }),
  );
  await runInsightRefresh(
    deps,
    jobContext({ user_id: USER_A, scope: 'all' as const, reason: 't' }),
  );
  mem.events.push(
    eventRow({ title: 'Kuzey Lojistik', location: 'Kadıköy Rıhtım Ofisi' }),
    eventRow({
      title: 'Bütçe',
      location: 'Levent Plaza',
      start_at: new Date(NOW.getTime() + 5 * 3_600_000).toISOString(),
      end_at: new Date(NOW.getTime() + 6 * 3_600_000).toISOString(),
    }),
  );
  const row = briefingRow();
  mem.briefings.push(row);
  const r = await runBriefing(deps, jobContext({ briefing_id: row.id }, { type: 'briefing' }));
  assertEquals(r.status, 'ready');
  return { prompt: sent(ai, 'BriefingMorningV1'), mem };
}

Deno.test(
  'Data Source Controls: calendar off → the morning briefing prompt lists events by title and time only',
  async () => {
    const on = await morning({});
    assertStringIncludes(on.prompt, 'Kadıköy Rıhtım Ofisi');
    const off = await morning({ calendar: false });
    assertStringIncludes(off.prompt, 'Kuzey Lojistik');
    assert(!off.prompt.includes('Kadıköy'), 'event location reached the prompt');
    assert(!off.prompt.includes('Levent'), 'event location reached the prompt');
    // The stored briefing items (shown to the user, never sent) keep the location.
    assert(off.mem.items.some((i) => (i.meta ?? '').includes('Kadıköy')));
  },
);

Deno.test(
  'Data Source Controls: calendar off → midday / evening polish sees event times, keeps the stored meta',
  async () => {
    const run = async (patch: Partial<AiDataAccess>) => {
      const ai = fixtureServices({
        user: {
          dataAccess: access(patch),
          flags: pipelineFlags({ 'ai.feature.briefing_polish': true }),
        },
      });
      const draft = fromEvent(
        eventRow({ title: 'Kuzey Lojistik', location: 'Kadıköy Ofisi' }),
        'Europe/Istanbul',
        'tr',
      );
      const out = await polishDrafts(
        {
          runtime: ai.services.runtime,
          user: await ai.services.users.load(USER_A),
          correlationId: uuid(),
        },
        'briefing_midday',
        [draft],
        NOW,
      );
      return { prompt: sent(ai, 'BriefingPolishV1'), out, draft };
    };
    const on = await run({});
    assertStringIncludes(on.prompt, 'Kadıköy Ofisi');
    const off = await run({ calendar: false });
    assertStringIncludes(off.prompt, 'Kuzey Lojistik');
    assert(!off.prompt.includes('Kadıköy'), 'event location reached the prompt');
    assertEquals(off.out.drafts[0]!.meta, off.draft.meta);
  },
);

Deno.test(
  'Data Source Controls: premium briefing audio reads event rows without calendar details',
  () => {
    const item = (over: Partial<BriefingItemRow>): BriefingItemRow =>
      ({
        id: uuid(),
        section: 'schedule',
        position: 0,
        title: 'Kuzey Lojistik',
        meta: '10:30–11:30 · Kadıköy Ofisi',
        entity_type: 'calendar_event',
        ...over,
      }) as unknown as BriefingItemRow;
    const briefing = { hero_line: 'Bugün 1 şey var.', narrative: null, sections: ['schedule'] };
    const full = briefingChapters(briefing as never, [item({})], 'tr');
    assertStringIncludes(full.map((c) => c.text).join(' '), 'Kadıköy');
    const guarded = briefingChapters(
      briefing as never,
      [item({})],
      'tr',
      access({ calendar: false }),
    );
    const text = guarded.map((c) => c.text).join(' ');
    assertStringIncludes(text, 'Kuzey Lojistik');
    assert(!text.includes('Kadıköy'));
    const mail = briefingChapters(
      briefing as never,
      [item({ entity_type: 'email_thread', title: 'Teklif', meta: 'Mehmet Bey bekliyor' })],
      'tr',
      access({ calendar: false }),
    );
    assertStringIncludes(mail.map((c) => c.text).join(' '), 'Mehmet Bey bekliyor');
  },
);

// ── AI memory ───────────────────────────────────────────────────────────────────────────────

function sourcesStore(mem: MemoryIntel): MemoryStore {
  const base = mem.memoryStore();
  const src = (
    chunkKind: string,
    sourceType: MemorySource['sourceType'],
    content: string,
  ): MemorySource => ({
    userId: USER_A,
    chunkKind,
    sourceType,
    sourceId: uuid(),
    sourceProvider:
      sourceType === 'calendar_event' || sourceType === 'email_thread' ? 'google' : null,
    sourceTimestamp: NOW.toISOString(),
    occurredAt: NOW.toISOString(),
    confidence: 1,
    evidence: [],
    contactIds: [],
    content,
    expiresAt: null,
  });
  return {
    ...base,
    sources: () =>
      Promise.resolve([
        src('person_fact', 'contact', 'Mehmet Yılmaz\nKurum: Yılmaz Endüstri'),
        src('event', 'calendar_event', 'Teklif görüşmesi\nKonum: Kadıköy Ofisi'),
        src('thread_summary', 'email_thread', 'Konu: Revize teklif\nÖzet: fiyat yüzde on artıyor'),
        src('life_event', 'life_event', 'Kargo yolda\nTür: shipment'),
      ]),
  };
}

async function embed(patch: Partial<AiDataAccess>) {
  const mem = new MemoryIntel();
  const ai = fixtureServices({ user: { dataAccess: access(patch) } });
  const deps = { ...intelDepsOf(mem, ai), memory: sourcesStore(mem) };
  const r = await runEmbedding(
    deps,
    jobContext(
      { user_id: USER_A, items: [{ kind: 'person_profile' as const, id: uuid() }] },
      { type: 'embedding' },
    ),
  );
  return { r, text: sent(ai), chunks: mem.chunks as unknown as MemoryChunkRow[] };
}

Deno.test(
  'Data Source Controls: every class is embedded with the toggles on (control)',
  async () => {
    const { r, text } = await embed({});
    assertEquals(r.embedded, 4);
    for (const t of ['Yılmaz Endüstri', 'Kadıköy', 'yüzde on', 'Kargo yolda'])
      assertStringIncludes(text, t);
  },
);

Deno.test(
  'Data Source Controls: contacts / calendar / mail_body off → those chunks are neither stored nor embedded',
  async () => {
    const { r, text, chunks } = await embed({ contacts: false, calendar: false, mailBody: false });
    assertEquals(r.withheld, 3);
    assertEquals(r.embedded, 1);
    assertStringIncludes(text, 'Kargo yolda');
    for (const t of ['Yılmaz', 'Kadıköy', 'yüzde on'])
      assert(!text.includes(t), `${t} was embedded`);
    assertEquals(
      chunks.map((c) => c.chunk_kind),
      ['life_event'],
    );
  },
);

Deno.test(
  'Data Source Controls: a chunk stored before a toggle went off is not sent for embedding',
  async () => {
    const mem = new MemoryIntel();
    const ai = fixtureServices({ user: { dataAccess: access({ contacts: false }) } });
    const base = mem.memoryStore();
    await base.upsertChunks([
      {
        user_id: USER_A,
        chunk_kind: 'person_fact',
        content: 'Selin Kaya\nKurum: Müşteri AŞ',
        content_hash: 'aa',
        contact_ids: [],
        occurred_at: NOW.toISOString(),
        page_no: null,
        source_type: 'contact',
        source_id: uuid(),
        source_provider: null,
        source_timestamp: NOW.toISOString(),
        confidence: 1,
        evidence: [],
        expires_at: null,
      },
    ]);
    const deps = {
      ...intelDepsOf(mem, ai),
      memory: { ...base, sources: () => Promise.resolve([]) },
    };
    const r = await runEmbedding(
      deps,
      jobContext(
        { user_id: USER_A, items: [{ kind: 'person_profile' as const, id: uuid() }] },
        {
          type: 'embedding',
        },
      ),
    );
    assertEquals(r.embedded, 0);
    assert(!sent(ai).includes('Selin'));
  },
);

// ── Capture ─────────────────────────────────────────────────────────────────────────────────

Deno.test(
  'Data Source Controls: attachments off at job time → a file capture never reaches a model and its file is removed',
  async () => {
    const mem = new MemoryIntel();
    const fx = assistFixture(mem, { user: { dataAccess: access({ attachments: false }) } });
    const id = uuid();
    const path = `${USER_A}/${id}/fatura.png`;
    await fx.storage.upload(
      'captures',
      path,
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      'image/png',
    );
    fx.store.captures.push({
      id,
      user_id: USER_A,
      kind: 'photo',
      status: 'analyzing',
      storage_path: path,
      mime_type: 'image/png',
      size_bytes: 4,
      sha256: null,
      original_filename: 'fatura.png',
      source_url: null,
      final_url: null,
      text_content: null,
      page_count: null,
      extracted: [],
      extracted_types: [],
      primary_type: null,
      share_origin: 'in_app',
      progress: {},
      file_deleted_at: null,
      idempotency_key: 'k',
      error_code: null,
      analyzed_at: null,
      link_preview: null,
      created_at: NOW.toISOString(),
      expires_at: null,
    });
    const r = await runCaptureAnalysis(
      fx.jobs,
      jobContext({ capture_id: id, user_id: USER_A }, { type: 'capture_analysis' }),
    );
    assertEquals(r.skipped, 'attachments_off');
    const capture = fx.store.captures[0]!;
    assertEquals([capture.status, capture.error_code], ['failed', 'DATA_SOURCE_DISABLED']);
    assert(capture.file_deleted_at !== null);
    assertEquals(fx.storage.objects.size, 0);
    assertEquals(fx.ai.prompts.length, 0);
  },
);
