/**
 * Waiting (M-WAIT-01, `insights.kind='reply_needed'`) and Follow-ups (M-FUP-01,
 * `insights.kind='follow_up'`) read models: the open insights joined in one extra query to their
 * source messages (sender / recipient, subject, time) — explicit columns, RLS-scoped. Waiting is
 * grouped ACİL / BUGÜN / DAHA SONRA and sorted by grounded due date then waiting time.
 */
import { qk } from '@da/api-client';
import { queryOptions } from '@tanstack/react-query';

import { getSupabase } from '../../lib/auth/supabase';
import { unwrap } from '../../lib/data/rpc';

export interface PersonItem {
  readonly id: string;
  readonly title: string;
  readonly body: string | null;
  readonly urgency: 'urgent' | 'today' | 'normal' | 'low';
  readonly dueAt: string | null;
  readonly since: string;
  readonly messageId: string | null;
  readonly threadId: string | null;
  readonly person: string;
  readonly personEmail: string | null;
  readonly topic: string | null;
  readonly provider: string | null;
}

const INSIGHT_COLUMNS =
  'id,title,body,urgency,due_at,entity_type,entity_id,source_type,source_id,source_provider,source_timestamp,created_at';

async function fetchPeople(kind: 'reply_needed' | 'follow_up'): Promise<PersonItem[]> {
  const supabase = getSupabase();
  const rows = unwrap(
    await supabase
      .from('insights')
      .select(INSIGHT_COLUMNS)
      .eq('kind', kind)
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(100),
  );
  const messageIds = rows.filter((r) => r.source_type === 'email_message').map((r) => r.source_id);
  const messages =
    messageIds.length === 0
      ? []
      : unwrap(
          await supabase
            .from('email_messages')
            .select('id,thread_id,from_name,from_email,to_emails,subject,received_at,provider')
            .in('id', messageIds),
        );
  const byId = new Map(messages.map((m) => [m.id, m]));
  return rows.map((r) => {
    const m = r.source_type === 'email_message' ? byId.get(r.source_id) : undefined;
    const threadId = r.entity_type === 'email_thread' ? r.entity_id : (m?.thread_id ?? null);
    const recipient = m?.to_emails[0] ?? null;
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      urgency: r.urgency,
      dueAt: r.due_at,
      since: m?.received_at ?? r.source_timestamp,
      messageId: m?.id ?? null,
      threadId,
      person:
        kind === 'follow_up' ? (recipient ?? r.title) : (m?.from_name ?? m?.from_email ?? r.title),
      personEmail: kind === 'follow_up' ? recipient : (m?.from_email ?? null),
      topic: m?.subject ?? null,
      provider: m?.provider ?? r.source_provider,
    };
  });
}

export type UrgencyGroup = 'urgent' | 'today' | 'later';

export function groupOf(urgency: PersonItem['urgency']): UrgencyGroup {
  if (urgency === 'urgent') return 'urgent';
  if (urgency === 'today') return 'today';
  return 'later';
}

/** Due date ascending (nulls last), then the longest wait first. */
export function sortWaiting(items: readonly PersonItem[]): PersonItem[] {
  return [...items].sort((a, b) => {
    const da = a.dueAt === null ? Number.POSITIVE_INFINITY : Date.parse(a.dueAt);
    const db = b.dueAt === null ? Number.POSITIVE_INFINITY : Date.parse(b.dueAt);
    if (da !== db) return da - db;
    return Date.parse(a.since) - Date.parse(b.since);
  });
}

export function waitingOptions() {
  return queryOptions({
    queryKey: qk.waiting.list(),
    queryFn: () => fetchPeople('reply_needed'),
    staleTime: 60_000,
    meta: { persist: true },
  });
}

export function followupsOptions(enabled: boolean) {
  return queryOptions({
    queryKey: qk.followups.list(),
    queryFn: () => fetchPeople('follow_up'),
    staleTime: 60_000,
    meta: { persist: true },
    enabled,
  });
}
