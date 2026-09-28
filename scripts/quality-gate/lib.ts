/**
 * Shared plumbing for the quality gate (DELIVERY_CHECKLIST §5): the file index, the finding shape
 * written to `quality-gate.json`, and small grep / config helpers used by `checks/*.ts`.
 * Only erasable TypeScript is used (Node type stripping).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** One `quality-gate.json` entry (§5.1). */
export interface Finding {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly match: string;
}

export interface Check {
  /** The checklist IDs this module reports (every ID needs a fixture under `fixtures/<ID>/`). */
  readonly ids: readonly string[];
  readonly title: string;
  run(ctx: Context): Finding[] | Promise<Finding[]>;
}

/** Directory names never descended into. */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  '.expo',
  '.expo-export',
  'dist',
  'build',
  'coverage',
  'generated',
  'playwright-report',
  'test-results',
  'blob-report',
  '.temp',
  '.branches',
  '.claude',
  '.gradle',
  'Pods',
]);

/**
 * Repository paths never scanned (§5.1 global exclusions). Only the prebuild outputs of the mobile
 * app are skipped; native module sources (`apps/mobile/modules/<m>/{ios,android}`) and widget
 * targets are product code and stay in scope.
 */
const SKIP_PATHS = [
  'docs/',
  'design/',
  'scripts/quality-gate/',
  'apps/mobile/ios/',
  'apps/mobile/android/',
  'apps/mobile/targets/widget/Assets.xcassets/',
];

const TEXT_EXT =
  /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|sql|md|yml|yaml|toml|swift|kt|kts|xml|html|css|txt|sh|plist|gradle|properties|env|example|allow)$/i;

export const CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

export class Context {
  readonly root: string;
  private index: string[] | null = null;
  private readonly cache = new Map<string, string>();

  constructor(root: string) {
    this.root = root;
  }

  /** Every scannable text file (repo-relative, `/`-separated). */
  files(): readonly string[] {
    if (this.index === null) {
      const out: string[] = [];
      const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
          if (SKIP_DIRS.has(name)) continue;
          const full = join(dir, name);
          const rel = relative(this.root, full).split('\\').join('/');
          if (SKIP_PATHS.some((p) => `${rel}/`.startsWith(p))) continue;
          const st = statSync(full);
          if (st.isDirectory()) walk(full);
          else if (TEXT_EXT.test(name) || name.startsWith('.env') || name === '.gitignore')
            out.push(rel);
        }
      };
      walk(this.root);
      this.index = out.sort();
    }
    return this.index;
  }

  /** Files under one of `prefixes` whose path matches `re`. */
  select(prefixes: readonly string[], re = /./): string[] {
    return this.files().filter((f) => prefixes.some((p) => f.startsWith(p)) && re.test(f));
  }

  exists(rel: string): boolean {
    return existsSync(join(this.root, rel));
  }

  read(rel: string): string {
    let text = this.cache.get(rel);
    if (text === undefined) {
      text = existsSync(join(this.root, rel)) ? readFileSync(join(this.root, rel), 'utf8') : '';
      this.cache.set(rel, text);
    }
    return text;
  }

  /** Files tracked by git (the working tree walk when the root is not a git checkout). */
  tracked(): string[] {
    if (existsSync(join(this.root, '.git'))) {
      const out = execFileSync('git', ['ls-files', '-z'], { cwd: this.root, encoding: 'utf8' });
      return out.split('\0').filter((f) => f !== '');
    }
    const all: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === '.git' || name === 'node_modules') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else all.push(relative(this.root, full).split('\\').join('/'));
      }
    };
    walk(this.root);
    return all;
  }
}

/** Test code: unit/integration tests, e2e specs, test helpers and fixtures. */
export function isTestPath(rel: string): boolean {
  return /(^|\/)(__tests__|__fixtures__|__mocks__|test|tests|e2e|fixtures|testing)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(jest|vitest)\.setup\.[jt]s$|(^|\/)vitest\.config\.[jt]s$|(^|\/)playwright\.config\.[jt]s$/.test(
    rel,
  );
}

/** 1-based line of a character offset. */
export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

export function clip(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** Line-by-line grep: one finding per matching line. */
export function grepLines(
  ctx: Context,
  files: readonly string[],
  id: string,
  test: (line: string, file: string) => boolean,
): Finding[] {
  const out: Finding[] = [];
  for (const file of files) {
    ctx
      .read(file)
      .split('\n')
      .forEach((line, i) => {
        if (test(line, file)) out.push({ id, file, line: i + 1, match: clip(line) });
      });
  }
  return out;
}

/** Whole-file regex (for patterns that span lines): one finding per match. `re` must be global. */
export function grepSource(
  ctx: Context,
  files: readonly string[],
  id: string,
  re: RegExp,
): Finding[] {
  const out: Finding[] = [];
  for (const file of files) {
    const text = ctx.read(file);
    for (const m of text.matchAll(re)) {
      out.push({ id, file, line: lineAt(text, m.index), match: clip(m[0]) });
    }
  }
  return out;
}

/** A finding about a missing enforcement / configuration (line 1 when there is no better line). */
export function missing(id: string, file: string, match: string, line = 1): Finding {
  return { id, file, line, match };
}

/**
 * The severity an ESLint flat-config source sets for `rule` outside test-only override blocks:
 * returns the offending text when the rule is absent, not `error`, or disabled for product code.
 */
export function eslintRuleProblem(source: string, rule: string, required: boolean): string | null {
  const esc = rule.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp(
    `['"]${esc}['"]\\s*:\\s*(\\[\\s*)?['"](error|warn|off)['"]|['"]${esc}['"]\\s*:\\s*(\\[\\s*)?([012])\\b`,
    'g',
  );
  let sawError = false;
  for (const m of source.matchAll(re)) {
    const level = m[2] ?? (m[4] === '2' ? 'error' : m[4] === '1' ? 'warn' : 'off');
    if (level === 'error') {
      sawError = true;
      continue;
    }
    if (!testOnlyBlock(source, m.index)) return clip(m[0]);
  }
  if (required && !sawError) return `${rule} is not configured at error level`;
  return null;
}

/** Offsets of `{` / `}` outside string literals, as [offset, +1 | -1]. */
function braces(source: string): [number, number][] {
  const out: [number, number][] = [];
  let quote: string | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (quote !== null) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '{') out.push([i, 1]);
    else if (c === '}') out.push([i, -1]);
  }
  return out;
}

/**
 * Offset after the whitespace, `// …\n` and `/* … *\/` comments starting at `i` (-1 when a comment
 * is unterminated). A scan, not `(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*`: the lazy block-comment
 * body could also end at any later `*\/`, so "/*" + many "*\/\/*" backtracked exponentially
 * (CodeQL js/redos).
 */
export function skipTrivia(text: string, i: number): number {
  let at = i;
  for (;;) {
    while (at < text.length && /\s/.test(text.charAt(at))) at += 1;
    if (text.startsWith('//', at)) {
      const newline = text.indexOf('\n', at + 2);
      if (newline === -1) return -1;
      at = newline + 1;
    } else if (text.startsWith('/*', at)) {
      const close = text.indexOf('*/', at + 2);
      if (close === -1) return -1;
      at = close + 2;
    } else {
      return at;
    }
  }
}

/** Whether the config object holding the rule at `index` is scoped to test / e2e / script files. */
function testOnlyBlock(source: string, index: number): boolean {
  // Innermost enclosing objects of `index`, innermost first.
  const stack: number[] = [];
  for (const [at, dir] of braces(source)) {
    if (at > index) break;
    if (dir === 1) stack.push(at);
    else stack.pop();
  }
  // The rule sits in `rules: { … }`; its parent object is the config block.
  const block = stack.at(-2);
  if (block === undefined) return false;
  const head = source.slice(block, index);
  const start = skipTrivia(head, 1);
  if (start === -1) return false;
  const list = /^files:\s*\[([^\]]*)\]/.exec(head.slice(start));
  if (list === null) return false;
  const globs = [...(list[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((g) => g[1] ?? '');
  return (
    globs.length > 0 &&
    globs.every((g) =>
      /test|__tests__|e2e|scripts|\.spec\.|jest\.setup|vitest\.setup|fixtures/.test(g),
    )
  );
}

/** String values of `export const NAME = [ 'a', 'b' ] as const` in a TS source. */
export function constStringArray(source: string, name: string): string[] {
  const m = new RegExp(`export const ${name}\\b[^=]*=\\s*\\[([^\\]]*)\\]`).exec(source);
  if (m === null) return [];
  return [...(m[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1] ?? '');
}
