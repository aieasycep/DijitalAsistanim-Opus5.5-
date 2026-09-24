/**
 * Reply headers (IMPLEMENTATION_PLAN T-5.12; API-MAIL-02…06; AI_PIPELINE_PLAN §13.3): recipients,
 * subject and the replied-to message are computed from the stored thread headers only — the model
 * output never sets them. Edited recipients outside the thread participants add the
 * `recipients_changed` warning that the approval's exact change shows.
 */
import type { MailMessageRow, MailThreadRow } from '../intel/types.ts';

export interface ReplyHeaders {
  readonly to: string[];
  readonly cc: string[];
  readonly subject: string;
}

const REPLY_PREFIX = /^\s*(re|ynt|yanıt|yanit|aw|sv)\s*:/i;
const MAX_SUBJECT = 998;

function lowerSet(values: readonly (string | null | undefined)[]): Set<string> {
  return new Set(
    values
      .filter((v): v is string => typeof v === 'string' && v !== '')
      .map((v) => v.toLowerCase()),
  );
}

function unique(values: readonly string[], exclude: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim().toLowerCase();
    if (v === '' || exclude.has(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** `Re: <subject>` unless the subject already carries a reply prefix. */
export function replySubject(subject: string | null): string {
  const base = (subject ?? '').trim();
  const out = base === '' ? 'Re:' : REPLY_PREFIX.test(base) ? base : `Re: ${base}`;
  return out.slice(0, MAX_SUBJECT);
}

/**
 * Reply-all headers for `message`: an inbound message is answered to its sender with the other
 * visible recipients on Cc; an outbound one (a follow-up on the user's own mail) goes to its
 * original To/Cc. The user's own addresses are never recipients.
 */
export function replyHeaders(
  message: MailMessageRow,
  own: readonly (string | null | undefined)[],
): ReplyHeaders {
  const mine = lowerSet(own);
  if (message.direction === 'inbound') {
    const to = unique([message.from_email], mine);
    const cc = unique([...message.to_emails, ...message.cc_emails], new Set([...mine, ...to]));
    return { to, cc, subject: replySubject(message.subject) };
  }
  const to = unique(message.to_emails, mine);
  const cc = unique(message.cc_emails, new Set([...mine, ...to]));
  return { to, cc, subject: replySubject(message.subject) };
}

/** Every address that appeared on the thread (participants plus the messages' headers). */
export function threadParticipants(
  thread: MailThreadRow | null,
  messages: readonly MailMessageRow[],
): Set<string> {
  return lowerSet([
    ...(thread?.participants ?? []).map((p) => p.email),
    ...messages.flatMap((m) => [m.from_email, ...m.to_emails, ...m.cc_emails]),
  ]);
}

/** `recipients_changed` when an edited recipient never appeared on the thread. */
export function recipientsChanged(
  recipients: readonly string[],
  participants: ReadonlySet<string>,
): boolean {
  return recipients.some((r) => !participants.has(r.trim().toLowerCase()));
}

/** A display first name for the greeting context ("Mehmet Bey" stays as written). */
export function recipientFirstName(message: MailMessageRow | undefined): string | null {
  const name = message?.from_name?.trim();
  if (name !== undefined && name !== '') return name.split(/\s+/)[0] ?? null;
  const local = message?.from_email.split('@')[0] ?? '';
  const word = local.split(/[._-]/)[0] ?? '';
  return word === '' ? null : word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1);
}
