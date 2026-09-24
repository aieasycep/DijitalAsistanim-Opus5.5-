/**
 * Insight builder (IMPLEMENTATION_PLAN T-5.05; JOB-12; AI_PIPELINE_PLAN §7.6–§7.7; M§8, M§13, M§20).
 *
 * A deterministic recompute over the user's current rows: mail analysis (reply needed, deadlines),
 * calendar intelligence (conflicts, back-to-back runs, prep needs, free-slot schedule suggestions
 * for Pro), tasks due, follow-up aging (amber 3 d / coral 7 d), commitments, life events, security
 * and the pending-approval digest. Every insight has a stable dedupe key, provenance (source +
 * verified evidence where the source has it), an urgency, a card type, one or two actions
 * (SREQ-89) and an explainability line. Dismissed items and dismissed suppression keys are never
 * recreated; done/dismissed/expired rows are never reopened; open/snoozed rows whose source no
 * longer qualifies are expired. Rebuilding with the same rows yields the same upserts.
 */
import {
  type BusyInterval,
  conflictPairKey,
  type DecisionTier,
  detectBackToBack,
  detectConflicts,
  findFreeSlots,
  type FlowCardType,
  type InsightAction,
  insightDedupeKey,
  type InsightKind,
  type IntelContext,
  type IntelEvent,
  localDate,
  localDateDiffDays,
  type NotificationCategory,
  notificationDedupeKey,
  prepNeed,
  routeForNotification,
  routes,
  type SourceType,
  type StoredEvidence,
  toDeepLink,
  type Urgency,
  waitBadge,
} from '@da/domain';
import { ageFollowUp } from '../followups.ts';
import {
  clip,
  copy,
  type CopyLocale,
  formatDay,
  formatDue,
  formatTime,
  withCases,
} from '../copy.ts';
import type { InsightSnapshot } from '../intel/store.ts';
import type {
  CalendarEventRow,
  InsightRow,
  InsightUpsert,
  MailThreadRow,
  ThreadPatch,
} from '../intel/types.ts';
import { kindWhy } from './explain.ts';
import { rankScore } from './rank.ts';

export type InsightScope = 'mail' | 'calendar' | 'tasks' | 'life' | 'followups' | 'all';

export interface BuildContext {
  readonly userId: string;
  readonly locale: CopyLocale;
  readonly timeZone: string;
  readonly now: Date;
  readonly isPro: boolean;
  readonly followUpAfterDays: number;
  readonly workingHours: { readonly start: string; readonly end: string; readonly days: number[] };
  readonly scope: InsightScope;
}

/** JOB-18 `build` payload (B's notification pipeline makes the send decision). */
export interface NotificationBuild {
  readonly category: NotificationCategory;
  readonly dedupe_key: string;
  readonly entity: { readonly type: SourceType; readonly id: string } | null;
  readonly deeplink: string;
  readonly template_key: string;
  readonly params_public: Record<string, string | number>;
  readonly params_sensitive: Record<string, string>;
  readonly urgency: Urgency;
  readonly time_sensitive: boolean;
  readonly vip: boolean;
  /** `life_intel` from an Android notification signal: channel `phone_digest` (R-12). */
  readonly from_android_signal?: boolean;
}

export interface BuildResult {
  readonly upserts: InsightUpsert[];
  readonly expire: string[];
  readonly threadPatches: { id: string; patch: ThreadPatch }[];
  readonly notifications: NotificationBuild[];
}

const SCOPE_KINDS: Readonly<Record<Exclude<InsightScope, 'all'>, readonly string[]>> = {
  mail: ['reply_needed:email_thread', 'deadline:email_thread'],
  calendar: [
    'conflict:calendar_event',
    'meeting:calendar_event',
    'schedule_suggestion:commitment',
    'schedule_suggestion:task',
  ],
  tasks: ['deadline:task', 'schedule_suggestion:task'],
  life: ['life_event:life_event', 'security:life_event'],
  followups: ['follow_up:email_thread', 'commitment:commitment'],
};

/** Whether an existing insight is produced (and so may be expired) by this scope's rebuild. */
export function ownedByScope(kind: InsightKind, entityType: string, scope: InsightScope): boolean {
  if (kind === 'approval_pending') return true;
  const key = `${kind}:${entityType}`;
  if (scope === 'all') return Object.values(SCOPE_KINDS).some((list) => list.includes(key));
  return SCOPE_KINDS[scope].includes(key);
}

const inScope = (scope: InsightScope, part: Exclude<InsightScope, 'all'>): boolean =>
  scope === 'all' || scope === part;

const action = (type: string, target: string | null, approval = false): InsightAction => ({
  action_type: type,
  target_id: target,
  requires_approval: approval,
});

interface Candidate extends Omit<InsightUpsert, 'rank_score'> {
  readonly importanceHigh: boolean;
  readonly vip: boolean;
  readonly notify?: Omit<NotificationBuild, 'dedupe_key' | 'deeplink'> & {
    readonly localDate: string;
  };
}

function epochKey(iso: string | null): string {
  return iso === null ? 'none' : String(Math.trunc(Date.parse(iso) / 1000));
}

function dayDiff(ctx: BuildContext, at: string | Date): number {
  return localDateDiffDays(localDate(ctx.now, ctx.timeZone), localDate(at, ctx.timeZone));
}

/** Urgency of a due/start time: ≤3 h urgent, today today, else normal. */
function urgencyFor(ctx: BuildContext, at: string | null, fallback: Urgency = 'normal'): Urgency {
  if (at === null) return fallback;
  const diff = Date.parse(at) - ctx.now.getTime();
  if (diff <= 3 * 3_600_000) return 'urgent';
  return dayDiff(ctx, at) <= 0 ? 'today' : fallback;
}

function isVip(
  snap: InsightSnapshot,
  ctx: BuildContext,
  email: string | null | undefined,
): boolean {
  if (!ctx.isPro || email === null || email === undefined) return false;
  return snap.vip.emails.some((e) => e.toLowerCase() === email.toLowerCase());
}

function counterpartOf(
  thread: MailThreadRow,
  own: readonly string[],
): { email: string; name: string } | null {
  const mine = new Set(own.map((o) => o.toLowerCase()));
  const p = thread.participants.find((x) => !mine.has(x.email.toLowerCase()));
  return p === undefined ? null : { email: p.email, name: p.name ?? p.email };
}

// ── Mail ─────────────────────────────────────────────────────────────────────

function mailCandidates(snap: InsightSnapshot, ctx: BuildContext): Candidate[] {
  const l = ctx.locale;
  const out: Candidate[] = [];
  const latest = new Map(snap.latestInbound.map((m) => [m.thread_id, m]));
  for (const t of snap.threads) {
    if (t.is_muted) continue;
    const m = latest.get(t.id);
    if (t.reply_state === 'awaiting_my_reply' && m !== undefined && t.category !== 'low_priority') {
      const vip = isVip(snap, ctx, m.from_email);
      const urgency: Urgency = t.urgency ?? (vip ? 'today' : 'normal');
      const tier: DecisionTier = t.category_tier ?? m.classification_tier ?? 'deterministic_signal';
      const sender = m.from_name ?? m.from_email;
      const subject = t.subject ?? m.subject ?? '';
      const kp = (m.key_points as { evidence?: StoredEvidence[] }[])[0]?.evidence ?? [];
      out.push({
        user_id: ctx.userId,
        kind: 'reply_needed',
        urgency,
        title: clip(
          copy(l, 'flow.generated.insight.replyNeeded.title', { sender: clip(sender, 60) }),
          200,
        ),
        body: clip(m.ai_summary ?? subject, 600) || null,
        why_important: clip(
          m.classification_reason ??
            t.category_reason ??
            copy(l, 'flow.generated.why.signal.awaiting_my_reply'),
          300,
        ),
        decision_tier: tier,
        reason_code:
          tier === 'explicit_rule'
            ? 'rule_reply_needed'
            : tier === 'ai_classification'
              ? 'ai_reply_needed'
              : 'awaiting_my_reply',
        rule_id: t.category_rule_id ?? m.classification_rule_id,
        learned_preference_id: null,
        entity_type: 'email_thread',
        entity_id: t.id,
        flow_card_type: 'email',
        actions: [action('reply_draft', m.id, true), action('open_source', m.id)],
        due_at: null,
        event_at: null,
        suppression_key: null,
        dedupe_key: insightDedupeKey({
          kind: 'reply_needed',
          entityType: 'email_thread',
          entityId: t.id,
          discriminator: m.id,
        }),
        source_type: 'email_message',
        source_id: m.id,
        source_provider: m.provider,
        source_timestamp: m.received_at,
        confidence:
          Math.round((m.classification_confidence ?? t.category_confidence ?? 0.8) * 1000) / 1000,
        evidence: kp.slice(0, 5),
        importanceHigh: t.category === 'important' || urgency === 'urgent' || urgency === 'today',
        vip,
        ...(urgency === 'urgent' || urgency === 'today' || vip || tier === 'explicit_rule'
          ? {
              notify: {
                category: 'critical_email' as const,
                entity: { type: 'email_thread' as const, id: t.id },
                template_key: vip
                  ? 'critical_email.vip'
                  : tier === 'explicit_rule'
                    ? 'critical_email.rule'
                    : 'critical_email.reply_needed',
                params_public: {},
                params_sensitive: {
                  sender: clip(sender, 60),
                  vipName: clip(sender, 60),
                  subject: clip(subject, 80),
                  expectedAction: clip(m.ai_summary ?? subject, 120),
                  ruleName: clip(t.category_reason ?? '', 80),
                },
                urgency,
                time_sensitive: urgency === 'urgent',
                vip,
                localDate: localDate(ctx.now, ctx.timeZone),
              },
            }
          : {}),
      });
    }
    if (t.deadline_at !== null) {
      const diffMs = Date.parse(t.deadline_at) - ctx.now.getTime();
      if (diffMs < -2 * 3_600_000 || diffMs > 7 * 86_400_000) continue;
      const urgency = urgencyFor(ctx, t.deadline_at);
      const due = formatDue(l, t.deadline_at, ctx.timeZone, false);
      const what = clip(t.topic_label ?? t.subject ?? '', 80);
      out.push({
        user_id: ctx.userId,
        kind: 'deadline',
        urgency,
        title: clip(copy(l, 'flow.generated.insight.deadline.title', { what }), 200),
        body: clip(copy(l, 'flow.generated.insight.deadline.body', { due }), 600),
        why_important: kindWhy(l, 'deadline', { due }),
        decision_tier: 'deterministic_signal',
        reason_code: dayDiff(ctx, t.deadline_at) <= 0 ? 'deadline_today' : 'deadline_upcoming',
        rule_id: null,
        learned_preference_id: null,
        entity_type: 'email_thread',
        entity_id: t.id,
        flow_card_type: 'deadline',
        actions: [action('open_source', t.id), action('remind', t.id, true)],
        due_at: t.deadline_at,
        event_at: null,
        suppression_key: null,
        dedupe_key: insightDedupeKey({
          kind: 'deadline',
          entityType: 'email_thread',
          entityId: t.id,
          discriminator: epochKey(t.deadline_at),
        }),
        source_type: 'email_thread',
        source_id: t.id,
        source_provider: t.provider,
        source_timestamp: t.last_message_at,
        confidence: (t.deadline_evidence ?? []).length > 0 ? 0.85 : 0.7,
        evidence: (t.deadline_evidence ?? []).slice(0, 5),
        importanceHigh: true,
        vip: false,
        ...(dayDiff(ctx, t.deadline_at) === 0 && diffMs > 0
          ? {
              notify: {
                category: 'deadline' as const,
                entity: { type: 'email_thread' as const, id: t.id },
                template_key: 'deadline.due_soon',
                params_public: withCases({ time: formatTime(t.deadline_at, ctx.timeZone) }),
                params_sensitive: { title: what },
                urgency,
                time_sensitive: urgency === 'urgent',
                vip: false,
                localDate: localDate(ctx.now, ctx.timeZone),
              },
            }
          : {}),
      });
    }
  }
  return out;
}

// ── Follow-ups and commitments ───────────────────────────────────────────────

function followUpCandidates(
  snap: InsightSnapshot,
  ctx: BuildContext,
  patches: { id: string; patch: ThreadPatch }[],
): Candidate[] {
  const l = ctx.locale;
  const out: Candidate[] = [];
  const muted = new Set(snap.mutedContacts.map((e) => e.toLowerCase()));
  for (const t of snap.threads) {
    if (t.reply_state !== 'awaiting_their_reply' || t.awaiting_since === null) continue;
    const person = counterpartOf(t, snap.ownAddresses);
    const vip = isVip(snap, ctx, person?.email);
    const isMuted = t.is_muted || (person !== null && muted.has(person.email.toLowerCase()));
    const aged = ageFollowUp(t, ctx.now, ctx.timeZone, ctx.followUpAfterDays, vip, isMuted);
    if (aged.state !== t.follow_up_state)
      patches.push({ id: t.id, patch: { follow_up_state: aged.state } });
    if (aged.state !== 'nudge_due') continue;
    const badge = waitBadge(aged.days);
    const name = clip(person?.name ?? '', 60) || 'none';
    const subject = clip(t.topic_label ?? t.subject ?? '', 80);
    out.push({
      user_id: ctx.userId,
      kind: 'follow_up',
      urgency: badge === 'coral' ? 'today' : 'normal',
      title: clip(copy(l, 'flow.generated.insight.followUp.title', { person: name }), 200),
      body: clip(
        copy(l, 'flow.generated.insight.followUp.body', { days: aged.days, subject }),
        600,
      ),
      why_important: kindWhy(l, 'follow_up', { days: aged.days }),
      decision_tier: 'deterministic_signal',
      reason_code:
        badge === 'coral'
          ? 'follow_up_overdue'
          : badge === 'amber'
            ? 'follow_up_waiting'
            : 'follow_up_due',
      rule_id: null,
      learned_preference_id: null,
      entity_type: 'email_thread',
      entity_id: t.id,
      flow_card_type: 'follow_up',
      actions: [action('follow_up_draft', t.id, true), action('remind', t.id, true)],
      due_at: null,
      event_at: null,
      suppression_key: null,
      dedupe_key: insightDedupeKey({
        kind: 'follow_up',
        entityType: 'email_thread',
        entityId: t.id,
        discriminator: epochKey(t.awaiting_since),
      }),
      source_type: 'email_thread',
      source_id: t.id,
      source_provider: t.provider,
      source_timestamp: t.awaiting_since,
      confidence: 0.9,
      evidence: [],
      importanceHigh: badge === 'coral',
      vip,
      notify: {
        category: 'follow_up',
        entity: { type: 'email_thread', id: t.id },
        template_key: 'follow_up.no_reply',
        params_public: { days: aged.days },
        params_sensitive: { person: name === 'none' ? '' : name, subject },
        urgency: badge === 'coral' ? 'today' : 'normal',
        time_sensitive: false,
        vip,
        localDate: localDate(ctx.now, ctx.timeZone),
      },
    });
  }
  for (const c of snap.commitments) {
    if (c.status !== 'open') continue;
    if (c.due_at === null) continue;
    const diff = Date.parse(c.due_at) - ctx.now.getTime();
    if (diff > 2 * 86_400_000) continue;
    const due = formatDue(l, c.due_at, ctx.timeZone, c.due_is_date_only);
    const mine = c.direction === 'user_owes';
    const name = clip(c.counterparty_name ?? '', 60) || 'none';
    const urgency: Urgency = diff < 0 || dayDiff(ctx, c.due_at) <= 0 ? 'today' : 'normal';
    out.push({
      user_id: ctx.userId,
      kind: 'commitment',
      urgency,
      title: clip(
        mine
          ? copy(l, 'flow.generated.insight.commitment.userTitle', { text: clip(c.text, 120) })
          : copy(l, 'flow.generated.insight.commitment.theyTitle', {
              name,
              text: clip(c.text, 120),
            }),
        200,
      ),
      body: clip(copy(l, 'flow.generated.insight.commitment.body', { due }), 600),
      why_important: mine ? kindWhy(l, 'commitment_user') : kindWhy(l, 'commitment_they', { name }),
      decision_tier: 'deterministic_signal',
      reason_code: diff < 0 ? 'commitment_overdue' : 'commitment_due',
      rule_id: null,
      learned_preference_id: null,
      entity_type: 'commitment',
      entity_id: c.id,
      flow_card_type: 'commitment',
      actions: mine
        ? [action('complete', c.id), action('remind', c.id, true)]
        : [action('follow_up_draft', c.id, true), action('complete', c.id)],
      due_at: c.due_at,
      event_at: null,
      suppression_key: null,
      dedupe_key: insightDedupeKey({
        kind: 'commitment',
        entityType: 'commitment',
        entityId: c.id,
        discriminator: epochKey(c.due_at),
      }),
      source_type: c.source_type,
      source_id: c.source_id,
      source_provider: c.source_provider,
      source_timestamp: c.source_timestamp,
      confidence: c.confidence,
      evidence: c.evidence.slice(0, 5),
      importanceHigh: mine,
      vip: false,
      ...(mine && dayDiff(ctx, c.due_at) === 0 && diff > 0
        ? {
            notify: {
              category: 'deadline' as const,
              entity: { type: 'commitment' as const, id: c.id },
              template_key: 'deadline.commitment_due',
              params_public: { time: formatTime(c.due_at, ctx.timeZone) },
              params_sensitive: { commitment: clip(c.text, 80) },
              urgency,
              time_sensitive: false,
              vip: false,
              localDate: localDate(ctx.now, ctx.timeZone),
            },
          }
        : {}),
    });
  }
  return out;
}

// ── Calendar and tasks ───────────────────────────────────────────────────────

function toIntel(e: CalendarEventRow): IntelEvent {
  return {
    id: e.id,
    start: e.start_at,
    end: e.end_at,
    allDay: e.all_day,
    status: e.status,
    attendees: e.attendees.flatMap((a) =>
      a.email === undefined
        ? []
        : [
            {
              email: a.email,
              self: a.self === true,
              contactId: a.contact_id ?? null,
              response: (a.response ?? null) as
                'accepted' | 'declined' | 'tentative' | 'needs_action' | null,
            },
          ],
    ),
    organizerSelf: e.organizer_self,
    canModify: e.can_modify,
    location: e.location,
    isOnline: e.is_online,
  };
}

function calendarCandidates(snap: InsightSnapshot, ctx: BuildContext): Candidate[] {
  const l = ctx.locale;
  const out: Candidate[] = [];
  const horizon = ctx.now.getTime() + 7 * 86_400_000;
  const upcoming = snap.events.filter(
    (e) =>
      e.status !== 'cancelled' &&
      Date.parse(e.end_at) > ctx.now.getTime() &&
      Date.parse(e.start_at) < horizon,
  );
  const byId = new Map(upcoming.map((e) => [e.id, e]));
  const intel = upcoming.map(toIntel);
  const intelCtx: IntelContext = {
    timeZone: ctx.timeZone,
    ownDomains: snap.ownDomains,
    vipContactIds: snap.vip.contactIds,
    vipEmails: snap.vip.emails,
    isPro: ctx.isPro,
  };
  const eventProvenance = (e: CalendarEventRow) => ({
    source_type: (e.provider === 'apple_device' || e.provider === 'android_device'
      ? 'device_calendar_event'
      : 'calendar_event') as SourceType,
    source_id: e.id,
    source_provider: e.provider,
    source_timestamp: e.updated_at,
  });
  for (const c of detectConflicts(intel)) {
    const a = byId.get(c.a);
    const b = byId.get(c.b);
    if (a === undefined || b === undefined) continue;
    const [first, second] = Date.parse(a.start_at) <= Date.parse(b.start_at) ? [a, b] : [b, a];
    const params = {
      timeA: formatTime(first.start_at, ctx.timeZone),
      eventA: clip(first.title ?? '', 60),
      timeB: formatTime(second.start_at, ctx.timeZone),
      eventB: clip(second.title ?? '', 60),
    };
    const movable = c.movable[0] ?? null;
    const pair = conflictPairKey(
      { id: first.id, startEpoch: Date.parse(first.start_at) / 1000 },
      { id: second.id, startEpoch: Date.parse(second.start_at) / 1000 },
    );
    const soon = Date.parse(first.start_at) - ctx.now.getTime() < 2 * 86_400_000;
    out.push({
      user_id: ctx.userId,
      kind: 'conflict',
      urgency: urgencyFor(ctx, first.start_at, 'normal'),
      title: clip(copy(l, 'flow.generated.insight.conflict.title'), 200),
      body: clip(copy(l, 'flow.generated.insight.conflict.body', params), 600),
      why_important: kindWhy(l, 'conflict'),
      decision_tier: 'deterministic_signal',
      reason_code: 'calendar_conflict',
      rule_id: null,
      learned_preference_id: null,
      entity_type: 'calendar_event',
      entity_id: first.id,
      flow_card_type: 'meeting',
      actions:
        movable === null
          ? [action('open_event', first.id), action('open_event', second.id)]
          : [action('calendar_update', movable, true), action('keep_both', first.id)],
      due_at: null,
      event_at: first.start_at,
      suppression_key: c.suppressionKey,
      dedupe_key: insightDedupeKey({
        kind: 'conflict',
        entityType: 'calendar_event',
        entityId: first.id,
        discriminator: pair,
      }),
      ...eventProvenance(first),
      confidence: 0.95,
      evidence: [],
      importanceHigh: true,
      vip: false,
      ...(soon
        ? {
            notify: {
              category: 'meeting' as const,
              entity: { type: eventProvenance(first).source_type, id: first.id },
              template_key: 'meeting.conflict',
              params_public: {
                day: formatDay(l, first.start_at, ctx.timeZone),
                timeA: params.timeA,
                timeB: params.timeB,
              },
              params_sensitive: { eventA: params.eventA, eventB: params.eventB },
              urgency: urgencyFor(ctx, first.start_at, 'normal'),
              time_sensitive: false,
              vip: false,
              localDate: localDate(ctx.now, ctx.timeZone),
            },
          }
        : {}),
    });
  }
  const twoDays = intel.filter((e) => {
    const row = byId.get(e.id);
    return row !== undefined && dayDiff(ctx, row.start_at) <= 1;
  });
  for (const run of detectBackToBack(twoDays, ctx.timeZone)) {
    const first = byId.get(run.eventIds[0] ?? '');
    if (first === undefined || run.eventIds.length < 3) continue;
    out.push({
      user_id: ctx.userId,
      kind: 'meeting',
      urgency: dayDiff(ctx, first.start_at) <= 0 ? 'today' : 'normal',
      title: clip(
        copy(l, 'flow.generated.insight.backToBack.title', { count: run.eventIds.length }),
        200,
      ),
      body: clip(
        copy(l, 'flow.generated.insight.backToBack.body', {
          day: formatDay(l, first.start_at, ctx.timeZone),
          gap: run.minGapMinutes,
        }),
        600,
      ),
      why_important: kindWhy(l, 'back_to_back'),
      decision_tier: 'deterministic_signal',
      reason_code: 'back_to_back',
      rule_id: null,
      learned_preference_id: null,
      entity_type: 'calendar_event',
      entity_id: first.id,
      flow_card_type: 'meeting',
      actions: [action('open_event', first.id), action('plan_break', first.id, true)],
      due_at: null,
      event_at: first.start_at,
      suppression_key: `back_to_back:${run.localDate}`,
      dedupe_key: insightDedupeKey({
        kind: 'meeting',
        entityType: 'calendar_event',
        entityId: first.id,
        discriminator: `b2b:${run.localDate}:${run.eventIds.length}`,
      }),
      ...eventProvenance(first),
      confidence: 0.95,
      evidence: [],
      importanceHigh: false,
      vip: false,
    });
  }
  for (const e of twoDays) {
    const row = byId.get(e.id);
    if (row === undefined || Date.parse(row.start_at) < ctx.now.getTime()) continue;
    const need = prepNeed(e, intelCtx);
    if (!need.needed) continue;
    const vipReason = need.reasons.includes('vip_attendee');
    out.push({
      user_id: ctx.userId,
      kind: 'meeting',
      urgency: urgencyFor(ctx, row.start_at, 'normal'),
      title: clip(
        copy(l, 'flow.generated.insight.prep.title', { event: clip(row.title ?? '', 80) }),
        200,
      ),
      body: clip(
        copy(l, 'flow.generated.insight.prep.body', {
          time: formatDue(l, row.start_at, ctx.timeZone, false),
          reason: vipReason ? 'vip' : 'external',
        }),
        600,
      ),
      why_important: kindWhy(l, 'meeting_prep'),
      decision_tier: 'deterministic_signal',
      reason_code: vipReason ? 'meeting_prep_vip' : 'meeting_prep',
      rule_id: null,
      learned_preference_id: null,
      entity_type: 'calendar_event',
      entity_id: row.id,
      flow_card_type: 'meeting',
      actions: [action('meeting_prep', row.id), action('open_event', row.id)],
      due_at: null,
      event_at: row.start_at,
      suppression_key: null,
      dedupe_key: insightDedupeKey({
        kind: 'meeting',
        entityType: 'calendar_event',
        entityId: row.id,
        discriminator: `prep:${epochKey(row.start_at)}`,
      }),
      ...eventProvenance(row),
      confidence: 0.9,
      evidence: [],
      importanceHigh: vipReason,
      vip: vipReason,
    });
  }
  return out;
}

function taskCandidates(snap: InsightSnapshot, ctx: BuildContext): Candidate[] {
  const l = ctx.locale;
  const out: Candidate[] = [];
  for (const t of snap.tasks) {
    if (t.status !== 'open') continue;
    const dueIso = t.due_at ?? (t.due_date === null ? null : `${t.due_date}T15:00:00.000Z`);
    if (dueIso === null) continue;
    const days =
      t.due_at !== null
        ? dayDiff(ctx, t.due_at)
        : localDateDiffDays(localDate(ctx.now, ctx.timeZone), t.due_date!);
    if (days > 1) continue;
    const due =
      t.due_at !== null
        ? formatDue(l, t.due_at, ctx.timeZone, false)
        : formatDay(l, dueIso, ctx.timeZone);
    out.push({
      user_id: ctx.userId,
      kind: 'deadline',
      urgency: days <= 0 ? 'today' : 'normal',
      title: clip(copy(l, 'flow.generated.insight.task.title', { title: clip(t.title, 120) }), 200),
      body: clip(copy(l, 'flow.generated.insight.deadline.body', { due }), 600),
      why_important: kindWhy(l, 'task_due'),
      decision_tier: 'deterministic_signal',
      reason_code: days < 0 ? 'task_overdue' : 'task_due',
      rule_id: null,
      learned_preference_id: null,
      entity_type: 'task',
      entity_id: t.id,
      flow_card_type: 'deadline',
      actions: [action('complete', t.id), action('remind', t.id, true)],
      due_at: t.due_at ?? dueIso,
      event_at: null,
      suppression_key: null,
      dedupe_key: insightDedupeKey({
        kind: 'deadline',
        entityType: 'task',
        entityId: t.id,
        discriminator: t.due_at === null ? (t.due_date ?? 'none') : epochKey(t.due_at),
      }),
      source_type: 'task',
      source_id: t.id,
      source_provider: t.provider,
      source_timestamp: t.created_at,
      confidence: 1,
      evidence: [],
      importanceHigh: days <= 0,
      vip: false,
    });
  }
  return out;
}

/** Pro: a free slot before a due own commitment or task → `schedule_suggestion` (≤2). */
function scheduleCandidates(snap: InsightSnapshot, ctx: BuildContext): Candidate[] {
  if (!ctx.isPro) return [];
  const l = ctx.locale;
  const busy: BusyInterval[] = snap.events.map((e) => ({
    start: e.start_at,
    end: e.end_at,
    cancelled: e.status === 'cancelled',
    allDay: e.all_day,
  }));
  const targets = [
    ...snap.commitments
      .filter((c) => c.status === 'open' && c.direction === 'user_owes' && c.due_at !== null)
      .map((c) => ({
        type: 'commitment' as const,
        id: c.id,
        title: c.text,
        due: c.due_at!,
        prov: c,
      })),
    ...snap.tasks
      .filter((t) => t.status === 'open' && t.due_at !== null)
      .map((t) => ({
        type: 'task' as const,
        id: t.id,
        title: t.title,
        due: t.due_at!,
        prov: null,
      })),
  ]
    .filter((x) => {
      const d = Date.parse(x.due) - ctx.now.getTime();
      return d > 2 * 3_600_000 && d < 3 * 86_400_000;
    })
    .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
    .slice(0, 2);
  const out: Candidate[] = [];
  for (const t of targets) {
    const slot = findFreeSlots({
      now: ctx.now,
      timeZone: ctx.timeZone,
      busy,
      workingHours: {
        start: ctx.workingHours.start,
        end: ctx.workingHours.end,
        days: ctx.workingHours.days,
      },
      minMinutes: 30,
      before: t.due,
      horizonDays: 3,
      bufferMinutes: 10,
    })[0];
    if (slot === undefined) continue;
    const end = new Date(Math.min(slot.end.getTime(), slot.start.getTime() + 60 * 60_000));
    out.push({
      user_id: ctx.userId,
      kind: 'schedule_suggestion',
      urgency: 'normal',
      title: clip(
        copy(l, 'flow.generated.insight.schedule.title', { title: clip(t.title, 100) }),
        200,
      ),
      body: clip(
        copy(l, 'flow.generated.insight.schedule.body', {
          day: formatDay(l, slot.start, ctx.timeZone),
          start: formatTime(slot.start, ctx.timeZone),
          end: formatTime(end, ctx.timeZone),
        }),
        600,
      ),
      why_important: kindWhy(l, 'schedule_suggestion'),
      decision_tier: 'deterministic_signal',
      reason_code: 'free_slot_before_due',
      rule_id: null,
      learned_preference_id: null,
      entity_type: t.type,
      entity_id: t.id,
      flow_card_type: null,
      actions: [action('plan_slot', t.id, true), action('dismiss', t.id)],
      due_at: t.due,
      event_at: slot.start.toISOString(),
      suppression_key: `schedule:${t.type}:${t.id}`,
      dedupe_key: insightDedupeKey({
        kind: 'schedule_suggestion',
        entityType: t.type,
        entityId: t.id,
        discriminator: epochKey(t.due),
      }),
      source_type: t.prov === null ? 'task' : t.prov.source_type,
      source_id: t.prov === null ? t.id : t.prov.source_id,
      source_provider: t.prov === null ? null : t.prov.source_provider,
      source_timestamp: t.prov === null ? ctx.now.toISOString() : t.prov.source_timestamp,
      confidence: 0.9,
      evidence: t.prov === null ? [] : t.prov.evidence.slice(0, 5),
      importanceHigh: false,
      vip: false,
    });
  }
  return out;
}

// ── Life and security ────────────────────────────────────────────────────────

const LIFE_ACTIONS: Readonly<Record<string, (id: string, tracking: boolean) => InsightAction[]>> = {
  shipment: (id, tracking) =>
    tracking
      ? [action('track_package', id), action('open_source', id)]
      : [action('open_source', id)],
  flight: (id) => [action('add_to_calendar', id, true), action('open_source', id)],
  reservation: (id) => [action('add_to_calendar', id, true), action('open_source', id)],
  payment: (id) => [action('remind', id, true), action('open_source', id)],
  subscription: (id) => [action('renewal_details', id), action('remind', id, true)],
  security: (id) => [action('change_password', id), action('open_source', id)],
};

function lifeCandidates(snap: InsightSnapshot, ctx: BuildContext): Candidate[] {
  const l = ctx.locale;
  const out: Candidate[] = [];
  const now = ctx.now.getTime();
  for (const e of snap.lifeEvents) {
    if (e.status !== 'open' || e.suppressed) continue;
    const when = e.due_at ?? e.event_at;
    const status = typeof e.payload.status === 'string' ? e.payload.status : 'confirmed';
    const recent = now - Date.parse(e.updated_at) < 2 * 86_400_000;
    // Undated shipments and flights (tracking or gate updates, e.g. from Android signals) stay
    // relevant while recently updated.
    const relevant =
      e.type === 'security'
        ? recent
        : when === null
          ? (e.type === 'shipment' || e.type === 'flight') && recent
          : Date.parse(when) > now - 12 * 3_600_000 && Date.parse(when) < now + 3 * 86_400_000;
    if (!relevant) continue;
    const security = e.type === 'security';
    const urgency: Urgency = security
      ? 'urgent'
      : when === null
        ? 'normal'
        : urgencyFor(ctx, when, 'normal');
    const body = security
      ? copy(l, 'life.securityNote')
      : e.due_at !== null
        ? copy(l, 'life.dueOn', { date: formatDay(l, e.due_at, ctx.timeZone) })
        : e.event_at !== null
          ? formatDue(l, e.event_at, ctx.timeZone, false)
          : null;
    const tracking = e.tracking_url !== null;
    const params = e.payload as Record<string, unknown>;
    const str = (k: string) => (typeof params[k] === 'string' ? String(params[k]) : '');
    const notify = lifeNotification(e.type, status, str, e, ctx);
    out.push({
      user_id: ctx.userId,
      kind: security ? 'security' : 'life_event',
      urgency,
      title: clip(e.title, 200),
      body: body === null ? null : clip(body, 600),
      why_important: kindWhy(l, security ? 'security' : 'life'),
      decision_tier: 'deterministic_signal',
      reason_code: security ? 'security_verified' : `life_${e.type}`,
      rule_id: null,
      learned_preference_id: null,
      entity_type: 'life_event',
      entity_id: e.id,
      flow_card_type: e.type as FlowCardType,
      actions: (LIFE_ACTIONS[e.type] ?? ((id: string) => [action('open_source', id)]))(
        e.id,
        tracking,
      ),
      due_at: e.due_at,
      event_at: e.event_at,
      suppression_key: null,
      dedupe_key: insightDedupeKey({
        kind: security ? 'security' : 'life_event',
        entityType: 'life_event',
        entityId: e.id,
        discriminator: status,
      }),
      source_type: e.source_type,
      source_id: e.source_id,
      source_provider: e.source_provider,
      source_timestamp: e.source_timestamp,
      confidence: e.confidence,
      evidence: e.evidence.slice(0, 5),
      importanceHigh: security || e.type === 'payment',
      vip: false,
      ...(notify === null ? {} : { notify }),
    });
  }
  return out;
}

function lifeNotification(
  type: string,
  status: string,
  str: (k: string) => string,
  e: InsightSnapshot['lifeEvents'][number],
  ctx: BuildContext,
): Candidate['notify'] | null {
  const l = ctx.locale;
  const tz = ctx.timeZone;
  const base = {
    category: 'life_intel' as const,
    entity: { type: 'life_event' as const, id: e.id },
    urgency: (type === 'security' ? 'urgent' : 'today') as Urgency,
    time_sensitive: type === 'flight' || type === 'security',
    vip: false,
    localDate: localDate(ctx.now, tz),
    ...(e.source_type === 'android_notification' ? { from_android_signal: true } : {}),
  };
  const when = e.event_at ?? e.due_at;
  const today = when !== null && dayDiff(ctx, when) === 0;
  switch (type) {
    case 'security':
      return {
        ...base,
        template_key: 'life_intel.security',
        params_public: {},
        params_sensitive: { service: str('service'), summary: clip(e.title, 120) },
      };
    case 'payment':
      if (e.due_at === null || dayDiff(ctx, e.due_at) > 1) return null;
      return {
        ...base,
        template_key: 'life_intel.payment',
        params_public: { date: formatDay(l, e.due_at, tz) },
        params_sensitive: {
          issuer: str('payee'),
          amount: e.amount === null ? '' : `${e.amount} ${e.currency ?? ''}`.trim(),
        },
      };
    case 'subscription':
      if (when === null || dayDiff(ctx, when) > 1) return null;
      return {
        ...base,
        template_key: 'life_intel.subscription',
        params_public: { date: formatDay(l, when, tz) },
        params_sensitive: {
          service: str('service'),
          amount: e.amount === null ? '' : `${e.amount} ${e.currency ?? ''}`.trim(),
        },
      };
    case 'shipment':
      if (!(status === 'delivered' || status === 'delayed' || status === 'out_for_delivery'))
        return null;
      // No estimated delivery time in the source → no "Tahmini teslimat" push with empty times.
      if (status !== 'delivered' && e.event_at === null) return null;
      return {
        ...base,
        template_key: 'life_intel.shipment',
        params_public: {
          state: status === 'out_for_delivery' ? 'other' : status,
          time: e.event_at === null ? '' : formatTime(e.event_at, tz),
          date: e.event_at === null ? '' : formatDay(l, e.event_at, tz),
          from: e.event_at === null ? '' : formatTime(e.event_at, tz),
          to:
            e.event_at === null
              ? ''
              : formatTime(new Date(Date.parse(e.event_at) + 2 * 3_600_000), tz),
        },
        params_sensitive: { seller: str('merchant') || str('carrier') },
      };
    case 'flight':
      if (!today || e.event_at === null) return null;
      return {
        ...base,
        template_key: 'life_intel.flight',
        params_public: {
          state:
            status === 'delayed' ? 'delayed' : status === 'checkin_open' ? 'checkin_open' : 'other',
          time: formatTime(e.event_at, tz),
          gate: str('gate'),
        },
        params_sensitive: { flight: str('flight_no') },
      };
    case 'reservation':
      if (!today || e.event_at === null) return null;
      return {
        ...base,
        template_key: 'life_intel.reservation',
        params_public: { time: formatTime(e.event_at, tz), partySize: str('party_size') || '1' },
        params_sensitive: { venue: str('venue') },
      };
    default:
      return null;
  }
}

// ── Approvals ────────────────────────────────────────────────────────────────

function approvalCandidates(snap: InsightSnapshot, ctx: BuildContext): Candidate[] {
  const pending = snap.approvals
    .filter((a) => a.status === 'pending' && Date.parse(a.approval_expires_at) > ctx.now.getTime())
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const newest = pending[0];
  if (newest === undefined) return [];
  const l = ctx.locale;
  return [
    {
      user_id: ctx.userId,
      kind: 'approval_pending',
      urgency: 'normal',
      title: clip(copy(l, 'flow.generated.insight.approval.title', { count: pending.length }), 200),
      body: clip(newest.what, 600),
      why_important: kindWhy(l, 'approval'),
      decision_tier: 'deterministic_signal',
      reason_code: 'approval_pending',
      rule_id: null,
      learned_preference_id: null,
      entity_type: 'approval_action',
      entity_id: newest.id,
      flow_card_type: null,
      actions: [action('review_approval', newest.id), action('open_approvals', null)],
      due_at: newest.approval_expires_at,
      event_at: null,
      suppression_key: null,
      dedupe_key: insightDedupeKey({
        kind: 'approval_pending',
        entityType: 'approval_action',
        entityId: newest.id,
      }),
      source_type: 'user_input',
      source_id: newest.id,
      source_provider: null,
      source_timestamp: newest.created_at,
      confidence: 1,
      evidence: [],
      importanceHigh: false,
      vip: false,
      notify: {
        category: 'approval',
        entity: null,
        template_key: 'approval.pending',
        params_public: { count: pending.length },
        params_sensitive: { summary: clip(newest.what, 80) },
        urgency: 'normal',
        time_sensitive: false,
        vip: false,
        localDate: localDate(ctx.now, ctx.timeZone),
      },
    },
  ];
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/** Push tap target (the insight row id is not known before the upsert). */
function notificationRoute(
  category: NotificationCategory,
  entityType: string,
  entityId: string,
): string {
  if (entityType === 'commitment') return routes.commitment(entityId);
  if (entityType === 'approval_action') return routes.approval(entityId);
  if (entityType === 'calendar_event' && category === 'meeting') return routes.event(entityId);
  return routeForNotification(category, entityId);
}

/** Builds the upserts, expirations, thread patches and notification candidates for one user. */
export function buildInsights(snap: InsightSnapshot, ctx: BuildContext): BuildResult {
  const patches: { id: string; patch: ThreadPatch }[] = [];
  const candidates: Candidate[] = [
    ...(inScope(ctx.scope, 'mail') ? mailCandidates(snap, ctx) : []),
    ...(inScope(ctx.scope, 'followups') ? followUpCandidates(snap, ctx, patches) : []),
    ...(inScope(ctx.scope, 'calendar') ? calendarCandidates(snap, ctx) : []),
    ...(inScope(ctx.scope, 'tasks') ? taskCandidates(snap, ctx) : []),
    ...(inScope(ctx.scope, 'calendar') || inScope(ctx.scope, 'tasks')
      ? scheduleCandidates(snap, ctx)
      : []),
    ...(inScope(ctx.scope, 'life') ? lifeCandidates(snap, ctx) : []),
    ...approvalCandidates(snap, ctx),
  ];
  const existing = new Map<string, InsightRow>(snap.insights.map((i) => [i.dedupe_key, i]));
  const suppressed = new Set(
    snap.insights
      .filter((i) => i.status === 'dismissed' && i.suppression_key !== null)
      .map((i) => i.suppression_key as string),
  );
  const seen = new Set<string>();
  const upserts: InsightUpsert[] = [];
  const notifications: NotificationBuild[] = [];
  for (const c of candidates) {
    if (seen.has(c.dedupe_key)) continue;
    seen.add(c.dedupe_key);
    const prior = existing.get(c.dedupe_key);
    if (prior !== undefined && prior.status !== 'open' && prior.status !== 'snoozed') continue;
    if (c.suppression_key !== null && suppressed.has(c.suppression_key)) continue;
    if (c.actions.length === 0) continue;
    const { importanceHigh, vip, notify, ...row } = c;
    const rank = rankScore(
      {
        kind: c.kind,
        urgency: c.urgency,
        dueAt: c.due_at,
        eventAt: c.event_at,
        createdAt: prior?.created_at ?? ctx.now.toISOString(),
        importanceHigh,
        vip,
      },
      { now: ctx.now, timeZone: ctx.timeZone },
    );
    upserts.push({ ...row, actions: row.actions.slice(0, 2), rank_score: rank });
    if (prior === undefined && notify !== undefined) {
      const { localDate: day, ...build } = notify;
      notifications.push({
        ...build,
        dedupe_key: notificationDedupeKey({
          category: build.category,
          entityType: c.entity_type,
          entityId: c.entity_id,
          localDate: day,
        }).slice(0, 200),
        deeplink: toDeepLink(notificationRoute(build.category, c.entity_type, c.entity_id)).slice(
          0,
          200,
        ),
      });
    }
  }
  const expire = snap.insights
    .filter(
      (i) =>
        (i.status === 'open' || i.status === 'snoozed') &&
        !seen.has(i.dedupe_key) &&
        ownedByScope(i.kind, i.entity_type, ctx.scope),
    )
    .map((i) => i.id);
  return { upserts, expire, threadPatches: patches, notifications };
}
