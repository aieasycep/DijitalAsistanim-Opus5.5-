import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadPrompts } from '../../gen-prompt-migration.ts';
import {
  attachViewColumns,
  buildSchemaModel,
  compareWithTypes,
  effectiveColumns,
  handleStatement,
  readTypes,
  type SchemaModel,
  splitStatements,
} from '../db-model.ts';
import {
  buildAiPromptsRun,
  CAPTURE_EXTRACT,
  describePrompts,
  parseFeatureMap,
  parseModelConfigSeed,
  purposeOf,
  REGISTRY,
  tierLabel,
  VARIANT_FEATURE,
  MODEL_CONFIG_SEED,
} from '../gen-ai-prompts.ts';
import { buildAiRoutingRun, renderPrices, targetLabel } from '../gen-ai-routing.ts';
import {
  buildReferenceRun,
  clientAccess,
  columnScope,
  cronSummary,
  diffFacts,
  modelFacts,
} from '../gen-db-reference.ts';
import {
  applyGenerated,
  MODEL_ID,
  readSqlString,
  ROOT,
  spliceGenerated,
  splitTopLevel,
  stripSqlComments,
} from '../lib.ts';

const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function emptyModel(): SchemaModel {
  return {
    migrations: [],
    relations: new Map(),
    functions: new Map(),
    cronJobs: [],
    buckets: [],
    storagePolicies: [],
  };
}

function run(model: SchemaModel, sql: string): void {
  const ctx = { model, migration: 'test.sql' };
  for (const stmt of splitStatements(stripSqlComments(sql))) {
    handleStatement(ctx, /^do \$/i.test(stmt) ? stmt : stmt.replace(/\s+/g, ' '));
  }
}

// ── lib ─────────────────────────────────────────────────────────────────────────────────────

test('generated sections are spliced between exactly one pair of markers', () => {
  const doc = 'head\n<!-- generated:x:start -->\nold\n<!-- generated:x:end -->\ntail\n';
  assert.equal(
    spliceGenerated(doc, 'x', 'new body'),
    'head\n<!-- generated:x:start -->\n\nnew body\n\n<!-- generated:x:end -->\ntail\n',
  );
  assert.throws(() => spliceGenerated('no markers', 'x', 'b'), /exactly one/);
  assert.throws(() => spliceGenerated(`${doc}${doc}`, 'x', 'b'), /exactly one/);
  assert.throws(() => spliceGenerated(doc, 'x', ['model', 'claude-x'].join(' ')), /model identifier/);
});

test('SQL helpers respect literals, dollar quotes and nesting', () => {
  assert.deepEqual(readSqlString("'it''s' rest", 0), { value: "it's", end: 7 });
  assert.equal(stripSqlComments("select '--x' -- note\n$$ -- kept $$"), "select '--x' \n$$ -- kept $$");
  assert.deepEqual(splitTopLevel("a, f(b, c), 'd,e', array[1, 2]"), [
    'a',
    'f(b, c)',
    "'d,e'",
    'array[1, 2]',
  ]);
  assert.deepEqual(splitStatements("select 1; do $$ begin perform 1; end $$; select ';'"), [
    'select 1',
    'do $$ begin perform 1; end $$',
    "select ';'",
  ]);
});

// ── AI prompts ──────────────────────────────────────────────────────────────────────────────

test('docs/AI_PROMPTS.md matches the prompt registry (no drift)', () => {
  const spec = buildAiPromptsRun();
  assert.equal(applyGenerated(spec, true), true, 'run `node scripts/docs/gen-ai-prompts.ts`');
  assert.equal(spec.sections.some((x) => MODEL_ID.test(x.body)), false);
});

test('every prompt key maps to a feature and a routing row', () => {
  const featureMap = parseFeatureMap(read(REGISTRY));
  assert.equal(featureMap.get('email_triage'), 'email_classification');
  const rows = parseModelConfigSeed(read(MODEL_CONFIG_SEED));
  assert.equal(rows.filter((r) => r.profile === 'balanced').length, rows.filter((r) => r.profile === 'lean').length);
  const docs = describePrompts(loadPrompts(), featureMap, rows);
  for (const d of docs) {
    assert.notEqual(d.balanced, null, `${d.prompt.prompt_key} has a balanced route`);
    assert.notEqual(d.lean, null, `${d.prompt.prompt_key} has a lean route`);
  }
  const capture = docs.find((d) => d.prompt.prompt_key === 'capture_vision');
  assert.ok(capture !== undefined);
  assert.equal(capture.balanced?.role, 'reasoning');
  assert.equal(tierLabel(capture.balanced), 'T2 → T3');
  // The variant keys are the ones the capture extractor really picks.
  const extractor = read(CAPTURE_EXTRACT);
  for (const key of Object.keys(VARIANT_FEATURE)) assert.match(extractor, new RegExp(`promptKey: '${key}'`));
});

test('prompts without a feature are refused, and the purpose is the opening of the system prompt', () => {
  const [first] = loadPrompts();
  assert.ok(first !== undefined);
  assert.throws(
    () => describePrompts([{ ...first, prompt_key: 'unknown_key' }], new Map(), []),
    /has no feature/,
  );
  assert.equal(
    purposeOf('You are the X of Dijital Asistan, a Turkish-first personal command center. You read mail. More.\n\nNext'),
    'You are the X of Dijital Asistan. You read mail.',
  );
});

test('docs/AI_PIPELINE.md model tables match the seeds (no drift)', () => {
  const spec = buildAiRoutingRun();
  assert.equal(applyGenerated(spec, true), true, 'run `node scripts/docs/gen-ai-routing.ts`');
  // Only these sections may name models.
  assert.ok(spec.sections.every((x) => x.allowModelIds === true));
  assert.equal(
    targetLabel({
      provider: 'p',
      model: 'm',
      params: { effort: 'low', thinking: { type: 'adaptive' }, max_output_tokens: 1500, timeout_ms: 20000 },
    }),
    '`p` `m` · effort low · thinking adaptive · 1,500 out · 20 s',
  );
  assert.match(
    renderPrices([new Map<string, string | number | null>([['provider', 'p'], ['model', 'm'], ['input_per_mtok_usd', 1]])]),
    /\| `p` \| `m` \| \$1 \| – \|/,
  );
});

// ── Database model ──────────────────────────────────────────────────────────────────────────

test('docs/DATABASE.md matches the migrations and the generated types (no drift)', () => {
  const spec = buildReferenceRun();
  assert.equal(applyGenerated(spec, true), true, 'run `node scripts/docs/gen-db-reference.ts`');
  assert.equal(spec.sections.some((x) => MODEL_ID.test(x.body)), false);
});

test('the static model agrees with database.types.ts and keeps every public table locked down', () => {
  const model = buildSchemaModel();
  const types = readTypes();
  attachViewColumns(model, types);
  assert.deepEqual(compareWithTypes(model, types), []);
  const tables = [...model.relations.values()].filter((r) => r.schema === 'public' && r.kind === 'table');
  assert.equal(tables.length, types.tables.size);
  for (const t of tables) {
    assert.ok(t.rlsEnabled && t.rlsForced, `${t.name}: RLS forced`);
    const anon = t.grants.get('anon');
    assert.ok(anon === undefined || (anon.table.size === 0 && anon.columns.size === 0), `${t.name}: no anon grant`);
  }
  // Credentials are never client-readable; a hidden column stays hidden.
  const credentials = model.relations.get('public.oauth_credentials');
  assert.ok(credentials !== undefined);
  assert.deepEqual(clientAccess(credentials).lines, []);
  const deletion = model.relations.get('public.data_deletion_requests');
  assert.ok(deletion !== undefined);
  assert.equal(effectiveColumns(deletion, 'authenticated', 'select').includes('status_token_hash'), false);
  assert.equal(model.cronJobs.length, 8);
  const facts = modelFacts(model);
  assert.equal(facts.functions.filter((f) => f.startsWith('public.') && f.endsWith(':authenticated')).length, 26);
});

test('do-block loops expand like the database would run them', () => {
  const model = emptyModel();
  run(
    model,
    `create table public.a (id uuid not null, user_id uuid not null, secret text, constraint a_pkey primary key (id));
     create table public.b (id uuid, user_id uuid);
     do $$ declare t record; begin
       for t in select c.relname from pg_catalog.pg_class c
                where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
       loop
         execute format('alter table public.%I enable row level security', t.relname);
         execute format('alter table public.%I force row level security', t.relname);
         execute format('revoke all on table public.%I from public, anon, authenticated', t.relname);
       end loop; end $$;
     do $$ declare r record; v_cols text; begin
       for r in select * from (values ('a', array['secret'])) as v (table_name, hidden) loop
         select string_agg(a.attname, ', ') into v_cols from pg_catalog.pg_attribute a
         where a.attrelid = r.table_name::regclass and not (a.attname = any(r.hidden));
         execute format('grant select (%s) on table public.%I to authenticated', v_cols, r.table_name);
       end loop; end $$;
     do $$ declare t text; begin
       foreach t in array array['a', 'b'] loop
         execute format('create policy %I on public.%I for select to authenticated '
                        'using ((select auth.uid()) = user_id)', t || '_select_own', t);
       end loop; end $$;
     alter table public.a add column later text;
     grant delete on table public.b to authenticated;`,
  );
  const a = model.relations.get('public.a');
  const b = model.relations.get('public.b');
  assert.ok(a !== undefined && b !== undefined);
  assert.ok(a.rlsForced && b.rlsForced);
  assert.deepEqual(a.columns, ['id', 'user_id', 'secret', 'later']);
  // Columns added after the grant are not covered by it.
  assert.deepEqual(effectiveColumns(a, 'authenticated', 'select'), ['id', 'user_id']);
  assert.deepEqual([...a.policies.keys()], ['a_select_own']);
  // The shorter description wins: the granted list here, the exception list for wide tables.
  assert.equal(columnScope(a, ['id', 'user_id']), '`id`, `user_id`');
  assert.equal(columnScope(a, ['id', 'user_id', 'later']), 'all columns except `secret`');
  assert.deepEqual(clientAccess(a).lines, ['**read** own rows · `id`, `user_id`']);
  // A grant without a policy is reported, not shown as access.
  assert.deepEqual(clientAccess(b).notes, ['delete granted without a policy (RLS denies it)']);
});

test('unknown loop shapes fail loudly instead of being skipped', () => {
  const model = emptyModel();
  assert.throws(() => {
    run(
        model,
        `create table public.a (id uuid, user_id uuid);
         do $$ declare t record; begin
           for t in select tablename from pg_tables loop
             execute format('grant select on table public.%I to authenticated', t.tablename);
           end loop; end $$;`,
    );
  }, /unsupported loop/);
});

test('catalog comparison and summaries', () => {
  assert.deepEqual(diffFacts('policy', ['a', 'b'], ['b', 'c']), [
    'policy: in the database only: a',
    'policy: in the static model only: c',
  ]);
  assert.equal(
    cronSummary("select public.enqueue_job('retention', 'retention:' || now())"),
    'enqueues a `retention` job (key per time bucket)',
  );
  assert.equal(cronSummary('select private.scheduler_tick();'), '`private.scheduler_tick()`');
  assert.equal(
    cronSummary('delete from cron.job_run_details where x; delete from net._http_response where y'),
    'deletes old rows from `cron.job_run_details` and `net._http_response`',
  );
});
