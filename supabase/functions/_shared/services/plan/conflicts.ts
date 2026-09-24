/**
 * Calendar conflict options (IMPLEMENTATION_PLAN T-5.14; AI_PIPELINE_PLAN §13.5; API-PLAN-03/04;
 * M§20, C-36). Options depend on who organises each event: only the organizer (or an event whose
 * guests may modify it) gets "move" / "shorten" (`calendar_update`, attendees are notified); a
 * non-organizer gets "propose a new time" as a reply draft to the organizer's mail; a reminder and
 * "ignore" are always offered; "call" only when the source mail shows a phone number. Travel time
 * and third-party availability are never claimed: attendee availability is `unknown` unless a
 * real free/busy answer exists.
 */
import { routes } from '@da/domain';
import type { MeetingEventRow, PlanInsightRow } from '../assist/store.ts';
import { clip, copy, type CopyLocale, message } from '../copy.ts';

export type OptionKind =
  | 'move_event'
  | 'shorten_event'
  | 'propose_new_time_email'
  | 'remind_me'
  | 'contact_external'
  | 'ignore';

export interface ConflictOption {
  option_id: string;
  kind: OptionKind;
  title: string;
  description: string;
  feasibility: { organizer: boolean; attendee_availability: 'free' | 'busy' | 'unknown' };
  side_effects: string[];
  requires_capability: 'calendar_write' | 'mail_send' | null;
  pro_required: boolean;
  /** Resolution data kept server-side in the cache. */
  event_id?: string;
  reply_to_message_id?: string;
  phone?: string;
}

/** Options are cached in `insights.payload.options` for 5 minutes (API-PLAN-03). */
export const OPTIONS_TTL_MS = 5 * 60_000;

/** The two event ids of a conflict insight (from its dedupe key pair `a:b:epochA:epochB`). */
export function conflictPair(insight: PlanInsightRow): [string, string] | null {
  const m = /([0-9a-f-]{36}):([0-9a-f-]{36}):\d+:\d+/.exec(insight.dedupe_key);
  if (m === null) return null;
  return [m[1]!, m[2]!];
}

export function canModify(event: MeetingEventRow): boolean {
  return event.organizer_self || event.can_modify;
}

export function buildOptions(input: {
  readonly events: readonly [MeetingEventRow, MeetingEventRow];
  readonly locale: CopyLocale;
  readonly organizerMail: ReadonlyMap<string, string>;
  readonly phones: readonly string[];
}): ConflictOption[] {
  const L = input.locale;
  const attendeesNotified = message(L, 'plan.conflict.attendeesNotified');
  const options: ConflictOption[] = [];
  for (const event of input.events) {
    const title = clip(event.title ?? '', 80);
    const organizer = canModify(event);
    if (organizer) {
      options.push({
        option_id: `move:${event.id}`,
        kind: 'move_event',
        title: message(L, 'plan.generated.options.move.title'),
        description: copy(L, 'plan.generated.options.move.description', { title }),
        feasibility: { organizer: true, attendee_availability: 'unknown' },
        side_effects: event.attendee_count > 0 ? [attendeesNotified] : [],
        requires_capability: 'calendar_write',
        pro_required: true,
        event_id: event.id,
      });
    }
  }
  const shortenable = input.events.find(canModify);
  if (shortenable !== undefined) {
    options.push({
      option_id: `shorten:${shortenable.id}`,
      kind: 'shorten_event',
      title: message(L, 'plan.generated.options.shorten.title'),
      description: copy(L, 'plan.generated.options.shorten.description', {
        title: clip(shortenable.title ?? '', 80),
      }),
      feasibility: { organizer: true, attendee_availability: 'unknown' },
      side_effects: shortenable.attendee_count > 0 ? [attendeesNotified] : [],
      requires_capability: 'calendar_write',
      pro_required: true,
      event_id: shortenable.id,
    });
  }
  const foreign = input.events.find((e) => !canModify(e) && input.organizerMail.has(e.id));
  if (foreign !== undefined) {
    options.push({
      option_id: `email:${foreign.id}`,
      kind: 'propose_new_time_email',
      title: message(L, 'plan.generated.options.email.title'),
      description: message(L, 'plan.generated.options.email.description'),
      feasibility: { organizer: false, attendee_availability: 'unknown' },
      side_effects: [],
      requires_capability: 'mail_send',
      pro_required: true,
      event_id: foreign.id,
      reply_to_message_id: input.organizerMail.get(foreign.id)!,
    });
  }
  options.push({
    option_id: 'remind',
    kind: 'remind_me',
    title: message(L, 'plan.generated.options.remind.title'),
    description: message(L, 'plan.generated.options.remind.description'),
    feasibility: { organizer: false, attendee_availability: 'unknown' },
    side_effects: [],
    requires_capability: null,
    pro_required: false,
  });
  const phone = input.phones[0];
  if (phone !== undefined) {
    options.push({
      option_id: 'contact',
      kind: 'contact_external',
      title: message(L, 'plan.generated.options.contact.title'),
      description: `${message(L, 'plan.generated.options.contact.description')} ${phone}`,
      feasibility: { organizer: false, attendee_availability: 'unknown' },
      side_effects: [],
      requires_capability: null,
      pro_required: false,
      phone,
    });
  }
  options.push({
    option_id: 'ignore',
    kind: 'ignore',
    title: message(L, 'plan.conflict.ignore'),
    description: message(L, 'plan.generated.options.ignore.description'),
    feasibility: { organizer: false, attendee_availability: 'unknown' },
    side_effects: [],
    requires_capability: null,
    pro_required: false,
  });
  return options.slice(0, 6);
}

/** The option list the API returns (resolution data stays in the cache). */
export function publicOptions(options: readonly ConflictOption[]) {
  return options.map(({ event_id: _e, reply_to_message_id: _r, phone: _p, ...rest }) => rest);
}

export function reminderRoute(insight: PlanInsightRow, anchorAt: string): string {
  return routes.reminderNew({
    targetType: 'insight',
    targetId: insight.id,
    anchorAt,
    mode: 'remind',
  });
}
