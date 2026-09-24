/**
 * Assistant data (M-ASST-01/02): persisted threads (titles only, `['assistant','threads']`), the
 * message history of a thread (PostgREST `assistant_messages`, oldest first), thread deletion
 * (`DELETE assistant_threads`, cascading to messages) and answer feedback (`ai_feedback`).
 */
import { qk } from '@da/api-client';
import { useQuery } from '@tanstack/react-query';

import { getSupabase } from '../../lib/auth/supabase';
import { toDataError } from '../../lib/postgrest';

type DbError = { message?: string; code?: string } | null;

export interface ThreadRow {
  readonly id: string;
  readonly title: string | null;
  readonly lastMessageAt: string | null;
  readonly scope: string;
  readonly contactId: string | null;
  readonly contactName: string | null;
}

export async function fetchThreads(limit = 20): Promise<readonly ThreadRow[]> {
  const { data, error } = (await getSupabase()
    .from('assistant_threads')
    .select('id, title, last_message_at, scope, scope_ref_id')
    .is('archived_at', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .range(0, limit - 1)) as { data: Record<string, unknown>[] | null; error: DbError };
  if (error !== null) throw toDataError(error);
  const rows = data ?? [];
  const contactIds = rows
    .filter((r) => r.scope === 'person' && typeof r.scope_ref_id === 'string')
    .map((r) => String(r.scope_ref_id));
  const names = new Map<string, string>();
  if (contactIds.length > 0) {
    const { data: contacts } = (await getSupabase()
      .from('contacts')
      .select('id, display_name')
      .in('id', contactIds)) as { data: { id: string; display_name: string }[] | null };
    for (const contact of contacts ?? []) names.set(contact.id, contact.display_name);
  }
  return rows.map((r) => {
    const contactId = typeof r.scope_ref_id === 'string' ? r.scope_ref_id : null;
    return {
      id: String(r.id),
      title: typeof r.title === 'string' ? r.title : null,
      lastMessageAt: typeof r.last_message_at === 'string' ? r.last_message_at : null,
      scope: typeof r.scope === 'string' ? r.scope : 'global',
      contactId,
      contactName: contactId === null ? null : (names.get(contactId) ?? null),
    };
  });
}

export function useThreads(enabled = true) {
  return useQuery({
    queryKey: qk.assistant.threads(),
    queryFn: () => fetchThreads(),
    meta: { persist: true },
    enabled,
  });
}

export async function deleteThread(id: string): Promise<void> {
  const { error } = (await getSupabase().from('assistant_threads').delete().eq('id', id)) as {
    error: DbError;
  };
  if (error !== null) throw toDataError(error);
}

export interface Citation {
  readonly index: number;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly provider: string | null;
  readonly timestamp: string | null;
  readonly title: string;
  readonly snippet: string;
  readonly route: string | null;
}

export interface StoredMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly status: string;
  readonly citations: readonly Citation[];
  readonly cards: readonly unknown[];
  readonly approvalIds: readonly string[];
  readonly followups: readonly string[];
  readonly grounded: boolean;
  readonly finishReason: string | null;
  readonly createdAt: string;
}

function citationsOf(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw, index) => {
      const c = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
      const source = (typeof c.source === 'object' && c.source !== null ? c.source : c) as Record<
        string,
        unknown
      >;
      return {
        index: typeof c.index === 'number' ? c.index : index,
        sourceType: typeof source.source_type === 'string' ? source.source_type : 'email_message',
        sourceId: typeof source.source_id === 'string' ? source.source_id : null,
        provider: typeof source.source_provider === 'string' ? source.source_provider : null,
        timestamp: typeof source.source_timestamp === 'string' ? source.source_timestamp : null,
        title: typeof c.title === 'string' ? c.title : '',
        snippet: typeof c.snippet === 'string' ? c.snippet : '',
        route: typeof source.open_route === 'string' ? source.open_route : null,
      };
    })
    .filter((c) => c.title !== '');
}

function stringsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) =>
      typeof v === 'string'
        ? v
        : typeof v === 'object' && v !== null && typeof (v as { text?: unknown }).text === 'string'
          ? (v as { text: string }).text
          : '',
    )
    .filter((v) => v !== '');
}

export async function fetchMessages(threadId: string): Promise<readonly StoredMessage[]> {
  const { data, error } = (await getSupabase()
    .from('assistant_messages')
    .select(
      'id, role, content, status, citations, cards, proposed_approval_ids, followup_suggestions, grounded, finish_reason, created_at',
    )
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .range(0, 29)) as { data: Record<string, unknown>[] | null; error: DbError };
  if (error !== null) throw toDataError(error);
  return (data ?? [])
    .map((m) => ({
      id: String(m.id),
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: typeof m.content === 'string' ? m.content : '',
      status: typeof m.status === 'string' ? m.status : 'complete',
      citations: citationsOf(m.citations),
      cards: Array.isArray(m.cards) ? (m.cards as unknown[]) : [],
      approvalIds: Array.isArray(m.proposed_approval_ids)
        ? (m.proposed_approval_ids as unknown[]).map(String)
        : [],
      followups: stringsOf(m.followup_suggestions),
      grounded: m.grounded === true,
      finishReason: typeof m.finish_reason === 'string' ? m.finish_reason : null,
      createdAt: typeof m.created_at === 'string' ? m.created_at : '',
    }))
    .reverse();
}

export function useMessages(threadId: string | null) {
  return useQuery({
    queryKey: qk.assistant.messages(threadId ?? 'new'),
    queryFn: () => fetchMessages(threadId ?? ''),
    enabled: threadId !== null,
    meta: { persist: true },
  });
}

export async function fetchThread(threadId: string) {
  const { data } = (await getSupabase()
    .from('assistant_threads')
    .select('id, title, scope, scope_ref_id')
    .eq('id', threadId)
    .maybeSingle()) as { data: Record<string, unknown> | null };
  if (data === null) return null;
  let contactName: string | null = null;
  if (data.scope === 'person' && typeof data.scope_ref_id === 'string') {
    const { data: contact } = (await getSupabase()
      .from('contacts')
      .select('display_name')
      .eq('id', data.scope_ref_id)
      .maybeSingle()) as { data: { display_name: string } | null };
    contactName = contact?.display_name ?? null;
  }
  return {
    id: String(data.id),
    title: typeof data.title === 'string' ? data.title : null,
    contactId: typeof data.scope_ref_id === 'string' ? data.scope_ref_id : null,
    contactName,
  };
}

/** "Faydalı" / "Faydalı değil" (`ai_feedback`, content-free). */
export async function sendAnswerFeedback(
  targetType: 'assistant_message' | 'search_answer',
  targetId: string,
  rating: 1 | -1,
): Promise<void> {
  const { error } = (await getSupabase()
    .from('ai_feedback')
    .insert({
      target_type: targetType,
      target_id: targetId,
      rating,
      reason_code: rating === 1 ? 'helpful' : 'inaccurate',
    } as never)) as { error: DbError };
  if (error !== null) throw toDataError(error);
}
