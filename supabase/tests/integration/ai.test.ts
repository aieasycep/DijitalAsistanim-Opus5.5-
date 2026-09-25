/**
 * IT-AI-* (TEST_PLAN §6.4; AI_PIPELINE_PLAN; API_CONTRACTS API-MAIL-07, API-AST-02, API-MEET-01,
 * JOB-10/11/14/15; R-02, R-04, R-05, R-22, R-23) through the fixture AI provider
 * (`AI_FIXTURE_PROVIDER_ENABLED=true`, the implemented form of `AI_PROVIDER_OVERRIDE=fixture`) and,
 * for embeddings, the mock Voyage server.
 */
import { assert, assertEquals, assertFalse } from '@std/assert';
import {
  call,
  count,
  createUser,
  drain,
  freshIdentities,
  it,
  json,
  makePro,
  mock,
  one,
  q,
  releaseJobs,
  type TestUser,
} from './_harness/mod.ts';
import { MAILBOX, syncedGoogle } from './_harness/sync.ts';

const LONG = 'gmail/messages_long_contract.json';

async function summary(user: TestUser, threadId: string, refresh = false): Promise<Response> {
  return await call('api', 'POST', `/mail/threads/${threadId}/summary`, {
    jwt: user.jwt,
    key: crypto.randomUUID(),
    body: { refresh },
  });
}

async function ahmetThread(accountId: string): Promise<string> {
  return (
    await one<{ thread_id: string }>(
      `select thread_id from public.email_messages where connected_account_id = $1 and provider_message_id = '18f2a0c1d0000001'`,
      [accountId],
    )
  ).thread_id;
}

async function setFlag(key: string, enabled: boolean): Promise<void> {
  await q(`update public.feature_flags set enabled = $2 where key = $1`, [key, enabled]);
}

it(
  'IT-AI-01',
  'fixture provider end to end: triage micro-batches ≤ 5, survivors analysed, insights with provenance and evidence',
  async () => {
    const user = await createUser({ pro: true });
    // The canon mailbox plus a long contract mail (deep extraction needs > 600 characters).
    const accountId = await syncedGoogle(user, ['mail_read'], { mailbox: [MAILBOX, LONG] });
    const triage = await q<{ source_count: number | null; status: string; provider: string }>(
      `select source_count, status, provider from public.ai_requests where user_id = $1 and feature = 'email_triage'`,
      [user.id],
    );
    assert(triage.length >= 1, 'T1 triage calls');
    for (const t of triage) {
      assertEquals(t.provider, 'fixture');
      assert((t.source_count ?? 1) <= 5, `batch of ${t.source_count}`);
    }
    assert(
      (await count(
        `select 1 from public.ai_requests where user_id = $1 and feature in ('email_deep_extract', 'commitment_extract', 'life_intel_extract')`,
        [user.id],
      )) >= 1,
      JSON.stringify({
        features: await q(
          `select feature, status, tier from public.ai_requests where user_id = $1`,
          [user.id],
        ),
        jobs: await q(
          `select type, status, result from public.jobs where user_id = $1 and type in ('email_triage','email_analysis','embedding')`,
          [user.id],
        ),
      }),
    );
    const insights = await q<Record<string, unknown>>(
      `select * from public.insights where user_id = $1`,
      [user.id],
    );
    assert(insights.length >= 1);
    for (const i of insights) {
      for (const f of [
        'source_type',
        'source_id',
        'source_provider',
        'source_timestamp',
        'confidence',
      ])
        assert(i[f] !== null, `${String(i.kind)}.${f}`);
      assert(
        Array.isArray(i.evidence) && (i.evidence as unknown[]).length >= 1,
        `${String(i.kind)} evidence`,
      );
    }
    // No request row carries content.
    const rows = JSON.stringify(
      await q(`select * from public.ai_requests where user_id = $1`, [user.id]),
    );
    assertFalse(rows.includes('revize teklifi'));
    void accountId;
  },
);

it(
  'IT-AI-04',
  'dedupe: re-analysing the same content hits the per-user cache; another user misses',
  async () => {
    const a = await createUser({ pro: true });
    const accountA = await syncedGoogle(a);
    const threadA = await ahmetThread(accountA);
    const first = await summary(a, threadA);
    assertEquals(first.status, 200, await first.text());
    // The stored summary is cleared, so the route calls the model path again: the cache answers.
    await q(
      `update public.email_threads set ai_summary = null, analysis_hash = null, analyzed_at = null where id = $1`,
      [threadA],
    );
    const again = await summary(a, threadA);
    assertEquals(again.status, 200, await again.text());
    const rowsA = await q<{ status: string }>(
      `select status from public.ai_requests where user_id = $1 and feature = 'thread_summary' order by created_at`,
      [a.id],
    );
    assert(rowsA.length >= 2, JSON.stringify(rowsA));
    assertEquals(rowsA[rowsA.length - 1]?.status, 'cached');
    await freshIdentities();
    const b = await createUser({ pro: true });
    const accountB = await syncedGoogle(b);
    const res = await summary(b, await ahmetThread(accountB));
    assertEquals(res.status, 200, await res.text());
    const rowsB = await q<{ status: string }>(
      `select status from public.ai_requests where user_id = $1 and feature = 'thread_summary'`,
      [b.id],
    );
    assertEquals(
      rowsB.map((r) => r.status),
      ['ok'],
    );
    assertEquals(
      await count(
        `select 1 from public.ai_result_cache where user_id = $1 and feature = 'thread_summary'`,
        [b.id],
      ),
      1,
    );
  },
);

it(
  'IT-AI-05',
  'budget: a Free user past ai_daily_budget_units → budget_blocked and 429 QUOTA_EXCEEDED',
  async () => {
    const user = await createUser();
    const accountId = await syncedGoogle(user);
    const limit = await one<{ value: number }>(
      `select value from public.plan_limits where plan = 'free' and key = 'ai_daily_budget_units'`,
    );
    // Today's units are spent (the triage of the first pass used some; top up to the limit).
    await q(
      `insert into public.ai_usage_daily (user_id, local_date, feature, units_used) values ($1, (now() at time zone 'Europe/Istanbul')::date, 'thread_summary', $2)
     on conflict (user_id, local_date, feature) do update set units_used = excluded.units_used`,
      [user.id, Number(limit.value)],
    );
    const res = await summary(user, await ahmetThread(accountId), true);
    const body = await json<{
      error?: { code: string; details?: { limit_key?: string }; message_key?: string };
    }>(res);
    assertEquals(res.status, 429, JSON.stringify(body));
    assertEquals(body.error?.code, 'QUOTA_EXCEEDED');
    assertEquals(body.error?.details?.limit_key, 'ai_daily_budget_units');
    assertEquals(body.error?.message_key, 'errors.quota_exceeded');
    assert(
      (await count(
        `select 1 from public.ai_requests where user_id = $1 and status = 'budget_blocked'`,
        [user.id],
      )) >= 1,
    );
  },
);

it('IT-AI-06', 'kill switch ai.global.enabled=false → killed, T0 results only', async () => {
  const user = await createUser({ pro: true });
  await setFlag('ai.global.enabled', false);
  try {
    await syncedGoogle(user);
    const rows = await q<{ status: string }>(
      `select status from public.ai_requests where user_id = $1`,
      [user.id],
    );
    for (const r of rows) assertEquals(r.status, 'killed', JSON.stringify(rows));
    assertEquals(
      await count(
        `select 1 from public.ai_requests where user_id = $1 and provider = 'fixture' and status = 'succeeded'`,
        [user.id],
      ),
      0,
    );
    // The T0 path still classifies the mailbox.
    assert(
      (await count(
        `select 1 from public.email_messages where user_id = $1 and classification is not null`,
        [user.id],
      )) >= 1,
    );
  } finally {
    await setFlag('ai.global.enabled', true);
  }
});

it(
  'IT-AI-07',
  'prompt injection mail: injection_suspected, no approvals, excluded from proposed actions',
  async () => {
    const user = await createUser({ pro: true });
    const accountId = await syncedGoogle(user, ['mail_read'], {
      mailbox: [MAILBOX, 'gmail/messages_injection.json'],
    });
    const row = await one<{ injection_suspected: boolean; id: string; thread_id: string }>(
      `select injection_suspected, id, thread_id from public.email_messages where connected_account_id = $1 and provider_message_id = '18f2a0c1d00000a1'`,
      [accountId],
    );
    assertEquals(row.injection_suspected, true);
    assertEquals(
      await count(`select 1 from public.approval_actions where user_id = $1`, [user.id]),
      0,
    );
    const insight = await q<{ actions: { requires_approval?: boolean }[] }>(
      `select actions from public.insights where entity_id = $1`,
      [row.thread_id],
    );
    for (const i of insight)
      for (const a of i.actions ?? []) assertFalse(a.requires_approval === true, JSON.stringify(a));
    // A reply draft for it is refused or carries no forwarding recipient from the mail.
    const draft = await call('api', 'POST', `/mail/${row.id}/reply-drafts`, {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: { tone: 'short' },
    });
    const out = await json<{ data?: { to: { email: string }[] } }>(draft);
    for (const r of out.data?.to ?? []) assertFalse(r.email.includes('disari@yabanci.example'));
  },
);

it(
  'IT-AI-08',
  'briefing: six sections with sources; a midday without delta is skipped; midday / evening compose on T0',
  async () => {
    const user = await createUser({ pro: true });
    await syncedGoogle(user);
    const localDate = (
      await one<{ d: string }>(`select (now() at time zone 'Europe/Istanbul')::date::text as d`)
    ).d;
    for (const kind of ['morning', 'midday', 'evening']) {
      await q(`select private.enqueue_job('briefing', $1, $2::text::jsonb, $3::uuid)`, [
        `briefing:it:${user.id}:${kind}`,
        JSON.stringify({ user_id: user.id, kind, local_date: localDate, origin: 'schedule' }),
        user.id,
      ]);
      await releaseJobs();
      await drain({ types: ['briefing'] });
    }
    const briefings = await q<{
      kind: string;
      status: string;
      skipped_reason: string | null;
      id: string;
      sections: unknown;
    }>(`select * from public.briefings where user_id = $1 and local_date = $2::date`, [
      user.id,
      localDate,
    ]);
    const morning = briefings.find((b) => b.kind === 'morning');
    assert(
      morning !== undefined && ['ready', 'delivered'].includes(morning.status),
      JSON.stringify(briefings.map((b) => [b.kind, b.status, b.skipped_reason])),
    );
    // The six M§9 morning sections.
    const sections = JSON.stringify(morning.sections);
    for (const name of [
      'priorities',
      'schedule',
      'awaiting_me',
      'awaiting_them',
      'deadlines',
      'life',
    ])
      assert(sections.includes(`"${name}"`), `${name} in ${sections.slice(0, 300)}`);
    const items = await q<{ section: string; source_id: string | null }>(
      `select * from public.briefing_items where briefing_id = $1`,
      [morning.id],
    );
    assert(items.length >= 1);
    for (const i of items) assert(i.source_id !== null, JSON.stringify(i));
    const midday = briefings.find((b) => b.kind === 'midday');
    assertEquals(midday?.status, 'skipped');
    assertEquals(
      (midday as { skipped_reason?: string } | undefined)?.skipped_reason,
      'no_meaningful_delta',
    );
    const reasoning = await count(
      `select 1 from public.ai_requests where user_id = $1 and feature in ('briefing_midday', 'briefing_evening') and tier = 't2'`,
      [user.id],
    );
    assertEquals(reasoning, 0);
    const evening = briefings.find((b) => b.kind === 'evening');
    if (evening !== undefined && evening.status !== 'skipped') {
      // "Yarına Hazırım": the carry-over closes the day and points at the next morning.
      const ready = await call('api', 'POST', `/briefings/${evening.id}/evening-ready`, {
        jwt: user.jwt,
        key: crypto.randomUUID(),
        body: { confirm: true },
      });
      const out = await json<{ data: { carried: number; next_morning_at: string } }>(ready);
      assertEquals(ready.status, 200, JSON.stringify(out));
      assert(Date.parse(out.data.next_morning_at) > Date.now());
    }
  },
);

it(
  'IT-AI-09',
  'embeddings via the mock Voyage: memory_chunks with expires_at; Voyage 503 → retry and FTS-only partial',
  async () => {
    // The analysis runs on the fixture provider; the embedding job then runs with the Voyage adapter
    // against the mock (fixture mode off, no LLM keys: only embeddings are needed).
    const voyage = {
      AI_FIXTURE_PROVIDER_ENABLED: 'false',
      ANTHROPIC_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
    };
    const user = await createUser({ pro: true });
    const accountId = await syncedGoogle(user, ['mail_read'], {
      mailbox: [MAILBOX, LONG],
      drainTypes: [
        'initial_sync',
        'gmail_sync',
        'watch_renewal',
        'email_triage',
        'email_analysis',
        'insight_refresh',
        'notification',
      ],
    });
    await ahmetThread(accountId);
    const pending = await count(
      `select 1 from public.jobs where type = 'embedding' and user_id = $1 and status = 'queued'`,
      [user.id],
    );
    assert(pending >= 1, 'the analysis enqueued embeddings');
    // Voyage 503: the job is retried and search degrades to FTS only meanwhile.
    await mock.script('POST /voyage/v1/embeddings', [
      { status: 503, body: { detail: 'Service unavailable' }, times: 50 },
    ]);
    await releaseJobs();
    await drain({ types: ['embedding'], overrides: voyage, rounds: 1 });
    const degraded = await q<{ status: string; result: Record<string, unknown> | null }>(
      `select status, result from public.jobs where type = 'embedding' and user_id = $1`,
      [user.id],
    );
    assert(
      degraded.some((j) => j.status === 'retrying' || j.result?.degraded === true),
      JSON.stringify(degraded),
    );
    // The chunks are written (FTS-searchable, with their expiry) but not embedded yet.
    const chunks = await q<{ expires_at: Date | null }>(
      `select expires_at from public.memory_chunks where user_id = $1`,
      [user.id],
    );
    assert(chunks.length >= 1, 'memory chunks written');
    for (const c of chunks) assert(c.expires_at !== null);
    assertEquals(
      await count(
        `select 1 from public.memory_chunks where user_id = $1 and embedding is not null`,
        [user.id],
      ),
      0,
    );
    // Voyage back: deterministic 1024-d vectors.
    await mock.reset();
    await releaseJobs();
    await drain({ types: ['embedding'], overrides: voyage });
    const calls = (await mock.requests('/voyage/v1/embeddings')).filter((r) => r.method === 'POST');
    assert(calls.length >= 1);
    for (const r of calls) {
      assertEquals(r.headers.authorization, `Bearer ${Deno.env.get('VOYAGE_API_KEY')}`);
      assertEquals((JSON.parse(r.body) as { output_dimension: number }).output_dimension, 1024);
    }
    const embedded = await q<{ dims: number; embedding_model: string }>(
      `select vector_dims(embedding) as dims, embedding_model from public.memory_chunks where user_id = $1 and embedding is not null`,
      [user.id],
    );
    assert(embedded.length >= 1, 'chunks embedded');
    for (const e of embedded) assertEquals(Number(e.dims), 1024);
  },
);

async function sse(res: Response): Promise<{ event: string; data: Record<string, unknown> }[]> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1] ?? '';
      const data = JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? '{}') as Record<string, unknown>;
      return { event, data };
    });
}

it(
  'IT-AI-10',
  'assistant SSE: parseable frames, own citations only, noAnswer out of scope, intent → one pending action_proposal',
  async () => {
    const user = await createUser({ pro: true });
    await syncedGoogle(user, ['mail_read', 'calendar_read', 'calendar_write']);
    const thread = await call('api', 'POST', '/assistant/threads', {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: { client_thread_id: crypto.randomUUID() },
    });
    const t = await json<{ data: { id: string } }>(thread);
    assert([200, 201].includes(thread.status), JSON.stringify(t));
    const ask = async (content: string) =>
      await sse(
        await call('api', 'POST', `/assistant/threads/${t.data.id}/messages`, {
          jwt: user.jwt,
          key: crypto.randomUUID(),
          headers: { Accept: 'text/event-stream' },
          body: { client_message_id: crypto.randomUUID(), content, input_mode: 'text' },
        }),
      );
    const grounded = await ask('Ahmet Yılmaz ne istiyor?');
    const names = grounded.map((f) => f.event);
    assertEquals(names[0], 'meta');
    assertEquals(names[names.length - 1], 'done');
    // Citations map to the user's own rows only (never another user's source).
    for (const c of grounded.filter((f) => f.event === 'citation')) {
      const source = c.data.source as { source_id: string };
      for (const table of [
        'email_messages',
        'email_threads',
        'memory_chunks',
        'calendar_events',
        'insights',
      ]) {
        assertEquals(
          await count(`select 1 from public."${table}" where id::text = $1 and user_id <> $2`, [
            source.source_id,
            user.id,
          ]),
          0,
          table,
        );
      }
    }
    const outOfScope = await ask('Mars’ta bugün hava nasıl?');
    assertEquals(outOfScope.filter((f) => f.event === 'citation').length, 0);
    const intent = await ask('Yarın 10:00’da Mehmet ile toplantı ekle');
    const proposals = intent.filter((f) => f.event === 'action_proposal');
    assertEquals(proposals.length, 1, JSON.stringify(intent.map((f) => f.event)));
    const approval = (proposals[0]?.data.approval ?? {}) as {
      id: string;
      status: string;
      action_type: string;
    };
    assertEquals(approval.status, 'pending');
    assertEquals(approval.action_type, 'calendar_create');
    assertEquals(await count(`select 1 from public.jobs where type = 'approval_execute'`), 0);
  },
);

it(
  'IT-AI-11',
  'meeting prep: external / VIP meetings precomputed at T-60 for Pro; internal ones on demand',
  async () => {
    const user = await createUser({ pro: true });
    await makePro(user.id);
    await q(`update public.feature_flags set enabled = true where key = 'feature.meeting_prep'`);
    const start = new Date(Date.now() + 60 * 60_000);
    const events = [
      {
        id: 'evtexternalprep',
        summary: 'Mehmet müşteri toplantısı',
        attendees: [{ email: 'mehmet@yilmazendustri.example' }],
      },
      {
        id: 'evtinternalprep',
        summary: 'Haftalık ekip',
        attendees: [{ email: 'burak.tan@example.com' }],
      },
    ].map((e) => ({
      ...e,
      start: { dateTime: start.toISOString() },
      end: { dateTime: new Date(start.getTime() + 3_600_000).toISOString() },
      organizer: { email: 'yunus.demir@example.com', self: true },
    }));
    await freshIdentities();
    await mock.google({ op: 'identity', identity: { email: 'yunus.demir@example.com' } });
    await syncedGoogle(user, ['calendar_read'], { mailbox: [], events });
    await q(`select private.scheduler_tick(now())`);
    const preps = await q<{ payload: { event_id: string } }>(
      `select payload from public.jobs where type = 'meeting_prep' and user_id = $1`,
      [user.id],
    );
    const byProvider = async (id: string) =>
      (
        await one<{ id: string }>(
          `select id from public.calendar_events where user_id = $1 and provider_event_id = $2`,
          [user.id, id],
        )
      ).id;
    const external = await byProvider('evtexternalprep');
    const internal = await byProvider('evtinternalprep');
    assert(
      preps.some((p) => p.payload.event_id === external),
      JSON.stringify(preps),
    );
    assertFalse(preps.some((p) => p.payload.event_id === internal));
    const res = await call('api', 'POST', `/meetings/${internal}/prep`, {
      jwt: user.jwt,
      key: crypto.randomUUID(),
      body: {},
    });
    assert([200, 202].includes(res.status), await res.text());
  },
);

it(
  'IT-AI-12',
  'routing profile switch balanced → lean → balanced takes effect with no deploy',
  async () => {
    const profileOf = async (user: TestUser) =>
      (
        await q<{ profile: string }>(
          `select distinct profile from public.ai_requests where user_id = $1 and feature = 'email_triage'`,
          [user.id],
        )
      ).map((r) => r.profile);
    // Each phase runs on a fresh worker instance (as after the 60 s profile cache TTL): no deploy.
    const balanced = await createUser({ pro: true });
    await syncedGoogle(balanced, ['mail_read'], { overrides: { DA_IT_INSTANCE: 'balanced-1' } });
    assertEquals(await profileOf(balanced), ['balanced']);
    await q(
      `update public.plan_limits set value = '"lean"' where plan = 'pro' and key = 'ai_routing_profile'`,
    );
    try {
      await freshIdentities();
      const lean = await createUser({ pro: true });
      await syncedGoogle(lean, ['mail_read'], { overrides: { DA_IT_INSTANCE: 'lean' } });
      assertEquals(await profileOf(lean), ['lean']);
    } finally {
      await q(
        `update public.plan_limits set value = '"balanced"' where plan = 'pro' and key = 'ai_routing_profile'`,
      );
    }
    await freshIdentities();
    const back = await createUser({ pro: true });
    await syncedGoogle(back, ['mail_read'], { overrides: { DA_IT_INSTANCE: 'balanced-2' } });
    assertEquals(await profileOf(back), ['balanced']);
  },
);
