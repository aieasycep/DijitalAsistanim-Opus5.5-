/**
 * Deterministic demo dataset (INTEGRATION_PLAN §13.2–§13.3; T-4.10): a pure function of
 * (flavour, user time zone, local anchor day). Ids are `demo:{template}:{yyyymmdd}`, times are local
 * wall-clock times relative to the anchor day (DST-safe via `zonedWallTimeToInstant`), and a mail is
 * visible once its arrival time has passed. The same day always yields the same items.
 */
import {
  addDaysToLocalDate,
  formatInZone,
  isoWeekdayOf,
  localDate,
  type MailAddress,
  type NormalizedCalendar,
  type NormalizedEvent,
  type NormalizedMailMessage,
  type NormalizedTask,
  type NormalizedTaskList,
  zonedWallTimeToInstant,
} from '@da/domain';
import {
  calendarFor,
  conferenceUrlFor,
  DEMO_CALENDARS,
  type DemoEventTemplate,
  EVENT_TEMPLATES,
  WEEKLY_TEAM,
} from './events.ts';
import { type DemoDates, type DemoMailTemplate, MAIL_TEMPLATES, selfOf } from './mails.ts';
import type { DemoFlavor, DemoPerson } from './people.ts';
import { DEMO_TASK_LISTS } from './tasks.ts';

export { DEMO_SELF, type DemoFlavor, PEOPLE } from './people.ts';

export interface DemoMail {
  readonly message: NormalizedMailMessage;
  readonly body: string;
  readonly arriveAt: string;
}

export interface DemoDataset {
  readonly anchor: string;
  readonly mails: readonly DemoMail[];
  readonly calendars: readonly NormalizedCalendar[];
  readonly events: readonly NormalizedEvent[];
  readonly taskLists: readonly NormalizedTaskList[];
  readonly tasks: readonly NormalizedTask[];
}

const MESSAGE_ID_DOMAIN = 'demo.dijitalasistan.app';

function stamp(anchor: string): string {
  return anchor.replace(/-/g, '');
}

function at(anchor: string, day: number, time: string, timeZone: string): Date {
  return zonedWallTimeToInstant(addDaysToLocalDate(anchor, day), time, timeZone);
}

function datesFor(anchor: string, timeZone: string): DemoDates {
  const noon = (offset: number) => at(anchor, offset, '12:00', timeZone);
  return {
    day: (offset) => formatInZone(noon(offset), timeZone, 'd MMMM'),
    dayWithWeekday: (offset) => formatInZone(noon(offset), timeZone, 'd MMMM EEEE'),
  };
}

function text(value: string | ((d: DemoDates) => string) | undefined, dates: DemoDates): string {
  return typeof value === 'function' ? value(dates) : (value ?? '');
}

function addr(person: DemoPerson): MailAddress {
  return { address: person.email, name: person.name };
}

const CATEGORY_LABEL: Readonly<Record<DemoMailTemplate['category'], string>> = {
  primary: 'CATEGORY_PERSONAL',
  promotions: 'CATEGORY_PROMOTIONS',
  social: 'CATEGORY_SOCIAL',
  updates: 'CATEGORY_UPDATES',
  forums: 'CATEGORY_FORUMS',
};

function mailOf(
  template: DemoMailTemplate,
  flavor: DemoFlavor,
  anchor: string,
  timeZone: string,
  dates: DemoDates,
): DemoMail {
  const self = selfOf(flavor);
  const from = template.from === 'self' ? self : template.from;
  const sent = template.from === 'self';
  const arrive = at(anchor, template.day, template.at, timeZone).toISOString();
  const s = stamp(anchor);
  const snippet = text(template.snippet, dates);
  const labels = sent
    ? ['SENT']
    : flavor === 'google'
      ? [
          'INBOX',
          CATEGORY_LABEL[template.category],
          ...(template.unread === true ? ['UNREAD'] : []),
          ...(template.starred === true ? ['STARRED'] : []),
        ]
      : ['INBOX'];
  const auth = template.auth;
  const message: NormalizedMailMessage = {
    providerMessageId: `demo:${template.id}:${s}`,
    providerThreadId: `demo-thread:${template.threadKey}:${s}`,
    rfc822MessageId: `<demo-${template.id}-${s}@${MESSAGE_ID_DOMAIN}>`,
    inReplyTo:
      template.replyToTemplate === undefined
        ? null
        : `<demo-${template.replyToTemplate}-${s}@${MESSAGE_ID_DOMAIN}>`,
    references:
      template.replyToTemplate === undefined
        ? []
        : [`<demo-${template.replyToTemplate}-${s}@${MESSAGE_ID_DOMAIN}>`],
    folder: sent ? 'sent' : 'inbox',
    labels,
    providerCategory:
      flavor === 'google'
        ? template.category
        : template.category === 'primary'
          ? 'focused'
          : 'other',
    from: addr(from),
    replyTo: [],
    to: template.to.map((p) => addr(p === 'self' ? self : p)),
    cc: (template.cc ?? []).map(addr),
    subject: text(template.subject, dates),
    snippet: snippet.slice(0, 200),
    sentAt: arrive,
    receivedAt: arrive,
    isRead: sent || template.unread !== true,
    isFlagged: template.starred === true,
    providerImportance: template.importance ?? null,
    hasAttachments: false,
    sizeBytes: null,
    headers: {
      listUnsubscribe: template.listUnsubscribe === true,
      listId:
        template.listUnsubscribe === true
          ? `<bulten.${from.email.split('@')[1] ?? 'example.com'}>`
          : null,
      precedence: template.listUnsubscribe === true ? 'bulk' : null,
      autoSubmitted: null,
      authentication:
        auth === undefined
          ? null
          : { dkim: auth.dkim, spf: auth.spf, dmarc: auth.dmarc, dkimDomain: auth.domain },
      priority: template.importance ?? null,
    },
    webLink: null,
    deleted: false,
  };
  return { message, body: text(template.body, dates) || snippet, arriveAt: arrive };
}

function eventOf(
  template: DemoEventTemplate,
  flavor: DemoFlavor,
  anchor: string,
  timeZone: string,
  id: string,
): NormalizedEvent {
  const self = selfOf(flavor);
  const start = at(anchor, template.day, template.start, timeZone).toISOString();
  const end = at(anchor, template.day, template.end, timeZone).toISOString();
  return {
    providerEventId: id,
    providerCalendarId: calendarFor(flavor, template.calendar),
    iCalUid: `${id}@${MESSAGE_ID_DOMAIN}`,
    seriesMasterId: template.id === WEEKLY_TEAM.id ? `demo:${WEEKLY_TEAM.id}` : null,
    originalStart: null,
    isOccurrence: template.id === WEEKLY_TEAM.id,
    status: 'confirmed',
    title: template.title,
    descriptionSnippet: template.description ?? null,
    location: template.location ?? null,
    start: { dateTime: start, timeZone },
    end: { dateTime: end, timeZone },
    allDay: false,
    organizer: { address: self.email, name: self.name },
    userIsOrganizer: true,
    attendees: [
      {
        email: self.email,
        name: self.name,
        responseStatus: 'accepted',
        isSelf: true,
        isOrganizer: true,
      },
      ...template.attendees.map((p) => ({
        email: p.email,
        name: p.name,
        responseStatus: 'accepted' as const,
        isSelf: false,
        isOrganizer: false,
      })),
    ],
    conferenceUrl: template.conference === true ? conferenceUrlFor(flavor, template.id) : null,
    transparency: 'busy',
    visibility: 'default',
    etag: `"demo-${id}"`,
    updatedAt: at(anchor, -7, '09:00', timeZone).toISOString(),
    daApprovalId: null,
    deleted: false,
  };
}

/**
 * Materialises the dataset of the local day containing `now` (or of `anchor`, a `YYYY-MM-DD` local
 * day, when given: the adapters use it to retire the items of earlier days).
 */
export function demoDataset(input: {
  flavor: DemoFlavor;
  timeZone: string;
  now: Date;
  anchor?: string;
}): DemoDataset {
  const anchor = input.anchor ?? localDate(input.now, input.timeZone);
  const dates = datesFor(anchor, input.timeZone);
  const mails = MAIL_TEMPLATES.map((t) => mailOf(t, input.flavor, anchor, input.timeZone, dates));

  const calendars: NormalizedCalendar[] = DEMO_CALENDARS[input.flavor].map((c) => ({
    providerCalendarId: c.id,
    name: c.name,
    color: c.color,
    timeZone: input.timeZone,
    accessRole: 'owner',
    isPrimary: c.primary,
    canWrite: true,
    kind: c.primary ? 'default' : 'other',
    deleted: false,
  }));

  const s = stamp(anchor);
  const events: NormalizedEvent[] = EVENT_TEMPLATES.map((t) =>
    eventOf(t, input.flavor, anchor, input.timeZone, `demo:${t.id}:${s}`),
  );
  for (let offset = -7; offset <= 21; offset++) {
    const day = addDaysToLocalDate(anchor, offset);
    if (isoWeekdayOf(day) !== 1) continue;
    events.push(
      eventOf(
        { ...WEEKLY_TEAM, day: offset },
        input.flavor,
        anchor,
        input.timeZone,
        `demo:${WEEKLY_TEAM.id}:${stamp(day)}`,
      ),
    );
  }

  const list = DEMO_TASK_LISTS[input.flavor];
  const tasks: NormalizedTask[] = list.tasks.map((t) => ({
    providerTaskId: `demo:${t.id}:${s}`,
    providerListId: list.id,
    title: t.title,
    notesSnippet: t.notes ?? null,
    status: t.completedDay === undefined ? 'open' : 'completed',
    due: t.dueDay === undefined ? null : { date: addDaysToLocalDate(anchor, t.dueDay) },
    completedAt:
      t.completedDay === undefined
        ? null
        : at(anchor, t.completedDay, '18:00', input.timeZone).toISOString(),
    importance: null,
    updatedAt: at(anchor, -1, '08:00', input.timeZone).toISOString(),
    daMarker: null,
    deleted: false,
  }));

  return {
    anchor,
    mails,
    calendars,
    events,
    taskLists: [{ providerListId: list.id, name: list.name, isDefault: true, deleted: false }],
    tasks,
  };
}
