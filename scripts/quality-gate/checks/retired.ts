/** QG-27 canonical-name drift: retired names (`retired-names.txt`, docs/CANONICAL_REGISTRY.md). */
import { type Check, type Context, type Finding, grepLines } from '../lib.ts';
import { allowed, retiredList } from './lists.ts';

export const retired: Check = {
  ids: ['QG-27'],
  title: 'Retired canonical names',
  run(ctx: Context): Finding[] {
    const list = retiredList();
    return grepLines(
      ctx,
      ctx.select(['apps/', 'packages/', 'supabase/']),
      'QG-27',
      (line, file) => !allowed(file, line) && list.some((re) => re.test(line)),
    );
  },
};
