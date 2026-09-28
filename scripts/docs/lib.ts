/**
 * Shared helpers of the documentation generators (IMPLEMENTATION_PLAN T-12.08, T-12.09).
 *
 * A generated section sits between `<!-- generated:<name>:start -->` and
 * `<!-- generated:<name>:end -->` in a hand-written Markdown file; everything outside the markers
 * is left untouched. `--check` renders the section again and fails when the committed file differs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Model identifiers never appear in generated sections (AI_PIPELINE_PLAN §3.7). */
export const MODEL_ID = /\b(?:claude|gpt|voyage)-[a-z0-9]/i;

export function markers(name: string): { start: string; end: string } {
  return { start: `<!-- generated:${name}:start -->`, end: `<!-- generated:${name}:end -->` };
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/**
 * Replaces the body between the two markers of `name` (each must occur exactly once). Model
 * identifiers are refused unless the section is a model table (`allowModelIds`).
 */
export function spliceGenerated(
  doc: string,
  name: string,
  body: string,
  allowModelIds = false,
): string {
  const { start, end } = markers(name);
  if (countOf(doc, start) !== 1 || countOf(doc, end) !== 1) {
    throw new Error(`expected exactly one ${start} and one ${end}`);
  }
  const i = doc.indexOf(start);
  const j = doc.indexOf(end);
  if (j < i) throw new Error(`${end} comes before ${start}`);
  if (!allowModelIds && MODEL_ID.test(body)) {
    throw new Error(`generated section ${name} contains a model identifier`);
  }
  return `${doc.slice(0, i + start.length)}\n\n${body.trim()}\n\n${doc.slice(j)}`;
}

/** Escapes a value for a Markdown table cell. */
export function cell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

export function code(value: string): string {
  return `\`${value}\``;
}

/** Relative link from a file under `docs/` to a repository path. */
export function repoLink(fromDocFile: string, repoPath: string, label = repoPath): string {
  const target = relative(dirname(fromDocFile), join(ROOT, repoPath)).split('\\').join('/');
  return `[${label}](${target})`;
}

export interface GeneratedSection {
  readonly name: string;
  readonly body: string;
  /** Only the AI model tables may name models (AI_PIPELINE.md). */
  readonly allowModelIds?: boolean;
}

export interface GeneratorRun {
  /** Absolute path of the Markdown file that holds the markers. */
  readonly file: string;
  readonly sections: readonly GeneratedSection[];
  /** The script to name in the drift message. */
  readonly script: string;
}

/** Writes the sections, or with `check` returns false when the committed file differs. */
export function applyGenerated(run: GeneratorRun, check: boolean): boolean {
  const current = readFileSync(run.file, 'utf8');
  const next = run.sections.reduce(
    (doc, s) => spliceGenerated(doc, s.name, s.body, s.allowModelIds === true),
    current,
  );
  if (check) return current === next;
  if (current !== next) writeFileSync(run.file, next);
  return true;
}

export function mainOf(run: () => GeneratorRun, argv: readonly string[]): number {
  const check = argv.includes('--check');
  const spec = run();
  const rel = relative(ROOT, spec.file);
  if (!applyGenerated(spec, check)) {
    console.error(`${spec.script}: ${rel} is out of date — run \`node ${spec.script}\``);
    return 1;
  }
  console.info(`${spec.script}: ${rel} ${check ? 'is up to date' : 'written'}`);
  return 0;
}

// ── SQL helpers ─────────────────────────────────────────────────────────────────────────────

/** Reads a SQL string literal starting at `text[at] === "'"`; returns the value and the end index. */
export function readSqlString(text: string, at: number): { value: string; end: number } {
  if (text[at] !== "'") throw new Error(`no string literal at ${at}`);
  let value = '';
  let i = at + 1;
  for (;;) {
    const ch = text[i];
    if (ch === undefined) throw new Error('unterminated string literal');
    if (ch === "'") {
      if (text[i + 1] === "'") {
        value += "'";
        i += 2;
        continue;
      }
      return { value, end: i + 1 };
    }
    value += ch;
    i += 1;
  }
}

/** Removes `--` line comments outside string literals and dollar-quoted bodies. */
export function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i] ?? '';
    if (ch === "'") {
      const { end } = readSqlString(sql, i);
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag !== null) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const end = close === -1 ? sql.length : close + tag[0].length;
        out += sql.slice(i, end);
        i = end;
        continue;
      }
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Splits a comma-separated list at depth 0 (parentheses and brackets nest; strings are opaque). */
export function splitTopLevel(text: string, separator = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (ch === "'") {
      const { end } = readSqlString(text, i);
      current += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === separator && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
    i += 1;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

export type SqlValue = string | number | boolean | null;

/** A literal of a seed `values` list: text, number, boolean or null. */
export function sqlValue(token: string): SqlValue {
  const t = token.trim();
  if (t.startsWith("'")) return readSqlString(t, 0).value;
  if (/^null$/i.test(t)) return null;
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  throw new Error(`unsupported SQL value: ${t.slice(0, 40)}`);
}

/** The rows of `insert into <table> (…) values (…), (…) [on conflict …]` as column → value maps. */
export function parseInsertRows(sql: string, table: string): Map<string, SqlValue>[] {
  const text = stripSqlComments(sql);
  const head = new RegExp(`insert into ${table.replace('.', '\\.')}\\s*\\(([^)]*)\\)\\s*values`, 'i').exec(
    text,
  );
  if (head === null) throw new Error(`insert into ${table} not found`);
  const columns = head[1]?.split(',').map((c) => c.trim()) ?? [];
  const tail = text.slice(head.index + head[0].length);
  const stop = tail.search(/\bon conflict\b/i);
  return splitTopLevel(stop === -1 ? tail : tail.slice(0, stop)).map((tuple) => {
    const inner = tuple.replace(/^\(/, '').replace(/\)\s*;?$/, '');
    const values = splitTopLevel(inner).map(sqlValue);
    if (values.length !== columns.length) {
      throw new Error(`${table}: ${values.length} values for ${columns.length} columns`);
    }
    return new Map(columns.map((c, i) => [c, values[i] ?? null]));
  });
}
