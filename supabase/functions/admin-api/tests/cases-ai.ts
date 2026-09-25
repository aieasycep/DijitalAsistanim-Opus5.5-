/**
 * ADM-08 AI operations and model config, ADM-09 prompts, ADM-10 AI feedback: SQL-shaped outputs and
 * mapped responses. Model ids come from the registry fixtures (no model literal lives here).
 */
import { assert, assertEquals, assertMatch } from '@std/assert';
import { adminFixtures } from '../../../../packages/validation/test/fixtures/admin-fixtures.ts';
import { argsOf, type Cases, data, REASON, rows, sqlPage, TS, uuid } from './case-helpers.ts';

interface Target {
  provider: string;
  model: string;
}
const MODELS_RESPONSE = adminFixtures['GET /ai/models'].valid.response as unknown as {
  data: { configs: { primary_target: Target; fallback_targets: Target[] }[] };
};
const MODEL_CONFIG = MODELS_RESPONSE.data.configs[0] as {
  primary_target: Target;
  fallback_targets: Target[];
};
const PRIMARY = MODEL_CONFIG.primary_target;
const FALLBACK = MODEL_CONFIG.fallback_targets[0] as Target;
const AI_KEYS = {
  ANTHROPIC_API_KEY: 'anthropic_key_for_tests',
  VOYAGE_API_KEY: 'voyage_key_for_tests',
};

/** One `ai_model_config_list` row (`primary_target` = `{provider, model} || params`). */
const sqlConfig = (extra: Record<string, unknown> = {}) => ({
  id: uuid(120),
  profile: 'balanced',
  role: 'classifier',
  feature: 'email_triage',
  tier: 't1',
  enabled: true,
  primary_target: {
    provider: PRIMARY.provider,
    model: PRIMARY.model,
    effort: 'low',
    max_output_tokens: 800,
  },
  fallback_targets: [
    { provider: FALLBACK.provider, model: FALLBACK.model, params: { max_output_tokens: 800 } },
  ],
  escalation_target: null,
  batch_policy: 'non_urgent',
  cache_ttl: '5m',
  max_input_tokens: 8000,
  eval_status: 'missing',
  retires_not_before: '2026-10-15',
  version: 3,
  updated_by: uuid(100),
  updated_at: TS,
  ...extra,
});

const configList = (rowsList: unknown[]) => ({
  rows: rowsList,
  routing_profiles: { free: 'lean', pro: 'balanced' },
  profile_costs: {
    balanced: { monthly_usd: 2.2412, coverage: 0.97, pro_users: 40, window_days: 30 },
    lean: { monthly_usd: null, coverage: null, pro_users: 40, window_days: 30 },
  },
  provider_health: {},
});

const sqlPromptVersion = (version: number, extra: Record<string, unknown> = {}) => ({
  id: uuid(200 + version),
  prompt_key: 'reply_draft',
  version,
  status: version === 2 ? 'active' : 'draft',
  system_prompt: `Sen bir asistansın.\nKısa yanıt ver (v${version}).`,
  user_template: 'Konu: {{today}}\n{{user_name}}',
  output_schema_ref: 'ReplyDraftsV1',
  schema_hash: 'c'.repeat(64),
  model_role: 'drafter',
  model_constraints: {},
  eval_dataset_version: null,
  eval_report: null,
  eval_passed: null,
  notes: null,
  changelog: null,
  created_by: 'ai_ops',
  created_at: TS,
  activated_by: null,
  activated_at: version === 2 ? TS : null,
  archived_at: null,
  ...extra,
});

const promptVersionGet = (args: Record<string, unknown>) =>
  sqlPromptVersion(Number(args.p_version));

const PRICES = {
  rows: [
    {
      id: uuid(130),
      provider: PRIMARY.provider,
      model: PRIMARY.model,
      input_per_mtok_usd: 1,
      output_per_mtok_usd: 5,
      cache_write_5m_per_mtok_usd: 1.25,
      cache_write_1h_per_mtok_usd: 2,
      cache_read_per_mtok_usd: 0.1,
      batch_discount: 0.5,
      audio_per_min_usd: null,
      chars_per_million_usd: null,
      effective_from: '2026-01-01',
      current: true,
      updated_by: null,
      created_at: TS,
    },
  ],
};

export const AI_CASES: Cases = {
  'GET /ai/metrics': {
    sql: {
      ai_metrics: () => ({
        range: '7d',
        group: 'model',
        source: 'raw',
        rows: [
          {
            key: PRIMARY.model,
            requests: 10,
            input_tokens: 1000,
            output_tokens: 100,
            cache_read_tokens: 0,
            cache_write_tokens: 50,
            cost_usd: 0.0123456,
            error_rate: 0,
            p50_ms: 800,
            p95_ms: 1500.4,
            budget_blocked: 0,
          },
        ],
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'ai_metrics'), { p_range: '7d', p_group: 'model' });
      const row = rows(body)[0] ?? {};
      assertEquals([row.cost_usd, row.p95_ms], [0.012346, 1500]);
      assert(!('cache_write_tokens' in row));
    },
  },
  'GET /ai/metrics/series': {
    sql: {
      ai_cost_series: () => ({
        range: '7d',
        split: 'feature',
        bucket: 'day',
        points: [
          { t: '2026-09-23T21:00:00+00:00', key: 'email_triage', requests: 10, cost_usd: 0.01 },
        ],
      }),
    },
    expect(h) {
      assertEquals(argsOf(h, 'ai_cost_series'), { p_range: '7d', p_split: 'feature' });
    },
  },
  'GET /ai/requests': {
    request: { query: { 'filter[feature]': 'email_triage', sort: 'cost_usd' } },
    sql: {
      ai_requests_list: () =>
        sqlPage([
          {
            id: uuid(106),
            created_at: TS,
            user_id: uuid(2),
            plan: 'pro',
            profile: 'balanced',
            feature: 'email_triage',
            tier: 't1',
            provider: PRIMARY.provider,
            model: PRIMARY.model,
            prompt_version_id: uuid(107),
            operation: 'structured',
            batch: false,
            status: 'ok',
            error_code: null,
            http_status: 200,
            input_tokens: 1000,
            output_tokens: 100,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            latency_ms: 900,
            ttft_ms: null,
            retry_count: 0,
            fallback_used: false,
            cost_usd: 0.001,
            citation_coverage: null,
            injection_suspected: false,
            correlation_id: null,
            job_id: uuid(70),
          },
        ]),
    },
    expect(h, body) {
      const args = argsOf(h, 'ai_requests_list') ?? {};
      assertEquals([args.p_sort, args.p_filter], ['-cost', { feature: 'email_triage' }]);
      const row = rows(body)[0] ?? {};
      assert(!('user_id' in row) && !('injection_suspected' in row));
    },
  },
  'GET /ai/models': {
    env: AI_KEYS,
    sql: {
      ai_model_config_list: () =>
        configList([
          sqlConfig(),
          sqlConfig({
            id: uuid(121),
            feature: 'stt',
            role: 'stt',
            primary_target: { provider: 'openai', model: 'stt-model-a', language: 'tr' },
            fallback_targets: [{ provider: 'deepgram', model: 'nova-3', params: {} }],
          }),
          sqlConfig({ id: uuid(122), feature: 'tts', role: 'unknown_role' }),
        ]),
    },
    expect(_h, body) {
      const d = data(body);
      const configs = d.configs as Record<string, unknown>[];
      assertEquals(configs.length, 2, 'the seeded voice rows are listed; unknown roles are not');
      assertEquals(
        configs.map((c) => [c.role, c.feature]),
        [
          ['classifier', 'email_triage'],
          ['stt', 'stt'],
        ],
      );
      assertEquals(configs[1]?.fallback_targets, [{ provider: 'deepgram', model: 'nova-3' }]);
      assertEquals(d.profile_costs, {
        balanced: { monthly_usd: 2.2412, coverage: 0.97, pro_users: 40, window_days: 30 },
        lean: { monthly_usd: null, coverage: null, pro_users: 40, window_days: 30 },
      });
      assertEquals(configs[0]?.batch_policy, 'micro_batch');
      assertEquals(configs[0]?.eval_status, 'pending');
      assertEquals(configs[0]?.retires_not_before, '2026-10-15T00:00:00Z');
      assertEquals(configs[0]?.primary_target, {
        ...PRIMARY,
        effort: 'low',
        max_output_tokens: 800,
      });
      assertEquals(d.credentials, {
        anthropic: 'configured',
        openai: 'external_credential_required',
        voyage: 'configured',
        stt: 'external_credential_required',
        tts: 'external_credential_required',
      });
    },
  },
  'PATCH /ai/models/:profile/:feature': {
    env: AI_KEYS,
    sql: (() => {
      let version = 3;
      return {
        ai_model_config_list: () => configList([sqlConfig({ version })]),
        ai_model_config_update: () => {
          version = 4;
          return {
            id: uuid(120),
            profile: 'balanced',
            feature: 'email_triage',
            version: 4,
            eval_status: 'missing',
            enabled: true,
          };
        },
      };
    })(),
    expect(h, body) {
      const args = argsOf(h, 'ai_model_config_update') ?? {};
      assertEquals(
        [args.p_profile, args.p_role, args.p_feature, args.p_provider, args.p_model],
        ['balanced', 'classifier', 'email_triage', PRIMARY.provider, PRIMARY.model],
      );
      assertEquals(
        args.p_params,
        { effort: 'low', max_output_tokens: 800 },
        'existing params are kept',
      );
      assertEquals([args.p_expected_version, args.p_reason], [3, REASON]);
      assertEquals(
        [args.p_clear_escalation, args.p_clear_cache_ttl, args.p_batch_policy],
        [false, false, null],
      );
      assertEquals(data(body).version, 4);
    },
  },
  'POST /ai/models/:profile/:feature/test': {
    sql: {
      ai_model_config_list: () =>
        configList([sqlConfig({ profile: 'lean', feature: 'reply_draft', role: 'drafter' })]),
      ai_model_prices_list: () => PRICES,
      prompts_list: () => ({
        rows: [{ prompt_key: 'reply_draft', active_version: 2, active_version_id: uuid(202) }],
      }),
      prompt_version_get: promptVersionGet,
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'authorize'), { p_permission: 'ai.models.write' });
      assertEquals(argsOf(h, 'prompt_version_get'), { p_key: 'reply_draft', p_version: 2 });
      const audit = argsOf(h, 'audit_write') ?? {};
      assertEquals([audit.p_action, audit.p_target_id], ['ai_model_config.tested', uuid(120)]);
      const names = h.rpcNames();
      assert(names.indexOf('authorize') < names.indexOf('audit_write'));
      const d = data(body);
      assertEquals(typeof d.schema_pass, 'boolean');
      assertEquals(d.cost_usd, 0, 'fixture provider calls cost nothing');
    },
  },
  'PATCH /ai/routing-profile': {
    sql: {
      ai_model_config_list: () => configList([]),
      plan_routing_profile_set: () => ({ plan: 'pro', profile: 'lean' }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'plan_routing_profile_set'), {
        p_plan: 'pro',
        p_profile: 'lean',
        p_reason: REASON,
      });
      assertEquals(data(body), { plan: 'pro', before: 'balanced', after: 'lean' });
    },
  },
  'GET /ai/feedback/aggregates': {
    sql: {
      ai_feedback_aggregate: () => ({
        range: '7d',
        group: 'prompt_version',
        rows: [
          { key: 'reply_draft@3', positive: 10, negative: 2, rate: 0.8333 },
          { key: null, positive: 0, negative: 0, rate: null },
        ],
        top_reasons: [{ reason_code: 'tone', count: 2 }],
      }),
    },
    expect(_h, body) {
      assertEquals(rows(body)[1], { key: 'none', positive: 0, negative: 0, rate: 0 });
    },
  },
  'GET /ai/feedback': {
    request: { query: { 'filter[prompt_version]': uuid(107) } },
    sql: {
      ai_feedback_list: () =>
        sqlPage([
          {
            id: uuid(108),
            feature: 'reply_draft',
            model: PRIMARY.model,
            prompt_version_id: uuid(107),
            prompt_version: 3,
            target_type: 'reply_draft',
            rating: -1,
            reason_code: 'tone',
            has_comment: true,
            created_at: TS,
          },
        ]),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'ai_feedback_list')?.p_filter, { prompt_version_id: uuid(107) });
      const row = rows(body)[0] ?? {};
      assertEquals(row.prompt_version, '3');
      assertEquals(row.has_comment, true, '"Yorum var · gizli"');
      assert(!('comment' in row), 'the text only through the audited reveal');
    },
  },
  'POST /ai/feedback/:id/reveal': {
    sql: { ai_feedback_reveal_comment: () => ({ value: 'Ton çok resmi.', expires_in_s: 60 }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'ai_feedback_reveal_comment'), { p_id: uuid(108), p_reason: REASON });
      assertEquals(data(body), { value: 'Ton çok resmi.', expires_in_s: 60 });
    },
  },
  // ADM-09
  'GET /ai/prompts': {
    sql: {
      prompts_list: () => ({
        rows: [
          {
            prompt_key: 'email_classification',
            active_version: 2,
            active_version_id: uuid(202),
            versions: 2,
            drafts: 0,
          },
          {
            prompt_key: 'assistant',
            active_version: null,
            active_version_id: null,
            versions: 0,
            drafts: 0,
          },
        ],
      }),
    },
    expect(_h, body) {
      assertEquals(rows(body), [
        { key: 'email_classification', active_version: 2 },
        { key: 'assistant', active_version: null },
      ]);
    },
  },
  'GET /ai/prompts/:key': {
    sql: {
      prompt_versions_list: () => ({
        prompt_key: 'assistant',
        rows: [
          {
            id: uuid(202),
            version: 2,
            status: 'active',
            created_by: 'ai_ops',
            created_at: TS,
            activated_by: null,
            activated_at: TS,
            archived_at: null,
            eval_passed: true,
            eval_dataset_version: 'v1',
            notes: null,
            changelog: null,
            telemetry: {
              requests: 100,
              error_rate: 0.01,
              schema_invalid_rate: 0,
              grounding_rejected_rate: 0,
              cost_usd: 0.2,
            },
            feedback: { positive: 9, negative: 1, positive_rate: 0.9 },
          },
        ],
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'prompt_versions_list'), { p_key: 'assistant', p_range: '30d' });
      const version = (data(body).versions as Record<string, unknown>[])[0] ?? {};
      assertEquals(version.telemetry, {
        requests: 100,
        error_rate: 0.01,
        feedback_positive_rate: 0.9,
      });
    },
  },
  'GET /ai/prompts/:key/diff': {
    sql: {
      prompt_version_get: promptVersionGet,
      prompt_diff: (args) => {
        const a = sqlPromptVersion(args.p_a === uuid(201) ? 1 : 2);
        const b = sqlPromptVersion(args.p_b === uuid(202) ? 2 : 1);
        const pick = (v: ReturnType<typeof sqlPromptVersion>) => ({
          id: v.id,
          version: v.version,
          system_prompt: v.system_prompt,
          user_template: v.user_template,
          output_schema_ref: v.output_schema_ref,
        });
        return { prompt_key: 'reply_draft', from: pick(a), to: pick(b) };
      },
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'prompt_diff'), { p_a: uuid(201), p_b: uuid(202) });
      const diff = String(data(body).diff);
      assertMatch(diff, /^--- system v1\n\+\+\+ system v2\n@@ /);
      assert(diff.includes('-Kısa yanıt ver (v1).') && diff.includes('+Kısa yanıt ver (v2).'));
      assert(!diff.includes('user v1'), 'unchanged parts produce no hunk');
    },
  },
  'GET /ai/prompts/:key/versions/:v': {
    sql: {
      prompt_version_get: promptVersionGet,
      prompt_versions_list: () => ({
        prompt_key: 'reply_draft',
        rows: [
          {
            ...sqlPromptVersion(2),
            telemetry: { requests: 100, error_rate: 0.01 },
            feedback: { positive_rate: null },
          },
        ],
      }),
    },
    expect(_h, body) {
      const d = data(body);
      assertEquals([d.key, d.output_schema, d.version], ['reply_draft', 'ReplyDraftsV1', 2]);
      assertEquals(d.telemetry, { requests: 100, error_rate: 0.01, feedback_positive_rate: null });
      assertEquals(d.template_system, 'Sen bir asistansın.\nKısa yanıt ver (v2).');
    },
  },
  'POST /ai/prompts/:key/versions': {
    sql: {
      prompt_create_draft: () => ({
        id: uuid(203),
        prompt_key: 'reply_draft',
        version: 3,
        status: 'draft',
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'prompt_create_draft'), {
        p_key: 'reply_draft',
        p_from_version: null,
        p_system_prompt: 'Sen bir asistansın.',
        p_user_template: '{{thread}}',
        p_output_schema_ref: 'ReplyDraftsV1',
        p_notes: null,
      });
      assertEquals(data(body), { key: 'reply_draft', version: 3, status: 'draft' });
    },
  },
  'PATCH /ai/prompts/:key/versions/:v': {
    sql: {
      prompt_update_draft: () => ({
        id: uuid(203),
        prompt_key: 'reply_draft',
        version: 3,
        status: 'draft',
      }),
    },
    expect(h) {
      assertEquals(argsOf(h, 'prompt_update_draft')?.p_notes, 'Ton düzeltmesi');
    },
  },
  'POST /ai/prompts/:key/versions/:v/test': {
    sql: {
      prompt_version_get: promptVersionGet,
      ai_model_config_list: () =>
        configList([sqlConfig({ feature: 'reply_draft', role: 'drafter' })]),
      ai_model_prices_list: () => PRICES,
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'authorize'), { p_permission: 'prompts.write' });
      const d = data(body);
      assertEquals(d.cases, 2);
      assert(Number(d.schema_pass_rate) >= 0 && Number(d.schema_pass_rate) <= 1);
      const audit = argsOf(h, 'audit_write') ?? {};
      assertEquals([audit.p_action, audit.p_target_id], ['prompt.tested', uuid(203)]);
    },
  },
  'POST /ai/prompts/:key/versions/:v/activate': {
    sql: {
      prompt_version_get: promptVersionGet,
      prompt_activate: () => ({
        id: uuid(203),
        prompt_key: 'reply_draft',
        version: 3,
        status: 'active',
        previous_version: 2,
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'prompt_activate'), { p_version: uuid(203), p_reason: REASON });
      assertEquals(data(body), { key: 'reply_draft', version: 3, status: 'active' });
    },
  },
  'POST /ai/prompts/:key/rollback': {
    sql: {
      prompt_rollback: () => ({
        id: uuid(202),
        prompt_key: 'reply_draft',
        version: 2,
        status: 'active',
        rolled_back_from: 3,
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'prompt_rollback'), {
        p_key: 'reply_draft',
        p_version: 2,
        p_reason: REASON,
      });
      assertEquals(data(body), { key: 'reply_draft', version: 2, status: 'active' });
    },
  },
  'POST /ai/prompts/:key/versions/:v/archive': {
    sql: {
      prompt_version_get: promptVersionGet,
      prompt_archive: () => ({ id: uuid(201), status: 'archived' }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'prompt_archive'), { p_version: uuid(201), p_reason: REASON });
      assertEquals(data(body), { key: 'reply_draft', version: 1, status: 'archived' });
    },
  },
};
