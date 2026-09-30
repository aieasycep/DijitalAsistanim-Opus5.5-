/**
 * The nightly `ai-eval` workflow's runner (TEST_PLAN §13 `ai-eval`): no silent skip — missing
 * database credentials or a provider key a configured target needs stop the run before any model
 * call with "External credential required" and the names; a fixture run of every suite passes and
 * is recorded; a dry run records nothing; a failed gate exits 1; the suite filter is validated.
 */
import { assert, assertEquals } from '@std/assert';
import type { ModelConfigRow } from '../ai/types.ts';
import type { EvalRecordInput, EvalStore, EvalVersion } from '../ai/evals/store.ts';
import { EVAL_SUITES } from '../ai/evals/suites.ts';
import { configRow } from '../testing/ai.ts';
import { assistFlags } from '../testing/assist.ts';
import { fixtureServices } from '../testing/intel.ts';
import { PROVIDER_KEYS, runCli, selectedSuites } from './ai-eval-cli.ts';

function store(): EvalStore & { recorded: EvalRecordInput[] } {
  const recorded: EvalRecordInput[] = [];
  return {
    recorded,
    version: (key) =>
      Promise.resolve({
        id: '0190f5e0-0000-7000-8000-00000000e002',
        prompt_key: key,
        version: 1,
        status: 'active',
        system_prompt: `Sistem: ${key}`,
        user_template: 'Sayı: {{count}}',
        output_schema_ref: key,
        schema_hash: 'a'.repeat(64),
        model_role: 'classifier',
        model_constraints: {},
      } satisfies EvalVersion),
    modelConfigs: (feature) =>
      Promise.resolve([
        configRow({
          feature,
          role: 'classifier',
          provider: 'anthropic',
          model: 'nightly-primary',
          params: {},
          fallback_targets: [{ provider: 'openai', model: 'nightly-fallback', params: {} }],
        }),
      ] satisfies ModelConfigRow[]),
    record(input) {
      recorded.push(input);
      return Promise.resolve({ model_rows: 1 });
    },
  };
}

function fixture(
  options: { available?: (p: string) => boolean; routable?: (p: string) => boolean } = {},
) {
  const ai = fixtureServices({ user: { flags: assistFlags() } });
  const services = {
    ...ai.services,
    runtime: {
      ...ai.services.runtime,
      router: {
        ...ai.services.runtime.router,
        providerAvailable: options.routable ?? (() => true),
      },
    },
    providers: { ...ai.services.providers, available: options.available ?? (() => true) },
  };
  return { ai, services };
}

function io() {
  const lines: string[] = [];
  return { lines, io: { out: (line: string) => lines.push(line) } };
}

Deno.test('ai-eval: missing database credentials are an external-credential failure', async () => {
  const out = io();
  assertEquals(await runCli({ raw: { GITHUB_ACTIONS: 'true' }, io: out.io }), 2);
  assertEquals(out.lines, [
    '::error title=External credential required::SUPABASE_URL, SUPABASE_SECRET_KEY',
    'External credential required: SUPABASE_URL, SUPABASE_SECRET_KEY',
  ]);
  const partial = io();
  assertEquals(await runCli({ raw: { SUPABASE_URL: 'https://x.supabase.co' }, io: partial.io }), 2);
  assertEquals(partial.lines, ['External credential required: SUPABASE_SECRET_KEY']);
});

Deno.test(
  'ai-eval: a provider key a target needs stops the run before any model call',
  async () => {
    const { ai, services } = fixture({ available: (p) => p !== 'openai' });
    const s = store();
    const out = io();
    const code = await runCli({
      raw: { AI_EVAL_SUITES: 'post_meeting,capture' },
      io: out.io,
      services: { ai: services, store: s },
    });
    assertEquals(code, 2);
    assertEquals(ai.telemetry.rows.length, 0);
    assertEquals(s.recorded, []);
    assert(
      out.lines[0]!.startsWith(
        'External credential required: OPENAI_API_KEY (for post_meeting_parse openai/nightly-fallback; capture_extract openai/nightly-fallback)',
      ),
      out.lines[0],
    );
    assertEquals(PROVIDER_KEYS.anthropic, 'ANTHROPIC_API_KEY');
  },
);

Deno.test(
  'ai-eval: a fixture run of every suite passes and is recorded; a dry run records nothing',
  async () => {
    const { services } = fixture();
    const s = store();
    const out = io();
    assertEquals(await runCli({ raw: {}, io: out.io, services: { ai: services, store: s } }), 0);
    assertEquals(s.recorded.map((r) => r.report.suite).sort(), Object.keys(EVAL_SUITES).sort());
    assert(
      s.recorded.every((r) => r.passed && r.report.trigger === 'ci' && r.report.mode === 'fixture'),
    );
    assertEquals(out.lines.at(-1), 'ai-eval: 6 suite(s) passed');
    assert(!out.lines.some((l) => /Revize|Mehmet|teklif/i.test(l)), 'no case text in the output');

    const dry = store();
    const dryOut = io();
    assertEquals(
      await runCli({
        raw: { AI_EVAL_DRY_RUN: 'true', AI_EVAL_SUITES: 'meeting_prep' },
        io: dryOut.io,
        services: { ai: fixture().services, store: dry },
      }),
      0,
    );
    assertEquals(dry.recorded, []);
    assertEquals(dryOut.lines.at(-1), 'ai-eval: 1 suite(s) passed (dry run, nothing recorded)');
  },
);

Deno.test('ai-eval: a failed gate exits 1 and is recorded as failed', async () => {
  const { services } = fixture({ routable: (p) => p !== 'openai' });
  const s = store();
  const out = io();
  const code = await runCli({
    raw: { AI_EVAL_SUITES: 'assistant_intent', GITHUB_ACTIONS: 'true' },
    io: out.io,
    services: { ai: services, store: s },
  });
  assertEquals(code, 1);
  assertEquals(s.recorded[0]?.passed, false);
  assert(out.lines.includes('::error title=Eval gate failed::assistant_intent'));
});

Deno.test('ai-eval: the suite filter accepts known prompt keys only', async () => {
  assertEquals(selectedSuites({}).suites.length, Object.keys(EVAL_SUITES).length);
  assertEquals(
    selectedSuites({ AI_EVAL_SUITES: ' capture , post_meeting ' }).suites.map((s) => s.key),
    ['post_meeting', 'capture'],
  );
  const out = io();
  assertEquals(await runCli({ raw: { AI_EVAL_SUITES: 'capture,thread_summary' }, io: out.io }), 2);
  assertEquals(out.lines, ['Invalid input: AI_EVAL_SUITES names no eval suite: thread_summary']);
});
