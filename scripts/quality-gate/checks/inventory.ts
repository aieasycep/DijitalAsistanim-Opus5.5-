/**
 * QG-16b No-Dead-Action inventory ↔ route files (DELIVERY_CHECKLIST §4.1: "QG-16 fails when a route
 * file under apps/mobile/app/** has no row here, or when a row's target does not resolve"; M§99,
 * SREQ-99, T-12.07). The mobile inventory is §4.2–§4.5 of docs/DELIVERY_CHECKLIST.md.
 *
 * - Every route file (the QG-16 route set: no `_layout`, no `+` files) has at least one row: its
 *   route path appears in a Target cell, or one of its screen IDs is in a Screen cell. Screen IDs
 *   of a route come from docs/SCREEN_AND_FLOW_MAP.md (index tables with a Route column, `**Route:**`
 *   / `**Route** —` lines and `| Route |` rows of a `### M-…` block) and, for routes the map does
 *   not name, from `scripts/quality-gate/route-screens.map`
 *   (`<route file> | <screen IDs> | <justification>`).
 * - Every route-like Target token resolves: an Expo route path (`mail/[id]/reply`,
 *   `(auth)/sign-in?mode=…`) to a route file; a `/path` to a route file, an `api` route of
 *   `packages/validation/src/api/routes.ts` (the full path or a documented suffix such as `/sync`)
 *   or an M-GL-07 link prefix (`/app/*`, `/r/*`, `/oauth/done`).
 * - Every map entry names an existing route file, screen IDs that have rows, and a justification.
 */
import {
  type Check,
  type Context,
  type Finding,
  clip,
  isTestPath,
  lineAt,
  missing,
} from '../lib.ts';
import { routeOf } from './product.ts';

const APP_DIR = 'apps/mobile/app/';
const CHECKLIST = 'docs/DELIVERY_CHECKLIST.md';
const SCREEN_MAP = 'docs/SCREEN_AND_FLOW_MAP.md';
const API_ROUTES = 'packages/validation/src/api/routes.ts';
export const ROUTE_SCREENS_MAP = 'scripts/quality-gate/route-screens.map';
const START = '### 4.2 ';
const END = '### 4.6 ';
/** Universal/app-link prefixes the M-GL-07 router accepts (SCREEN_AND_FLOW_MAP M-GL-07). */
const LINK_PREFIXES = ['/app/', '/r/', '/oauth/done'];
const ID = /M-[A-Z]+-[0-9]+[A-Z]*/g;

/** Table cells of a Markdown row (escaped `\|` stays inside its cell). */
function cells(line: string): string[] {
  return line.split(/(?<!\\)\|/).map((c) => c.trim());
}

/** Screen IDs of a cell, with `M-ON-01…04` and `M-SET-10…M-SET-14` ranges expanded. */
export function screenIds(cell: string): string[] {
  const out = new Set<string>();
  for (const m of cell.matchAll(/(M-[A-Z]+-)(\d+)…(?:M-[A-Z]+-)?(\d+)/g)) {
    const [prefix, from, to] = [m[1] ?? '', Number(m[2]), Number(m[3])];
    const width = (m[2] ?? '').length;
    for (let n = from; n <= to && n - from < 50; n++)
      out.add(`${prefix}${String(n).padStart(width, '0')}`);
  }
  for (const m of cell.matchAll(ID)) out.add(m[0]);
  return [...out];
}

/**
 * A route-ish token → URL segments (`mail/[id]/reply` → `mail, :p, reply`); null when it is not a
 * path. Expo groups, `index`, the `app/` prefix, extensions, queries, fragments and `…` tails are
 * dropped; `{x}` and `[x]` become parameters.
 */
export function routeSegments(token: string): string[] | null {
  const bare = token
    .replace(/[?#…].*$/, '')
    .replace(/\{[^}]*\}/g, ':p')
    .replace(/\[[^\]]*\]/g, ':p')
    .replace(/^app\//, '')
    .replace(/\.[jt]sx?$/, '');
  if (!/^\/?[a-z0-9:()+_-]+(\/[a-z0-9:()+_-]*)*$/.test(bare)) return null;
  const segments = bare
    .split('/')
    .filter((s) => s !== '' && !/^\([a-z-]+\)$/.test(s) && s !== 'index');
  if (segments.some((s) => s.includes('(') || s.startsWith('_') || s.startsWith('+'))) return null;
  return segments;
}

/** The Expo group a token names (`(auth)/sign-in` → `auth`), or null. */
export function routeGroup(token: string): string | null {
  return /^(?:\/|app\/)?\(([a-z-]+)\)\//.exec(token)?.[1] ?? null;
}

export interface RouteRef {
  readonly segments: readonly string[];
  /** The group a reference names; a group-less reference matches a file in any group. */
  readonly group: string | null;
}

interface RouteFile {
  readonly f: string;
  readonly segments: readonly string[];
  readonly groups: readonly string[];
}

/**
 * A route file matches a reference: the same number of segments, literals equal, a route parameter
 * matches anything (a reference parameter only a route parameter), and a named group is the file's
 * group (`(onboarding)/vip` is not `vip`).
 */
function matches(route: RouteFile, ref: RouteRef): boolean {
  return (
    (ref.group === null || route.groups.includes(ref.group)) &&
    route.segments.length === ref.segments.length &&
    route.segments.every(
      (s, i) =>
        s.startsWith(':') || (!(ref.segments[i] ?? '').startsWith(':') && s === ref.segments[i]),
    )
  );
}

/** A documented API path (or suffix such as `/sync`) of an `api` route. */
function apiMatch(apiPaths: readonly string[][], token: readonly string[]): boolean {
  return apiPaths.some((path) => {
    if (token.length === 0 || token.length > path.length) return false;
    const tail = path.slice(path.length - token.length);
    return tail.every(
      (s, i) => s === token[i] || (s.startsWith(':') && (token[i] ?? '').startsWith(':')),
    );
  });
}

export interface InventoryRow {
  readonly line: number;
  readonly ids: readonly string[];
  readonly target: string;
}

/** The rows of §4.2–§4.5 (Screen column IDs, Target cell, 1-based line), or null without them. */
export function inventoryRows(text: string): InventoryRow[] | null {
  const start = text.indexOf(START);
  const end = start === -1 ? -1 : text.indexOf(END, start + 1);
  if (start === -1 || end === -1) return null;
  const firstLine = lineAt(text, start);
  return text
    .slice(start, end)
    .split('\n')
    .map((line, i) => ({ line, n: firstLine + i }))
    .filter(({ line }) => line.startsWith('| M-'))
    .map(({ line, n }) => {
      const c = cells(line);
      return { line: n, ids: screenIds(c[1] ?? ''), target: c[4] ?? '' };
    });
}

export interface TargetToken {
  readonly token: string;
  readonly slash: boolean;
  /** Null for an M-GL-07 link prefix (`/app/*`, `/r/{code}`): resolved, never a route mention. */
  readonly ref: RouteRef | null;
}

function isLinkPrefix(token: string): boolean {
  return LINK_PREFIXES.some((p) => token === p.replace(/\/$/, '') || token.startsWith(p));
}

/** Route-like backtick tokens of a Target cell (not preceded by an HTTP method, no URL scheme). */
export function targetTokens(target: string): TargetToken[] {
  const out: TargetToken[] = [];
  for (const m of target.matchAll(/(\b(?:GET|POST|PATCH|PUT|DELETE)\s+)?`([^`]+)`/g)) {
    if (m[1] !== undefined) continue;
    const token = m[2] ?? '';
    if (token.includes('://') || /\s/.test(token)) continue;
    if (!token.startsWith('/') && !token.includes('/')) continue;
    // A call such as `openBrowserAsync(terms/privacy)` is a local action, not a path.
    if (/\([^)]*\)(?!\/)/.test(token.replace(/^\([a-z-]+\)\//, ''))) continue;
    const slash = token.startsWith('/');
    if (slash && isLinkPrefix(token)) {
      out.push({ token, slash, ref: null });
      continue;
    }
    const segments = routeSegments(token);
    if (segments !== null) out.push({ token, slash, ref: { segments, group: routeGroup(token) } });
  }
  return out;
}

/** (screen ID, route) pairs named by SCREEN_AND_FLOW_MAP. */
export function screenRoutes(text: string): { id: string; route: RouteRef }[] {
  const out: { id: string; route: RouteRef }[] = [];
  const add = (ids: readonly string[], cell: string) => {
    // "`app/waiting.tsx`; param `focus`": a parameter name is not a route.
    for (const m of cell.replace(/\bparams?\s+`[^`]*`/g, '').matchAll(/`([^`]+)`/g)) {
      const token = m[1] ?? '';
      const segments = routeSegments(token);
      if (segments === null) continue;
      for (const id of ids) out.push({ id, route: { segments, group: routeGroup(token) } });
    }
  };
  // Index tables: the column whose header starts with "Route".
  let routeColumn = -1;
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) {
      routeColumn = -1;
      continue;
    }
    const c = cells(line);
    const header = c.findIndex((cell) => /^Route\b/.test(cell));
    if (header !== -1 && !(c[1] ?? '').startsWith('M-')) {
      routeColumn = header;
      continue;
    }
    if (routeColumn !== -1 && (c[1] ?? '').startsWith('M-'))
      add(screenIds(c[1] ?? ''), c[routeColumn] ?? '');
  }
  // `### M-… · Name` blocks: the first Route line of the block.
  for (const block of text.split(/\n(?=### )/)) {
    const heading = /^### (M-[A-Z]+-[0-9]+[A-Z]*)/.exec(block);
    if (heading === null) continue;
    const route = /^(?:- \*\*Route(?::\*\*| ?\*\* —)|\| Route \|)(.*)$/m.exec(block);
    if (route !== null) add([heading[1] ?? ''], route[1] ?? '');
  }
  return out;
}

interface MapEntry {
  readonly line: number;
  readonly file: string;
  readonly ids: readonly string[];
  readonly why: string;
}

function mapEntries(text: string): MapEntry[] {
  return text
    .split('\n')
    .map((raw, i) => ({ raw: raw.trim(), line: i + 1 }))
    .filter(({ raw }) => raw !== '' && !raw.startsWith('#'))
    .map(({ raw, line }) => {
      const [file = '', ids = '', ...why] = raw.split('|').map((s) => s.trim());
      return { line, file, ids: screenIds(ids), why: why.join('|').trim() };
    });
}

function inventory(ctx: Context): Finding[] {
  const files = ctx.select([APP_DIR], /\.[jt]sx?$/).filter((f) => !isTestPath(f));
  // A tree without `docs/` is a partial checkout (like QG-26 without `packages/domain`); with
  // `docs/` present the checklist and its §4 inventory are required.
  if (files.length === 0 || !ctx.exists('docs')) return [];
  const rows = inventoryRows(ctx.exists(CHECKLIST) ? ctx.read(CHECKLIST) : '');
  if (rows === null)
    return [missing('QG-16b', CHECKLIST, 'No-Dead-Action inventory §4.2–§4.5 not found')];

  const routes: RouteFile[] = files
    .map((f) => ({ f, url: routeOf(f) }))
    .filter((r): r is { f: string; url: string } => r.url !== null)
    .map((r) => ({
      f: r.f,
      segments: r.url.split('/').filter(Boolean),
      groups: [...r.f.matchAll(/\/\(([a-z-]+)\)\//g)].map((m) => m[1] ?? ''),
    }));
  const apiPaths = [
    ...ctx.read(API_ROUTES).matchAll(/^\s*'(?:GET|POST|PATCH|PUT|DELETE) (\/[^']*)'/gm),
  ].map((m) => (m[1] ?? '').split('/').filter(Boolean));

  const rowIds = new Set(rows.flatMap((r) => r.ids));
  const tokens = rows.flatMap((r) => targetTokens(r.target).map((t) => ({ ...t, line: r.line })));
  const out: Finding[] = [];

  for (const t of tokens) {
    const ref = t.ref;
    const resolved =
      ref === null ||
      routes.some((r) => matches(r, ref)) ||
      (t.slash && ref.group === null && apiMatch(apiPaths, ref.segments));
    if (!resolved)
      out.push({
        id: 'QG-16b',
        file: CHECKLIST,
        line: t.line,
        match: clip(`\`${t.token}\` → no route file, api route or link prefix`),
      });
  }

  const map = mapEntries(ctx.read(ROUTE_SCREENS_MAP));
  for (const e of map) {
    const problem = !files.includes(e.file)
      ? 'names no route file'
      : e.ids.length === 0
        ? 'names no screen ID'
        : e.ids.some((id) => !rowIds.has(id))
          ? `screen ID without a §4 row: ${e.ids.filter((id) => !rowIds.has(id)).join(', ')}`
          : e.why === ''
            ? 'has no justification'
            : null;
    if (problem !== null)
      out.push({
        id: 'QG-16b',
        file: ROUTE_SCREENS_MAP,
        line: e.line,
        match: clip(`${e.file} ${problem}`),
      });
  }

  const pairs = screenRoutes(ctx.read(SCREEN_MAP));
  for (const r of routes) {
    const byPath = tokens.some((t) => t.ref !== null && matches(r, t.ref));
    const ids = [
      ...pairs.filter((p) => matches(r, p.route)).map((p) => p.id),
      ...map.filter((e) => e.file === r.f).flatMap((e) => e.ids),
    ];
    if (!byPath && !ids.some((id) => rowIds.has(id))) {
      const named = [...new Set(ids)];
      out.push(
        missing(
          'QG-16b',
          r.f,
          `/${r.segments.join('/')} has no No-Dead-Action row (no Target path${named.length === 0 ? ', no screen ID' : `; no rows for ${named.join(', ')}`})`,
        ),
      );
    }
  }
  return out;
}

export const inventoryCheck: Check = {
  ids: ['QG-16b'],
  title: 'No-Dead-Action inventory ↔ mobile route files',
  run(ctx: Context): Finding[] {
    return inventory(ctx);
  },
};
