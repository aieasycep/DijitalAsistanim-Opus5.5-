/**
 * Normalised provider DTOs → the stored subset (DATABASE_AND_RLS_PLAN §4.3; INTEGRATION_PLAN §3.8,
 * §3.15). Mail keeps headers, ≤ 200-char snippets and deterministic triage signals only (no body);
 * events keep a ≤ 500-char description excerpt and an allow-listed conference URL; tasks keep a
 * ≤ 500-char notes excerpt. All-day items are stored with their dates and the local-midnight
 * instants of the event's (or the user's) time zone.
 */
import {
  checkConferencingUrl,
  type EventTime,
  type NormalizedEvent,
  type NormalizedMailMessage,
  type NormalizedTask,
  zonedWallTimeToInstant,
} from '@da/domain';
import { sha256Hex } from '../../crypto/hmac.ts';
import type { EventRow, MailRow, TaskRow } from './types.ts';

const BULK_PRECEDENCE = new Set(['bulk', 'list', 'junk']);

function authPass(value: 'pass' | 'fail' | 'none' | null | undefined): boolean | null {
  if (value === 'pass') return true;
  if (value === 'fail') return false;
  return null;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export async function mailRowOf(
  message: NormalizedMailMessage,
  webLink: string | null,
): Promise<MailRow> {
  const headers = message.headers;
  return {
    provider_message_id: message.providerMessageId,
    provider_thread_id: message.providerThreadId,
    internet_message_id: message.rfc822MessageId,
    in_reply_to: message.inReplyTo,
    references_ids: message.references.slice(-20),
    direction: message.folder === 'sent' ? 'outbound' : 'inbound',
    from_email: (message.from?.address ?? '').toLowerCase(),
    from_name: message.from?.name ?? null,
    to_emails: message.to.slice(0, 50).map((a) => a.address.toLowerCase()),
    cc_emails: message.cc.slice(0, 50).map((a) => a.address.toLowerCase()),
    subject: message.subject.slice(0, 500),
    snippet: message.snippet.slice(0, 200),
    sent_at: message.sentAt,
    received_at: message.receivedAt,
    is_read: message.isRead,
    importance: message.providerImportance,
    labels: message.labels,
    has_attachments: message.hasAttachments === true,
    list_unsubscribe: headers.listUnsubscribe,
    auto_submitted: headers.autoSubmitted !== null && headers.autoSubmitted.toLowerCase() !== 'no',
    precedence_bulk:
      headers.precedence !== null && BULK_PRECEDENCE.has(headers.precedence.toLowerCase()),
    dkim_pass: authPass(headers.authentication?.dkim),
    spf_pass: authPass(headers.authentication?.spf),
    content_hash: await sha256Hex(
      `${normalizeText(message.subject)}\n${normalizeText(message.snippet)}`,
    ),
    web_link: webLink,
    thread_web_link: null,
    deleted: message.deleted,
  };
}

function instantOf(time: EventTime, timeZone: string): string {
  if ('date' in time) {
    try {
      return zonedWallTimeToInstant(time.date, '00:00', timeZone).toISOString();
    } catch {
      return zonedWallTimeToInstant(time.date, '00:00', 'UTC').toISOString();
    }
  }
  return new Date(time.dateTime).toISOString();
}

export function conferenceUrlOf(url: string | null): string | null {
  if (url === null) return null;
  const check = checkConferencingUrl(url);
  return check.ok ? check.url : null;
}

export function eventRowOf(event: NormalizedEvent, userTimeZone: string): EventRow {
  const zone = ('timeZone' in event.start ? event.start.timeZone : null) ?? userTimeZone;
  const allDay = event.allDay || 'date' in event.start;
  return {
    provider_event_id: event.providerEventId,
    ical_uid: event.iCalUid,
    recurring_event_id: event.seriesMasterId,
    etag: event.etag,
    title: event.title.slice(0, 300),
    description_excerpt:
      event.descriptionSnippet === null ? null : event.descriptionSnippet.slice(0, 500),
    location: event.location === null ? null : event.location.slice(0, 300),
    conference_url: conferenceUrlOf(event.conferenceUrl),
    start_at: instantOf(event.start, zone),
    end_at: instantOf(event.end, zone),
    all_day: allDay,
    start_date: 'date' in event.start ? event.start.date : null,
    end_date: 'date' in event.end ? event.end.date : null,
    time_zone: zone,
    status: event.status,
    organizer_email: event.organizer?.address.toLowerCase() ?? null,
    organizer_self: event.userIsOrganizer,
    can_modify: event.userIsOrganizer,
    attendees: event.attendees.slice(0, 100).map((a) => ({
      email: a.email.toLowerCase(),
      name: a.name,
      response: a.responseStatus,
    })),
    attendee_count: event.attendees.length,
    da_approval_id: event.daApprovalId,
    provider_updated_at: event.updatedAt,
    deleted: event.deleted || event.status === 'cancelled',
  };
}

export function taskRowOf(task: NormalizedTask): TaskRow {
  const due = task.due;
  return {
    provider_task_id: task.providerTaskId,
    provider_list_id: task.providerListId,
    title: task.title.slice(0, 500),
    notes_excerpt: task.notesSnippet === null ? null : task.notesSnippet.slice(0, 500),
    due_date: due !== null && 'date' in due ? due.date : null,
    due_at: due !== null && 'dateTime' in due ? new Date(due.dateTime).toISOString() : null,
    status: task.status,
    completed_at: task.completedAt,
    deleted: task.deleted,
  };
}

export function deletedTaskRow(providerTaskId: string, providerListId: string): TaskRow {
  return {
    provider_task_id: providerTaskId,
    provider_list_id: providerListId,
    title: '',
    notes_excerpt: null,
    due_date: null,
    due_at: null,
    status: 'open',
    completed_at: null,
    deleted: true,
  };
}
