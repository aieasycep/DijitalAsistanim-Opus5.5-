/**
 * QG-01 work markers and QG-01b deferral comments (M§100, R-17). The work-marker list is the shared
 * `banned-markers.txt` (also read by the i18n catalog gate and the web e2e helpers); the spec's
 * case-sensitive `HA[C]K` is added here.
 */
import { type Check, type Context, type Finding, clip } from '../lib.ts';
import { allowed, bannedList } from './lists.ts';

const SCOPES = ['apps/', 'packages/', 'supabase/', 'scripts/', '.github/'];
/** Markers from the shared list that are work markers (the rest is copy, see copy.ts). */
const MARKER_SOURCES = /^\\b(TODO|FIXME|XXX|TBD)\\b$/;
const HACK = /\bHA[C]K\b/;
/** A lowercase URL path segment (`/me/todo/lists`) is an endpoint name, not a marker. */
const URL_SEGMENT = /(?<=\/)[a-z]+(?=\/)/g;

const DEFERRAL =
  /(\/\/|\/\*|^\s*\*|--|^\s*#)\s*(later\b|in\s+the\s+future|future\s+work|ileride|sonra\s+yap[ıi]lacak)/i;
const COMMENT_FILES = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|sql|sh|swift|kt|kts|ya?ml|toml|gradle)$/;

export const markers: Check = {
  ids: ['QG-01', 'QG-01b'],
  title: 'Work markers and deferral comments',
  run(ctx: Context): Finding[] {
    const list = bannedList().filter((re) => MARKER_SOURCES.test(re.source));
    const out: Finding[] = [];
    for (const file of ctx.select(SCOPES)) {
      ctx
        .read(file)
        .split('\n')
        .forEach((raw, i) => {
          if (allowed(file, raw)) return;
          const line = raw.replace(URL_SEGMENT, '');
          if (list.some((re) => re.test(line)) || HACK.test(line)) {
            out.push({ id: 'QG-01', file, line: i + 1, match: clip(raw) });
          } else if (COMMENT_FILES.test(file) && DEFERRAL.test(line)) {
            out.push({ id: 'QG-01b', file, line: i + 1, match: clip(raw) });
          }
        });
    }
    return out;
  },
};
