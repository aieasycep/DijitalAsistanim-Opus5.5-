import { z } from 'zod';
import {
  Ref,
  Refiner,
  sameNumericTokens,
  type BaseRefineContext,
  type RefineResult,
} from './common.ts';

/** §4.3.7 · prompts `briefing_midday` / `briefing_evening` (optional T1 polish, R-05). */
export const BriefingPolishV1 = z.strictObject({
  items: z.array(z.strictObject({ ref: Ref, title_tr: z.string(), sub_tr: z.string().nullable() })),
});
export type BriefingPolishV1 = z.infer<typeof BriefingPolishV1>;

export const BRIEFING_POLISH_LIMITS = { title_chars: 80, sub_chars: 140 } as const;

export interface BriefingPolishRefineContext extends BaseRefineContext {
  /** The deterministic T0 title and sub per ref; the fallback when polish changes a number. */
  readonly originals: Readonly<Record<string, { title_tr: string; sub_tr: string | null }>>;
}

/**
 * Number-preservation rule: the multiset of digit/time tokens in the polished title+sub must equal the
 * T0 title+sub, otherwise the T0 text is kept. Unknown refs are dropped.
 */
export function refineBriefingPolishV1(
  parsed: BriefingPolishV1,
  ctx: BriefingPolishRefineContext,
): RefineResult<BriefingPolishV1> {
  const r = new Refiner(ctx.aliases);
  const seen = new Set<string>();
  const items = parsed.items.flatMap((item, i) => {
    const path = `items.${i}`;
    const original = ctx.originals[item.ref];
    if (!r.ref(item.ref, `${path}.ref`) || original === undefined) return [];
    if (seen.has(item.ref)) {
      r.drop(`${path}.ref`, 'duplicate_ref');
      return [];
    }
    seen.add(item.ref);
    const title = r.text(item.title_tr, BRIEFING_POLISH_LIMITS.title_chars, `${path}.title_tr`);
    const sub = r.nullableText(item.sub_tr, BRIEFING_POLISH_LIMITS.sub_chars, `${path}.sub_tr`);
    const polished = `${title} ${sub ?? ''}`;
    const baseline = `${original.title_tr} ${original.sub_tr ?? ''}`;
    if (title === '' || !sameNumericTokens(polished, baseline)) {
      r.drop(path, 'number_mismatch');
      return [{ ref: item.ref, title_tr: original.title_tr, sub_tr: original.sub_tr }];
    }
    return [{ ref: item.ref, title_tr: title, sub_tr: sub }];
  });
  return r.result({ items });
}
