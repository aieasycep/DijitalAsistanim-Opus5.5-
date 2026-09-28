/**
 * Code hygiene:
 * QG-11 skipped / focused tests · QG-13 demo / fixture leakage into production code (and the
 * production build refusing demo mode) · QG-21 remote imports in Deno · QG-25 Realtime unused (the
 * source grep; the publication count is pgTAP, verified present here).
 */
import { type Check, type Context, type Finding, grepLines, isTestPath, missing } from '../lib.ts';

const FOCUS =
  /\b(it|test|describe)\.(skip|only|todo)\(|\bx(it|describe)\(|test\.fixme\(|\.only\(|Deno\.test\.(only|ignore)\(|\bonly:\s*true\b/;

const DEMO_IMPORT = /\/providers\/demo\/|\/fixtures\/|\bdemo(Adapter|Data)\b/;
/**
 * The demo provider package's gate-enforcing entry points (INTEGRATION_PLAN §2.10, §13): `guard.ts`
 * (the production gate itself) and `index.ts` (whose adapters only `createProviderRegistry`
 * resolves, behind `isDemoEnabled`). Deep imports into the package are leakage.
 */
const DEMO_ENTRY = /\/providers\/demo\/(guard|index)\.ts['"]/;
/** A module that enforces the demo / fixture gate itself may reach fixture code. */
const GATE_CALL = /\b(isDemoEnabled|assertDemoAllowed|fixtureProviderEnabled)\(/;
const IMPORT_LINE =
  /^\s*(import|export)\b[^'"]*\bfrom\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/;
const DEMO_ALLOWED = /^supabase\/functions\/_shared\/(providers\/demo|testing)\/|^supabase\/seed\//;

const REMOTE_IMPORT = /https:\/\/(esm\.sh|deno\.land\/x|unpkg\.com)/;

const REALTIME = /\.channel\(|postgres_changes|supabase\.realtime/;

function testFile(f: string): boolean {
  return /\.(test|spec)\./.test(f) || /^apps\/[^/]+\/e2e\//.test(f);
}

export const code: Check = {
  ids: ['QG-11', 'QG-13', 'QG-21', 'QG-25'],
  title: 'Focused tests, demo leakage, remote Deno imports, Realtime usage',
  run(ctx: Context): Finding[] {
    const all = ctx.select(['apps/', 'packages/', 'supabase/', 'scripts/'], /\.[cm]?[jt]sx?$/);
    const out: Finding[] = [
      ...grepLines(ctx, all.filter(testFile), 'QG-11', (l) => FOCUS.test(l)),
      ...grepLines(
        ctx,
        all.filter(
          (f) => /^(apps|supabase\/functions)\//.test(f) && !isTestPath(f) && !DEMO_ALLOWED.test(f),
        ),
        'QG-13',
        (l, f) => {
          if (IMPORT_LINE.exec(l) === null || !DEMO_IMPORT.test(l)) return false;
          if (/\bdemo(Adapter|Data)\b/.test(l)) return true;
          if (DEMO_ENTRY.test(l)) return false;
          return !(l.includes('/fixtures/') && GATE_CALL.test(ctx.read(f)));
        },
      ),
      ...grepLines(ctx, ctx.select(['supabase/functions/'], /\.(ts|json|jsonc)$/), 'QG-21', (l) =>
        REMOTE_IMPORT.test(l),
      ),
      ...grepLines(
        ctx,
        all.filter((f) => f.startsWith('apps/') && !isTestPath(f)),
        'QG-25',
        (l) => REALTIME.test(l),
      ),
    ];
    if (ctx.exists('apps/mobile/app.config.ts')) {
      const config = ctx.read('apps/mobile/app.config.ts');
      if (!/EXPO_PUBLIC_DEMO_MODE[\s\S]{0,200}ALLOW_DEMO_IN_PRODUCTION/.test(config))
        out.push(
          missing(
            'QG-13',
            'apps/mobile/app.config.ts',
            'production build does not refuse EXPO_PUBLIC_DEMO_MODE without ALLOW_DEMO_IN_PRODUCTION',
          ),
        );
    }
    if (ctx.exists('supabase/tests/database')) {
      const pgtap = ctx
        .select(['supabase/tests/database/'], /\.sql$/)
        .some((f) =>
          /pg_publication_tables\s+where\s+pubname\s*=\s*'supabase_realtime'/.test(ctx.read(f)),
        );
      if (!pgtap)
        out.push(
          missing(
            'QG-25',
            'supabase/tests/database',
            'no pgTAP assertion on the supabase_realtime publication',
          ),
        );
    }
    return out;
  },
};
