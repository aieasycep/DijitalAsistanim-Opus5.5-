/**
 * Supabase implementation of `ExecuteRepo` for the worker (service role). Internal inserts are
 * idempotent on the approval key (`tasks.idempotency_key`, `reminders.idempotency_key` through
 * `schedule_reminder`, `commitments.dedupe_key`): a unique violation returns the existing row.
 */
import type { AccountDataSourceToggles, ProviderAccountRef } from '@da/domain';
import type { DbClient } from '../../../db/clients.ts';
import { DB_FN, rpc } from '../../../db/functions.ts';
import { mapDbError } from '../../../errors.ts';
import { APPROVAL_COLUMNS, supabaseApprovalsRepo, toApprovalRow } from '../repo.ts';
import type { ExecuteRepo, MailContext } from './model.ts';

type DbError = { code?: string; message?: string };

async function one<T>(
  query: PromiseLike<{ data: unknown; error: DbError | null }>,
): Promise<T | null> {
  const { data, error } = await query;
  if (error !== null) throw mapDbError(error);
  return (data ?? null) as T | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function supabaseExecuteRepo(system: DbClient): ExecuteRepo {
  const approvals = supabaseApprovalsRepo(system);

  async function insertIdempotent(
    table: 'tasks' | 'commitments',
    row: Record<string, unknown>,
    keyColumn: 'idempotency_key' | 'dedupe_key',
  ): Promise<{ id: string; created: boolean }> {
    const { data, error } = await system.from(table).insert(row).select('id').maybeSingle();
    if (error === null && data !== null) return { id: (data as { id: string }).id, created: true };
    if (error !== null && error.code !== '23505') throw mapDbError(error);
    const existing = await one<{ id: string }>(
      system
        .from(table)
        .select('id')
        .eq('user_id', row.user_id as string)
        .eq(keyColumn, row[keyColumn] as string)
        .maybeSingle(),
    );
    if (existing === null) throw mapDbError(error ?? { code: 'P0002', message: 'NOT_FOUND' });
    return { id: existing.id, created: false };
  }

  return {
    async approval(id) {
      const row = await one<Record<string, unknown>>(
        system.from('approval_actions').select(APPROVAL_COLUMNS).eq('id', id).maybeSingle(),
      );
      return row === null ? null : toApprovalRow(row);
    },
    transition: (input) => approvals.transition(input),
    async accountRef(userId, accountId) {
      const row = await one<{
        id: string;
        user_id: string;
        provider: ProviderAccountRef['provider'];
        provider_account_id: string;
        account_email: string | null;
        tenant_id: string | null;
        tenant_type: 'personal' | 'work' | null;
        capabilities_granted: ProviderAccountRef['capabilitiesGranted'];
        data_source_toggles: AccountDataSourceToggles;
        status: string;
      }>(
        system
          .from('connected_accounts')
          .select(
            'id,user_id,provider,provider_account_id,account_email,tenant_id,tenant_type,capabilities_granted,data_source_toggles,status',
          )
          .eq('id', accountId)
          .eq('user_id', userId)
          .maybeSingle(),
      );
      if (row === null || row.status === 'disconnected') return null;
      return {
        connectedAccountId: row.id,
        userId: row.user_id,
        provider: row.provider,
        providerAccountId: row.provider_account_id,
        email: row.account_email,
        tenantId: row.tenant_id,
        tenantType: row.tenant_type,
        capabilitiesGranted: row.capabilities_granted,
        dataSourceToggles: row.data_source_toggles,
      };
    },
    calendar: (userId, calendarId) => approvals.calendar(userId, calendarId),
    calendarEvent: (userId, eventId) => approvals.calendarEvent(userId, eventId),
    async mailContext(userId, threadId, messageId) {
      const [thread, message] = await Promise.all([
        one<{ provider_thread_id: string }>(
          system
            .from('email_threads')
            .select('provider_thread_id')
            .eq('id', threadId)
            .eq('user_id', userId)
            .maybeSingle(),
        ),
        one<{
          provider_message_id: string;
          internet_message_id: string | null;
          references_ids: string[];
          thread_id: string;
        }>(
          system
            .from('email_messages')
            .select('provider_message_id,internet_message_id,references_ids,thread_id')
            .eq('id', messageId)
            .eq('user_id', userId)
            .maybeSingle(),
        ),
      ]);
      if (thread === null || message === null || message.thread_id !== threadId) return null;
      const context: MailContext = {
        providerThreadId: thread.provider_thread_id,
        providerMessageId: message.provider_message_id,
        internetMessageId: message.internet_message_id,
        references: message.references_ids ?? [],
      };
      return context;
    },
    async displayName(userId) {
      const row = await one<{ display_name: string | null }>(
        system.from('profiles').select('display_name').eq('user_id', userId).maybeSingle(),
      );
      return row?.display_name ?? null;
    },
    planFeature: (userId, key) => approvals.planFeature(userId, key),
    insertTask: (row) => insertIdempotent('tasks', row, 'idempotency_key'),
    insertCommitment: (row) => insertIdempotent('commitments', row, 'dedupe_key'),
    async scheduleReminder(userId, row) {
      const payload = { ...row };
      if (typeof payload.correlation_id !== 'string' || !UUID_RE.test(payload.correlation_id)) {
        delete payload.correlation_id;
      }
      const out = await rpc<{ created: boolean; reminder: { id: string } }>(
        system,
        DB_FN.scheduleReminder,
        {
          p_user: userId,
          p_row: payload,
        },
      );
      return { id: out.reminder.id, created: out.created };
    },
    async markReplyDraftSent(userId, draftId) {
      const { error } = await system
        .from('reply_drafts')
        .update({ status: 'sent' })
        .eq('id', draftId)
        .eq('user_id', userId);
      if (error !== null) throw mapDbError(error);
    },
    async markThreadAwaitingReply(userId, threadId) {
      const { error } = await system
        .from('email_threads')
        .update({ reply_state: 'awaiting_their_reply' })
        .eq('id', threadId)
        .eq('user_id', userId);
      if (error !== null) throw mapDbError(error);
    },
    async markReplyInsightsDone(userId, threadId) {
      const { error } = await system
        .from('insights')
        .update({ status: 'done', done_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('entity_type', 'email_thread')
        .eq('entity_id', threadId)
        .eq('kind', 'reply_needed')
        .eq('status', 'open');
      if (error !== null) throw mapDbError(error);
    },
    async markInsightDone(userId, insightId) {
      const { error } = await system
        .from('insights')
        .update({ status: 'done', done_at: new Date().toISOString() })
        .eq('id', insightId)
        .eq('user_id', userId)
        .eq('status', 'open');
      if (error !== null) throw mapDbError(error);
    },
  };
}
