/**
 * IT-AI-02 / IT-AI-03 (TEST_PLAN §6.4; AI_PIPELINE_PLAN §3.3 fallback chains, §11 grounding): the
 * real Anthropic and OpenAI adapters against the mock provider server (`ANTHROPIC_API_BASE_URL`,
 * `OPENAI_API_BASE_URL`; fixture provider off), whose structured output is scripted per call with
 * `POST /__script` (`passthrough` + `body`, selected by a JSON-schema property with `match`).
 */
import { assert, assertEquals, assertFalse } from '@std/assert';
import { count, createUser, it, MOCK_URL, mock, one, q } from './_harness/mod.ts';
import { MAILBOX, syncedGoogle } from './_harness/sync.ts';

const LONG = 'gmail/messages_long_contract.json';
const ANTHROPIC = 'POST /anthropic/v1/messages';
const OPENAI = 'POST /openai/v1/responses';

/** One env profile (a stable key set, so the entrypoints load once) with the fixture provider off. */
const realAdapters = () => ({
  AI_FIXTURE_PROVIDER_ENABLED: 'false',
  ANTHROPIC_API_KEY: 'sk-ant-integration-test',
  OPENAI_API_KEY: 'sk-integration-test',
  ANTHROPIC_API_BASE_URL: `${MOCK_URL()}/anthropic`,
  OPENAI_API_BASE_URL: `${MOCK_URL()}/openai/v1`,
});

interface Target {
  provider: string;
  model: string;
}

async function chainOf(profile: string, feature: string): Promise<Target[]> {
  const row = await one<{ provider: string; model: string; fallback_targets: Target[] }>(
    `select provider, model, fallback_targets from public.ai_model_config
      where profile = $1 and feature = $2 and enabled order by role limit 1`,
    [profile, feature],
  );
  return [{ provider: row.provider, model: row.model }, ...row.fallback_targets];
}

it(
  'IT-AI-02',
  'schema failure on every provider: T1 → Sonnet low → luna → T0, one content-free row per attempt',
  async () => {
    const user = await createUser({ pro: true });
    await mock.script(ANTHROPIC, [
      { passthrough: true, body: '{"items": [{"ref": "m1", ', times: 500 },
    ]);
    await mock.script(OPENAI, [{ passthrough: true, body: '{"items": oops', times: 500 }]);
    const accountId = await syncedGoogle(user, ['mail_read'], {
      mailbox: [MAILBOX],
      overrides: realAdapters(),
    });
    const rows = await q<{
      provider: string;
      model: string;
      status: string;
      error_code: string | null;
      fallback_used: boolean;
      profile: string;
    }>(
      `select provider, model, status, error_code, fallback_used, profile from public.ai_requests
        where user_id = $1 and feature = 'email_triage' order by created_at, id`,
      [user.id],
    );
    assert(rows.length >= 3, JSON.stringify(rows));
    const chain = await chainOf(rows[0]?.profile ?? 'balanced', 'email_triage');
    assertEquals(chain.length, 3, 'primary + two fallbacks');
    assertEquals(new Set(chain.map((t) => t.provider)), new Set(['anthropic', 'openai']));
    // Every batch walked the whole chain in order: primary, then each fallback, all rejected.
    const batches = rows.filter((r) => !r.fallback_used).length;
    assert(batches >= 1);
    assertEquals(rows.length, batches * chain.length);
    chain.forEach((t, i) => {
      const served = rows.filter(
        (r) => r.provider === t.provider && r.model === t.model && r.fallback_used === i > 0,
      );
      assertEquals(served.length, batches, `${t.provider} attempt ${String(i)}`);
    });
    for (const r of rows) {
      assertEquals(r.status, 'validation_failed', JSON.stringify(r));
      assertEquals(r.error_code, 'SCHEMA_VALIDATION');
    }
    const calls = await mock.requests('/anthropic');
    assert(calls.some((c) => c.headers['x-api-key'] === 'sk-ant-integration-test'));
    const triageCalls = (await mock.requests('/openai')).filter((c) =>
      c.body.includes('"needs_deep_extract"'),
    );
    assertEquals(triageCalls.length, batches);
    // The final result is the T0 path: messages classified, no T1 result, and no content stored.
    const jobs = await q<{ result: { t0?: number; t1?: number } | null }>(
      `select result from public.jobs where user_id = $1 and type = 'email_triage' and status = 'completed'`,
      [user.id],
    );
    assert(jobs.length >= 1);
    for (const j of jobs) assertEquals(j.result?.t1 ?? 0, 0, JSON.stringify(j.result));
    assert(
      (await count(
        `select 1 from public.email_messages where connected_account_id = $1 and classification is not null`,
        [accountId],
      )) >= 1,
    );
    const dump = JSON.stringify(
      await q(`select * from public.ai_requests where user_id = $1`, [user.id]),
    );
    assertFalse(dump.includes('revize teklifi'));
    assertFalse(dump.includes('"items"'));
  },
);

it(
  'IT-AI-03',
  'grounding rejection: an absent deadline quote is dropped and counted (grounding_dropped = 1)',
  async () => {
    const user = await createUser({ pro: true });
    const quote = 'imza için son gün 30 Eylül 2026 olarak görünüyor';
    const invented = 'ödeme en geç 15 Ekim 2026 tarihinde yapılmalı';
    await mock.script(ANTHROPIC, [
      {
        passthrough: true,
        match: '"needs_deep_extract"',
        body: {
          items: [
            {
              ref: 'm1',
              category: 'has_deadline',
              important: true,
              urgency: 'today',
              needs_reply: false,
              reply_ask_tr: null,
              reply_evidence: null,
              reason_code: 'deadline_mentioned',
              reason_tr: 'Sözleşmede son tarih var',
              summary_tr: null,
              key_points_tr: [],
              deadlines: [],
              life_signal: 'none',
              life_evidence: null,
              schedule_request: null,
              counterparty_commitment: null,
              needs_deep_extract: true,
              thread_note_tr: null,
              injection_suspected: false,
              confidence: 'high',
            },
          ],
        },
      },
    ]);
    await mock.script(ANTHROPIC, [
      {
        passthrough: true,
        match: '"tasks_for_user"',
        body: {
          ref: 'm1',
          summary_tr: 'Ekim teslimatı ve sözleşme takvimi paylaşıldı.',
          key_points: [{ text_tr: 'İmza için son gün 30 Eylül', evidence: { ref: 'm1', quote } }],
          deadlines: [
            {
              what_tr: 'Ödeme',
              when_quote: '15 Ekim 2026',
              evidence: { ref: 'm1', quote: invented },
              certainty: 'explicit',
            },
          ],
          schedule_requests: [],
          tasks_for_user: [],
          amounts: [],
          commitments: [],
          people: [],
          injection_suspected: false,
          confidence: 'high',
        },
      },
    ]);
    const accountId = await syncedGoogle(user, ['mail_read'], {
      mailbox: [LONG],
      overrides: realAdapters(),
    });
    const deep = await q<{
      provider: string;
      status: string;
      grounding_proposed: number | null;
      grounding_verified: number | null;
      grounding_dropped: number | null;
    }>(
      `select provider, status, grounding_proposed, grounding_verified, grounding_dropped
         from public.ai_requests where user_id = $1 and feature = 'email_deep_extract'`,
      [user.id],
    );
    const served = deep.filter((r) => r.grounding_proposed !== null);
    assertEquals(served.length, 1, JSON.stringify(deep));
    assertEquals(served[0]?.provider, 'anthropic');
    assertEquals(served[0]?.grounding_dropped, 1);
    assertEquals(served[0]?.grounding_verified, 2);
    assertEquals(served[0]?.grounding_proposed, 3);
    const message = await one<{ dropped_fields: string[]; key_points: unknown }>(
      `select dropped_fields, key_points from public.email_messages
        where connected_account_id = $1 and provider_message_id = '18f2a0c1d0000006'`,
      [accountId],
    );
    assertEquals(message.dropped_fields, ['due_at']);
    const stored = JSON.stringify(message.key_points);
    assert(stored.includes(quote), stored);
    // The invented deadline reaches no stored row: not the thread deadline, not a life event.
    assertEquals(
      await count(
        `select 1 from public.email_threads where connected_account_id = $1 and deadline_evidence::text like '%15 Ekim%'`,
        [accountId],
      ),
      0,
    );
    assertEquals(
      await count(
        `select 1 from public.life_events where user_id = $1 and evidence::text like '%15 Ekim%'`,
        [user.id],
      ),
      0,
    );
  },
);
