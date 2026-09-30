/**
 * API-WDG-01 `GET /widgets/snapshot` (IMPLEMENTATION_PLAN T-6.07; SCREEN_AND_FLOW_MAP §11.2;
 * INTEGRATION_PLAN §12.2): `WidgetSnapshotV1` composed without any LLM call from `today_overview`,
 * today's briefing, the next calendar events and the follow-up insights, rendered under the user's
 * notification detail level:
 *
 * - `generic` → counts only (no titles, names, subjects or amounts, no source labels);
 * - `title_only` → `title_private` (category + time / duration, ≤ 40 chars, no names);
 * - `full` → `title_full` (≤ 60 chars) as well.
 * Free snapshots carry no Pro-only fields (no audio minutes, only the morning briefing, no prep
 * state). Deep links are app routes only; nothing is a signed URL.
 */
import {
  deepLinkForInsight,
  formatTime,
  type InsightKind,
  localDate,
  type NotificationDetail,
  type Provider,
  routes,
  sourceLabel,
  type SourceType,
  toDeepLink,
  truncateParam,
  type Urgency,
} from '@da/domain';
import { WidgetSnapshotV1 } from '@da/validation';
import type { z } from 'zod';
import { weakEtag } from '../../http/respond.ts';
import { type ServerLocale, translate } from '../../i18n/catalog.ts';

export type WidgetSnapshot = z.infer<typeof WidgetSnapshotV1>;

export interface OverviewInsight {
  readonly id: string;
  readonly kind: InsightKind;
  readonly urgency: Urgency;
  readonly title: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly due_at: string | null;
  readonly event_at: string | null;
  readonly created_at?: string | null;
  readonly source: {
    readonly source_type: SourceType;
    readonly provider: Provider | null;
    readonly source_timestamp: string;
  } | null;
}

export interface WidgetEvent {
  readonly id: string;
  readonly title: string | null;
  readonly start_at: string;
  readonly end_at: string;
}

export interface WidgetBriefingRow {
  readonly id: string;
  readonly kind: 'morning' | 'midday' | 'evening' | 'weekly';
  readonly status: string;
  readonly generated_at: string | null;
  readonly scheduled_for: string | null;
  readonly counts: Readonly<Record<string, unknown>>;
  readonly audio_duration_s: number | null;
}

export interface WidgetSources {
  installationBelongsToUser(installationId: string): Promise<boolean>;
  preferences(): Promise<{
    detail_level: NotificationDetail;
    lock_screen_private: boolean;
    timezone: string;
    locale: string;
  }>;
  isPro(): Promise<boolean>;
  overview(): Promise<{
    priorities: OverviewInsight[];
    follow_ups: { insight_id: string; entity_id: string; title: string; due_at: string | null }[];
    deadlines: unknown[];
  }>;
  eventsBetween(from: Date, to: Date): Promise<WidgetEvent[]>;
  preps(eventIds: readonly string[]): Promise<Record<string, { ready: boolean; topics: number }>>;
  briefing(localDate: string): Promise<WidgetBriefingRow | null>;
  sources(): Promise<{ connected: number; lastAnalysisAt: string | null }>;
}

const BADGE: Readonly<Record<string, WidgetSnapshot['priorities'][number]['badge']>> = {
  deadline: 'SON TARİH',
  meeting: 'TOPLANTI',
  conflict: 'TOPLANTI',
  follow_up: 'TAKİP',
  life_event: 'KİŞİSEL',
  security: 'GÜVENLİK',
};

function badgeOf(insight: OverviewInsight): WidgetSnapshot['priorities'][number]['badge'] {
  if (insight.kind === 'security') return 'GÜVENLİK';
  if (insight.urgency === 'urgent') return 'ACİL';
  return (
    BADGE[insight.kind] ?? (insight.entity_type === 'calendar_event' ? 'TOPLANTI' : 'SON TARİH')
  );
}

function privateTitle(
  badge: WidgetSnapshot['priorities'][number]['badge'],
  locale: ServerLocale,
): string {
  const key =
    badge === 'ACİL'
      ? 'widgets.private.urgent'
      : badge === 'GÜVENLİK'
        ? 'widgets.private.security'
        : badge === 'KİŞİSEL'
          ? 'widgets.private.personal'
          : badge === 'TOPLANTI'
            ? 'common.badges.meeting'
            : badge === 'TAKİP'
              ? 'common.badges.followUp'
              : 'widgets.private.deadline';
  return truncateParam(translate(locale, key), 40);
}

function minutesBetween(a: string, b: string): number {
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));
}

export async function buildWidgetSnapshot(
  sources: WidgetSources,
  input: { installationId: string | null; now: Date },
): Promise<WidgetSnapshot | 'not_found'> {
  if (
    input.installationId === null ||
    !(await sources.installationBelongsToUser(input.installationId))
  ) {
    return 'not_found';
  }
  const [prefs, isPro, overview, src] = await Promise.all([
    sources.preferences(),
    sources.isPro(),
    sources.overview(),
    sources.sources(),
  ]);
  const locale: ServerLocale = prefs.locale.toLowerCase().startsWith('en') ? 'en' : 'tr';
  const tz = prefs.timezone;
  const mode = prefs.detail_level;
  const full = mode === 'full';
  const titled = mode !== 'generic';
  const now = input.now;
  const today = localDate(now, tz);
  const dayEnd = new Date(now.getTime() + 36 * 3_600_000);

  const events = (await sources.eventsBetween(now, dayEnd)).filter(
    (e) => localDate(e.start_at, tz) === today || Date.parse(e.start_at) <= now.getTime(),
  );
  const preps =
    isPro && events.length > 0 ? await sources.preps(events.slice(0, 3).map((e) => e.id)) : {};
  const meeting = (e: WidgetEvent): WidgetSnapshot['later_meetings'][number] => {
    const minutes = minutesBetween(e.start_at, e.end_at);
    const prep = preps[e.id];
    return {
      event_id: e.id,
      start_at: new Date(e.start_at).toISOString(),
      end_at: new Date(e.end_at).toISOString(),
      time_label: formatTime(e.start_at, tz),
      duration_min: minutes,
      ...(full && e.title !== null ? { title_full: truncateParam(e.title, 60) } : {}),
      ...(titled
        ? {
            title_private: truncateParam(
              translate(locale, 'widgets.private.meeting', { minutes }),
              40,
            ),
          }
        : {}),
      prep_ready: isPro ? prep?.ready === true : false,
      prep_topic_count: isPro ? (prep?.ready === true ? prep.topics : null) : null,
      deeplink: toDeepLink(routes.meetingPrep(e.id)),
    };
  };

  const priorities = overview.priorities.slice(0, 3).map((insight) => {
    const badge = badgeOf(insight);
    const at = insight.due_at ?? insight.event_at;
    const label =
      titled && insight.source !== null
        ? truncateParam(
            sourceLabel({
              provider: insight.source.provider,
              sourceType: insight.source.source_type,
              at: insight.source.source_timestamp,
              timeZone: tz,
              now,
              locale,
            }),
            40,
          )
        : undefined;
    return {
      id: insight.id,
      badge,
      urgency: insight.urgency,
      ...(full ? { title_full: truncateParam(insight.title, 60) } : {}),
      ...(titled ? { title_private: privateTitle(badge, locale) } : {}),
      time_label: at === null ? null : formatTime(at, tz),
      ...(label === undefined ? {} : { source_label: label }),
      deeplink: deepLinkForInsight(insight),
    };
  });

  const followRow = overview.follow_ups[0];
  const waitingDays = (row: { due_at: string | null }) =>
    Math.max(
      0,
      Math.floor((now.getTime() - Date.parse(row.due_at ?? now.toISOString())) / 86_400_000),
    );
  const follow_up =
    followRow === undefined
      ? null
      : {
          thread_id: followRow.entity_id,
          insight_id: followRow.insight_id,
          ...(full ? { title_full: truncateParam(followRow.title, 60) } : {}),
          ...(titled
            ? {
                title_private: truncateParam(
                  translate(locale, 'widgets.private.followUp', { days: waitingDays(followRow) }),
                  40,
                ),
              }
            : {}),
          waiting_days: waitingDays(followRow),
          deeplink: toDeepLink(routes.followups(followRow.insight_id)),
        };

  const briefingRow = await sources.briefing(today);
  const briefingKind = briefingRow?.kind;
  const briefing =
    briefingRow === null ||
    briefingKind === undefined ||
    briefingKind === 'weekly' ||
    (!isPro && briefingKind !== 'morning') ||
    !['ready', 'delivered', 'scheduled', 'generating'].includes(briefingRow.status)
      ? null
      : {
          id: briefingRow.id,
          kind: briefingKind,
          status:
            briefingRow.status === 'delivered'
              ? ('ready' as const)
              : (briefingRow.status as 'ready' | 'scheduled' | 'generating'),
          ready_at:
            briefingRow.generated_at === null
              ? null
              : new Date(briefingRow.generated_at).toISOString(),
          scheduled_for:
            briefingRow.scheduled_for === null
              ? null
              : new Date(briefingRow.scheduled_for).toISOString(),
          time_label:
            briefingRow.scheduled_for === null ? null : formatTime(briefingRow.scheduled_for, tz),
          item_count: Object.values(briefingRow.counts).reduce<number>(
            (sum, v) =>
              sum + (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0),
            0,
          ),
          audio_minutes:
            isPro && briefingRow.audio_duration_s !== null
              ? Math.max(1, Math.round(briefingRow.audio_duration_s / 60))
              : null,
          deeplink: toDeepLink(routes.briefing(briefingRow.id)),
        };

  const upcoming = events.filter((e) => Date.parse(e.end_at) > now.getTime());
  const noSources = src.connected === 0;
  const body = {
    v: 1 as const,
    generated_at: now.toISOString(),
    locale,
    state: noSources ? ('no_sources' as const) : ('ok' as const),
    detail_mode: mode,
    lock_screen_private: prefs.lock_screen_private,
    entitlement: isPro ? ('pro' as const) : ('free' as const),
    counts: {
      important: overview.priorities.length,
      events_today: events.filter((e) => localDate(e.start_at, tz) === today).length,
      follow_ups: overview.follow_ups.length,
      deadlines: overview.deadlines.length,
    },
    briefing: noSources ? null : briefing,
    priorities: noSources ? [] : priorities,
    next_meeting: noSources || upcoming[0] === undefined ? null : meeting(upcoming[0]),
    later_meetings: noSources ? [] : upcoming.slice(1, 3).map(meeting),
    follow_up: noSources ? null : follow_up,
    last_analysis_at:
      src.lastAnalysisAt === null ? null : new Date(src.lastAnalysisAt).toISOString(),
  };
  const { generated_at: _generated, ...stable } = body;
  const etag = await weakEtag(stable);
  return WidgetSnapshotV1.parse({ ...body, etag });
}

/** The value hashed for the HTTP ETag (the snapshot without its generation time). */
export function stableSnapshot(snapshot: WidgetSnapshot): Omit<WidgetSnapshot, 'generated_at'> {
  const { generated_at: _generated, ...stable } = snapshot;
  return stable;
}
