import { z } from 'zod';
import { NOTIFICATION_DETAIL_VALUES, URGENCY_VALUES } from '@da/domain';
import { IsoDateTime, Uuid } from './api/common.ts';
import { utf8ByteLength } from './analytics-events.ts';

/*
 * WidgetSnapshotV1 (docs/SCREEN_AND_FLOW_MAP.md §11.2, INTEGRATION_PLAN §12.2, API-WDG-01). Rendered
 * server-side under the effective notification detail level: `generic` = counts only, `title_only` =
 * `title_private` (no names, subjects or amounts), `full` = `title_full` / `chip_full`. Title fields the
 * level does not allow are omitted, never blanked. Objects are strict, so a mail body, snippet, signed
 * URL or any other field can never be written into the App Group / Glance store.
 */

/** Widget deep links: `dijitalasistan://…` app routes only (never web or signed URLs). */
export const WidgetDeepLink = z
  .string()
  .max(200)
  .regex(/^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9/_\-?=&%.]*$/)
  .refine((link) => !/^https?:/i.test(link), 'web_links_not_allowed');

const MONEY_LIKE = /(₺|\$|€|£|\bTL\b|\bTRY\b|\bUSD\b|\bEUR\b)|\d[\d.]*,\d{2}\b/i;
const CONTACT_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+|https?:\/\/|www\./i;

/** Private titles never carry amounts or contact details (category + time/duration only). */
const PrivateTitle = z
  .string()
  .max(40)
  .refine(
    (value) => !MONEY_LIKE.test(value) && !CONTACT_LIKE.test(value),
    'private_title_leaks_content',
  );
const FullTitle = z.string().max(60);

export const WidgetBadge = z.enum([
  'ACİL',
  'SON TARİH',
  'TOPLANTI',
  'TAKİP',
  'KİŞİSEL',
  'GÜVENLİK',
]);

export const MeetingEntry = z.strictObject({
  event_id: Uuid,
  start_at: IsoDateTime,
  end_at: IsoDateTime,
  time_label: z.string().max(40),
  duration_min: z.int().min(0),
  title_full: FullTitle.optional(),
  title_private: PrivateTitle.optional(),
  prep_ready: z.boolean(),
  prep_topic_count: z.int().min(0).nullable(),
  deeplink: WidgetDeepLink,
});
export type MeetingEntry = z.infer<typeof MeetingEntry>;

export const WidgetPriority = z.strictObject({
  id: Uuid,
  badge: WidgetBadge,
  urgency: z.enum(URGENCY_VALUES),
  title_full: FullTitle.optional(),
  chip_full: z.string().max(24).optional(),
  title_private: PrivateTitle.optional(),
  time_label: z.string().max(40).nullable(),
  source_label: z.string().max(40).optional(),
  deeplink: WidgetDeepLink,
});

export const WidgetBriefing = z.strictObject({
  id: Uuid,
  kind: z.enum(['morning', 'midday', 'evening']),
  status: z.enum(['ready', 'scheduled', 'generating']),
  ready_at: IsoDateTime.nullable(),
  scheduled_for: IsoDateTime.nullable(),
  time_label: z.string().max(40).nullable(),
  item_count: z.int().min(0),
  audio_minutes: z.int().min(0).nullable(),
  deeplink: WidgetDeepLink,
});

export const WidgetFollowUp = z.strictObject({
  thread_id: Uuid,
  insight_id: Uuid,
  title_full: FullTitle.optional(),
  title_private: PrivateTitle.optional(),
  waiting_days: z.int().min(0),
  deeplink: WidgetDeepLink,
});

/** Maximum serialized size of a snapshot (§11.2). */
export const WIDGET_SNAPSHOT_MAX_BYTES = 8 * 1024;

interface TitledEntry {
  title_full?: string | undefined;
  chip_full?: string | undefined;
  title_private?: string | undefined;
  source_label?: string | undefined;
}

export const WidgetSnapshotV1 = z
  .strictObject({
    v: z.literal(1),
    etag: z.string().max(128),
    generated_at: IsoDateTime,
    locale: z.enum(['tr', 'en']),
    state: z.enum(['ok', 'signed_out', 'no_sources', 'stale']),
    detail_mode: z.enum(NOTIFICATION_DETAIL_VALUES),
    lock_screen_private: z.boolean(),
    entitlement: z.enum(['free', 'pro']),
    counts: z.strictObject({
      important: z.int().min(0),
      events_today: z.int().min(0),
      follow_ups: z.int().min(0),
      deadlines: z.int().min(0),
    }),
    briefing: WidgetBriefing.nullable(),
    priorities: z.array(WidgetPriority).max(3),
    next_meeting: MeetingEntry.nullable(),
    later_meetings: z.array(MeetingEntry).max(2),
    follow_up: WidgetFollowUp.nullable(),
    last_analysis_at: IsoDateTime.nullable(),
  })
  .superRefine((snapshot, ctx) => {
    const titled: [TitledEntry, (string | number)[]][] = [
      ...snapshot.priorities.map((p, i): [TitledEntry, (string | number)[]] => [
        p,
        ['priorities', i],
      ]),
      ...(snapshot.next_meeting
        ? [[snapshot.next_meeting, ['next_meeting']] as [TitledEntry, string[]]]
        : []),
      ...snapshot.later_meetings.map((m, i): [TitledEntry, (string | number)[]] => [
        m,
        ['later_meetings', i],
      ]),
      ...(snapshot.follow_up
        ? [[snapshot.follow_up, ['follow_up']] as [TitledEntry, string[]]]
        : []),
    ];
    for (const [entry, path] of titled) {
      const full = entry.title_full !== undefined || entry.chip_full !== undefined;
      if (snapshot.detail_mode !== 'full' && full) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'title_full'],
          message: 'title_full_not_allowed',
        });
      }
      if (snapshot.detail_mode === 'generic') {
        if (entry.title_private !== undefined || entry.source_label !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'title_private'],
            message: 'generic_counts_only',
          });
        }
      } else if (entry.title_private === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'title_private'],
          message: 'title_private_required',
        });
      }
    }
    if (snapshot.entitlement === 'free') {
      if (snapshot.briefing !== null && snapshot.briefing.audio_minutes !== null) {
        ctx.addIssue({ code: 'custom', path: ['briefing', 'audio_minutes'], message: 'pro_only' });
      }
      if (snapshot.briefing !== null && snapshot.briefing.kind !== 'morning') {
        ctx.addIssue({ code: 'custom', path: ['briefing', 'kind'], message: 'pro_only' });
      }
      [snapshot.next_meeting, ...snapshot.later_meetings].forEach((meeting, i) => {
        if (meeting !== null && (meeting.prep_ready || meeting.prep_topic_count !== null)) {
          ctx.addIssue({
            code: 'custom',
            path: i === 0 ? ['next_meeting'] : ['later_meetings', i - 1],
            message: 'pro_only',
          });
        }
      });
    }
    if (snapshot.state === 'signed_out' || snapshot.state === 'no_sources') {
      const empty =
        snapshot.briefing === null &&
        snapshot.priorities.length === 0 &&
        snapshot.next_meeting === null &&
        snapshot.later_meetings.length === 0 &&
        snapshot.follow_up === null;
      if (!empty)
        ctx.addIssue({ code: 'custom', path: ['state'], message: 'state_requires_empty_snapshot' });
    }
    if (utf8ByteLength(JSON.stringify(snapshot)) > WIDGET_SNAPSHOT_MAX_BYTES) {
      ctx.addIssue({ code: 'custom', path: [], message: 'snapshot_too_large' });
    }
  });
export type WidgetSnapshotV1 = z.infer<typeof WidgetSnapshotV1>;

/**
 * Re-filters a cached snapshot when the user lowers the detail level offline (§11.2): `title_only`
 * drops `title_full` / `chip_full`; `generic` drops every title and source label. Raising the level
 * needs the next online fetch, so a higher target level returns the snapshot unchanged.
 */
export function downgradeWidgetSnapshot(
  snapshot: WidgetSnapshotV1,
  level: z.infer<typeof WidgetSnapshotV1>['detail_mode'],
): WidgetSnapshotV1 {
  const rank = { generic: 0, title_only: 1, full: 2 } as const;
  if (rank[level] >= rank[snapshot.detail_mode]) return snapshot;
  const strip = <T extends TitledEntry>(entry: T): T => {
    const { title_full: _full, chip_full: _chip, ...rest } = entry;
    if (level === 'generic') {
      const { title_private: _private, source_label: _source, ...bare } = rest;
      return bare as T;
    }
    return rest as T;
  };
  return {
    ...snapshot,
    detail_mode: level,
    priorities: snapshot.priorities.map(strip),
    next_meeting: snapshot.next_meeting ? strip(snapshot.next_meeting) : null,
    later_meetings: snapshot.later_meetings.map(strip),
    follow_up: snapshot.follow_up ? strip(snapshot.follow_up) : null,
  };
}

/** The snapshot the app writes locally at sign-out or account deletion (no call, §11.4). */
export function signedOutWidgetSnapshot(now: Date, locale: 'tr' | 'en'): WidgetSnapshotV1 {
  return {
    v: 1,
    etag: 'signed_out',
    generated_at: now.toISOString(),
    locale,
    state: 'signed_out',
    detail_mode: 'generic',
    lock_screen_private: true,
    entitlement: 'free',
    counts: { important: 0, events_today: 0, follow_ups: 0, deadlines: 0 },
    briefing: null,
    priorities: [],
    next_meeting: null,
    later_meetings: [],
    follow_up: null,
    last_analysis_at: null,
  };
}
