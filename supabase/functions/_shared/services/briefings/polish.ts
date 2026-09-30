/**
 * Optional one-sentence T1 polish of midday / evening item copy (R-05; AI_PIPELINE_PLAN §4.3.7).
 * Runs only when `ai.feature.briefing_polish` is on (and the route allows it); never T2. Numbers
 * and times must survive unchanged, otherwise the deterministic text stays.
 */
import { BriefingPolishV1, refineBriefingPolishV1 } from '@da/validation';
import type { UntrustedDoc } from '../../ai/untrusted.ts';
import { callModel, type PipelineContext, trustedHeader } from '../ai/pipeline.ts';
import { isOn } from '../flags.ts';
import { type ItemDraft, promptMeta } from './items.ts';

export interface PolishOutcome {
  readonly drafts: ItemDraft[];
  readonly polished: boolean;
  readonly promptVersionId: string | null;
}

export async function polishDrafts(
  pipeline: PipelineContext,
  feature: 'briefing_midday' | 'briefing_evening',
  drafts: readonly ItemDraft[],
  now: Date,
): Promise<PolishOutcome> {
  if (drafts.length === 0 || !isOn(pipeline.user.flags, 'ai.feature.briefing_polish')) {
    return { drafts: [...drafts], polished: false, promptVersionId: null };
  }
  // Event locations are calendar details: with `calendar` off the model sees the time only, and
  // such drafts keep their deterministic meta line (only the title may be polished).
  const access = pipeline.user.dataAccess;
  const subs = drafts.map((d) => promptMeta(d, access));
  const withheld = drafts.map((d, i) => subs[i] !== d.meta);
  const docs: UntrustedDoc[] = drafts.map((d, i) => ({
    ref: `i${i + 1}`,
    kind: 'summary',
    text: JSON.stringify({ title: d.title, sub: subs[i] ?? null }),
  }));
  const result = await callModel(pipeline, {
    feature,
    schema: BriefingPolishV1,
    schemaName: 'BriefingPolishV1',
    context: trustedHeader(pipeline.user, now),
    docs,
    vars: { count: drafts.length },
    cacheContent: `${feature}\n${docs.map((d) => `${d.ref}\n${d.text}`).join('\n')}`,
    units: 1,
    extraSources: drafts.flatMap((d, i) => [d.title, subs[i] ?? '']),
  });
  if (result.kind !== 'ai') return { drafts: [...drafts], polished: false, promptVersionId: null };
  const originals = Object.fromEntries(
    drafts.map((d, i) => [`i${i + 1}`, { title_tr: d.title, sub_tr: subs[i] ?? null }]),
  );
  const refined = refineBriefingPolishV1(result.data, {
    aliases: docs.map((d) => d.ref),
    originals,
  });
  if (!refined.ok) return { drafts: [...drafts], polished: false, promptVersionId: null };
  const byRef = new Map(refined.data.items.map((item) => [item.ref, item]));
  return {
    drafts: drafts.map((d, i) => {
      const p = byRef.get(`i${i + 1}`);
      if (p === undefined) return d;
      return withheld[i]
        ? { ...d, title: p.title_tr }
        : { ...d, title: p.title_tr, meta: p.sub_tr };
    }),
    polished: true,
    promptVersionId: result.promptVersionId,
  };
}
