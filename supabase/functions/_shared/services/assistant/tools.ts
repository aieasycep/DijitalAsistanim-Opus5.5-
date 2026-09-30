/**
 * Read-only assistant tools (IMPLEMENTATION_PLAN T-5.11; AI_PIPELINE_PLAN §11.3, §11.4; R-04):
 * the T0 SQL-template answers of the structured intents (today's focus, who needs a reply, day
 * load, deadlines, payments, travel, reply status, last contact) over the user's derived data, and
 * the retrieval step of grounded QA (RPC-02 under the caller's JWT, turned into `search_result`
 * documents `r1..r6`). Nothing here writes: write intents are handled by `proposals.ts`.
 */
import {
  type BusyInterval,
  findFreeSlots,
  localDate,
  routeForInsight,
  routes,
  type SourceType,
} from '@da/domain';
import type { AssistantRichCardV1 } from '@da/validation';
import type { SearchResultDoc } from '../../ai/types.ts';
import { sourceRef } from '../assist/common.ts';
import type { AssistStore, ContactMatch } from '../assist/store.ts';
import { clip, copy, type CopyLocale, formatDay, formatTime } from '../copy.ts';
import type { InsightSnapshot } from '../intel/store.ts';
import type { InsightRow } from '../intel/types.ts';
import type { SearchResultView } from '../memory/search.ts';
import type { DetectedIntent } from './intents.ts';

export type Ref = ReturnType<typeof sourceRef>;

export interface Citation {
  readonly source: Ref;
  readonly title: string;
  readonly snippet: string;
}

export interface TemplateAnswer {
  readonly text: string;
  readonly cards: AssistantRichCardV1[];
  readonly citations: Citation[];
}

type ListItem = Extract<AssistantRichCardV1, { type: 'list' }>['data']['items'][number];
type Badge = ListItem['badge'];

const BADGE: Partial<Record<InsightRow['kind'], Badge>> = {
  deadline: 'SON TARİH',
  meeting: 'TOPLANTI',
  follow_up: 'TAKİP',
  life_event: 'KİŞİSEL',
  security: 'GÜVENLİK',
};

export interface ToolContext {
  readonly now: Date;
  readonly timeZone: string;
  readonly locale: CopyLocale;
  readonly workingHours: { start: string; end: string; days: readonly number[] };
}

function insightCitation(i: InsightRow): Citation {
  return {
    source: sourceRef({
      source_type: i.source_type,
      source_id: i.source_id,
      source_provider: i.source_provider,
      source_timestamp: i.source_timestamp,
    }),
    title: clip(i.title, 200),
    snippet: clip(i.body ?? i.title, 200),
  };
}

function insightItem(i: InsightRow, ctx: ToolContext): ListItem {
  const at = i.due_at ?? i.event_at;
  return {
    entity_type: i.entity_type,
    entity_id: i.entity_id,
    title: clip(i.title, 200),
    meta:
      at === null
        ? null
        : `${formatDay(ctx.locale, at, ctx.timeZone)} ${formatTime(at, ctx.timeZone)}`,
    badge: i.urgency === 'urgent' ? 'ACİL' : (BADGE[i.kind] ?? null),
    route: routeForInsight(i),
  };
}

function listCard(
  kind: Extract<AssistantRichCardV1, { type: 'list' }>['data']['kind'],
  title: string,
  items: ListItem[],
  route: string,
): AssistantRichCardV1 {
  return { type: 'list', route, data: { kind, title, items, undo_token: null } };
}

function inRange(at: string | null, from: Date, to: Date): boolean {
  if (at === null) return false;
  const t = Date.parse(at);
  return t >= from.getTime() && t < to.getTime();
}

function dayLabel(ctx: ToolContext, from: Date): string {
  const today = localDate(ctx.now, ctx.timeZone);
  const day = localDate(from, ctx.timeZone);
  if (day === today) return ctx.locale === 'en' ? 'Today' : 'Bugün';
  const tomorrow = localDate(new Date(ctx.now.getTime() + 86_400_000), ctx.timeZone);
  if (day === tomorrow) return ctx.locale === 'en' ? 'Tomorrow' : 'Yarın';
  return formatDay(ctx.locale, from, ctx.timeZone);
}

function period(
  intent: DetectedIntent,
  ctx: ToolContext,
  fallbackDays: number,
): { from: Date; to: Date } {
  if (intent.from !== null && intent.to !== null) return { from: intent.from, to: intent.to };
  return { from: ctx.now, to: new Date(ctx.now.getTime() + fallbackDays * 86_400_000) };
}

const open = (i: { status: string }) => i.status === 'open';

/** T0 answers of the structured intents; null for intents that need a person or retrieval. */
export function templateAnswer(
  intent: DetectedIntent,
  snapshot: InsightSnapshot,
  ctx: ToolContext,
): TemplateAnswer | null {
  const L = ctx.locale;
  switch (intent.intent) {
    case 'focus_today': {
      const top = snapshot.insights
        .filter(open)
        .sort((a, b) => b.rank_score - a.rank_score)
        .slice(0, 5);
      if (top.length === 0)
        return { text: copy(L, 'assistant.generated.focusNone'), cards: [], citations: [] };
      return {
        text: copy(L, 'assistant.generated.focus', {
          count: top.length,
          title: clip(top[0]!.title, 120),
        }),
        cards: [
          listCard(
            'waiting_on_you',
            copy(L, 'assistant.generated.focusCard', { count: top.length }),
            top.map((i) => insightItem(i, ctx)),
            routes.today(),
          ),
        ],
        citations: top.map(insightCitation),
      };
    }
    case 'who_needs_reply': {
      const replies = snapshot.insights
        .filter((i) => open(i) && i.kind === 'reply_needed')
        .sort((a, b) => (a.due_at ?? '9').localeCompare(b.due_at ?? '9'))
        .slice(0, 8);
      if (replies.length === 0) {
        return { text: copy(L, 'assistant.generated.whoNeedsReplyNone'), cards: [], citations: [] };
      }
      return {
        text: copy(L, 'assistant.generated.whoNeedsReply', { count: replies.length }),
        cards: [
          listCard(
            'waiting_on_you',
            copy(L, 'assistant.generated.whoNeedsReplyCard'),
            replies.map((i) => insightItem(i, ctx)),
            routes.waiting(),
          ),
        ],
        citations: replies.map(insightCitation),
      };
    }
    case 'am_i_busy': {
      const range =
        intent.from !== null && intent.to !== null
          ? { from: intent.from, to: intent.to }
          : {
              from: new Date(ctx.now.getTime() + 86_400_000),
              to: new Date(ctx.now.getTime() + 2 * 86_400_000),
            };
      const events = snapshot.events
        .filter((e) => e.status !== 'cancelled' && !e.all_day)
        .filter(
          (e) =>
            Date.parse(e.start_at) < range.to.getTime() &&
            Date.parse(e.end_at) > range.from.getTime(),
        )
        .sort((a, b) => a.start_at.localeCompare(b.start_at));
      const day = dayLabel(ctx, range.from);
      if (events.length === 0) {
        return { text: copy(L, 'assistant.generated.busyNone', { day }), cards: [], citations: [] };
      }
      const busy: BusyInterval[] = events.map((e) => ({ start: e.start_at, end: e.end_at }));
      const slots = findFreeSlots({
        now: Math.max(range.from.getTime(), ctx.now.getTime()),
        timeZone: ctx.timeZone,
        busy,
        workingHours: ctx.workingHours,
        quietHours: null,
        minMinutes: 15,
        before: range.to.getTime(),
        horizonDays: Math.max(
          1,
          Math.ceil((range.to.getTime() - range.from.getTime()) / 86_400_000),
        ),
      });
      const longest = [...slots].sort((a, b) => b.minutes - a.minutes)[0];
      const text = [
        copy(L, 'assistant.generated.busy', { day, count: events.length }),
        ...(longest === undefined
          ? []
          : [
              copy(L, 'assistant.generated.busyGap', {
                start: formatTime(longest.start, ctx.timeZone),
                end: formatTime(longest.end, ctx.timeZone),
              }),
            ]),
      ].join(' ');
      return {
        text,
        cards: [
          listCard(
            'events',
            copy(L, 'assistant.generated.eventsCard', {
              day: day.toLocaleUpperCase('tr-TR'),
              count: events.length,
            }),
            events.slice(0, 10).map((e) => ({
              entity_type: 'calendar_event',
              entity_id: e.id,
              title: clip(e.title ?? '', 200),
              meta: `${formatTime(e.start_at, ctx.timeZone)}–${formatTime(e.end_at, ctx.timeZone)}`,
              badge: 'TOPLANTI' as Badge,
              route: routes.event(e.id),
            })),
            routes.plan({ view: 'day', date: localDate(range.from, ctx.timeZone) }),
          ),
        ],
        citations: events.slice(0, 6).map((e) => ({
          source: sourceRef({
            source_type: 'calendar_event',
            source_id: e.id,
            source_provider: e.provider,
            source_timestamp: e.updated_at,
          }),
          title: clip(e.title ?? '', 200),
          snippet: `${formatTime(e.start_at, ctx.timeZone)}–${formatTime(e.end_at, ctx.timeZone)}`,
        })),
      };
    }
    case 'deadlines_period': {
      const range = period(intent, ctx, 7);
      const due = snapshot.insights
        .filter((i) => open(i) && i.kind === 'deadline' && inRange(i.due_at, range.from, range.to))
        .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))
        .slice(0, 10);
      if (due.length === 0)
        return { text: copy(L, 'assistant.generated.deadlinesNone'), cards: [], citations: [] };
      return {
        text: copy(L, 'assistant.generated.deadlines', { count: due.length }),
        cards: [
          listCard(
            'deadlines',
            copy(L, 'assistant.generated.deadlinesCard'),
            due.map((i) => insightItem(i, ctx)),
            routes.flow('all'),
          ),
        ],
        citations: due.map(insightCitation),
      };
    }
    case 'payments_period':
    case 'travel_lookup': {
      const payments = intent.intent === 'payments_period';
      const range = payments
        ? period(intent, ctx, 30)
        : intent.from !== null && intent.to !== null
          ? { from: intent.from, to: intent.to }
          : {
              from: new Date(ctx.now.getTime() - 30 * 86_400_000),
              to: new Date(ctx.now.getTime() + 30 * 86_400_000),
            };
      const types = payments ? ['payment', 'subscription'] : ['flight', 'reservation'];
      const rows = snapshot.lifeEvents
        .filter((l) => types.includes(l.type) && !l.suppressed)
        .filter(
          (l) =>
            inRange(l.due_at ?? l.event_at, range.from, range.to) ||
            (payments && l.due_at === null && l.status === 'open'),
        )
        .slice(0, 10);
      if (rows.length === 0) {
        return {
          text: copy(
            L,
            payments ? 'assistant.generated.paymentsNone' : 'assistant.generated.travelNone',
          ),
          cards: [],
          citations: [],
        };
      }
      const amountNote =
        !payments && rows.every((r) => r.amount === null)
          ? ` ${copy(L, 'assistant.generated.amountMissing')}`
          : '';
      return {
        text: `${copy(L, payments ? 'assistant.generated.payments' : 'assistant.generated.travel', { count: rows.length })}${amountNote}`,
        cards: [
          listCard(
            payments ? 'payments' : 'events',
            copy(
              L,
              payments ? 'assistant.generated.paymentsCard' : 'assistant.generated.eventsCard',
              {
                day: '',
                count: rows.length,
              },
            ).trim(),
            rows.map((r) => {
              const at = r.due_at ?? r.event_at;
              const amount = r.amount === null ? null : `${r.amount} ${r.currency ?? ''}`.trim();
              return {
                entity_type: 'life_event',
                entity_id: r.id,
                title: clip(r.title, 200),
                meta:
                  [at === null ? null : formatDay(L, at, ctx.timeZone), amount]
                    .filter((v) => v !== null)
                    .join(' · ') || null,
                badge: 'KİŞİSEL' as Badge,
                route: routes.life(r.id),
              };
            }),
            routes.flow('personal'),
          ),
        ],
        citations: rows.map((r) => ({
          source: sourceRef({
            source_type: r.source_type,
            source_id: r.source_id,
            source_provider: r.source_provider,
            source_timestamp: r.source_timestamp,
          }),
          title: clip(r.title, 200),
          snippet: clip(r.title, 200),
        })),
      };
    }
    case 'play_briefing':
      return { text: copy(L, 'assistant.generated.playBriefing'), cards: [], citations: [] };
    case 'smalltalk':
      return { text: copy(L, 'assistant.generated.smalltalk'), cards: [], citations: [] };
    case 'unsupported':
      return { text: copy(L, 'assistant.generated.unsupported'), cards: [], citations: [] };
    case 'snooze_item': {
      const names = intent.people.map((p) => p.toLocaleLowerCase('tr-TR'));
      const matches = snapshot.insights
        .filter(
          (i) =>
            open(i) &&
            (names.length === 0 ||
              names.some((n) => i.title.toLocaleLowerCase('tr-TR').includes(n))),
        )
        .slice(0, 5);
      return {
        text: copy(L, 'assistant.generated.snooze'),
        cards:
          matches.length === 0
            ? []
            : [
                listCard(
                  'waiting_on_you',
                  copy(L, 'assistant.generated.focusCard', { count: matches.length }),
                  matches.map((i) => insightItem(i, ctx)),
                  routes.today(),
                ),
              ],
        citations: matches.map(insightCitation),
      };
    }
    default:
      return null;
  }
}

/** The person of a person-scoped intent: one match, a chip question, or not found. */
export async function resolvePerson(
  store: AssistStore,
  userId: string,
  people: readonly string[],
  scopedContactId: string | null,
): Promise<
  | { kind: 'one'; contact: ContactMatch }
  | { kind: 'many'; contacts: ContactMatch[] }
  | { kind: 'none' }
> {
  if (scopedContactId !== null && people.length === 0) {
    const c = await store.contact(userId, scopedContactId);
    return c === null ? { kind: 'none' } : { kind: 'one', contact: c };
  }
  if (people.length === 0) return { kind: 'none' };
  const found = await store.contactsNamed(userId, people);
  if (found.length === 1) return { kind: 'one', contact: found[0]! };
  if (found.length > 1) return { kind: 'many', contacts: found.slice(0, 4) };
  return { kind: 'none' };
}

export function personChoiceCard(
  contacts: readonly ContactMatch[],
  L: CopyLocale,
): AssistantRichCardV1 {
  return listCard(
    'person_choice',
    copy(L, 'assistant.generated.personChoice'),
    contacts.map((c) => ({
      entity_type: 'contact',
      entity_id: c.id,
      title: clip(c.display_name, 200),
      meta: c.organization,
      badge: null,
      route: routes.person(c.id),
    })),
    routes.assistant(),
  );
}

/** Retrieved rows → `search_result` documents (`r1..r6`) with their citation sources. */
export function retrievalDocs(
  results: readonly SearchResultView[],
  limit = 6,
): { docs: SearchResultDoc[]; citations: Citation[] } {
  const used = results.filter((r) => r.title !== '' || r.snippet !== '').slice(0, limit);
  return {
    docs: used.map((r, i) => ({
      source: `r${i + 1}`,
      title: clip(r.title, 200),
      sentences: splitSentences(`${r.title}. ${r.snippet}`),
    })),
    citations: used.map((r) => ({
      source: {
        ...sourceRef({
          source_type: r.source.source_type as SourceType,
          source_id: r.source.source_id,
          source_provider: r.source.source_provider,
          source_timestamp: r.source.source_timestamp,
        }),
        ...(r.source.open_route === undefined ? {} : { open_route: r.source.open_route }),
      },
      title: clip(r.title, 200),
      snippet: clip(r.snippet, 200),
    })),
  };
}

export function splitSentences(text: string): string[] {
  return (text.match(/[^.!?\n]+[.!?]*/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .slice(0, 12);
}
