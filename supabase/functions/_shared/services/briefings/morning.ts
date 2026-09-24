/**
 * Morning briefing (IMPLEMENTATION_PLAN T-5.08; AI_PIPELINE_PLAN §4.3.6; JOB-14; M§9).
 *
 * Code picks the six sections in canonical order — Bugünün Öncelikleri (carried items first, top 5
 * ranked), Programın, Senden Beklenenler, Senin Beklediklerin, Son Tarihler, Kişisel Gelişmeler —
 * and the hero line "Bugün bilmen gereken {n} şey var.". The T2 `briefing_morning` call receives
 * only the ranked item JSON (refs `i*` for items, `s*` for statistics) and writes ≤90 words; every
 * sentence must cite refs and every number must come from a cited ref, otherwise it is dropped.
 * With no model (budget, kill switch, failure) the narrative is the T0 template.
 */
import { localDate } from '@da/domain';
import { BriefingMorningV1, refineBriefingMorningV1, type SectionKey } from '@da/validation';
import type { UntrustedDoc } from '../../ai/untrusted.ts';
import { callModel, type PipelineContext, trustedHeader } from '../ai/pipeline.ts';
import { clip, copy, formatDay, formatWeekday } from '../copy.ts';
import type { NotificationBuild } from '../insights/build.ts';
import { todayPriorities } from '../insights/rank.ts';
import type {
  BriefingItemInsert,
  BriefingItemRow,
  BriefingPatch,
  BriefingRow,
  CalendarEventRow,
  InsightRow,
} from '../intel/types.ts';
import {
  briefingNotification,
  type BriefingSection,
  fromCarried,
  fromEvent,
  fromInsight,
  type ItemDraft,
  itemRows,
  withoutSeen,
} from './items.ts';

export const MORNING_SECTIONS: readonly SectionKey[] = [
  'priorities',
  'schedule',
  'awaiting_me',
  'awaiting_them',
  'deadlines',
  'life',
];

const SECTION_LIMIT = 5;

export interface MorningInput {
  readonly briefing: BriefingRow;
  readonly now: Date;
  readonly insights: readonly InsightRow[];
  /** Today's events (local day of the briefing). */
  readonly events: readonly CalendarEventRow[];
  readonly carried: readonly BriefingItemRow[];
  readonly mail: { readonly total: number; readonly attention: number };
  readonly freshness: Record<string, unknown>;
}

export interface ComposedBriefing {
  readonly patch: BriefingPatch;
  readonly items: BriefingItemInsert[];
  readonly notification: NotificationBuild | null;
  readonly narrativeMode: 'ai' | 'template' | 'none';
}

/** Section drafts in canonical order (also used by the tests for the verbatim labels). */
export function morningSections(input: MorningInput, timeZone: string, locale: 'tr' | 'en') {
  const open = input.insights.filter((i) => i.status === 'open');
  const seen = new Set<string>();
  const carried = input.carried.map(fromCarried);
  const ranked = todayPriorities(open).map((i) => fromInsight(i, timeZone));
  const priorities = withoutSeen([...carried, ...ranked], seen, SECTION_LIMIT + carried.length);
  const byKind = (kinds: readonly string[]) =>
    open.filter((i) => kinds.includes(i.kind)).map((i) => fromInsight(i, timeZone));
  const schedule = input.events
    .filter((e) => e.status !== 'cancelled')
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .map((e) => fromEvent(e, timeZone, locale))
    .slice(0, 8);
  const sections: [BriefingSection, ItemDraft[]][] = [
    ['priorities', priorities],
    ['schedule', schedule],
    ['awaiting_me', withoutSeen(byKind(['reply_needed']), seen, SECTION_LIMIT)],
    ['awaiting_them', withoutSeen(byKind(['follow_up']), seen, SECTION_LIMIT)],
    ['deadlines', withoutSeen(byKind(['deadline', 'commitment']), seen, SECTION_LIMIT)],
    ['life', withoutSeen(byKind(['life_event', 'security']), seen, SECTION_LIMIT)],
  ];
  return sections;
}

function refText(d: ItemDraft): string {
  return [d.title, d.meta ?? ''].filter((t) => t !== '').join(' · ');
}

/** T0 narrative: counts of the sections, filled into the catalog template. */
export function templateNarrative(
  sections: readonly (readonly [BriefingSection, readonly ItemDraft[]])[],
  locale: 'tr' | 'en',
): string {
  const n = (key: BriefingSection) => sections.find(([s]) => s === key)?.[1].length ?? 0;
  return copy(locale, 'briefing.generated.morning.template', {
    meetings: n('schedule'),
    replies: n('awaiting_me'),
    waiting: n('awaiting_them'),
    deadlines: n('deadlines'),
  });
}

export async function composeMorning(
  pipeline: PipelineContext,
  input: MorningInput,
): Promise<ComposedBriefing> {
  const { user } = pipeline;
  const tz = input.briefing.time_zone || user.timeZone;
  const l = user.locale;
  const sections = morningSections(input, tz, l);
  const priorities = sections[0]![1];
  const count = priorities.length;
  const hero = count === 0 ? copy(l, 'today.hero.morningReady.zero') : copy(l, 'today.hero.morningReady.title', { count });
  const nonEmpty = MORNING_SECTIONS.filter((s) => (sections.find(([k]) => k === s)?.[1].length ?? 0) > 0);

  // Ranked item JSON → refs i1..iN (items) and s1..s3 (statistics).
  const docs: UntrustedDoc[] = [];
  const refTexts: Record<string, string> = {};
  const refOf = new Map<ItemDraft, string>();
  let i = 0;
  for (const [section, drafts] of sections) {
    for (const d of drafts) {
      i += 1;
      const ref = `i${i}`;
      refOf.set(d, ref);
      refTexts[ref] = refText(d);
      docs.push({
        ref,
        kind: 'summary',
        text: JSON.stringify({ section, title: d.title, meta: d.meta, badge: d.badge, urgency: d.urgency }),
      });
    }
  }
  const stats: [string, string][] = [
    ['s1', `${input.mail.total} mail`],
    ['s2', `${input.mail.attention} dikkat gerektiren mail`],
    ['s3', `${sections[1]![1].length} etkinlik`],
  ];
  for (const [ref, text] of stats) {
    refTexts[ref] = text;
    docs.push({ ref, kind: 'summary', text });
  }
  const topRefs = priorities.slice(0, 3).map((d) => refOf.get(d)!);
  let narrative = templateNarrative(sections, l);
  let mode: ComposedBriefing['narrativeMode'] = 'template';
  let promptVersionId: string | null = null;
  const chapters: { key: string; text: string }[] = [];
  const reasons: Record<string, string> = {};
  if (docs.length > 3) {
    const result = await callModel(pipeline, {
      feature: 'briefing_morning',
      schema: BriefingMorningV1,
      schemaName: 'BriefingMorningV1',
      context: [...trustedHeader(user, input.now), `Bölümler: ${nonEmpty.join(', ')}`],
      docs,
      vars: { count },
      cacheContent: `briefing_morning\n${input.briefing.id}\n${docs.map((d) => `${d.ref}\n${d.text}`).join('\n')}`,
      units: 1,
      extraSources: Object.values(refTexts),
    });
    if (result.kind === 'ai') {
      const refined = refineBriefingMorningV1(result.data, {
        aliases: docs.map((d) => d.ref),
        refTexts,
        nonEmptySections: nonEmpty,
        topPriorityRefs: topRefs,
      });
      const sentences = refined.data.narrative.filter((s) => s.refs.length > 0);
      if (refined.ok && sentences.length > 0) {
        narrative = sentences.map((s) => s.text_tr).join(' ');
        mode = 'ai';
        promptVersionId = result.promptVersionId;
        if (refined.data.overview_spoken_tr !== '') {
          chapters.push({ key: 'overview', text: refined.data.overview_spoken_tr });
        }
        for (const s of refined.data.section_spoken) chapters.push({ key: s.section, text: s.text_tr });
        for (const r of refined.data.priority_reasons) {
          const draft = [...refOf.entries()].find(([, ref]) => ref === r.ref)?.[0];
          if (draft !== undefined) reasons[draft.entityId] = r.why_tr;
        }
      }
    }
  }
  const counts = Object.fromEntries(sections.map(([s, d]) => [s, d.length]));
  const patch: BriefingPatch = {
    status: 'ready',
    skipped_reason: null,
    generated_at: input.now.toISOString(),
    failed_at: null,
    error_code: null,
    headline: clip(`${formatWeekday(l, input.now, tz)}, ${formatDay(l, input.now, tz)}`, 200),
    hero_line: clip(hero, 200),
    narrative: clip(narrative, 3000),
    sections: [...MORNING_SECTIONS],
    counts: { ...counts, items: count, carried: input.carried.length, emails: input.mail.total, attention: input.mail.attention },
    provenance: {
      emails: input.mail.total,
      events: sections[1]![1].length,
      hours: 24,
      narrative_mode: mode,
      local_date: localDate(input.now, tz),
      priority_reasons: reasons,
    },
    audio_chapters: chapters,
    source_freshness: input.freshness,
    prompt_version_id: promptVersionId,
  };
  const highlights = priorities
    .slice(0, 2)
    .map((d) => d.title)
    .join(' · ');
  const notification = briefingNotification(input.briefing, count === 0 ? 'morning.calm' : 'morning.ready', {
    public: count === 0 ? {} : { count },
    sensitive: count === 0 ? {} : { highlights: clip(highlights, 160) },
  });
  return { patch, items: itemRows(input.briefing, sections), notification, narrativeMode: mode };
}
