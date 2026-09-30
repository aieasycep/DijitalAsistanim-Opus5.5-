/**
 * Database source checks: QG-10 RLS (static half; the live `rls-report.json` / pgTAP assertion runs
 * in the `db` job and is verified present here) and QG-17 migration portability.
 *
 * Static RLS rule: every table created in `public` / `admin_api` has RLS enabled and forced, either
 * by an explicit `alter table … enable|force row level security` in any migration or by the
 * catalogue-wide loop of `…_rls_policies_grants.sql` when the table is created before that file.
 */
import { type Check, type Context, type Finding, lineAt, missing } from '../lib.ts';

const PORTABILITY =
  /JSON_TABLE|MERGE\s+.*RETURNING|transaction_timeout|halfvec|sparsevec|hnsw\.iterative_scan/i;
const CREATE_EXT = /create\s+extension\s+(?!if\s+not\s+exists)("?)(pg_net|pg_cron|vector)\1/i;
const CREATE_TABLE =
  /create\s+table\s+(?:if\s+not\s+exists\s+)?(public|admin_api)\.("?)([a-z_][a-z0-9_]*)\2/gi;
/** The catalogue-wide loop: `execute format('alter table public.%I enable|force row level security', …)`. */
const LOOP_ENABLE = /alter table public\.%I enable row level security/i;
const LOOP_FORCE = /alter table public\.%I force row level security/i;

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));
}

export const database: Check = {
  ids: ['QG-10', 'QG-17'],
  title: 'RLS forced on every table (static), migration portability',
  run(ctx: Context): Finding[] {
    const migrations = ctx.select(['supabase/migrations/'], /\.sql$/);
    const out: Finding[] = [];
    const sources = migrations.map((f) => ({ f, sql: stripSqlComments(ctx.read(f)) }));
    const all = sources.map((s) => s.sql).join('\n');
    const loop = sources.find((s) => LOOP_ENABLE.test(s.sql) && LOOP_FORCE.test(s.sql));
    for (const { f, sql } of sources) {
      sql.split('\n').forEach((line, i) => {
        if (PORTABILITY.test(line) || CREATE_EXT.test(line))
          out.push({ id: 'QG-17', file: f, line: i + 1, match: line.trim().slice(0, 160) });
      });
      for (const m of sql.matchAll(CREATE_TABLE)) {
        const schema = (m[1] ?? '').toLowerCase();
        const table = m[3] ?? '';
        const coveredByLoop = schema === 'public' && loop !== undefined && f <= loop.f;
        const q = `${schema}\\.("?)${table}\\1`;
        const enable = new RegExp(
          `alter\\s+table\\s+(only\\s+)?${q}\\s+enable\\s+row\\s+level\\s+security`,
          'i',
        );
        const force = new RegExp(
          `alter\\s+table\\s+(only\\s+)?${q}\\s+force\\s+row\\s+level\\s+security`,
          'i',
        );
        if (!coveredByLoop && !(enable.test(all) && force.test(all)))
          out.push({
            id: 'QG-10',
            file: f,
            line: lineAt(sql, m.index),
            match: `${schema}.${table} has no enable + force row level security`,
          });
      }
    }
    if (ctx.exists('supabase/tests/database')) {
      const asserted = ctx
        .select(['supabase/tests/database/'], /\.sql$/)
        .some((f) => ctx.read(f).includes('relforcerowsecurity'));
      if (!asserted)
        out.push(
          missing(
            'QG-10',
            'supabase/tests/database',
            'no pgTAP assertion that RLS is forced on every table',
          ),
        );
    }
    return out;
  },
};
