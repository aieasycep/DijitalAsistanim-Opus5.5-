/**
 * I18N-01 i18n key integrity: every catalog key the code refers to exists in both the `tr` and the
 * `en` catalogs (`packages/i18n/messages/<locale>/<ns>.json`). The apps address catalogs through
 * typed `useTranslations` keys (compile-time checked); this check covers what the type checker
 * cannot see:
 * - `packages/domain/src`: every key-shaped literal (`'<ns>.a.b'`, `` `<ns>.a.${x}` ``) — domain code
 *   emits `messageRef(...)` / key strings that other layers render;
 * - `supabase/functions`: the key argument of `translate` / `message` / `copy` / `lookupMessage` /
 *   `hasMessage` / `messageRef`, and of file-local wrappers that prefix a key
 *   (`t(ctx, 'summary.x')` → `approvals.summary.x`).
 * Template keys are expanded over their declared finite value set (`DECLARED`, from `@da/domain`);
 * an undeclared template must resolve to at least one catalog key.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Check, type Context, type Finding, isTestPath, lineAt } from '../lib.ts';

const MESSAGES = 'packages/i18n/messages';
const LOCALES = ['tr', 'en'] as const;
const CALL = /\b(messageRef|translate|message|copy|lookupMessage|hasMessage|resolve)\(/g;
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

type Catalog = ReadonlyMap<string, 'string' | 'object'>;

function flatten(node: unknown, prefix: string, out: Map<string, 'string' | 'object'>): void {
  if (typeof node === 'string') {
    out.set(prefix, 'string');
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  if (prefix !== '') out.set(prefix, 'object');
  for (const [k, v] of Object.entries(node)) flatten(v, prefix === '' ? k : `${prefix}.${k}`, out);
}

function loadCatalogs(ctx: Context): Record<string, Catalog> | null {
  if (!ctx.exists(`${MESSAGES}/tr`)) return null;
  const out: Record<string, Catalog> = {};
  for (const locale of LOCALES) {
    const map = new Map<string, 'string' | 'object'>();
    const dir = `${MESSAGES}/${locale}`;
    for (const file of ctx.exists(dir) ? readdirSync(join(ctx.root, dir)) : []) {
      if (!file.endsWith('.json')) continue;
      flatten(JSON.parse(ctx.read(`${MESSAGES}/${locale}/${file}`)), file.slice(0, -5), map);
    }
    out[locale] = map;
  }
  return out;
}

/** Top-level argument texts of the call whose `(` is at `open`. */
function callArgs(text: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(text, i);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) {
        args.push(text.slice(start, i));
        return args;
      }
    } else if (c === ',' && depth === 1) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return args;
}

/** Index of the closing quote of the string literal opening at `i` (template `${}` aware). */
function skipString(text: string, i: number): number {
  const q = text[i];
  for (let j = i + 1; j < text.length; j += 1) {
    const c = text[j];
    if (c === '\\') j += 1;
    else if (c === q) return j;
    else if (q === '`' && c === '$' && text[j + 1] === '{') {
      let depth = 1;
      j += 2;
      for (; j < text.length && depth > 0; j += 1) {
        if (text[j] === '{') depth += 1;
        else if (text[j] === '}') depth -= 1;
      }
      j -= 1;
    }
  }
  return text.length;
}

/** String / template literals in an expression, `${…}` replaced by `*`. */
function literals(expr: string): string[] {
  return [...expr.matchAll(LITERAL)].map((m) =>
    (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, '*'),
  );
}

const KEY_SHAPE = /^[a-z][a-z_]*(\.[A-Za-z0-9_*]+)+$/;

interface Ref {
  readonly key: string;
  readonly file: string;
  readonly line: number;
}

interface Wrapper {
  readonly name: string;
  readonly prefix: string;
  readonly at: number;
}

/** Enclosing function of `index` with a parameter named `param` → its name. */
function enclosingFunction(text: string, index: number, param: string): string | null {
  const head = text.slice(0, index);
  const defs = [
    ...head.matchAll(/function\s+(\w+)\s*\(([^)]*)\)/g),
    ...head.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::[^=]*)?=>/g),
  ].sort((a, b) => a.index - b.index);
  const last = defs.at(-1);
  if (last === undefined || !new RegExp(`\\b${param}\\b`).test(last[2] ?? '')) return null;
  return last[1] ?? null;
}

/** Comments blanked out (offsets and line numbers kept); string literals are left intact. */
function stripComments(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const end = skipString(src, i);
      out += src.slice(i, end + 1);
      i = end;
    } else if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += ' '.repeat(stop - i);
      i = stop - 1;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else out += c ?? '';
  }
  return out;
}

/** Whether the literal at `index` is used as a key (`key:`, `nameKey:`, `keys = [`, `keys.push(`, `return` in a `…Key(s)` function). */
function keyContext(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 240), index);
  const cut = Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}'));
  const stmt = before.slice(cut + 1);
  if (/\b\w*[kK]eys?\s*(:|=|\.push\()/.test(stmt)) return true;
  if (!/^\s*return\s*$/.test(stmt)) return false;
  const fn = [...text.slice(0, index).matchAll(/function\s+(\w+)/g)].at(-1)?.[1] ?? '';
  return /Keys?$/.test(fn);
}

/** `${name}` at the start of a template → the value of a same-file `const name = <literal>`. */
function inlineConsts(text: string, key: string): string {
  return key.replace(/^\$\{(\w+)\}/, (whole, name: string) => {
    const m = new RegExp(`const\\s+${name}\\s*=\\s*(['"\`])([^'"\`]*)\\1`).exec(text);
    return m === null ? whole : (m[2] ?? '');
  });
}

function refsIn(
  ctx: Context,
  file: string,
  namespaces: ReadonlySet<string>,
  domain: boolean,
): Ref[] {
  const text = stripComments(ctx.read(file));
  const out: Ref[] = [];
  const isKey = (k: string): boolean =>
    KEY_SHAPE.test(k) && namespaces.has(k.split('.')[0] ?? '') && !k.endsWith('.');
  const wrappers: Wrapper[] = [];
  for (const m of text.matchAll(CALL)) {
    const open = m.index + m[0].length - 1;
    const args = callArgs(text, open).slice(0, 2);
    for (const arg of args) {
      const raw = /^\s*`([a-z][a-z_.]*\.)\$\{(\w+)\}`\s*$/.exec(arg);
      const name = raw === null ? null : enclosingFunction(text, m.index, raw[2] ?? '');
      if (raw !== null && name !== null) {
        wrappers.push({ name, prefix: raw[1] ?? '', at: m.index });
        continue;
      }
      for (const key of literals(arg))
        if (isKey(key)) out.push({ key, file, line: lineAt(text, m.index) });
    }
  }
  for (const w of wrappers) {
    let opaque = false;
    for (const m of text.matchAll(new RegExp(`\\b${w.name}\\(`, 'g'))) {
      if (/(function\s+|const\s+|let\s+)$/.test(text.slice(Math.max(0, m.index - 10), m.index)))
        continue;
      const args = callArgs(text, m.index + m[0].length - 1).slice(0, 2);
      const keys = args
        .flatMap(literals)
        .filter((k) => /^[A-Za-z0-9_*]+(\.[A-Za-z0-9_*]+)*$/.test(k));
      if (keys.length === 0) opaque = true;
      for (const key of keys) out.push({ key: w.prefix + key, file, line: lineAt(text, m.index) });
    }
    if (opaque) out.push({ key: `${w.prefix}*`, file, line: lineAt(text, w.at) });
  }
  if (domain) {
    // Key strings built outside a call (`nameKey: \`notifications.channel.${id}\``, key helpers).
    for (const m of text.matchAll(LITERAL)) {
      const key = inlineConsts(text, m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, '*');
      if (isKey(key) && keyContext(text, m.index) && !out.some((r) => r.key === key))
        out.push({ key, file, line: lineAt(text, m.index) });
    }
  }
  return out;
}

/** Finite value sets of template keys (`*` = one interpolation). */
async function declaredSets(ctx: Context): Promise<Map<string, readonly string[]>> {
  const sets = new Map<string, readonly string[]>();
  if (!ctx.exists('packages/domain/src/index.ts')) return sets;
  const d = (await import(
    pathToFileURL(join(ctx.root, 'packages/domain/src/index.ts')).href
  )) as Record<string, readonly string[] | undefined>;
  const put = (pattern: string, values: readonly string[] | undefined): void => {
    if (values !== undefined) sets.set(pattern, values);
  };
  put('explain.tiers.*', d.DECISION_TIER_VALUES);
  put(
    'flow.generated.why.signal.*',
    d.DETERMINISTIC_REASON_CODES && [...d.DETERMINISTIC_REASON_CODES, 'other'],
  );
  put(
    'explain.confidenceBand.*',
    d.CONFIDENCE_LABEL_VALUES?.filter((v) => v !== 'high'),
  );
  put('explain.confidenceWording.*', d.CONFIDENCE_WORDING_VALUES);
  put('reminder.presets.*', d.REMINDER_PRESETS);
  put('approvals.types.*', d.APPROVAL_ACTION_TYPE_VALUES);
  put('approvals.results.*', d.APPROVAL_ACTION_TYPE_VALUES);
  put('common.source.*', d.SOURCE_NAME_KEYS);
  const channels = d.ANDROID_CHANNELS as unknown as readonly { id: string }[] | undefined;
  put(
    'push.channels.*.name',
    channels?.map((c) => c.id),
  );
  return sets;
}

function expand(pattern: string, catalog: Catalog): string[] {
  const parts = pattern.split('.');
  let current = [''];
  for (const part of parts) {
    const next: string[] = [];
    for (const base of current) {
      if (!part.includes('*')) {
        next.push(base === '' ? part : `${base}.${part}`);
        continue;
      }
      const re = new RegExp(`^${part.replace(/\*/g, '[A-Za-z0-9_]+')}$`);
      const prefix = base === '' ? '' : `${base}.`;
      for (const key of catalog.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest.includes('.') && re.test(rest)) next.push(key);
      }
    }
    current = next;
  }
  return current.filter((k) => catalog.get(k) === 'string');
}

export const i18nKeys: Check = {
  ids: ['I18N-01'],
  title: 'i18n keys referenced from domain and Edge Function code exist in tr and en',
  async run(ctx: Context): Promise<Finding[]> {
    const catalogs = loadCatalogs(ctx);
    if (catalogs === null) return [];
    const tr: Catalog = catalogs.tr ?? new Map<string, 'string' | 'object'>();
    const en: Catalog = catalogs.en ?? new Map<string, 'string' | 'object'>();
    const namespaces = new Set([...tr.keys()].map((k) => k.split('.')[0] ?? ''));
    const sets = await declaredSets(ctx);
    const files = [
      ...ctx.select(['packages/domain/src/'], /\.ts$/).map((f) => ({ f, domain: true })),
      ...ctx
        .select(['supabase/functions/'], /\.ts$/)
        .filter((f) => !f.includes('/_shared/testing/'))
        .map((f) => ({ f, domain: false })),
    ].filter(({ f }) => !isTestPath(f));
    const out: Finding[] = [];
    const seen = new Set<string>();
    for (const { f, domain } of files) {
      for (const ref of refsIn(ctx, f, namespaces, domain)) {
        const id = `${ref.file}:${ref.line}:${ref.key}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const pattern = ref.key;
        let missingKeys: string[];
        if (!pattern.includes('*')) {
          missingKeys =
            tr.get(pattern) === 'string' && en.get(pattern) === 'string' ? [] : [pattern];
        } else if (sets.has(pattern)) {
          // Every `*` of the pattern stands for the declared value (`replaceAll`, not the first only).
          missingKeys = (sets.get(pattern) ?? [])
            .map((v) => pattern.replaceAll('*', v))
            .filter((k) => tr.get(k) !== 'string' || en.get(k) !== 'string');
        } else {
          const both = expand(pattern, tr).filter((k) => en.get(k) === 'string');
          missingKeys = both.length > 0 ? [] : [pattern];
        }
        for (const key of missingKeys)
          out.push({
            id: 'I18N-01',
            file: ref.file,
            line: ref.line,
            match: `${key} is missing from ${[tr.get(key) === 'string' ? '' : 'tr', en.get(key) === 'string' ? '' : 'en'].filter(Boolean).join(' and ') || 'the catalogs'}`,
          });
      }
    }
    return out;
  },
};
