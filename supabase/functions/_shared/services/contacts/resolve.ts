/**
 * Contacts from mail headers and event attendees (IMPLEMENTATION_PLAN T-5.06; M§30).
 *
 * Addresses are normalised (trimmed, `mailto:` and angle brackets removed, lower-cased), the
 * user's own addresses and automated senders are skipped (the SQL side re-checks), and a company
 * name is derived from a non-webmail domain (`ayse@contoso.com.tr` → "Contoso"). Upserts go through
 * `upsert_contacts_from_people`; `link_contact_refs` then writes `contact_id` into thread
 * participants and event attendees so person search and person intelligence match on it.
 */
import type { PersonCandidate } from '@da/domain';
import type { ContactRef, MailStore, PersonRef } from '../intel/store.ts';
import type { CalendarEventRow, MailMessageRow, Participant } from '../intel/types.ts';

const EMAIL_RE = /^[^@\s<>"]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/** Canonical form of an address, or null when it is not a mailbox address. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = raw
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/^.*<([^>]+)>.*$/, '$1')
    .trim()
    .toLowerCase();
  return EMAIL_RE.test(cleaned) ? cleaned : null;
}

/** Consumer mailbox domains: no organisation is derived from them. */
export const WEBMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.com.tr',
  'outlook.com',
  'outlook.com.tr',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.com.tr',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'yandex.com',
  'yandex.com.tr',
  'mail.ru',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'gmx.com',
  'gmx.net',
]);

const SUFFIX_LABELS: ReadonlySet<string> = new Set([
  'com',
  'net',
  'org',
  'edu',
  'gov',
  'bel',
  'k12',
  'av',
  'gen',
  'biz',
  'info',
  'co',
  'io',
  'ai',
  'app',
  'dev',
  'tr',
  'uk',
  'de',
  'eu',
  'us',
  'example',
]);

/** Company name of a work domain; null for webmail and unparseable domains. */
export function organizationFor(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (domain === '' || WEBMAIL_DOMAINS.has(domain)) return null;
  const labels = domain.split('.').filter((l) => l !== '');
  while (labels.length > 1 && SUFFIX_LABELS.has(labels[labels.length - 1]!)) labels.pop();
  const name = labels[labels.length - 1] ?? '';
  if (name.length < 2 || SUFFIX_LABELS.has(name)) return null;
  const words = name.split('-').filter((w) => w !== '');
  return words
    .map((w) => w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1))
    .join(' ')
    .slice(0, 120);
}

function isOwn(email: string, own: ReadonlySet<string>): boolean {
  return own.has(email);
}

function person(
  raw: string,
  role: PersonRef['role'],
  at: string,
  own: ReadonlySet<string>,
  name?: string | null,
): PersonRef | null {
  const email = normalizeEmail(raw);
  if (email === null || isOwn(email, own)) return null;
  return { email, name: name ?? null, organization: organizationFor(email), at, role };
}

/** People of messages: sender (with display name), To and Cc recipients. */
export function peopleFromMessages(
  messages: readonly MailMessageRow[],
  ownAddresses: readonly string[],
): PersonRef[] {
  const own = new Set(ownAddresses.map((a) => a.toLowerCase()));
  const out = new Map<string, PersonRef>();
  const add = (p: PersonRef | null) => {
    if (p === null) return;
    const prev = out.get(p.email);
    if (prev === undefined || (prev.name === null && p.name !== null)) out.set(p.email, p);
  };
  for (const m of messages) {
    add(person(m.from_email, 'from', m.received_at, own, m.from_name));
    for (const to of m.to_emails) add(person(to, 'to', m.received_at, own));
    for (const cc of m.cc_emails) add(person(cc, 'cc', m.received_at, own));
  }
  return [...out.values()];
}

/** People of calendar events: attendees other than the user. */
export function peopleFromEvents(
  events: readonly CalendarEventRow[],
  ownAddresses: readonly string[],
): PersonRef[] {
  const own = new Set(ownAddresses.map((a) => a.toLowerCase()));
  const out = new Map<string, PersonRef>();
  for (const e of events) {
    for (const a of e.attendees) {
      if (a.self === true || a.email === undefined) continue;
      const p = person(a.email, 'attendee', e.start_at, own, a.name ?? null);
      if (p !== null && !out.has(p.email)) out.set(p.email, p);
    }
  }
  return [...out.values()];
}

/** Candidates for `linkPerson` (commitment counterparties) from thread participants + contacts. */
export function personCandidates(
  participants: readonly Participant[],
  contacts: readonly ContactRef[],
): PersonCandidate[] {
  const out: PersonCandidate[] = [];
  const seen = new Set<string>();
  for (const c of contacts) {
    out.push({ id: c.id, name: c.display_name, email: c.emails[0] ?? null });
    seen.add(c.id);
  }
  for (const p of participants) {
    if (p.contact_id === null || p.contact_id === undefined || seen.has(p.contact_id)) continue;
    out.push({ id: p.contact_id, name: p.name ?? p.email, email: p.email });
    seen.add(p.contact_id);
  }
  return out;
}

/**
 * Upserts the people of the given messages/events and links them back to their threads and
 * events. Returns the contact ids by address.
 */
export async function resolveContacts(
  store: Pick<MailStore, 'upsertContacts' | 'linkContacts'>,
  input: {
    readonly userId: string;
    readonly ownAddresses: readonly string[];
    readonly messages?: readonly MailMessageRow[];
    readonly events?: readonly CalendarEventRow[];
  },
): Promise<Record<string, string>> {
  const people = [
    ...peopleFromMessages(input.messages ?? [], input.ownAddresses),
    ...peopleFromEvents(input.events ?? [], input.ownAddresses),
  ];
  if (people.length === 0) return {};
  const ids = await store.upsertContacts(input.userId, people);
  const threadIds = [...new Set((input.messages ?? []).map((m) => m.thread_id))];
  const eventIds = [...new Set((input.events ?? []).map((e) => e.id))];
  if (threadIds.length > 0 || eventIds.length > 0) {
    await store.linkContacts(input.userId, threadIds, eventIds);
  }
  return ids;
}
