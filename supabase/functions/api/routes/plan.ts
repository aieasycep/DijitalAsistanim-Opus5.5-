/**
 * Plan routes (IMPLEMENTATION_PLAN T-5.14; API_CONTRACTS API-PLAN-01 `GET /plan/free-slots`,
 * API-PLAN-02 `POST /plan/proposals`, API-PLAN-03 `POST /plan/conflicts/:insightId/options`,
 * API-PLAN-04 `POST /plan/conflicts/:insightId/resolve`; M§19, M§20). Deterministic: the
 * `@da/domain` slot finder decides, no model is called. Every calendar write is a pending approval
 * (`calendar_create` for proposals, `calendar_update` for conflict moves) through B's
 * `proposeApproval`; a non-organizer never gets a move option.
 */
import { ConflictResolveBody, FreeSlotsQuery, PlanProposalBody, routes } from '@da/validation';
import type { ApprovalView } from '@da/validation';
import { insightDedupeKey } from '@da/domain';
import { currentUser } from '../../_shared/auth/user.ts';
import { AppError } from '../../_shared/errors.ts';
import type { AppContext, UserAuth } from '../../_shared/http/context.ts';
import { sendData } from '../../_shared/http/respond.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
  validParams,
  validQuery,
} from '../../_shared/http/validate.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import { contentKey } from '../../_shared/services/assist/common.ts';
import type { MeetingEventRow, PlanInsightRow } from '../../_shared/services/assist/store.ts';
import type { AiUser } from '../../_shared/services/ai/runtime.ts';
import { proposeApproval } from '../../_shared/services/approvals/propose.ts';
import { toApprovalView } from '../../_shared/services/approvals/view.ts';
import { clip, copy, formatDay, formatTime } from '../../_shared/services/copy.ts';
import {
  buildOptions,
  type ConflictOption,
  conflictPair,
  OPTIONS_TTL_MS,
  publicOptions,
  reminderRoute,
} from '../../_shared/services/plan/conflicts.ts';
import {
  busyIntervals,
  freeSlots,
  pickSlot,
  quietSpec,
  sourcesConsidered,
} from '../../_shared/services/plan/slots.ts';
import type { RequestRepos, RouteKit, RouteRegistrar } from '../deps.ts';
import { serviceDeps } from './approvals.ts';
import { assistOf, replyDraftView } from './assist-api.ts';
import { createReplyDraft } from './mail.ts';

const DAY_MS = 86_400_000;
const FREE_RANGE_DAYS = 2;

async function busyFor(kit: RouteKit, userId: string, from: Date, to: Date) {
  const { assist, intel } = assistOf(kit);
  const [events, tasks] = await Promise.all([
    intel.mail.events(userId, from, to),
    assist.store.timedTasks(userId, from, to),
  ]);
  return busyIntervals(events, tasks);
}

async function reuseDuplicate(
  repos: RequestRepos,
  userId: string,
  locale: 'tr' | 'en',
  error: unknown,
): Promise<ApprovalView | null> {
  if (!(error instanceof AppError) || error.code !== 'STATE_CONFLICT') return null;
  const id = (error.details as { approval_id?: unknown } | undefined)?.approval_id;
  if (typeof id !== 'string') return null;
  const row = await repos.approvals.get(userId, id);
  return row === null ? null : toApprovalView(row, { locale });
}

/** API-PLAN-02: a deterministic slot → `schedule_suggestion` insight → pending `calendar_create`. */
async function propose(
  c: AppContext,
  kit: RouteKit,
  auth: UserAuth,
  user: AiUser,
  body: {
    item?: { type: 'task' | 'commitment' | 'insight' | 'email_message'; id: string } | undefined;
    title?: string | undefined;
    duration_minutes: number;
    window: { from: string; to: string };
    prefer: 'morning' | 'afternoon' | 'any';
    target_calendar_id?: string | undefined;
  },
) {
  const { assist, intel } = assistOf(kit);
  const repos = kit.deps.repos(auth);
  const now = kit.now();
  const item = body.item === undefined ? null : await assist.store.planItem(auth.userId, body.item);
  if (body.item !== undefined && item === null)
    throw new AppError('NOT_FOUND', { details: { resource: body.item.type } });
  const title = clip(body.title ?? item?.title ?? '', 300);
  const from = new Date(Math.max(Date.parse(body.window.from), now.getTime()));
  const to = new Date(body.window.to);
  const due = item?.due_at === null || item?.due_at === undefined ? null : new Date(item.due_at);
  const [busy, quiet] = await Promise.all([
    busyFor(kit, auth.userId, from, to),
    assist.store.quietHours(auth.userId),
  ]);
  const slots = freeSlots({
    from,
    to,
    minMinutes: body.duration_minutes,
    withinWorkingHours: true,
    timeZone: user.timeZone,
    workingHours: user.workingHours,
    quiet: quietSpec(quiet),
    busy,
    bufferMinutes: 10,
    before: due,
    personal: item?.personal === true,
  });
  const picked = pickSlot(slots, body.duration_minutes, body.prefer, user.timeZone);
  if (picked === null)
    throw new AppError('STATE_CONFLICT', { details: { reason: 'no_free_slot' } });
  const calendar = await assist.store.writableCalendar(
    auth.userId,
    body.target_calendar_id ?? null,
  );
  if (calendar === null) {
    throw new AppError('DATA_SOURCE_DISABLED', {
      details: { toggle: 'calendar_write_with_approval', reason: 'no_writable_calendar' },
    });
  }
  const windowHash = (
    await contentKey([body.window.from, body.window.to, body.duration_minutes, body.prefer])
  ).slice(0, 16);
  const itemKey =
    body.item === undefined
      ? `title:${(await contentKey([title])).slice(0, 16)}`
      : `${body.item.type}:${body.item.id}`;
  const entityType =
    body.item === undefined || body.item.type === 'insight'
      ? 'approval_action'
      : body.item.type === 'email_message'
        ? 'email_message'
        : body.item.type;
  const entityId =
    body.item?.type === 'insight' || body.item === undefined ? crypto.randomUUID() : body.item.id;
  const rationale = clip(
    copy(user.locale, 'plan.generated.rationale', {
      day: formatDay(user.locale, picked.slot.start, user.timeZone),
      start: formatTime(picked.slot.start, user.timeZone),
      end: formatTime(picked.slot.end, user.timeZone),
      task: clip(title, 80),
    }),
    300,
  );
  const [insight] = await intel.mail.upsertInsights([
    {
      user_id: auth.userId,
      kind: 'schedule_suggestion',
      urgency: 'normal',
      title,
      body: rationale,
      why_important: null,
      decision_tier: 'deterministic_signal',
      reason_code: 'plan_proposal',
      rule_id: null,
      learned_preference_id: null,
      entity_type: entityType,
      entity_id: entityId,
      flow_card_type: null,
      actions: [],
      due_at: due?.toISOString() ?? null,
      event_at: picked.slot.start.toISOString(),
      rank_score: 0,
      suppression_key: null,
      dedupe_key: insightDedupeKey({
        kind: 'schedule_suggestion',
        entityType: 'approval_action',
        entityId: auth.userId,
        discriminator: `plan:${itemKey}:${windowHash}`,
      }),
      source_type: 'user_input',
      source_id: auth.userId,
      source_provider: null,
      source_timestamp: now.toISOString(),
      confidence: 1,
      evidence: [],
    },
  ]);
  if (insight === undefined)
    throw new AppError('SERVICE_UNAVAILABLE', { details: { reason: 'insight_upsert' } });
  const deps = serviceDeps(c, kit, repos);
  let approval: ApprovalView;
  try {
    const out = await proposeApproval(deps, {
      userId: auth.userId,
      payload: {
        action_type: 'calendar_create',
        target: {
          kind: 'provider',
          connected_account_id: calendar.connected_account_id,
          calendar_id: calendar.id,
        },
        title: title === '' ? copy(user.locale, 'plan.focusBlock') : title,
        time: {
          kind: 'timed',
          start: picked.slot.start.toISOString(),
          end: picked.slot.end.toISOString(),
          time_zone: user.timeZone,
        },
        attendees: [],
        reminders_minutes: [],
        ...(body.item === undefined || body.item.type === 'email_message'
          ? {}
          : { origin_task_ref: { type: body.item.type, id: body.item.id } }),
      },
      origin: 'plan_proposal',
      originRefId: insight.id,
      actor: 'user',
    });
    approval = out.view;
  } catch (error) {
    const existing = await reuseDuplicate(repos, auth.userId, deps.locale, error);
    if (existing === null) throw error;
    approval = existing;
  }
  await assist.store.linkInsightApproval(auth.userId, insight.id, approval.id);
  return {
    insight_id: insight.id,
    slot: { start: picked.slot.start.toISOString(), end: picked.slot.end.toISOString() },
    alternatives: picked.alternatives.map((s) => ({
      start: s.start.toISOString(),
      end: s.end.toISOString(),
    })),
    rationale_text: rationale,
    approval,
  };
}

async function conflictContext(kit: RouteKit, userId: string, insightId: string) {
  const { assist } = assistOf(kit);
  const insight = await assist.store.planInsight(userId, insightId);
  if (insight === null || insight.kind !== 'conflict')
    throw new AppError('NOT_FOUND', { details: { resource: 'insight' } });
  if (insight.status !== 'open')
    throw new AppError('STATE_CONFLICT', {
      details: { reason: 'conflict_resolved', status: insight.status },
    });
  const pair = conflictPair(insight);
  if (pair === null) throw new AppError('NOT_FOUND', { details: { resource: 'calendar_event' } });
  const [a, b] = await Promise.all(pair.map((id) => assist.store.meetingEvent(userId, id)));
  if (a === null || b === null || a === undefined || b === undefined) {
    throw new AppError('NOT_FOUND', { details: { resource: 'calendar_event' } });
  }
  const events = (Date.parse(a.start_at) <= Date.parse(b.start_at) ? [a, b] : [b, a]) as [
    MeetingEventRow,
    MeetingEventRow,
  ];
  return { insight, events };
}

async function optionsFor(
  kit: RouteKit,
  userId: string,
  locale: 'tr' | 'en',
  insight: PlanInsightRow,
  events: [MeetingEventRow, MeetingEventRow],
) {
  const { assist } = assistOf(kit);
  const cached = insight.payload?.options as { at?: string; list?: ConflictOption[] } | undefined;
  if (
    cached?.at !== undefined &&
    Array.isArray(cached.list) &&
    kit.now().getTime() - Date.parse(cached.at) < OPTIONS_TTL_MS
  ) {
    return cached.list;
  }
  const organizerMail = new Map<string, string>();
  for (const event of events) {
    if (event.organizer_self || event.can_modify || event.organizer_email === null) continue;
    const [mail] = (
      await assist.store.mailsWith(
        userId,
        [event.organizer_email],
        new Date(kit.now().getTime() - 60 * DAY_MS),
        5,
      )
    ).filter((m) => m.direction === 'inbound');
    if (mail !== undefined) organizerMail.set(event.id, mail.id);
  }
  const phones = await assist.store.sourcePhones(userId, insight.source_type, insight.source_id);
  const list = buildOptions({ events, locale, organizerMail, phones });
  await assist.store.setInsightPayload(userId, insight.id, {
    ...(insight.payload ?? {}),
    options: { at: kit.now().toISOString(), list },
  });
  return list;
}

function conflictView(
  insight: PlanInsightRow,
  events: [MeetingEventRow, MeetingEventRow],
  options: ConflictOption[],
) {
  return {
    conflict: {
      insight_id: insight.id,
      events: events.map((e) => ({
        id: e.id,
        title: e.title ?? '',
        start: new Date(e.start_at).toISOString(),
        end: new Date(e.end_at).toISOString(),
        is_organizer: e.organizer_self,
        attendee_count: e.attendee_count,
      })),
    },
    options: publicOptions(options),
  };
}

async function resolve(
  c: AppContext,
  kit: RouteKit,
  auth: UserAuth,
  user: AiUser,
  insightId: string,
  body: {
    option_id: string;
    params?:
      | {
          new_start?: string | undefined;
          new_end?: string | undefined;
          tone?: 'short' | 'professional' | 'friendly' | 'detailed' | undefined;
        }
      | undefined;
  },
) {
  const { assist } = assistOf(kit);
  const repos = kit.deps.repos(auth);
  const { insight, events } = await conflictContext(kit, auth.userId, insightId);
  const options = await optionsFor(kit, auth.userId, user.locale, insight, events);
  const option = options.find((o) => o.option_id === body.option_id);
  if (option === undefined)
    throw new AppError('VALIDATION_FAILED', { details: { reason: 'unknown_option' } });
  const none = {
    approval: null,
    reply_draft: null,
    reminder_options_route: null,
    insight_status: 'open' as const,
  };
  switch (option.kind) {
    case 'ignore': {
      await assist.store.dismissInsight(
        auth.userId,
        insight.id,
        insight.suppression_key ?? `conflict:${events[0].id}:${events[1].id}`,
      );
      return { ...none, insight_status: 'dismissed' as const };
    }
    case 'remind_me':
      return { ...none, reminder_options_route: reminderRoute(insight, events[0].start_at) };
    case 'contact_external':
      return none;
    case 'propose_new_time_email': {
      const at = body.params?.new_start;
      const instructions =
        at === undefined
          ? copy(user.locale, 'plan.generated.newTimeOpen')
          : copy(user.locale, 'plan.generated.newTimeInstruction', {
              time: `${formatDay(user.locale, at, user.timeZone)} ${formatTime(at, user.timeZone)}`,
            });
      const draft = await createReplyDraft(kit, auth, {
        messageId: option.reply_to_message_id ?? '',
        tone: body.params?.tone ?? 'professional',
        instructions,
        correlationId: c.get('correlationId'),
      });
      return { ...none, reply_draft: replyDraftView(draft.row, draft.webLink) };
    }
    case 'move_event':
    case 'shorten_event': {
      const event = events.find((e) => e.id === option.event_id);
      const other = events.find((e) => e.id !== option.event_id);
      if (event === undefined || other === undefined)
        throw new AppError('VALIDATION_FAILED', { details: { reason: 'unknown_option' } });
      let start = Date.parse(event.start_at);
      let end = Date.parse(event.end_at);
      if (option.kind === 'shorten_event') {
        if (start <= Date.parse(other.start_at)) end = Date.parse(other.start_at);
        else start = Date.parse(other.end_at);
      } else if (body.params?.new_start !== undefined) {
        start = Date.parse(body.params.new_start);
        end =
          body.params.new_end === undefined
            ? start + (end - Date.parse(event.start_at))
            : Date.parse(body.params.new_end);
      } else {
        const duration = end - start;
        const from = new Date(Math.max(Date.parse(other.end_at), kit.now().getTime()));
        const [busy, quiet] = await Promise.all([
          busyFor(kit, auth.userId, from, new Date(from.getTime() + 7 * DAY_MS)),
          assist.store.quietHours(auth.userId),
        ]);
        const slot = pickSlot(
          freeSlots({
            from,
            to: new Date(from.getTime() + 7 * DAY_MS),
            minMinutes: Math.ceil(duration / 60_000),
            withinWorkingHours: true,
            timeZone: user.timeZone,
            workingHours: user.workingHours,
            quiet: quietSpec(quiet),
            busy,
          }),
          Math.ceil(duration / 60_000),
          'any',
          user.timeZone,
        );
        if (slot === null)
          throw new AppError('STATE_CONFLICT', { details: { reason: 'no_free_slot' } });
        start = slot.slot.start.getTime();
        end = slot.slot.end.getTime();
      }
      if (!(end > start))
        throw new AppError('VALIDATION_FAILED', { details: { reason: 'invalid_time' } });
      const deps = serviceDeps(c, kit, repos);
      const out = await proposeApproval(deps, {
        userId: auth.userId,
        payload: {
          action_type: 'calendar_update',
          target: {
            kind: 'provider',
            connected_account_id: event.connected_account_id,
            calendar_id: event.calendar_id,
          },
          calendar_event_id: event.id,
          changes: {
            time: {
              kind: 'timed',
              start: new Date(start).toISOString(),
              end: new Date(end).toISOString(),
              time_zone: user.timeZone,
            },
          },
        },
        origin: 'conflict_resolution',
        originRefId: insight.id,
        source: {
          source_type: 'calendar_event',
          source_id: event.id,
          source_provider: event.provider,
          source_timestamp: event.updated_at,
        },
        actor: 'user',
      });
      return { ...none, approval: out.view };
    }
  }
}

export const registerPlanRoutes: RouteRegistrar = (app, kit) => {
  const idem = { repo: kit.deps.idempotency, now: () => kit.now().getTime() };

  const slots = routes['GET /plan/free-slots'];
  mountRoute(
    app,
    slots,
    ...kit.chain({ gate: true, rateLimit: 'api_default' }),
    validateRequest(slots),
    async (c) => {
      const auth = currentUser(c);
      const q = validQuery(c, FreeSlotsQuery);
      const { assist, intel } = assistOf(kit);
      const user = await intel.ai.users.load(auth.userId);
      const from = new Date(q.from);
      const to = new Date(q.to);
      if (!user.isPro && to.getTime() - from.getTime() > FREE_RANGE_DAYS * DAY_MS) {
        throw new AppError('ENTITLEMENT_REQUIRED', { details: { feature: 'advanced_planning' } });
      }
      const [busy, quiet, accounts] = await Promise.all([
        busyFor(kit, auth.userId, from, to),
        assist.store.quietHours(auth.userId),
        assist.store.accountSources(auth.userId),
      ]);
      const found = freeSlots({
        from,
        to,
        minMinutes: q.min_minutes,
        withinWorkingHours: q.within_working_hours,
        timeZone: user.timeZone,
        workingHours: user.workingHours,
        quiet: quietSpec(quiet),
        busy,
      });
      return sendData(c, {
        slots: found.map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
          minutes: s.minutes,
        })),
        sources_considered: sourcesConsidered(accounts, kit.now()),
      });
    },
  );

  const proposals = routes['POST /plan/proposals'];
  mountRoute(
    app,
    proposals,
    ...kit.chain({ gate: true, rateLimit: 'approvals_mutate' }),
    parseJsonBody(proposals),
    validateRequest(proposals),
    (c) => {
      const auth = currentUser(c);
      const body = validBody(c, PlanProposalBody);
      return withIdempotency(c, idem, {
        status: 201,
        async execute() {
          const user = await assistOf(kit).intel.ai.users.load(auth.userId);
          const data = await propose(c, kit, auth, user, body);
          return {
            data,
            ref: {
              type: 'insight',
              id: data.insight_id,
              ack: {
                approval_id: data.approval.id,
                slot_start: data.slot.start,
                slot_end: data.slot.end,
                rationale: data.rationale_text,
              },
            },
          };
        },
        async replay(ref) {
          const repos = kit.deps.repos(auth);
          const approvalId = String(ref.ack?.approval_id ?? '');
          const row = await repos.approvals.get(auth.userId, approvalId);
          if (row === null) throw new AppError('NOT_FOUND');
          return {
            insight_id: ref.id ?? '',
            slot: {
              start: String(ref.ack?.slot_start ?? ''),
              end: String(ref.ack?.slot_end ?? ''),
            },
            alternatives: [],
            rationale_text: String(ref.ack?.rationale ?? ''),
            approval: toApprovalView(row, { locale: serviceDeps(c, kit, repos).locale }),
          };
        },
      });
    },
  );

  const options = routes['POST /plan/conflicts/:insightId/options'];
  mountRoute(
    app,
    options,
    ...kit.chain({ gate: true, rateLimit: 'api_default' }),
    parseJsonBody(options),
    validateRequest(options),
    async (c) => {
      const auth = currentUser(c);
      const params = validParams(c, options.request.params);
      const user = await assistOf(kit).intel.ai.users.load(auth.userId);
      const { insight, events } = await conflictContext(kit, auth.userId, params.insightId);
      const list = await optionsFor(kit, auth.userId, user.locale, insight, events);
      return sendData(c, conflictView(insight, events, list));
    },
  );

  const resolveRoute = routes['POST /plan/conflicts/:insightId/resolve'];
  mountRoute(
    app,
    resolveRoute,
    ...kit.chain({ gate: true, rateLimit: 'approvals_mutate' }),
    parseJsonBody(resolveRoute),
    validateRequest(resolveRoute),
    (c) => {
      const auth = currentUser(c);
      const params = validParams(c, resolveRoute.request.params);
      const body = validBody(c, ConflictResolveBody);
      return withIdempotency(c, idem, {
        status: 200,
        async execute() {
          const user = await assistOf(kit).intel.ai.users.load(auth.userId);
          const data = await resolve(c, kit, auth, user, params.insightId, body);
          return {
            data,
            ref: {
              type: 'insight',
              id: params.insightId,
              ack: { result: JSON.parse(JSON.stringify(data)) },
            },
          };
        },
        replay: (ref) => Promise.resolve(ref.ack?.result as Awaited<ReturnType<typeof resolve>>),
      });
    },
  );
};
