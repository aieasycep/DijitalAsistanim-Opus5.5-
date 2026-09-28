/**
 * docs/DATABASE.md reference generator (IMPLEMENTATION_PLAN T-12.08: "table and RLS reference
 * (generated section)"). It renders the section between `<!-- generated:db:start -->` and
 * `<!-- generated:db:end -->` from the migrations and `packages/api-client/src/database.types.ts`
 * (see `db-model.ts`); no database is needed, so `--check` runs in `pnpm test:scripts`.
 *
 * Usage:
 *   node scripts/docs/gen-db-reference.ts               rewrite the section
 *   node scripts/docs/gen-db-reference.ts --check       fail when the section is out of date
 *   node scripts/docs/gen-db-reference.ts --verify-db   compare the static model with the catalog of
 *     a migrated database: DA_DOCS_DB_URL (libpq URL), otherwise the tier-C test database through
 *     scripts/db/psql.sh (PGPORT / DA_TEST_DB select the cluster and database)
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Constants } from '../../packages/api-client/src/database.types.ts';
import {
  attachViewColumns,
  buildSchemaModel,
  compareWithTypes,
  effectiveColumns,
  type FunctionModel,
  hasTablePrivilege,
  type PolicyModel,
  readTypes,
  type RelationModel,
  type SchemaModel,
} from './db-model.ts';
import { type GeneratorRun, cell, code, mainOf, repoLink, ROOT } from './lib.ts';

export const DOC = join(ROOT, 'docs', 'DATABASE.md');
const SCRIPT = 'scripts/docs/gen-db-reference.ts';
const CLIENT = 'authenticated';
const OWN = '(select auth.uid()) = user_id';

function codes(values: readonly string[]): string {
  return values.map(code).join(', ');
}

/** "all columns", "all columns except `a`", or the column list. */
export function columnScope(rel: RelationModel, cols: readonly string[]): string {
  if (cols.length === rel.columns.length) return 'all columns';
  const missing = rel.columns.filter((c) => !cols.includes(c));
  if (missing.length <= 5 && missing.length < cols.length) return `all columns except ${codes(missing)}`;
  return codes(cols);
}

/** Row scope of the permissive policies for one command. */
export function rowScope(policies: readonly PolicyModel[], field: 'using' | 'check'): string {
  const scopes = policies.map((p) => {
    const expr = (field === 'check' ? (p.check ?? p.using) : p.using)?.replace(/\s+/g, ' ').trim() ?? 'true';
    if (expr === OWN) return 'own rows';
    if (expr === 'true') return 'all rows';
    if (expr.startsWith(`${OWN} and `)) return `own rows where ${code(expr.slice(OWN.length + 5))}`;
    return code(expr);
  });
  return [...new Set(scopes)].join(' or ');
}

function policiesFor(rel: RelationModel, command: PolicyModel['command'], restrictive: boolean): PolicyModel[] {
  return [...rel.policies.values()].filter(
    (p) =>
      p.restrictive === restrictive &&
      (p.command === command || p.command === 'all') &&
      (p.roles.includes(CLIENT) || p.roles.includes('public')),
  );
}

export interface ClientAccess {
  readonly lines: string[];
  readonly notes: string[];
}

/** What a signed-in client (`authenticated`) can do on a relation: grants AND policies. */
export function clientAccess(rel: RelationModel): ClientAccess {
  const lines: string[] = [];
  const notes: string[] = [];
  const kinds = [
    ['select', 'read', 'using'],
    ['insert', 'insert', 'check'],
    ['update', 'update', 'check'],
  ] as const;
  for (const [priv, label, field] of kinds) {
    const cols = effectiveColumns(rel, CLIENT, priv);
    const permissive = policiesFor(rel, priv, false);
    if (cols.length === 0) continue;
    if (rel.kind === 'table' && permissive.length === 0) {
      notes.push(`${priv} granted without a policy (RLS denies it)`);
      continue;
    }
    const rows =
      rel.kind === 'table'
        ? rowScope(permissive, field)
        : rel.securityInvoker
          ? 'rows the caller may see in the underlying tables (`security_invoker`)'
          : 'all rows (runs with the view owner rights)';
    lines.push(`**${label}** ${rows} · ${columnScope(rel, cols)}`);
  }
  if (hasTablePrivilege(rel, CLIENT, 'delete')) {
    const permissive = policiesFor(rel, 'delete', false);
    if (permissive.length === 0) notes.push('delete granted without a policy (RLS denies it)');
    else lines.push(`**delete** ${rowScope(permissive, 'using')}`);
  }
  const restrictive = [...rel.policies.values()].filter((p) => p.restrictive);
  if (restrictive.length > 0) {
    notes.push(
      `restrictive ${restrictive.map((p) => code(p.name)).join(', ')} (${code(restrictive[0]?.using ?? '')})`,
    );
  }
  const service = rel.grants.get('service_role');
  if (rel.kind === 'table' && service?.table.has('insert') === true) {
    const missing = (['update', 'delete'] as const).filter((p) => !service.table.has(p));
    if (missing.length > 0) {
      notes.push(`append-only: no ${missing.map((m) => m.toUpperCase()).join(' or ')}, not even for \`service_role\``);
    }
  }
  if (rel.grants.get('anon') !== undefined) {
    const anon = rel.grants.get('anon');
    if (anon !== undefined && (anon.table.size > 0 || anon.columns.size > 0)) notes.push('**anon has grants**');
  }
  if (rel.kind === 'table' && !(rel.rlsEnabled && rel.rlsForced)) notes.push('**RLS not forced**');
  return { lines, notes };
}

function migrationTitle(file: string): string {
  const m = /^(\d+)_(.+)\.sql$/.exec(file);
  return m === null ? file : `${m[2]?.replace(/_/g, ' ')} (${m[1]})`;
}

function tableRow(rel: RelationModel): string {
  const access = clientAccess(rel);
  const accessText = access.lines.length === 0 ? 'none (SYS)' : access.lines.join('<br>');
  return `| ${code(rel.name)} | ${cell(rel.comment ?? '')} | ${rel.columns.length} | ${accessText} | ${access.notes.join('<br>')} |`;
}

function renderRelations(model: SchemaModel): string[] {
  const out: string[] = [];
  const publicTables = [...model.relations.values()].filter((r) => r.schema === 'public' && r.kind === 'table');
  const groups = new Map<string, RelationModel[]>();
  for (const rel of publicTables) groups.set(rel.migration, [...(groups.get(rel.migration) ?? []), rel]);
  out.push(
    '### Tables (`public`)',
    '',
    `${publicTables.length} tables, grouped by the migration that creates them. **Client access** is what a signed-in user (\`authenticated\`) can do through PostgREST: the column grant **and** a permissive policy are both required. "own rows" is \`${OWN}\`; "none (SYS)" means no client grant: only \`service_role\` (Edge Functions) and security-definer functions reach the table. Every table has RLS enabled and forced; \`anon\` has no grant anywhere.`,
  );
  for (const [migration, rels] of groups) {
    out.push(
      '',
      `#### ${migrationTitle(migration)}`,
      '',
      `Created in ${repoLink(DOC, `supabase/migrations/${migration}`, code(migration))}.`,
      '',
      '| Table | Purpose (table comment) | Cols | Client access | Notes |',
      '|---|---|---|---|---|',
      ...rels.map(tableRow),
      '',
      '<details><summary>Columns</summary>',
      '',
      ...rels.map((r) => `- ${code(r.name)}: ${r.columns.join(', ')}`),
      '',
      '</details>',
    );
  }
  const views = [...model.relations.values()].filter((r) => r.kind === 'view' && r.schema === 'public');
  out.push('', '### Views (`public`)', '', '| View | Created in | Client access |', '|---|---|---|');
  for (const v of views) {
    const access = clientAccess(v);
    out.push(`| ${code(v.name)} | ${code(v.migration)} | ${access.lines.join('<br>') || 'none'} |`);
  }
  const priv = [...model.relations.values()].filter((r) => r.schema === 'private');
  out.push(
    '',
    '### `private` schema relations',
    '',
    'Never exposed through PostgREST (only `public` and `admin_api` are). Reached by security-definer functions and, where granted, by `service_role`.',
    '',
    '| Relation | Kind | Created in | Purpose | `service_role` |',
    '|---|---|---|---|---|',
  );
  for (const r of priv) {
    const g = r.grants.get('service_role');
    const privs = g === undefined ? [] : [...g.table].sort();
    out.push(
      `| ${code(r.name)} | ${r.kind} | ${code(r.migration)} | ${cell(r.comment ?? '')} | ${privs.length === 0 ? '–' : privs.join(', ')} |`,
    );
  }
  return out;
}

function executableBy(fn: FunctionModel, role: string): boolean {
  return fn.execute.has(role) || fn.execute.has('public');
}

function renderFunctions(model: SchemaModel): string[] {
  const fns = [...model.functions.values()];
  const bySchema = (s: FunctionModel['schema']) =>
    fns.filter((f) => f.schema === s).sort((a, b) => a.name.localeCompare(b.name));
  const split = (list: readonly FunctionModel[]) => ({
    client: list.filter((f) => executableBy(f, CLIENT)),
    service: list.filter((f) => !executableBy(f, CLIENT) && f.execute.has('service_role')),
    neither: list.filter((f) => !executableBy(f, CLIENT) && !f.execute.has('service_role')),
  });
  const pub = split(bySchema('public'));
  const admin = split(bySchema('admin_api'));
  const priv = split(bySchema('private'));
  const row = (schema: string, s: ReturnType<typeof split>) =>
    `| \`${schema}\` | ${s.client.length + s.service.length + s.neither.length} | ${s.client.length} | ${s.service.length} | ${s.neither.length} |`;
  const names = (list: readonly FunctionModel[]) => codes(list.map((f) => f.name));
  const out = [
    '### Functions',
    '',
    'EXECUTE as granted by the migrations (PostgreSQL grants EXECUTE to PUBLIC on a new function; the migrations revoke it). "Neither" functions are reached only from other definer functions, triggers or the database owner.',
    '',
    '| Schema | Functions | `authenticated` (and `service_role`) | `service_role` only | Neither |',
    '|---|---|---|---|---|',
    row('public', pub),
    row('admin_api', admin),
    row('private', priv),
    '',
    `**User RPCs** (\`public\`, called with the user's JWT; RLS and \`auth.uid()\` scope them): ${names(pub.client)}.`,
    '',
    `**Service-role wrappers and server helpers** (\`public\`; the Edge Functions call \`private\` logic through these): ${names(pub.service)}.`,
  ];
  if (pub.neither.length > 0) out.push('', `**Other \`public\` functions**: ${names(pub.neither)}.`);
  out.push(
    '',
    `**\`admin_api\` functions** (callable by \`authenticated\`, but each checks the gateway header, \`aal2\`, the admin identity, the session and its permission in SQL; see [BACKOFFICE_RBAC.md](BACKOFFICE_RBAC.md)): ${names(admin.client)}.`,
  );
  if (admin.service.length > 0) {
    out.push('', `**\`admin_api\` functions for \`service_role\` only** (the sign-in and invite steps that \`admin-api\` runs with the secret key before an admin JWT exists, and the health-row writer): ${names(admin.service)}.`);
  }
  if (priv.client.length > 0) {
    out.push(
      '',
      `**\`private\` functions executable by \`authenticated\`** (pure helpers used by CHECK constraints on client-writable columns and by RLS-evaluated expressions): ${names(priv.client)}.`,
    );
  }
  return out;
}

function renderEnums(): string[] {
  const enums = Constants.public.Enums as Readonly<Record<string, readonly string[]>>;
  const names = Object.keys(enums).sort();
  return [
    '### Enums (`public`)',
    '',
    `${names.length} enums (\`Constants.public.Enums\` of the generated types; \`pnpm db:enum-parity\` keeps them equal to \`DB_ENUMS\` in \`@da/domain\`).`,
    '',
    '| Enum | Values |',
    '|---|---|',
    ...names.map((n) => `| ${code(n)} | ${(enums[n] ?? []).map(code).join(' ')} |`),
  ];
}

/** A one-line summary of a cron command. */
export function cronSummary(command: string): string {
  const job = /public\.enqueue_job\('([a-z_]+)'/.exec(command);
  if (job !== null) return `enqueues a ${code(job[1] ?? '')} job (key per time bucket)`;
  const call = /\b(private|public)\.([a-z0-9_]+)\(([^)]*)\)/.exec(command);
  if (call !== null) return code(`${call[1] ?? ''}.${call[2] ?? ''}(${call[3] ?? ''})`);
  const deletes = [...command.matchAll(/delete from ([a-z_.]+)/gi)].map((m) => code(m[1] ?? ''));
  if (deletes.length > 0) return `deletes old rows from ${deletes.join(' and ')}`;
  return code(command.slice(0, 60));
}

function renderCron(model: SchemaModel): string[] {
  return [
    '### Cron jobs (pg_cron, UTC)',
    '',
    '| Job | Schedule | Runs |',
    '|---|---|---|',
    ...model.cronJobs.map((j) => `| ${code(j.name)} | ${code(j.schedule)} | ${cronSummary(j.command)} |`),
  ];
}

function renderBuckets(model: SchemaModel): string[] {
  const mib = (n: number | null) => (n === null ? '–' : `${Math.round(n / 1048576)} MiB`);
  return [
    '### Storage buckets',
    '',
    '| Bucket | Public | Size limit | Allowed MIME types | Client policy on `storage.objects` |',
    '|---|---|---|---|---|',
    ...model.buckets.map((b) => {
      const pol = model.storagePolicies.filter((p) => p.using?.includes(`'${b.id}'`) === true);
      const policy =
        pol.length === 0
          ? 'none'
          : pol.map((p) => `${code(p.name)}: ${p.command} own folder \`{user_id}/…\``).join('<br>');
      return `| ${code(b.id)} | ${b.isPublic ? 'yes' : 'no'} | ${mib(b.fileSizeLimit)} | ${b.mimeTypes.map(code).join(' ')} | ${policy} |`;
    }),
    '',
    'Clients have no INSERT, UPDATE or DELETE policy on `storage.objects`: uploads use signed upload URLs minted by `api`, and the worker writes and deletes with the secret key.',
  ];
}

function renderMigrations(model: SchemaModel): string[] {
  return [
    '### Migration order',
    '',
    `${model.migrations.length} migrations, applied in file-name order:`,
    '',
    ...model.migrations.map((m) => `1. ${repoLink(DOC, `supabase/migrations/${m}`, code(m))}`),
  ];
}

export function renderReference(model: SchemaModel): string {
  return [
    ...renderMigrations(model),
    '',
    ...renderRelations(model),
    '',
    ...renderFunctions(model),
    '',
    ...renderEnums(),
    '',
    ...renderCron(model),
    '',
    ...renderBuckets(model),
  ].join('\n');
}

export function buildReferenceRun(): GeneratorRun {
  const model = buildSchemaModel();
  const types = readTypes();
  attachViewColumns(model, types);
  const problems = compareWithTypes(model, types);
  if (problems.length > 0) {
    throw new Error(`the migrations and database.types.ts disagree:\n${problems.join('\n')}`);
  }
  return { file: DOC, sections: [{ name: 'db', body: renderReference(model) }], script: SCRIPT };
}

// ── --verify-db ─────────────────────────────────────────────────────────────────────────────

const CATALOG_QUERY = `select json_build_object(
  'tables', (select json_agg(json_build_object('name', c.relname, 'rls', c.relrowsecurity, 'forced', c.relforcerowsecurity) order by c.relname)
             from pg_catalog.pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')),
  'policies', (select json_agg(p.tablename || '.' || p.policyname || ':' || lower(p.cmd) || ':' || lower(p.permissive) order by 1)
               from pg_catalog.pg_policies p where p.schemaname = 'public'),
  'columns', (select json_agg(c.relname || '.' || a.attname || ':' || x.priv order by 1)
              from pg_catalog.pg_class c
              join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
              cross join (values ('select'), ('insert'), ('update')) as x (priv)
              where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v')
                and has_column_privilege('authenticated', c.oid, a.attnum, x.priv)),
  'deletes', (select json_agg(c.relname order by 1) from pg_catalog.pg_class c
              where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
                and has_table_privilege('authenticated', c.oid, 'delete')),
  'functions', (select json_agg(distinct n.nspname || '.' || p.proname || ':' ||
                  case when has_function_privilege('authenticated', p.oid, 'execute') then 'authenticated'
                       when has_function_privilege('service_role', p.oid, 'execute') then 'service_role'
                       else 'none' end)
                from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                where n.nspname in ('public', 'admin_api', 'private') and p.prokind = 'f'
                  and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e'))
)`;

interface Catalog {
  readonly tables: { name: string; rls: boolean; forced: boolean }[];
  readonly policies: string[];
  readonly columns: string[];
  readonly deletes: string[];
  readonly functions: string[];
}

function readCatalog(): Catalog {
  const url = process.env.DA_DOCS_DB_URL;
  const output = url
    ? execFileSync('psql', [url, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', CATALOG_QUERY], { encoding: 'utf8' })
    : execFileSync('bash', [join(ROOT, 'scripts/db/psql.sh'), '-At', '-v', 'ON_ERROR_STOP=1', '-c', CATALOG_QUERY], {
        encoding: 'utf8',
      });
  return JSON.parse(output.trim()) as Catalog;
}

/** The same facts as the catalog query, from the static model. */
export function modelFacts(model: SchemaModel): Omit<Catalog, 'tables'> & { tables: Catalog['tables'] } {
  const rels = [...model.relations.values()].filter((r) => r.schema === 'public');
  const tables = rels.filter((r) => r.kind === 'table');
  const policies: string[] = [];
  const columns: string[] = [];
  for (const r of rels) {
    for (const p of r.policies.values()) {
      policies.push(`${r.name}.${p.name}:${p.command}:${p.restrictive ? 'restrictive' : 'permissive'}`);
    }
    for (const priv of ['select', 'insert', 'update'] as const) {
      for (const c of effectiveColumns(r, CLIENT, priv)) columns.push(`${r.name}.${c}:${priv}`);
    }
  }
  const functions = [...model.functions.values()].map((f) => {
    const who = executableBy(f, CLIENT) ? 'authenticated' : executableBy(f, 'service_role') ? 'service_role' : 'none';
    return `${f.schema}.${f.name}:${who}`;
  });
  return {
    tables: tables.map((t) => ({ name: t.name, rls: t.rlsEnabled, forced: t.rlsForced })),
    policies,
    columns,
    deletes: tables.filter((t) => hasTablePrivilege(t, CLIENT, 'delete')).map((t) => t.name),
    functions,
  };
}

export function diffFacts(label: string, db: readonly string[], model: readonly string[]): string[] {
  const a = new Set(db);
  const b = new Set(model);
  return [
    ...[...a].filter((x) => !b.has(x)).sort().map((x) => `${label}: in the database only: ${x}`),
    ...[...b].filter((x) => !a.has(x)).sort().map((x) => `${label}: in the static model only: ${x}`),
  ];
}

function verifyDb(): number {
  const catalog = readCatalog();
  const model = buildSchemaModel();
  attachViewColumns(model, readTypes());
  const facts = modelFacts(model);
  const asText = (t: Catalog['tables']) => t.map((x) => `${x.name}:${x.rls ? 'rls' : 'no-rls'}:${x.forced ? 'forced' : 'not-forced'}`);
  const problems = [
    ...diffFacts('table', asText(catalog.tables), asText(facts.tables)),
    ...diffFacts('policy', catalog.policies, facts.policies),
    ...diffFacts('column privilege', catalog.columns, facts.columns),
    ...diffFacts('delete privilege', catalog.deletes, facts.deletes),
    ...diffFacts('function', catalog.functions, facts.functions),
  ];
  for (const p of problems) console.error(p);
  if (problems.length > 0) {
    console.error(`${SCRIPT}: the static model differs from the database in ${problems.length} fact(s)`);
    return 1;
  }
  console.info(
    `${SCRIPT}: the static model matches the database (${facts.tables.length} tables, ${facts.policies.length} policies, ${facts.columns.length} client column privileges, ${facts.functions.length} functions)`,
  );
  return 0;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  process.exitCode = args.includes('--verify-db') ? verifyDb() : mainOf(buildReferenceRun, args);
}
