/**
 * The M§33 approval card computed by the server at proposal and at every edit (API_CONTRACTS §5.2,
 * §6.2 step 1): what · why · exact change · destination · side effects, plus the executor, the
 * expiry (§6.6) and the write capability the destination needs. Copy comes from the `approvals`
 * catalog in the user's locale; field values stay raw (ISO instants, titles) so clients format them.
 */
import {
  approvalExpiresAt,
  type Capability,
  formatDate,
  formatTime,
  isWithinQuietHours,
  type Provider,
  sourceLabel,
  type SourceType,
  startOfLocalDay,
} from '@da/domain';
import { withTrCases } from '@da/i18n/tr-suffix';
import type { ApprovalPayload } from '@da/validation';
import { type ServerLocale, translate } from '../../i18n/catalog.ts';
import type {
  AccountInfo,
  ApprovalCardExtras,
  ApprovalOriginValue,
  ApprovalUserContext,
  CalendarEventInfo,
  CalendarInfo,
  ExactChangeField,
  InstallationInfo,
  SideEffectItem,
  StoredExactChange,
  TargetKind,
} from './model.ts';

export interface CardContext {
  readonly now: Date;
  readonly user: ApprovalUserContext;
  readonly origin: ApprovalOriginValue;
  readonly account: AccountInfo | null;
  readonly calendar: CalendarInfo | null;
  readonly event: CalendarEventInfo | null;
  readonly installation: InstallationInfo | null;
  /** Provider etag / changeKey of the event (`calendar_update`). */
  readonly precondition: string | null;
  readonly source: {
    readonly type: SourceType;
    readonly provider: Provider | 'in_app' | null;
    readonly at: string;
  } | null;
}

export interface ComputedCard {
  readonly what: string;
  readonly why: string;
  readonly change_summary: string;
  readonly side_effects: SideEffectItem[];
  readonly exact_change: StoredExactChange;
  readonly destination_account_id: string | null;
  readonly destination_label: string | null;
  readonly executor: 'server' | 'device';
  readonly device_installation_id: string | null;
  readonly approval_expires_at: Date;
  readonly capability: Capability | null;
  readonly requires_confirmation: boolean;
  /** The Pro feature the proposal needs (API-APR-01 role requirement), if any. */
  readonly pro_feature: 'commitments' | 'advanced_planning' | null;
}

/** Write capability per action type for provider targets (API_CONTRACTS §7). */
export const WRITE_CAPABILITY: Readonly<Record<string, Capability>> = {
  email_send: 'mail_send',
  calendar_create: 'calendar_write',
  calendar_update: 'calendar_write',
  task_create: 'tasks_write',
};

/** Commitments below this confidence need their own confirmation (M§18, M§115). */
export const CONFIRMATION_CONFIDENCE = 0.7;

const MAX_WHAT = 200;
const MAX_SUMMARY = 500;
const MAX_EFFECT = 200;

function clip(text: string, max: number): string {
  const chars = Array.from(text.trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

function t(ctx: CardContext, key: string, params: Record<string, string | number> = {}): string {
  return translate(ctx.user.locale, `approvals.${key}`, params);
}

type EventTimeValue = Extract<ApprovalPayload, { action_type: 'calendar_create' }>['time'];

function eventStartInstant(time: EventTimeValue, tz: string): Date {
  return time.kind === 'timed' ? new Date(time.start) : startOfLocalDay(time.start_date, tz);
}

function describeTime(ctx: CardContext, time: EventTimeValue): string {
  const tz = ctx.user.timeZone;
  const locale = ctx.user.locale;
  if (time.kind === 'timed') {
    return t(ctx, 'summary.timed', {
      date: formatDate(time.start, tz, locale),
      start: formatTime(time.start, tz),
      end: formatTime(time.end, tz),
    });
  }
  return t(ctx, 'summary.allDay', {
    date: formatDate(`${time.start_date}T12:00:00Z`, 'UTC', locale),
  });
}

function timeFields(
  time: EventTimeValue | undefined,
  before: EventTimeValue | null,
): ExactChangeField[] {
  if (time === undefined) return [];
  if (time.kind === 'timed') {
    const b = before?.kind === 'timed' ? before : null;
    return [
      { field: 'start', before: b?.start ?? null, after: time.start },
      { field: 'end', before: b?.end ?? null, after: time.end },
    ];
  }
  const b = before?.kind === 'all_day' ? before : null;
  return [
    { field: 'start_date', before: b?.start_date ?? null, after: time.start_date },
    { field: 'end_date', before: b?.end_date ?? null, after: time.end_date },
  ];
}

function eventTimeOf(event: CalendarEventInfo): EventTimeValue {
  if (event.all_day && event.start_date !== null && event.end_date !== null) {
    return { kind: 'all_day', start_date: event.start_date, end_date: event.end_date };
  }
  return {
    kind: 'timed',
    start: new Date(event.start_at).toISOString(),
    end: new Date(event.end_at).toISOString(),
    time_zone: event.time_zone ?? 'UTC',
  };
}

function serviceName(
  provider: Provider | 'in_app',
  type: SourceType,
  locale: ServerLocale,
): string {
  if (provider === 'in_app') return sourceLabelName('in_app', type, locale);
  return sourceLabelName(provider, type, locale);
}

function sourceLabelName(
  provider: Provider | 'in_app',
  type: SourceType,
  locale: ServerLocale,
): string {
  const label = sourceLabel({
    provider,
    sourceType: type,
    at: '2026-01-01T00:00:00Z',
    timeZone: 'UTC',
    locale,
  });
  return label.split(' · ')[0] ?? label;
}

function accountLabel(account: AccountInfo, type: SourceType, locale: ServerLocale): string {
  const name = serviceName(account.provider, type, locale);
  const who = account.account_email ?? account.display_label;
  return who === null ? name : `${who} · ${name}`;
}

function destinationOf(
  kind: TargetKind,
  ctx: CardContext,
  containerType: SourceType,
  containerLabel: string | null,
  deviceProvider: Provider | null,
): ApprovalCardExtras['destination'] {
  if (kind === 'in_app') {
    return {
      target_kind: 'in_app',
      provider: 'in_app',
      account_label: null,
      container_label: null,
    };
  }
  if (kind === 'device') {
    const provider = deviceProvider ?? 'apple_device';
    return {
      target_kind: 'device',
      provider,
      account_label: t(ctx, 'destination.device'),
      container_label: sourceLabelName(provider, containerType, ctx.user.locale),
    };
  }
  const account = ctx.account;
  return {
    target_kind: 'provider',
    provider: account?.provider ?? 'google',
    account_label: account === null ? null : accountLabel(account, containerType, ctx.user.locale),
    container_label: containerLabel,
  };
}

function sourceLine(ctx: CardContext): { label: string | null } {
  if (ctx.source === null) return { label: null };
  const provider = ctx.source.provider;
  return {
    label: clip(
      sourceLabel({
        provider,
        sourceType: ctx.source.type,
        at: ctx.source.at,
        timeZone: ctx.user.timeZone,
        now: ctx.now,
        locale: ctx.user.locale,
      }),
      120,
    ),
  };
}

function card(
  ctx: CardContext,
  destination: ApprovalCardExtras['destination'],
  extra: { capability: Capability | null; requiresConfirmation: boolean; proRequired: boolean },
  sourceRoute: string | null,
): ApprovalCardExtras {
  return {
    destination,
    requires_confirmation: extra.requiresConfirmation,
    pro_required: extra.proRequired,
    capability: extra.capability,
    source_label: sourceLine(ctx).label,
    source_route: sourceRoute,
    precondition: ctx.precondition,
  };
}

function effect(code: SideEffectItem['code'], text: string): SideEffectItem {
  return { code, text: clip(text, MAX_EFFECT) };
}

/** Computes the card of a validated payload. The caller has checked ownership of every id. */
export function computeCard(
  payload: ApprovalPayload,
  ctx: CardContext,
  sourceRoute: string | null = null,
): ComputedCard {
  const why = clip(t(ctx, `why.${ctx.origin}`), 300);
  const locale = ctx.user.locale;
  const tz = ctx.user.timeZone;
  const base = {
    why,
    destination_account_id: null as string | null,
    destination_label: null as string | null,
    executor: 'server' as 'server' | 'device',
    device_installation_id: null as string | null,
    requires_confirmation: false,
    pro_feature:
      ctx.origin === 'plan_proposal' || ctx.origin === 'conflict_resolution'
        ? ('advanced_planning' as const)
        : null,
  };

  switch (payload.action_type) {
    case 'email_send': {
      const recipients = payload.to.length + payload.cc.length;
      const destination = destinationOf('provider', ctx, 'email_thread', null, null);
      const fields: ExactChangeField[] = [
        { field: 'to', before: null, after: payload.to.map((r) => r.email).join(', ') },
        ...(payload.cc.length > 0
          ? [{ field: 'cc', before: null, after: payload.cc.map((r) => r.email).join(', ') }]
          : []),
        { field: 'subject', before: null, after: payload.subject },
        { field: 'body_text', before: null, after: clip(payload.body_text, 2000) },
      ];
      return {
        ...base,
        what: clip(payload.subject, MAX_WHAT),
        change_summary: clip(
          t(ctx, 'summary.email', { count: recipients, subject: payload.subject }),
          MAX_SUMMARY,
        ),
        side_effects: [
          effect('email_sent_to', t(ctx, 'sideEffects.emailSentTo', { count: recipients })),
        ],
        exact_change: {
          kind: 'send',
          fields,
          card: card(
            ctx,
            destination,
            { capability: 'mail_send', requiresConfirmation: false, proRequired: false },
            sourceRoute,
          ),
        },
        destination_account_id: payload.connected_account_id,
        destination_label: destination.account_label,
        approval_expires_at: approvalExpiresAt('email_send', { createdAt: ctx.now }),
        capability: 'mail_send',
      };
    }
    case 'calendar_create': {
      const device = payload.target.kind === 'device';
      const destination = destinationOf(
        payload.target.kind,
        ctx,
        'calendar_event',
        ctx.calendar?.name ?? null,
        payload.target.kind === 'device' ? payload.target.provider : null,
      );
      const effects: SideEffectItem[] = [];
      if (payload.attendees.length > 0) {
        effects.push(
          effect(
            'invites_sent',
            t(ctx, 'sideEffects.invitesSent', { count: payload.attendees.length }),
          ),
        );
      }
      if (device) effects.push(effect('device_write', t(ctx, 'sideEffects.deviceCalendar')));
      const fields: ExactChangeField[] = [
        { field: 'title', before: null, after: payload.title },
        ...timeFields(payload.time, null),
        ...(payload.location === undefined
          ? []
          : [{ field: 'location', before: null, after: payload.location }]),
        ...(payload.attendees.length === 0
          ? []
          : [
              {
                field: 'attendees',
                before: null,
                after: payload.attendees.map((a) => a.email).join(', '),
              },
            ]),
      ];
      const capability = device ? null : 'calendar_write';
      return {
        ...base,
        what: clip(payload.title, MAX_WHAT),
        change_summary: clip(describeTime(ctx, payload.time), MAX_SUMMARY),
        side_effects: effects,
        exact_change: {
          kind: 'create',
          fields,
          card: card(
            ctx,
            destination,
            { capability, requiresConfirmation: false, proRequired: base.pro_feature !== null },
            sourceRoute,
          ),
        },
        destination_account_id:
          payload.target.kind === 'provider' ? payload.target.connected_account_id : null,
        destination_label: destination.account_label,
        executor: device ? 'device' : 'server',
        device_installation_id: ctx.installation?.id ?? null,
        approval_expires_at: approvalExpiresAt('calendar_create', {
          createdAt: ctx.now,
          eventStart: eventStartInstant(payload.time, tz),
        }),
        capability,
      };
    }
    case 'calendar_update': {
      const device = payload.target.kind === 'device';
      const event = ctx.event;
      const before = event === null ? null : eventTimeOf(event);
      const destination = destinationOf(
        payload.target.kind,
        ctx,
        'calendar_event',
        ctx.calendar?.name ?? null,
        payload.target.kind === 'device' ? payload.target.provider : null,
      );
      const changes = payload.changes;
      const fields: ExactChangeField[] = [
        ...(changes.title === undefined
          ? []
          : [{ field: 'title', before: event?.title ?? null, after: changes.title }]),
        ...timeFields(changes.time, before),
        ...(changes.location === undefined
          ? []
          : [{ field: 'location', before: event?.location ?? null, after: changes.location }]),
        ...(changes.description === undefined
          ? []
          : [{ field: 'description', before: null, after: changes.description }]),
      ];
      const effects: SideEffectItem[] = [];
      if ((event?.attendee_count ?? 0) > 0) {
        effects.push(
          effect(
            'attendees_notified',
            t(ctx, 'sideEffects.attendeesNotified', { count: event?.attendee_count ?? 0 }),
          ),
        );
      }
      if (device) effects.push(effect('device_write', t(ctx, 'sideEffects.deviceCalendar')));
      const summary =
        changes.time !== undefined && before !== null
          ? t(ctx, 'summary.moved', {
              from: describeTime(ctx, before),
              to: describeTime(ctx, changes.time),
            })
          : t(ctx, 'summary.updated');
      const capability = device ? null : 'calendar_write';
      const originalStart = event === null ? ctx.now : new Date(event.start_at);
      return {
        ...base,
        what: clip(changes.title ?? event?.title ?? t(ctx, 'types.calendar_update'), MAX_WHAT),
        change_summary: clip(summary, MAX_SUMMARY),
        side_effects: effects,
        exact_change: {
          kind: 'update',
          fields,
          card: card(
            ctx,
            destination,
            { capability, requiresConfirmation: false, proRequired: base.pro_feature !== null },
            sourceRoute,
          ),
        },
        destination_account_id:
          payload.target.kind === 'provider' ? payload.target.connected_account_id : null,
        destination_label: destination.account_label,
        executor: device ? 'device' : 'server',
        device_installation_id: ctx.installation?.id ?? null,
        approval_expires_at: approvalExpiresAt('calendar_update', {
          createdAt: ctx.now,
          eventStart: originalStart,
        }),
        capability,
      };
    }
    case 'task_create': {
      const kind = payload.target.kind;
      const destination = destinationOf(
        kind,
        ctx,
        'task',
        kind === 'provider' ? payload.target.task_list_id : null,
        'apple_device',
      );
      const effects: SideEffectItem[] = [];
      if (kind === 'provider') {
        effects.push(
          effect(
            'provider_task_created',
            t(ctx, 'sideEffects.providerTask', {
              service: serviceName(ctx.account?.provider ?? 'google', 'task', locale),
            }),
          ),
        );
      } else if (kind === 'device') {
        effects.push(effect('device_write', t(ctx, 'sideEffects.deviceReminders')));
      } else {
        effects.push(effect('internal_record', t(ctx, 'sideEffects.internalTask')));
      }
      const due = payload.due;
      const dueText =
        due === undefined
          ? t(ctx, 'summary.taskNoDue')
          : t(ctx, 'summary.taskDue', {
              date:
                due.kind === 'date'
                  ? formatDate(`${due.date}T12:00:00Z`, 'UTC', locale)
                  : `${formatDate(due.at, tz, locale)} ${formatTime(due.at, tz)}`,
            });
      const fields: ExactChangeField[] = [
        { field: 'title', before: null, after: payload.title },
        ...(payload.notes === undefined
          ? []
          : [{ field: 'notes', before: null, after: clip(payload.notes, 500) }]),
        ...(due === undefined
          ? []
          : [{ field: 'due', before: null, after: due.kind === 'date' ? due.date : due.at }]),
      ];
      const capability = kind === 'provider' ? 'tasks_write' : null;
      return {
        ...base,
        what: clip(payload.title, MAX_WHAT),
        change_summary: clip(dueText, MAX_SUMMARY),
        side_effects: effects,
        exact_change: {
          kind: 'create',
          fields,
          card: card(
            ctx,
            destination,
            { capability, requiresConfirmation: false, proRequired: base.pro_feature !== null },
            sourceRoute,
          ),
        },
        destination_account_id: kind === 'provider' ? payload.target.connected_account_id : null,
        destination_label: destination.account_label,
        executor: kind === 'device' ? 'device' : 'server',
        device_installation_id: kind === 'device' ? (ctx.installation?.id ?? null) : null,
        approval_expires_at: approvalExpiresAt('task_create', { createdAt: ctx.now }),
        capability,
      };
    }
    case 'reminder_create': {
      const kind = payload.destination.kind;
      const destination = destinationOf(kind, ctx, 'task', null, 'apple_device');
      const effects: SideEffectItem[] = [];
      const time = formatTime(payload.fire_at, tz);
      if (kind === 'device') {
        effects.push(effect('device_write', t(ctx, 'sideEffects.deviceReminders')));
      } else {
        effects.push(
          effect('push_reminder', t(ctx, 'sideEffects.pushReminder', withTrCases({ time }))),
        );
        effects.push(effect('internal_record', t(ctx, 'sideEffects.internalReminder')));
      }
      const quiet = ctx.user.quietHours;
      if (
        quiet.enabled &&
        isWithinQuietHours(quiet.start, quiet.end, payload.fire_at, tz, quiet.days)
      ) {
        effects.push(
          effect(
            kind === 'device' ? 'device_write' : 'push_reminder',
            t(ctx, 'sideEffects.quietHours'),
          ),
        );
      }
      return {
        ...base,
        what: clip(payload.title, MAX_WHAT),
        change_summary: clip(
          t(ctx, 'summary.reminderAt', { date: formatDate(payload.fire_at, tz, locale), time }),
          MAX_SUMMARY,
        ),
        side_effects: effects,
        exact_change: {
          kind: 'create',
          fields: [
            { field: 'title', before: null, after: payload.title },
            { field: 'fire_at', before: null, after: new Date(payload.fire_at).toISOString() },
          ],
          card: card(
            ctx,
            destination,
            {
              capability: null,
              requiresConfirmation: false,
              proRequired: base.pro_feature !== null,
            },
            sourceRoute,
          ),
        },
        executor: kind === 'device' ? 'device' : 'server',
        device_installation_id: kind === 'device' ? (ctx.installation?.id ?? null) : null,
        approval_expires_at: approvalExpiresAt('reminder_create', {
          createdAt: ctx.now,
          fireAt: payload.fire_at,
        }),
        capability: null,
      };
    }
    case 'commitment_create': {
      const who = payload.counterparty.name ?? payload.counterparty.email ?? '';
      const destination = destinationOf('in_app', ctx, 'commitment', null, null);
      const summary =
        payload.due_at === null
          ? t(ctx, 'summary.commitmentNoDue', { counterparty: who })
          : t(ctx, 'summary.commitmentDue', {
              counterparty: who,
              date: formatDate(payload.due_at, tz, locale),
            });
      const requiresConfirmation = payload.confidence < CONFIRMATION_CONFIDENCE;
      return {
        ...base,
        what: clip(payload.text, MAX_WHAT),
        change_summary: clip(summary, MAX_SUMMARY),
        side_effects: [effect('internal_record', t(ctx, 'sideEffects.internalCommitment'))],
        exact_change: {
          kind: 'create',
          fields: [
            { field: 'text', before: null, after: payload.text },
            { field: 'direction', before: null, after: payload.direction },
            { field: 'counterparty', before: null, after: who === '' ? null : who },
            { field: 'due_at', before: null, after: payload.due_at },
          ],
          card: card(
            ctx,
            destination,
            { capability: null, requiresConfirmation, proRequired: true },
            sourceRoute,
          ),
        },
        requires_confirmation: requiresConfirmation,
        approval_expires_at: approvalExpiresAt('commitment_create', { createdAt: ctx.now }),
        capability: null,
        pro_feature: 'commitments',
      };
    }
  }
}
