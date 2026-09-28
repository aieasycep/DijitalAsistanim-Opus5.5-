/**
 * A static model of the database schema built from the migrations (in file-name order) and the
 * generated PostgREST types, for docs/DATABASE.md (IMPLEMENTATION_PLAN T-12.08). No database is
 * needed: the statements that shape access (tables, columns, views, comments, RLS switches,
 * policies, table and column grants, function EXECUTE grants, cron jobs, storage buckets) are read
 * from the SQL text. The `do $$ … $$` loops of the RLS migration are interpreted: each
 * `execute format(…)` template is expanded for every item of its loop and handled like a plain
 * statement. A loop shape the model does not understand is an error, never a silent skip.
 *
 * `gen-db-reference.ts --verify-db` compares this model with the catalog of a migrated database.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSqlString, ROOT, splitTopLevel, stripSqlComments } from './lib.ts';

export const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
export const DATABASE_TYPES = join(ROOT, 'packages', 'api-client', 'src', 'database.types.ts');

export type Privilege = 'select' | 'insert' | 'update' | 'delete' | 'truncate' | 'references' | 'trigger';
const PRIVILEGES: readonly Privilege[] = [
  'select',
  'insert',
  'update',
  'delete',
  'truncate',
  'references',
  'trigger',
];
const COLUMN_PRIVILEGES: ReadonlySet<Privilege> = new Set(['select', 'insert', 'update', 'references']);

export interface RoleGrants {
  /** Table-level privileges (cover every column, also columns added later). */
  readonly table: Set<Privilege>;
  /** Column-level privileges. */
  readonly columns: Map<Privilege, Set<string>>;
}

export interface PolicyModel {
  readonly name: string;
  readonly command: 'all' | 'select' | 'insert' | 'update' | 'delete';
  readonly restrictive: boolean;
  readonly roles: readonly string[];
  readonly using: string | null;
  readonly check: string | null;
  readonly migration: string;
}

export interface RelationModel {
  readonly schema: 'public' | 'private';
  readonly name: string;
  readonly kind: 'table' | 'view';
  readonly migration: string;
  /** Views: `with (security_invoker = true)` (the caller's RLS applies). */
  securityInvoker: boolean;
  comment: string | null;
  readonly columns: string[];
  rlsEnabled: boolean;
  rlsForced: boolean;
  readonly policies: Map<string, PolicyModel>;
  readonly grants: Map<string, RoleGrants>;
}

export interface FunctionModel {
  readonly schema: 'public' | 'private' | 'admin_api';
  readonly name: string;
  readonly migration: string;
  /** Roles with EXECUTE (`public` = the PUBLIC pseudo-role). */
  readonly execute: Set<string>;
}

export interface CronJobModel {
  readonly name: string;
  readonly schedule: string;
  readonly command: string;
}

export interface BucketModel {
  readonly id: string;
  readonly isPublic: boolean;
  readonly fileSizeLimit: number | null;
  readonly mimeTypes: readonly string[];
}

export interface StoragePolicyModel {
  readonly name: string;
  readonly command: string;
  readonly roles: readonly string[];
  readonly using: string | null;
}

export interface SchemaModel {
  readonly migrations: readonly string[];
  readonly relations: Map<string, RelationModel>;
  readonly functions: Map<string, FunctionModel>;
  readonly cronJobs: CronJobModel[];
  readonly buckets: BucketModel[];
  readonly storagePolicies: StoragePolicyModel[];
}

// ── Statement splitting ─────────────────────────────────────────────────────────────────────

/** Splits SQL into statements at `;` outside strings and dollar-quoted bodies. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i] ?? '';
    if (ch === "'") {
      const { end } = readSqlString(sql, i);
      current += sql.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag !== null) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const end = close === -1 ? sql.length : close + tag[0].length;
        current += sql.slice(i, end);
        i = end;
        continue;
      }
    }
    if (ch === ';') {
      if (current.trim() !== '') out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
    i += 1;
  }
  if (current.trim() !== '') out.push(current.trim());
  return out;
}

/** Collapses whitespace outside string literals and dollar-quoted bodies (kept verbatim). */
function normalize(statement: string): string {
  let out = '';
  let i = 0;
  while (i < statement.length) {
    const ch = statement[i] ?? '';
    if (ch === "'") {
      const { end } = readSqlString(statement, i);
      out += statement.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(statement.slice(i));
      if (tag !== null) {
        const close = statement.indexOf(tag[0], i + tag[0].length);
        const end = close === -1 ? statement.length : close + tag[0].length;
        out += statement.slice(i, end);
        i = end;
        continue;
      }
    }
    if (/\s/.test(ch)) {
      if (!out.endsWith(' ')) out += ' ';
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out.trim();
}

/** The text inside the parentheses that open at `text[open] === '('`, and the index after `)`. */
function balanced(text: string, open: number): { inner: string; end: number } {
  if (text[open] !== '(') throw new Error(`expected "(" at ${open}: ${text.slice(open, open + 30)}`);
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (ch === "'") {
      i = readSqlString(text, i).end;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
    }
    i += 1;
  }
  throw new Error(`unbalanced parentheses: ${text.slice(open, open + 60)}`);
}

// ── Model building ──────────────────────────────────────────────────────────────────────────

function relKey(schema: string, name: string): string {
  return `${schema}.${name}`;
}

function roleGrants(rel: RelationModel, role: string): RoleGrants {
  let g = rel.grants.get(role);
  if (g === undefined) {
    g = { table: new Set(), columns: new Map() };
    rel.grants.set(role, g);
  }
  return g;
}

function rolesOf(list: string): string[] {
  return list
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter((r) => r !== '');
}

const NON_COLUMN = new Set(['constraint', 'primary', 'unique', 'check', 'exclude', 'foreign', 'like']);

function columnsOfCreate(body: string): string[] {
  return splitTopLevel(body)
    .map((def) => /^"?([a-z_][a-z0-9_]*)"?\s/i.exec(def)?.[1]?.toLowerCase() ?? '')
    .filter((name) => name !== '' && !NON_COLUMN.has(name));
}

interface Context {
  readonly model: SchemaModel;
  readonly migration: string;
}

function relation(ctx: Context, schema: string, name: string): RelationModel {
  const rel = ctx.model.relations.get(relKey(schema, name));
  if (rel === undefined) throw new Error(`${ctx.migration}: unknown relation ${schema}.${name}`);
  return rel;
}

function applyGrant(
  ctx: Context,
  verb: 'grant' | 'revoke',
  privList: string,
  targets: string,
  roles: string[],
): void {
  for (const target of targets.split(',').map((t) => t.trim())) {
    const [schema = '', name = ''] = target.split('.');
    const rel = relation(ctx, schema, name);
    for (const piece of splitTopLevel(privList)) {
      const m = /^([a-z]+)(?:\s+privileges)?(?:\s*\((.*)\))?$/i.exec(piece.trim());
      if (m === null) throw new Error(`${ctx.migration}: cannot read privilege "${piece}"`);
      const word = (m[1] ?? '').toLowerCase();
      const cols = m[2]?.split(',').map((c) => c.trim().toLowerCase()) ?? null;
      const privs: Privilege[] =
        word === 'all' ? [...PRIVILEGES] : [word as Privilege];
      for (const priv of privs) {
        if (!PRIVILEGES.includes(priv)) throw new Error(`${ctx.migration}: unknown privilege ${priv}`);
        for (const role of roles) {
          const g = roleGrants(rel, role);
          if (cols === null) {
            if (verb === 'grant') g.table.add(priv);
            else {
              g.table.delete(priv);
              // Revoking a table privilege also revokes it on every column.
              g.columns.delete(priv);
            }
          } else {
            if (!COLUMN_PRIVILEGES.has(priv)) throw new Error(`${ctx.migration}: ${priv} has no column form`);
            const set = g.columns.get(priv) ?? new Set<string>();
            for (const c of cols) {
              if (!rel.columns.includes(c)) {
                throw new Error(`${ctx.migration}: ${verb} ${priv} on unknown column ${rel.name}.${c}`);
              }
              if (verb === 'grant') set.add(c);
              else set.delete(c);
            }
            g.columns.set(priv, set);
          }
        }
      }
    }
  }
}

function parsePolicy(ctx: Context, stmt: string): void {
  const head = /^create policy "?([a-z0-9_]+)"? on ([a-z_]+)\.([a-z0-9_]+)\s*(.*)$/is.exec(stmt);
  if (head === null) throw new Error(`${ctx.migration}: cannot read policy: ${stmt.slice(0, 80)}`);
  const [, name = '', schema = '', table = '', restRaw = ''] = head;
  let rest = restRaw;
  let restrictive = false;
  const as = /^as (restrictive|permissive)\s*/i.exec(rest);
  if (as !== null) {
    restrictive = as[1]?.toLowerCase() === 'restrictive';
    rest = rest.slice(as[0].length);
  }
  let command: PolicyModel['command'] = 'all';
  const forCmd = /^for (all|select|insert|update|delete)\s*/i.exec(rest);
  if (forCmd !== null) {
    command = (forCmd[1] ?? 'all').toLowerCase() as PolicyModel['command'];
    rest = rest.slice(forCmd[0].length);
  }
  let roles = ['public'];
  const to = /^to ([a-z_, ]+?)(?=\s+using\b|\s+with check\b|$)\s*/i.exec(rest);
  if (to !== null) {
    roles = rolesOf(to[1] ?? '');
    rest = rest.slice(to[0].length);
  }
  let using: string | null = null;
  let check: string | null = null;
  const u = /^using\s*/i.exec(rest);
  if (u !== null) {
    const b = balanced(rest, u[0].length);
    using = b.inner.trim();
    rest = rest.slice(b.end).trim();
  }
  const w = /^with check\s*/i.exec(rest);
  if (w !== null) {
    const b = balanced(rest, w[0].length);
    check = b.inner.trim();
    rest = rest.slice(b.end).trim();
  }
  if (rest !== '') throw new Error(`${ctx.migration}: unread policy text "${rest}"`);
  if (schema === 'storage' && table === 'objects') {
    ctx.model.storagePolicies.push({ name, command, roles, using });
    return;
  }
  const rel = relation(ctx, schema, table);
  rel.policies.set(name, { name, command, restrictive, roles, using, check, migration: ctx.migration });
}

function functionKey(schema: string, name: string): string {
  return `${schema}.${name}`;
}

function applyExecute(ctx: Context, verb: 'grant' | 'revoke', list: string, roles: string[]): void {
  const names = [...list.matchAll(/\b(public|private|admin_api)\.([a-z0-9_]+)\s*\(/g)];
  if (names.length === 0) throw new Error(`${ctx.migration}: no function in execute ${verb}`);
  for (const m of names) {
    const fn = ctx.model.functions.get(functionKey(m[1] ?? '', m[2] ?? ''));
    if (fn === undefined) throw new Error(`${ctx.migration}: execute on unknown function ${m[1]}.${m[2]}`);
    for (const role of roles) {
      if (verb === 'grant') fn.execute.add(role);
      else fn.execute.delete(role);
    }
  }
}

function applySchemaExecute(ctx: Context, verb: 'grant' | 'revoke', schema: string, roles: string[]): void {
  for (const fn of ctx.model.functions.values()) {
    if (fn.schema !== schema) continue;
    for (const role of roles) {
      if (verb === 'grant') fn.execute.add(role);
      else fn.execute.delete(role);
    }
  }
}

/** Reads `'a' 'b'` (adjacent literals continued over a newline) starting at `at`. */
function readConcatenated(text: string, at: number): { value: string; end: number } {
  let { value, end } = readSqlString(text, at);
  for (;;) {
    const gap = /^\s+'/.exec(text.slice(end));
    if (gap === null) return { value, end };
    const next = readSqlString(text, end + gap[0].length - 1);
    value += next.value;
    end = next.end;
  }
}

interface LoopItem {
  /** Loop-variable expressions → values (`t`, `t.relname`, `r.table_name`, `v_cols`). */
  readonly vars: ReadonlyMap<string, string>;
}

function arrayLiteral(text: string): string[] {
  const inner = /^array\[(.*?)\](?:::text\[\])?$/is.exec(text.trim())?.[1] ?? '';
  return splitTopLevel(inner)
    .filter((s) => s !== '')
    .map((s) => readSqlString(s.trim(), 0).value);
}

function loopItems(ctx: Context, body: string): LoopItem[] {
  const foreach = /foreach ([a-z_]+) in array (array\[[\s\S]*?\])\s*loop/i.exec(body);
  if (foreach !== null) {
    const v = foreach[1] ?? 't';
    return arrayLiteral(foreach[2] ?? '').map((item) => ({ vars: new Map([[v, item]]) }));
  }
  const allTables =
    /for ([a-z_]+) in select c\.relname from pg_catalog\.pg_class c\s+where c\.relnamespace = 'public'::regnamespace and c\.relkind in \('r', 'p'\)\s+loop/i.exec(
      body,
    );
  if (allTables !== null) {
    const v = allTables[1] ?? 't';
    return [...ctx.model.relations.values()]
      .filter((r) => r.schema === 'public' && r.kind === 'table')
      .map((r) => ({ vars: new Map([[`${v}.relname`, r.name]]) }));
  }
  const values = /for ([a-z_]+) in select \* from \(values\s+([\s\S]*?)\) as v \(([a-z_]+), ([a-z_]+)\)\s*loop/i.exec(
    body,
  );
  if (values !== null) {
    const v = values[1] ?? 'r';
    const nameField = values[3] ?? 'table_name';
    const excludeField = values[4] ?? '';
    // The column list must be "every column except the listed ones" (checked, not assumed).
    if (!new RegExp(`not \\(a\\.attname = any\\(${v}\\.${excludeField}\\)\\)`, 'i').test(body)) {
      throw new Error(`${ctx.migration}: values loop without the "all columns except" filter`);
    }
    return splitTopLevel(values[2] ?? '').map((tuple) => {
      const parts = splitTopLevel(balanced(tuple.trim(), 0).inner);
      const table = readSqlString((parts[0] ?? '').trim(), 0).value;
      const excluded = new Set(arrayLiteral(parts[1] ?? ''));
      const rel = relation(ctx, 'public', table);
      const cols = rel.columns.filter((c) => !excluded.has(c)).join(', ');
      return { vars: new Map([[`${v}.${nameField}`, table], ['v_cols', cols]]) };
    });
  }
  throw new Error(`${ctx.migration}: unsupported loop in a do block`);
}

function evalArg(expr: string, vars: ReadonlyMap<string, string>): string {
  const e = expr.trim();
  const direct = vars.get(e);
  if (direct !== undefined) return direct;
  const concat = /^([a-z_.]+)\s*\|\|\s*'([^']*)'$/i.exec(e);
  if (concat !== null) {
    const base = vars.get(concat[1] ?? '');
    if (base !== undefined) return base + (concat[2] ?? '');
  }
  throw new Error(`cannot evaluate format() argument "${e}"`);
}

function expandFormat(template: string, args: readonly string[]): string {
  let n = 0;
  return template.replace(/%([Is])/g, () => {
    const value = args[n];
    n += 1;
    if (value === undefined) throw new Error(`format() has too few arguments for "${template}"`);
    return value;
  });
}

const ACCESS_TEMPLATE = /^\s*(create policy|drop policy|grant|revoke|alter table|comment on)\b/i;

function handleDoBlock(ctx: Context, stmt: string): void {
  const body = /^do \$([a-z_]*)\$([\s\S]*)\$\1\$$/i.exec(stmt)?.[2];
  if (body === undefined) return;
  // Only templates that shape access are interpreted (e.g. `alter database … set timezone` is not).
  const templates = [...body.matchAll(/execute format\(/gi)]
    .map((m) => {
      const at = m.index + m[0].length;
      const lit = readConcatenated(body, at);
      const close = balanced(body, m.index + m[0].length - 1);
      const argsText = body.slice(lit.end, close.end - 1).replace(/^\s*,/, '');
      return { template: lit.value, args: splitTopLevel(argsText) };
    })
    .filter((t) => ACCESS_TEMPLATE.test(t.template));
  if (templates.length === 0) {
    handleCron(ctx, body);
    return;
  }
  const items = loopItems(ctx, body);
  for (const item of items) {
    for (const t of templates) {
      const sql = expandFormat(t.template, t.args.map((a) => evalArg(a, item.vars)));
      handleStatement(ctx, normalize(sql));
    }
  }
}

function handleCron(ctx: Context, body: string): void {
  for (const m of body.matchAll(/cron\.schedule\(\s*/gi)) {
    const at = m.index + m[0].length;
    const name = readSqlString(body, at);
    const scheduleAt = body.indexOf("'", name.end);
    const schedule = readSqlString(body, scheduleAt);
    const rest = body.slice(schedule.end);
    const tag = /^\s*,\s*(\$[a-z_]*\$)/i.exec(rest);
    if (tag === null) throw new Error(`${ctx.migration}: cron command is not dollar-quoted`);
    const start = schedule.end + tag[0].length;
    const close = body.indexOf(tag[1] ?? '', start);
    ctx.model.cronJobs.push({
      name: name.value,
      schedule: schedule.value,
      command: body.slice(start, close).trim(),
    });
  }
}

function handleBuckets(ctx: Context, stmt: string): void {
  const m = /^insert into storage\.buckets \(([^)]*)\) values (.*?)(?: on conflict .*)?$/is.exec(stmt);
  if (m === null) return;
  const cols = (m[1] ?? '').split(',').map((c) => c.trim());
  for (const tuple of splitTopLevel(m[2] ?? '')) {
    const values = splitTopLevel(balanced(tuple.trim(), 0).inner);
    const get = (col: string): string => (values[cols.indexOf(col)] ?? '').trim();
    const text = (col: string): string => readSqlString(get(col), 0).value;
    const limit = get('file_size_limit');
    ctx.model.buckets.push({
      id: text('id'),
      isPublic: /^true$/i.test(get('public')),
      fileSizeLimit: /^\d+$/.test(limit) ? Number(limit) : null,
      mimeTypes: get('allowed_mime_types') === '' ? [] : arrayLiteral(get('allowed_mime_types')),
    });
  }
}

export function handleStatement(ctx: Context, stmt: string): void {
  let m: RegExpExecArray | null;
  if ((m = /^create table (?:if not exists )?(public|private)\.([a-z0-9_]+)\s*\(/i.exec(stmt)) !== null) {
    const body = balanced(stmt, m[0].length - 1).inner;
    const schema = (m[1] ?? '').toLowerCase() as 'public' | 'private';
    const name = m[2] ?? '';
    ctx.model.relations.set(relKey(schema, name), {
      schema,
      name,
      kind: 'table',
      migration: ctx.migration,
      securityInvoker: false,
      comment: null,
      columns: columnsOfCreate(body),
      rlsEnabled: false,
      rlsForced: false,
      policies: new Map(),
      grants: new Map(),
    });
    return;
  }
  if ((m = /^create (?:or replace )?view (public|private)\.([a-z0-9_]+)\b(.*)$/is.exec(stmt)) !== null) {
    const schema = (m[1] ?? '').toLowerCase() as 'public' | 'private';
    const name = m[2] ?? '';
    const key = relKey(schema, name);
    const invoker = /^\s*with \(security_invoker = (?:true|on)\)/i.test(m[3] ?? '');
    const existing = ctx.model.relations.get(key);
    if (existing !== undefined) existing.securityInvoker = invoker;
    else {
      ctx.model.relations.set(key, {
        schema,
        name,
        kind: 'view',
        migration: ctx.migration,
        securityInvoker: invoker,
        comment: null,
        columns: [],
        rlsEnabled: false,
        rlsForced: false,
        policies: new Map(),
        grants: new Map(),
      });
    }
    return;
  }
  if ((m = /^alter table (?:if exists )?(?:only )?(public|private)\.([a-z0-9_]+) (.*)$/is.exec(stmt)) !== null) {
    const rel = ctx.model.relations.get(relKey(m[1] ?? '', m[2] ?? ''));
    if (rel === undefined) return;
    for (const clause of splitTopLevel(m[3] ?? '')) {
      let c: RegExpExecArray | null;
      if ((c = /^add column (?:if not exists )?"?([a-z_][a-z0-9_]*)"?\s/i.exec(clause)) !== null) {
        const col = (c[1] ?? '').toLowerCase();
        if (!rel.columns.includes(col)) rel.columns.push(col);
      } else if ((c = /^drop column (?:if exists )?"?([a-z_][a-z0-9_]*)"?/i.exec(clause)) !== null) {
        const i = rel.columns.indexOf((c[1] ?? '').toLowerCase());
        if (i >= 0) rel.columns.splice(i, 1);
      } else if ((c = /^rename column "?([a-z0-9_]+)"? to "?([a-z0-9_]+)"?$/i.exec(clause)) !== null) {
        const i = rel.columns.indexOf((c[1] ?? '').toLowerCase());
        if (i >= 0) rel.columns[i] = (c[2] ?? '').toLowerCase();
      } else if (/^enable row level security$/i.test(clause)) {
        rel.rlsEnabled = true;
      } else if (/^force row level security$/i.test(clause)) {
        rel.rlsForced = true;
      } else if (/^(disable|no force) row level security$/i.test(clause)) {
        throw new Error(`${ctx.migration}: RLS switched off on ${rel.name}`);
      }
    }
    return;
  }
  if ((m = /^comment on (?:table|view) (public|private)\.([a-z0-9_]+) is\s*'/is.exec(stmt)) !== null) {
    const rel = relation(ctx, m[1] ?? '', m[2] ?? '');
    rel.comment = readConcatenated(stmt, m[0].length - 1).value;
    return;
  }
  if (/^create policy /i.test(stmt)) {
    parsePolicy(ctx, stmt);
    return;
  }
  if ((m = /^drop policy (?:if exists )?"?([a-z0-9_]+)"? on ([a-z_]+)\.([a-z0-9_]+)$/i.exec(stmt)) !== null) {
    if (m[2] === 'storage') {
      const i = ctx.model.storagePolicies.findIndex((p) => p.name === m?.[1]);
      if (i >= 0) ctx.model.storagePolicies.splice(i, 1);
      return;
    }
    ctx.model.relations.get(relKey(m[2] ?? '', m[3] ?? ''))?.policies.delete(m[1] ?? '');
    return;
  }
  if ((m = /^create (?:or replace )?function (public|private|admin_api)\.([a-z0-9_]+)\s*\(/i.exec(stmt)) !== null) {
    const schema = (m[1] ?? '').toLowerCase() as FunctionModel['schema'];
    const key = functionKey(schema, m[2] ?? '');
    if (!ctx.model.functions.has(key)) {
      // A new function is executable by PUBLIC until revoked (PostgreSQL default).
      ctx.model.functions.set(key, {
        schema,
        name: m[2] ?? '',
        migration: ctx.migration,
        execute: new Set(['public']),
      });
    }
    return;
  }
  if ((m = /^(grant|revoke) (?:execute|all(?: privileges)?) on all functions in schema ([a-z_]+) (to|from) (.+)$/i.exec(stmt)) !== null) {
    applySchemaExecute(ctx, (m[1] ?? '').toLowerCase() as 'grant' | 'revoke', m[2] ?? '', rolesOf(m[4] ?? ''));
    return;
  }
  if ((m = /^(grant|revoke) (?:execute|all(?: privileges)?) on function (.+) (to|from) ([a-z_, ]+)$/is.exec(stmt)) !== null) {
    applyExecute(ctx, (m[1] ?? '').toLowerCase() as 'grant' | 'revoke', m[2] ?? '', rolesOf(m[4] ?? ''));
    return;
  }
  if (
    (m =
      /^(grant|revoke) (.+?) on (?:table )?((?:public|private)\.[a-z0-9_]+(?:\s*,\s*(?:public|private)\.[a-z0-9_]+)*) (to|from) ([a-z_, ]+)$/is.exec(
        stmt,
      )) !== null
  ) {
    applyGrant(ctx, (m[1] ?? '').toLowerCase() as 'grant' | 'revoke', m[2] ?? '', m[3] ?? '', rolesOf(m[5] ?? ''));
    return;
  }
  if (/^do \$/i.test(stmt)) {
    handleDoBlock(ctx, stmt);
    return;
  }
  if (/^insert into storage\.buckets/i.test(stmt)) handleBuckets(ctx, stmt);
}

/** Builds the model from every migration in file-name order. */
export function buildSchemaModel(dir: string = MIGRATIONS_DIR): SchemaModel {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const model: SchemaModel = {
    migrations: files,
    relations: new Map(),
    functions: new Map(),
    cronJobs: [],
    buckets: [],
    storagePolicies: [],
  };
  for (const file of files) {
    const ctx: Context = { model, migration: file };
    for (const raw of splitStatements(stripSqlComments(readFileSync(join(dir, file), 'utf8')))) {
      const stmt = normalize(raw);
      // `do` bodies keep their line structure for the loop parser.
      handleStatement(ctx, /^do \$/i.test(stmt) ? raw.trim() : stmt);
    }
  }
  return model;
}

// ── Generated types ─────────────────────────────────────────────────────────────────────────

export interface TypesModel {
  /** public table → Row column names. */
  readonly tables: Map<string, string[]>;
  readonly views: Map<string, string[]>;
  readonly publicFunctions: string[];
  readonly adminFunctions: string[];
}

function blockLines(lines: readonly string[], from: number, indent: number): { start: number; end: number } {
  const close = `${' '.repeat(indent)}};`;
  for (let i = from + 1; i < lines.length; i++) if (lines[i] === close) return { start: from + 1, end: i };
  throw new Error(`database.types.ts: unterminated block at line ${from + 1}`);
}

function namesAt(lines: readonly string[], range: { start: number; end: number }, indent: number): Map<string, number> {
  const re = new RegExp(`^ {${indent}}([a-z_][a-z0-9_]*):`);
  const out = new Map<string, number>();
  for (let i = range.start; i < range.end; i++) {
    const m = re.exec(lines[i] ?? '');
    if (m !== null) out.set(m[1] ?? '', i);
  }
  return out;
}

function schemaBlock(lines: readonly string[], schema: string, section: string): { start: number; end: number } {
  const top = lines.indexOf(`  ${schema}: {`);
  if (top === -1) throw new Error(`database.types.ts: schema ${schema} not found`);
  const schemaRange = blockLines(lines, top, 2);
  const at = lines.slice(schemaRange.start, schemaRange.end).indexOf(`    ${section}: {`);
  if (at === -1) throw new Error(`database.types.ts: ${schema}.${section} not found`);
  return blockLines(lines, schemaRange.start + at, 4);
}

function rowColumns(lines: readonly string[], relLine: number): string[] {
  const rel = blockLines(lines, relLine, 6);
  const rowAt = lines.slice(rel.start, rel.end).indexOf('        Row: {');
  if (rowAt === -1) throw new Error(`database.types.ts: no Row at line ${relLine + 1}`);
  const row = blockLines(lines, rel.start + rowAt, 8);
  return [...namesAt(lines, row, 10).keys()];
}

export function readTypes(source: string = readFileSync(DATABASE_TYPES, 'utf8')): TypesModel {
  const lines = source.split('\n');
  const rels = (section: string): Map<string, string[]> => {
    const range = schemaBlock(lines, 'public', section);
    const out = new Map<string, string[]>();
    for (const [name, line] of namesAt(lines, range, 6)) out.set(name, rowColumns(lines, line));
    return out;
  };
  const fns = (schema: string): string[] => [...namesAt(lines, schemaBlock(lines, schema, 'Functions'), 6).keys()];
  return {
    tables: rels('Tables'),
    views: rels('Views'),
    publicFunctions: fns('public'),
    adminFunctions: fns('admin_api'),
  };
}

/** Views are `create view … as select …`: their columns come from the generated types. */
export function attachViewColumns(model: SchemaModel, types: TypesModel): void {
  for (const rel of model.relations.values()) {
    if (rel.schema !== 'public' || rel.kind !== 'view') continue;
    rel.columns.splice(0, rel.columns.length, ...(types.views.get(rel.name) ?? []));
  }
}

/** Differences between the migration model and the generated types (columns, tables, views). */
export function compareWithTypes(model: SchemaModel, types: TypesModel): string[] {
  const problems: string[] = [];
  const check = (kind: 'table' | 'view', expected: Map<string, string[]>) => {
    const actual = [...model.relations.values()].filter((r) => r.schema === 'public' && r.kind === kind);
    for (const rel of actual) {
      const cols = expected.get(rel.name);
      if (cols === undefined) {
        problems.push(`${kind} public.${rel.name}: in the migrations but not in database.types.ts`);
        continue;
      }
      if (kind === 'view') continue;
      const a = [...rel.columns].sort().join(',');
      const b = [...cols].sort().join(',');
      if (a !== b) problems.push(`table public.${rel.name}: columns differ (migrations ${a} ≠ types ${b})`);
    }
    for (const name of expected.keys()) {
      if (!actual.some((r) => r.name === name)) {
        problems.push(`${kind} public.${name}: in database.types.ts but not in the migrations`);
      }
    }
  };
  check('table', types.tables);
  check('view', types.views);
  const fnNames = (schema: FunctionModel['schema']) =>
    [...model.functions.values()].filter((f) => f.schema === schema).map((f) => f.name).sort();
  const cmp = (schema: FunctionModel['schema'], typed: readonly string[]) => {
    const fromSql = new Set(fnNames(schema));
    for (const name of typed) if (!fromSql.has(name)) problems.push(`function ${schema}.${name}: typed but not created`);
  };
  cmp('public', types.publicFunctions);
  cmp('admin_api', types.adminFunctions);
  return problems;
}

// ── Effective access ────────────────────────────────────────────────────────────────────────

/** Columns a role holds `priv` on (table-level grants cover every column). */
export function effectiveColumns(rel: RelationModel, role: string, priv: Privilege): string[] {
  const g = rel.grants.get(role);
  if (g === undefined) return [];
  if (g.table.has(priv)) return [...rel.columns];
  const set = g.columns.get(priv);
  return set === undefined ? [] : rel.columns.filter((c) => set.has(c));
}

export function hasTablePrivilege(rel: RelationModel, role: string, priv: Privilege): boolean {
  return rel.grants.get(role)?.table.has(priv) === true;
}
