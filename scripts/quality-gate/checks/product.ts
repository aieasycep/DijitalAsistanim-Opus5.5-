/**
 * Product wiring:
 * QG-16 dead navigation / unreachable screen — every `apps/mobile/app/**` route is referenced by a
 * navigation literal, the deep-link map (`@da/domain` `ROUTE_DEFS`, which the notification router
 * resolves through) or is a tab root; every navigation literal (`router.push/replace/navigate`,
 * `href`, `pathname`) resolves to a route ·
 * QG-26 analytics catalogue — every tracked event-name literal is in `ANALYTICS_EVENTS` (or an alias)
 * and no literal prop name is on the banned list.
 */
import {
  type Check,
  type Context,
  type Finding,
  clip,
  constStringArray,
  isTestPath,
  lineAt,
  missing,
} from '../lib.ts';

const APP_DIR = 'apps/mobile/app/';
const DEEPLINKS = 'packages/domain/src/deeplinks.ts';
const EVENTS = 'packages/domain/src/analytics/events.ts';
const VALIDATE = 'packages/domain/src/analytics/validate.ts';

/** `app/(tabs)/today/index.tsx` → `/today`; `app/mail/[id].tsx` → `/mail/:id`; layouts → null. */
export function routeOf(file: string): string | null {
  const segments = file
    .slice(APP_DIR.length)
    .replace(/\.[jt]sx?$/, '')
    .split('/');
  const last = segments.at(-1) ?? '';
  if (last.startsWith('_') || last.startsWith('+')) return null;
  const url = segments
    .filter((s) => !/^\(.+\)$/.test(s) && s !== 'index')
    .map((s) => s.replace(/^\[\.\.\.(.+)\]$/, '*$1').replace(/^\[(.+)\]$/, ':$1'));
  return `/${url.join('/')}`;
}

/** Normalises a path literal: query/hash dropped, `${…}` → `:p`, groups removed. */
function normalise(literal: string): string {
  const path = literal
    .replace(/\$\{[^}]*\}/g, ':p')
    .replace(/[?#].*$/, '')
    .split('/')
    .filter((s) => s !== '' && !/^\(.+\)$/.test(s))
    .join('/');
  return `/${path}`;
}

function matches(route: string, ref: string): boolean {
  const a = route.split('/').filter(Boolean);
  const b = ref.split('/').filter(Boolean);
  if (a.at(-1)?.startsWith('*') === true) return b.length >= a.length - 1;
  if (a.length !== b.length) return false;
  return a.every((s, i) => s === b[i] || s.startsWith(':') || (b[i] ?? '').startsWith(':'));
}

const PATH_LITERAL = /(['"`])(\/[A-Za-z0-9_\-/:.[\]()${}?=&%]*)\1/g;
const NAV_LITERAL =
  /(?:router\.(?:push|replace|navigate|dismissTo)\(\s*|\bhref=\{?\s*|\bhref:\s*|\bpathname:\s*|<Redirect\s+href=\{?\s*)(['"`])(\/[^'"`]*)\1/g;
/** Registry lists mirror the files on disk; they are not navigation. */
const REGISTRY_BLOCK = /export const (SCREEN_ROUTES|DEMO_ONLY_ROUTES)\b[^=]*=\s*\[[\s\S]*?\];/g;

function routes(ctx: Context): Finding[] {
  const files = ctx.select([APP_DIR], /\.[jt]sx?$/);
  if (files.length === 0) return [];
  const table = files
    .map((f) => ({ f, route: routeOf(f) }))
    .filter((r): r is { f: string; route: string } => r.route !== null);
  const refs = new Set<string>();
  for (const m of ctx.read(DEEPLINKS).matchAll(/pattern:\s*'([^']+)'/g))
    refs.add(normalise(m[1] ?? ''));
  const out: Finding[] = [];
  const sources = ctx
    .select(['apps/mobile/src/', APP_DIR], /\.[jt]sx?$/)
    .filter((f) => !isTestPath(f));
  for (const f of sources) {
    const text = ctx.read(f).replace(REGISTRY_BLOCK, '');
    for (const m of text.matchAll(PATH_LITERAL)) refs.add(normalise(m[2] ?? ''));
    for (const m of text.matchAll(NAV_LITERAL)) {
      const target = normalise(m[2] ?? '');
      if (!table.some((r) => matches(r.route, target)))
        out.push({
          id: 'QG-16',
          file: f,
          line: lineAt(text, m.index),
          match: `${clip(m[0])} → no route`,
        });
    }
  }
  for (const { f, route } of table) {
    const tabRoot = /\(tabs\)\/[^/]+\/index\.[jt]sx?$/.test(f);
    if (route === '/' || tabRoot) continue;
    if (![...refs].some((ref) => matches(route, ref)))
      out.push(missing('QG-16', f, `${route} is unreachable (no navigation, deep link or tab)`));
  }
  return out;
}

const TRACK_CALL =
  /\b(track|sendWebEvent|validateAnalyticsEvent|trackEvent)\(\s*['"]([a-z][a-z0-9_]*)['"]\s*(?:,\s*\{([^}]*)\})?/g;
const LOCAL_TRACK = /\b(const|let|function)\s+track\b/;

function analytics(ctx: Context): Finding[] {
  if (!ctx.exists('packages/domain')) return [];
  if (!ctx.exists(EVENTS)) return [missing('QG-26', EVENTS, 'analytics catalogue missing')];
  const catalogue = ctx.read(EVENTS);
  const block = /export const ANALYTICS_EVENTS = \{([\s\S]*?)\n\};/.exec(catalogue)?.[1] ?? '';
  const aliases = /ANALYTICS_EVENT_ALIASES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(catalogue)?.[1] ?? '';
  const names = new Set([
    ...[...block.matchAll(/^ {2}([a-z][a-z0-9_]*):/gm)].map((m) => m[1] ?? ''),
    ...[...aliases.matchAll(/^ {2}([a-z][a-z0-9_]*):/gm)].map((m) => m[1] ?? ''),
  ]);
  const banned = new Set(constStringArray(ctx.read(VALIDATE), 'BANNED_PROP_NAMES'));
  const out: Finding[] = [];
  const files = ctx
    .select(['apps/', 'supabase/functions/'], /\.[jt]sx?$/)
    .filter((f) => !isTestPath(f));
  for (const f of files) {
    const text = ctx.read(f);
    if (LOCAL_TRACK.test(text) && !/sendWebEvent|validateAnalyticsEvent/.test(text)) continue;
    for (const m of text.matchAll(TRACK_CALL)) {
      if (m[1] === 'track' && LOCAL_TRACK.test(text)) continue;
      const name = m[2] ?? '';
      const props = [...(m[3] ?? '').matchAll(/(?:^|,)\s*([a-z_][a-z0-9_]*)\s*(?=[:,]|$)/g)].map(
        (p) => p[1] ?? '',
      );
      const bad = props.filter((p) => banned.has(p));
      if (!names.has(name) || bad.length > 0)
        out.push({
          id: 'QG-26',
          file: f,
          line: lineAt(text, m.index),
          match: !names.has(name)
            ? `${name} is not in ANALYTICS_EVENTS`
            : `banned prop ${bad.join(', ')}`,
        });
    }
  }
  return out;
}

export const product: Check = {
  ids: ['QG-16', 'QG-26'],
  title: 'Route reachability and dead hrefs, analytics catalogue',
  run(ctx: Context): Finding[] {
    return [...routes(ctx), ...analytics(ctx)];
  },
};
