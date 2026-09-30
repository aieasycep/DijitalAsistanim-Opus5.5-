/**
 * People data (T-8.16): RPC-03 `person_intelligence` (Pro sections arrive under `locked_sections`
 * for Free), `vip_people` owner-scoped CRUD (stored on every plan up to `vip_max`; the trigger
 * raises `PLAN_LIMIT:vip_max`), RPC-13 `vip_suggestions` (Pro), RPC-23 `upsert_manual_contact`
 * (add a VIP by e-mail, R-24) and the contact picker over `contacts`. VIP writes are internal and
 * idempotent on `(user_id, contact_id)`, so offline they wait for the connection.
 */
import { qk } from '@da/api-client';
import { VIP_RELATIONSHIP_VALUES, type VipRelationship } from '@da/domain';
import { foldForSearch } from '@da/i18n';
import { queryOptions } from '@tanstack/react-query';

import { getSupabase } from '../../lib/auth/supabase';
import { DataError, rpc, toDataError } from '../../lib/postgrest';
import { runOrQueue } from '../../lib/offline/mutations';
import { getQueryClient } from '../../lib/query/client';

type DbError = { message?: string; code?: string } | null;

export interface PersonData {
  readonly contact: {
    readonly id: string;
    readonly name: string;
    readonly email: string | null;
    readonly organization: string | null;
    readonly title: string | null;
  };
  readonly isVip: boolean;
  readonly relationship: VipRelationship | null;
  readonly lastContactAt: string | null;
  readonly meetings: readonly { id: string; title: string; startAt: string }[];
  readonly emails: readonly {
    threadId: string;
    subject: string;
    summary: string | null;
    at: string | null;
  }[];
  readonly topics: readonly string[];
  readonly openLoops: readonly { insightId: string; title: string; dueAt: string | null }[];
  readonly userOwes: readonly { id: string; text: string; dueAt: string | null }[];
  readonly theyOwe: readonly { id: string; text: string; dueAt: string | null }[];
  readonly locked: readonly string[];
}

function arr(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    : [];
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function relationshipOf(value: unknown): VipRelationship | null {
  return (VIP_RELATIONSHIP_VALUES as readonly unknown[]).includes(value)
    ? (value as VipRelationship)
    : null;
}

export function parsePerson(raw: unknown): PersonData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;
  const contact = (data.contact ?? {}) as Record<string, unknown>;
  const id = str(contact.id);
  if (id === null) return null;
  const owes = (value: unknown) =>
    arr(value).map((c) => ({ id: String(c.id), text: str(c.text) ?? '', dueAt: str(c.due_at) }));
  return {
    contact: {
      id,
      name: str(contact.display_name) ?? str(contact.primary_email) ?? '',
      email: str(contact.primary_email),
      organization: str(contact.organization),
      title: str(contact.title),
    },
    isVip: data.is_vip === true,
    relationship: relationshipOf(data.relationship),
    lastContactAt: str(data.last_contact_at),
    meetings: arr(data.upcoming_meetings).map((m) => ({
      id: String(m.id),
      title: str(m.title) ?? '',
      startAt: str(m.start_at) ?? '',
    })),
    emails: arr(data.related_emails).map((e) => ({
      threadId: String(e.thread_id),
      subject: str(e.subject) ?? '',
      summary: str(e.ai_summary),
      at: str(e.last_message_at),
    })),
    topics: Array.isArray(data.recent_topics)
      ? data.recent_topics.filter((t): t is string => typeof t === 'string')
      : [],
    openLoops: arr(data.open_loops).map((l) => ({
      insightId: String(l.insight_id),
      title: str(l.title) ?? '',
      dueAt: str(l.due_at),
    })),
    userOwes: owes(data.user_owes),
    theyOwe: owes(data.they_owe),
    locked: Array.isArray(data.locked_sections)
      ? data.locked_sections.filter((s): s is string => typeof s === 'string')
      : [],
  };
}

export function personQueryOptions(contactId: string) {
  return queryOptions({
    queryKey: qk.person.detail(contactId),
    queryFn: async () => parsePerson(await rpc('person_intelligence', { p_contact_id: contactId })),
    meta: { persist: true },
    staleTime: 60_000,
  });
}

export interface VipRow {
  readonly id: string;
  readonly contactId: string;
  readonly name: string;
  readonly email: string | null;
  readonly organization: string | null;
  readonly relationship: VipRelationship;
  readonly alwaysNotify: boolean;
  readonly bypassQuietHours: boolean;
  readonly origin: string;
  readonly createdAt: string;
}

export async function fetchVips(): Promise<readonly VipRow[]> {
  const { data, error } = (await getSupabase()
    .from('vip_people')
    .select(
      'id, contact_id, relationship, always_notify, bypass_quiet_hours, origin, created_at, contacts(display_name, primary_email, organization)',
    )
    .order('created_at', { ascending: false })) as {
    data: Record<string, unknown>[] | null;
    error: DbError;
  };
  if (error !== null) throw toDataError(error);
  return (data ?? []).map((row) => {
    const contact = (row.contacts ?? {}) as Record<string, unknown>;
    return {
      id: String(row.id),
      contactId: String(row.contact_id),
      name: str(contact.display_name) ?? str(contact.primary_email) ?? '',
      email: str(contact.primary_email),
      organization: str(contact.organization),
      relationship: relationshipOf(row.relationship) ?? 'other',
      alwaysNotify: row.always_notify !== false,
      bypassQuietHours: row.bypass_quiet_hours !== false,
      origin: str(row.origin) ?? 'user',
      createdAt: str(row.created_at) ?? '',
    };
  });
}

export function vipListQueryOptions() {
  return queryOptions({
    queryKey: qk.vip.list(),
    queryFn: fetchVips,
    meta: { persist: true },
  });
}

export interface VipSuggestion {
  readonly contactId: string;
  readonly name: string;
  readonly organization: string | null;
  readonly exchanges: number;
}

export async function fetchVipSuggestions(): Promise<readonly VipSuggestion[]> {
  const data = await rpc('vip_suggestions', {});
  return arr(data).map((s) => ({
    contactId: String(s.contact_id),
    name: str(s.display_name) ?? str(s.primary_email) ?? '',
    organization: str(s.organization),
    exchanges: typeof s.exchanges_30d === 'number' ? s.exchanges_30d : 0,
  }));
}

export interface VipSettings {
  readonly relationship: VipRelationship;
  readonly alwaysNotify: boolean;
  readonly bypassQuietHours: boolean;
}

export function invalidatePeople(contactId?: string): void {
  const client = getQueryClient();
  void client.invalidateQueries({ queryKey: qk.vip.all });
  void client.invalidateQueries({ queryKey: qk.contacts.vipSuggestions() });
  void client.invalidateQueries({ queryKey: qk.today.all });
  if (contactId !== undefined)
    void client.invalidateQueries({ queryKey: qk.person.detail(contactId) });
}

/**
 * Insert or update the VIP row of a contact (unique on `(user_id, contact_id)`), through the
 * offline mutation queue (`vip_set`, last write wins per contact): offline it is queued and sent on
 * reconnect; online a failure (e.g. `PLAN_LIMIT:vip_max`) rejects.
 */
export async function saveVip(
  contactId: string,
  settings: VipSettings,
  origin: 'user' | 'suggestion' | 'onboarding' = 'user',
  existingId: string | null = null,
): Promise<void> {
  const result = await runOrQueue('vip_set', {
    contactId,
    on: true,
    settings: {
      relationship: settings.relationship,
      alwaysNotify: settings.alwaysNotify,
      bypassQuietHours: settings.bypassQuietHours,
    },
    ...(existingId === null ? { origin } : {}),
  });
  if (result.status === 'failed') throw result.error;
  invalidatePeople(contactId);
}

/** Removes a contact's VIP row (queued offline like {@link saveVip}). */
export async function removeVip(_vipId: string, contactId: string): Promise<void> {
  const result = await runOrQueue('vip_set', { contactId, on: false });
  if (result.status === 'failed') throw result.error;
  invalidatePeople(contactId);
}

/** RPC-23: the owner's contact for an e-mail (created when new). */
export async function upsertManualContact(email: string, name: string): Promise<string> {
  const id = await rpc('upsert_manual_contact', {
    p_email: email.trim().toLowerCase(),
    ...(name.trim() === '' ? {} : { p_display_name: name.trim() }),
  });
  return id;
}

/** Whether a failed VIP write hit the Free limit (`PLAN_LIMIT:vip_max`). */
export function isVipLimit(error: unknown): boolean {
  return error instanceof DataError && error.code === 'PLAN_LIMIT';
}

export interface ContactRow {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly organization: string | null;
}

/** Contacts for the picker (recent correspondents first), filtered by name or e-mail. */
export async function fetchContacts(term: string): Promise<readonly ContactRow[]> {
  const { data, error } = (await getSupabase()
    .from('contacts')
    .select('id, display_name, primary_email, organization, last_contact_at')
    .is('merged_into_id', null)
    .order('last_contact_at', { ascending: false, nullsFirst: false })
    .limit(50)) as { data: Record<string, unknown>[] | null; error: DbError };
  if (error !== null) throw toDataError(error);
  const needle = foldForSearch(term.trim());
  return (data ?? [])
    .map((c) => ({
      id: String(c.id),
      name: str(c.display_name) ?? str(c.primary_email) ?? '',
      email: str(c.primary_email),
      organization: str(c.organization),
    }))
    .filter(
      (c) =>
        needle === '' ||
        foldForSearch(c.name).includes(needle) ||
        foldForSearch(c.email ?? '').includes(needle),
    );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}
