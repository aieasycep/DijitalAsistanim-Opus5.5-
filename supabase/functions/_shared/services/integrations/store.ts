/**
 * supabase-backed `IntegrationStore` (service client; RLS is bypassed, so every call passes the ids it
 * was given by verified code paths). Multi-row and multi-table steps go through the service-role
 * wrappers of migration 20260924002000 so they stay atomic; single-table reads and writes use
 * PostgREST directly. `bytea` values travel as `\x…` hex (PostgREST) or plain hex (RPC jsonb).
 */
import { fromByteaHex, toByteaHex, toHex } from '../../crypto/encoding.ts';
import type { DbClient } from '../../db/clients.ts';
import { DB_FN, rpc } from '../../db/functions.ts';
import { AppError, mapDbError } from '../../errors.ts';
import type { TokenKind } from '../../crypto/token-cipher.ts';
import type {
  AccountRecord,
  CalendarRecord,
  CredentialRecord,
  CredentialWrite,
  IntegrationStore,
  JobStatusRow,
  OAuthStateRecord,
  ResumeApproval,
  StoredMessage,
  SyncStatePatch,
  SyncStateRecord,
} from './types.ts';

export const ACCOUNT_COLUMNS =
  'id,user_id,provider,provider_account_id,account_email,display_label,tenant_type,tenant_id,status,status_reason,' +
  'granted_scopes,capabilities_granted,data_source_toggles,connected_at,last_sync_at,last_successful_sync_at,' +
  'last_error_code,last_error_at,reauth_required_at,disconnected_at,revocation_mode,pending_binding_until,' +
  'demo_flavor,created_at,updated_at';

const STATE_COLUMNS =
  'id,user_id,provider,purpose,connected_account_id,requested_capabilities,requested_scopes,code_verifier_iv,' +
  'code_verifier_ciphertext,key_version,nonce_hash,return_to,expires_at,used_at,device_nonce_hash,' +
  'completion_code_hash,approval_id,token_ciphertext,token_iv,result,error_code,completed_at,created_at';

const SYNC_COLUMNS =
  'id,user_id,connected_account_id,calendar_id,resource,resource_key,cursor,status,page_token,backfill_until,' +
  'backfill_cursor,window_start,window_end,rebaseline_due_at,watch_kind,watch_id,watch_resource_id,' +
  'watch_token_hash,watch_history_id,watch_expires_at,watch_renew_after,lifecycle_last_event,lifecycle_last_at,' +
  'next_poll_at,cursor_invalidated_at,last_full_sync_at,last_incremental_sync_at,last_success_at,' +
  'last_error_code,consecutive_failures,stats';

const CALENDAR_COLUMNS =
  'id,user_id,connected_account_id,provider,provider_calendar_id,name,color,time_zone,access_role,is_primary,' +
  'selected,can_write';

const CREDENTIAL_COLUMNS =
  'id,connected_account_id,token_kind,key_version,iv,ciphertext,aad_hash,access_expires_at';

type Row = Record<string, unknown>;

function bytes(value: unknown): Uint8Array | null {
  return typeof value === 'string' && value !== '' ? fromByteaHex(value) : null;
}

function hexOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value.replace(/^\\x/, '') : null;
}

function toState(row: Row): OAuthStateRecord {
  return {
    ...(row as unknown as OAuthStateRecord),
    code_verifier_iv: bytes(row.code_verifier_iv) ?? new Uint8Array(),
    code_verifier_ciphertext: bytes(row.code_verifier_ciphertext) ?? new Uint8Array(),
    nonce_hash: bytes(row.nonce_hash),
    device_nonce_hash: bytes(row.device_nonce_hash) ?? new Uint8Array(),
    completion_code_hash: bytes(row.completion_code_hash),
    token_ciphertext: bytes(row.token_ciphertext),
    token_iv: bytes(row.token_iv),
  };
}

function toSync(row: Row): SyncStateRecord {
  return {
    ...(row as unknown as SyncStateRecord),
    watch_token_hash: hexOrNull(row.watch_token_hash),
    stats: (row.stats ?? {}) as Record<string, number>,
  };
}

function syncPatchColumns(patch: SyncStatePatch): Row {
  const out: Row = { ...patch };
  if ('watch_token_hash' in patch) {
    out.watch_token_hash =
      patch.watch_token_hash === null || patch.watch_token_hash === undefined
        ? null
        : `\\x${patch.watch_token_hash}`;
  }
  return out;
}

function credentialJson(write: CredentialWrite): Row {
  return {
    token_kind: write.kind,
    key_version: write.token.keyVersion,
    iv: toHex(write.token.iv),
    ciphertext: toHex(write.token.ciphertext),
    aad_hash: toHex(write.token.aadHash),
    access_expires_at: write.accessExpiresAt,
    scope_snapshot: write.scopeSnapshot,
  };
}

function throwIf(error: { code?: string; message?: string } | null): void {
  if (error !== null) throw mapDbError(error);
}

export function supabaseIntegrationStore(
  db: DbClient,
  now: () => Date = () => new Date(),
): IntegrationStore {
  const accounts = () => db.from('connected_accounts');
  const states = () => db.from('oauth_states');
  const syncs = () => db.from('sync_states');
  const calendars = () => db.from('calendars');
  const credentials = () => db.from('oauth_credentials');

  const one = async <T>(
    query: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
  ) => {
    const { data, error } = await query;
    throwIf(error);
    return (data ?? null) as T | null;
  };

  const store: IntegrationStore = {
    async getAccount(id) {
      return await one<AccountRecord>(
        accounts().select(ACCOUNT_COLUMNS).eq('id', id).maybeSingle(),
      );
    },
    async findAccount(userId, provider, providerAccountId) {
      return await one<AccountRecord>(
        accounts()
          .select(ACCOUNT_COLUMNS)
          .eq('user_id', userId)
          .eq('provider', provider)
          .eq('provider_account_id', providerAccountId)
          .maybeSingle(),
      );
    },
    async linkedToOtherUser(provider, providerAccountId, userId) {
      const { data, error } = await accounts()
        .select('id')
        .eq('provider', provider)
        .eq('provider_account_id', providerAccountId)
        .neq('user_id', userId)
        .neq('status', 'disconnected')
        .limit(1);
      throwIf(error);
      return Array.isArray(data) && data.length > 0;
    },
    async findMailAccountsByEmail(email) {
      const { data, error } = await accounts()
        .select(ACCOUNT_COLUMNS)
        .eq('account_email', email.toLowerCase())
        .eq('provider', 'google')
        .not('status', 'in', '(disconnected,connecting)')
        .contains('capabilities_granted', ['mail_read']);
      throwIf(error);
      return (data ?? []) as unknown as AccountRecord[];
    },
    async countActiveWithCapability(userId, capability, exceptId) {
      let query = accounts()
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .neq('status', 'disconnected')
        .contains('capabilities_granted', [capability]);
      if (exceptId !== undefined) query = query.neq('id', exceptId);
      const { count, error } = await query;
      throwIf(error);
      return count ?? 0;
    },
    async userTimeZone(userId) {
      const row = await one<{ timezone: string | null }>(
        db.from('user_preferences').select('timezone').eq('user_id', userId).maybeSingle(),
      );
      return row?.timezone ?? 'Europe/Istanbul';
    },
    async approvalForResume(approvalId, userId) {
      return await one<ResumeApproval>(
        db
          .from('approval_actions')
          .select('id,user_id,action_type,status,destination_account_id')
          .eq('id', approvalId)
          .eq('user_id', userId)
          .maybeSingle(),
      );
    },
    async planLimit(userId, key) {
      const value = await rpc<unknown>(db, DB_FN.planLimit, { p_user: userId, p_key: key });
      return typeof value === 'number' ? value : null;
    },
    async updateAccount(id, patch) {
      const row = await one<AccountRecord>(
        accounts().update(patch).eq('id', id).select(ACCOUNT_COLUMNS).maybeSingle(),
      );
      if (row === null) throw new AppError('NOT_FOUND');
      return row;
    },
    async pausedByPlan(id) {
      return (await rpc<boolean>(db, DB_FN.accountPausedByPlan, { p_account: id })) === true;
    },
    async accountCan(id, capability) {
      return (
        (await rpc<boolean>(db, DB_FN.accountCan, { p_account: id, p_cap: capability })) === true
      );
    },
    async upsertDeviceAccount(userId, provider, installationId, capabilities) {
      const out = await rpc<{ account_id: string; created: boolean }>(
        db,
        DB_FN.upsertDeviceAccount,
        {
          p_user: userId,
          p_provider: provider,
          p_installation: installationId,
          p_capabilities: capabilities,
        },
      );
      return { accountId: out.account_id, created: out.created };
    },

    async insertState(state) {
      const { error } = await states().insert({
        id: state.id,
        user_id: state.user_id,
        state_hash: toByteaHex(state.state_hash),
        provider: state.provider,
        purpose: state.purpose,
        connected_account_id: state.connected_account_id,
        requested_capabilities: state.requested_capabilities,
        requested_scopes: state.requested_scopes,
        code_verifier_iv: toByteaHex(state.code_verifier_iv),
        code_verifier_ciphertext: toByteaHex(state.code_verifier_ciphertext),
        key_version: state.key_version,
        nonce_hash: state.nonce_hash === null ? null : toByteaHex(state.nonce_hash),
        return_to: state.return_to,
        expires_at: state.expires_at,
        device_nonce_hash: toByteaHex(state.device_nonce_hash),
        approval_id: state.approval_id,
      });
      throwIf(error);
    },
    async consumeState(stateHash) {
      const at = now().toISOString();
      const row = await one<Row>(
        states()
          .update({ used_at: at })
          .eq('state_hash', toByteaHex(stateHash))
          .is('used_at', null)
          .gt('expires_at', at)
          .select(STATE_COLUMNS)
          .maybeSingle(),
      );
      return row === null ? null : toState(row);
    },
    async findStateByHash(stateHash) {
      const row = await one<Row>(
        states().select(STATE_COLUMNS).eq('state_hash', toByteaHex(stateHash)).maybeSingle(),
      );
      return row === null ? null : toState(row);
    },
    async findStateByCompletionHash(hash) {
      const row = await one<Row>(
        states().select(STATE_COLUMNS).eq('completion_code_hash', toByteaHex(hash)).maybeSingle(),
      );
      return row === null ? null : toState(row);
    },
    async getState(id) {
      const row = await one<Row>(states().select(STATE_COLUMNS).eq('id', id).maybeSingle());
      return row === null ? null : toState(row);
    },
    async callbackStore(stateId, patch, account, creds) {
      await rpc<Row>(db, DB_FN.oauthCallbackStore, {
        p_state_id: stateId,
        p_state: {
          result: patch.result,
          completion_code_hash:
            patch.completionCodeHash === null ? null : toHex(patch.completionCodeHash),
          error_code: patch.errorCode,
          token_ciphertext: patch.token === null ? null : toHex(patch.token.ciphertext),
          token_iv: patch.token === null ? null : toHex(patch.token.iv),
          key_version: patch.token?.keyVersion ?? null,
          connected_account_id: patch.connectedAccountId,
        },
        p_account: account,
        p_credentials: creds.map(credentialJson),
      });
    },
    async completeBinding(stateId, userId, accountId, patch, creds) {
      return await rpc<AccountRecord & { paused_by_plan: boolean }>(
        db,
        DB_FN.oauthCompleteBinding,
        {
          p_state_id: stateId,
          p_user: userId,
          p_account_id: accountId,
          p_account: patch,
          p_credentials: creds.map(credentialJson),
        },
      );
    },
    async closeFlow(stateId, result, errorCode) {
      const out = await rpc<{ deleted_account_id: string | null }>(db, DB_FN.oauthCloseFlow, {
        p_state_id: stateId,
        p_result: result,
        p_error_code: errorCode,
      });
      return { deletedAccountId: out.deleted_account_id ?? null };
    },
    async expiredHeldStates(accountId) {
      const cutoff = new Date(now().getTime() - 10 * 60_000).toISOString();
      const { data, error } = await states()
        .select(STATE_COLUMNS)
        .eq('connected_account_id', accountId)
        .is('completed_at', null)
        .not('token_ciphertext', 'is', null)
        .lt('used_at', cutoff)
        .limit(20);
      throwIf(error);
      return ((data ?? []) as unknown as Row[]).map(toState);
    },

    async getCredential(accountId, kind) {
      const row = await one<Row>(
        credentials()
          .select(CREDENTIAL_COLUMNS)
          .eq('connected_account_id', accountId)
          .eq('token_kind', kind)
          .maybeSingle(),
      );
      if (row === null) return null;
      return {
        id: String(row.id),
        connected_account_id: String(row.connected_account_id),
        kind: row.token_kind as TokenKind,
        keyVersion: Number(row.key_version),
        iv: fromByteaHex(String(row.iv)),
        ciphertext: fromByteaHex(String(row.ciphertext)),
        aadHash: fromByteaHex(String(row.aad_hash)),
        access_expires_at: (row.access_expires_at as string | null) ?? null,
      } satisfies CredentialRecord;
    },
    async saveCredential(account, write) {
      const columns = {
        key_version: write.token.keyVersion,
        iv: toByteaHex(write.token.iv),
        ciphertext: toByteaHex(write.token.ciphertext),
        aad_hash: toByteaHex(write.token.aadHash),
        access_expires_at: write.accessExpiresAt,
        scope_snapshot: write.scopeSnapshot,
        rotated_at: now().toISOString(),
      };
      const update = () =>
        credentials()
          .update(columns)
          .eq('connected_account_id', account.id)
          .eq('token_kind', write.kind)
          .select('id');
      const first = await update();
      throwIf(first.error);
      if (Array.isArray(first.data) && first.data.length > 0) return;
      const { error } = await credentials().insert({
        user_id: account.user_id,
        connected_account_id: account.id,
        provider: account.provider,
        token_kind: write.kind,
        ...columns,
      });
      if (error === null) return;
      if (error.code !== '23505') throw mapDbError(error);
      const retry = await update();
      throwIf(retry.error);
    },
    async deleteCredentials(accountId) {
      const { error } = await credentials().delete().eq('connected_account_id', accountId);
      throwIf(error);
    },
    async tryLockRefresh(accountId, owner, seconds) {
      return (
        (await rpc<boolean>(db, DB_FN.tryLockCredentialRefresh, {
          p_account: accountId,
          p_owner: owner,
          p_seconds: seconds,
        })) === true
      );
    },
    async releaseRefreshLock(accountId, owner) {
      const { error } = await credentials()
        .update({ refresh_lock_until: null, refresh_lock_owner: null })
        .eq('connected_account_id', accountId)
        .eq('refresh_lock_owner', owner);
      throwIf(error);
    },

    async ensureSyncState(input) {
      const { error } = await syncs().upsert(
        {
          user_id: input.userId,
          connected_account_id: input.accountId,
          resource: input.resource,
          resource_key: input.resourceKey,
          calendar_id: input.calendarId ?? null,
        },
        { onConflict: 'connected_account_id,resource,resource_key', ignoreDuplicates: true },
      );
      throwIf(error);
      const row = await one<Row>(
        syncs()
          .select(SYNC_COLUMNS)
          .eq('connected_account_id', input.accountId)
          .eq('resource', input.resource)
          .eq('resource_key', input.resourceKey)
          .maybeSingle(),
      );
      if (row === null)
        throw new AppError('SERVICE_UNAVAILABLE', { details: { reason: 'sync_state' } });
      return toSync(row);
    },
    async getSyncState(id) {
      const row = await one<Row>(syncs().select(SYNC_COLUMNS).eq('id', id).maybeSingle());
      return row === null ? null : toSync(row);
    },
    async listSyncStates(accountId) {
      const { data, error } = await syncs()
        .select(SYNC_COLUMNS)
        .eq('connected_account_id', accountId);
      throwIf(error);
      return ((data ?? []) as unknown as Row[]).map(toSync);
    },
    async findSyncStateByWatch(kind, watchId) {
      const row = await one<Row>(
        syncs().select(SYNC_COLUMNS).eq('watch_kind', kind).eq('watch_id', watchId).maybeSingle(),
      );
      return row === null ? null : toSync(row);
    },
    async updateSyncState(id, patch) {
      const row = await one<Row>(
        syncs().update(syncPatchColumns(patch)).eq('id', id).select(SYNC_COLUMNS).maybeSingle(),
      );
      if (row === null) throw new AppError('NOT_FOUND');
      return toSync(row);
    },
    async acquireLease(id, owner, seconds) {
      return (
        (await rpc<boolean>(db, DB_FN.acquireSyncLease, {
          p_sync_state: id,
          p_owner: owner,
          p_seconds: seconds,
        })) === true
      );
    },
    async releaseLease(id, owner) {
      await rpc<null>(db, DB_FN.releaseSyncLease, { p_sync_state: id, p_owner: owner });
    },

    async upsertCalendars(accountId, list) {
      const out = await rpc<{ calendars: unknown[]; missing: string[] | null }>(
        db,
        DB_FN.upsertCalendars,
        {
          p_account: accountId,
          p_calendars: list,
        },
      );
      const missing = out.missing ?? [];
      const all = await store.listCalendars(accountId);
      return { calendars: all.filter((c) => !missing.includes(c.id)), missing };
    },
    async listCalendars(accountId) {
      const { data, error } = await calendars()
        .select(CALENDAR_COLUMNS)
        .eq('connected_account_id', accountId)
        .order('is_primary', { ascending: false })
        .order('name');
      throwIf(error);
      return (data ?? []) as unknown as CalendarRecord[];
    },
    async getCalendar(id) {
      return await one<CalendarRecord>(
        calendars().select(CALENDAR_COLUMNS).eq('id', id).maybeSingle(),
      );
    },
    async deleteCalendars(ids) {
      if (ids.length === 0) return;
      const { error } = await calendars()
        .delete()
        .in('id', [...ids]);
      throwIf(error);
    },
    async setCalendarSelected(id, selected) {
      const { error } = await calendars().update({ selected }).eq('id', id);
      throwIf(error);
    },
    async countSelectedCalendars(userId) {
      const { count, error } = await calendars()
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('selected', true);
      throwIf(error);
      return count ?? 0;
    },
    async defaultWriteCalendar(userId) {
      const row = await one<{ default_write_calendar_id: string | null }>(
        db
          .from('user_preferences')
          .select('default_write_calendar_id')
          .eq('user_id', userId)
          .maybeSingle(),
      );
      return row?.default_write_calendar_id ?? null;
    },
    async setDefaultWriteCalendar(userId, calendarId) {
      const { error } = await db
        .from('user_preferences')
        .update({ default_write_calendar_id: calendarId })
        .eq('user_id', userId);
      throwIf(error);
    },

    async upsertMail(accountId, rows) {
      if (rows.length === 0) return [];
      return (
        (await rpc(db, DB_FN.upsertMailMessages, { p_account: accountId, p_messages: rows })) ?? []
      );
    },
    async applyMailChanges(accountId, labelChanges, deleted) {
      if (labelChanges.length === 0 && deleted.length === 0)
        return { label_changes: 0, deleted: 0 };
      return await rpc(db, DB_FN.applyMailChanges, {
        p_account: accountId,
        p_label_changes: labelChanges,
        p_deleted: deleted,
      });
    },
    async listRecentMessageIds(accountId, since) {
      const { data, error } = await db
        .from('email_messages')
        .select('provider_message_id')
        .eq('connected_account_id', accountId)
        .gte('received_at', since)
        .limit(5000);
      throwIf(error);
      return ((data ?? []) as { provider_message_id: string }[]).map((r) => r.provider_message_id);
    },
    async getMessage(id) {
      const row = await one<Row & { thread: { provider_thread_id: string } | null }>(
        db
          .from('email_messages')
          .select(
            'id,user_id,connected_account_id,provider_message_id,subject,from_email,from_name,to_emails,cc_emails,' +
              'received_at,web_link,provider_deleted_at,thread:email_threads(provider_thread_id)',
          )
          .eq('id', id)
          .maybeSingle(),
      );
      if (row === null) return null;
      const { thread, ...rest } = row;
      return {
        ...(rest as unknown as StoredMessage),
        provider_thread_id: thread?.provider_thread_id ?? '',
      };
    },
    async upsertEvents(accountId, calendarId, rows, origin) {
      if (rows.length === 0) return { upserted: 0, cancelled: 0 };
      return await rpc(db, DB_FN.upsertCalendarEvents, {
        p_account: accountId,
        p_calendar: calendarId,
        p_events: rows,
        p_origin: origin,
      });
    },
    async markEventsDeleted(calendarId, ids) {
      if (ids.length === 0) return 0;
      return await rpc<number>(db, DB_FN.markCalendarEventsDeleted, {
        p_calendar: calendarId,
        p_provider_event_ids: ids,
      });
    },
    async pruneEvents(calendarId, since, windowStart, windowEnd) {
      return await rpc<number>(db, DB_FN.pruneCalendarEvents, {
        p_calendar: calendarId,
        p_since: since,
        p_window_start: windowStart,
        p_window_end: windowEnd,
      });
    },
    async upsertTasks(accountId, rows) {
      if (rows.length === 0) return { upserted: 0 };
      return await rpc(db, DB_FN.upsertTasks, { p_account: accountId, p_tasks: rows });
    },
    async stageDeviceSnapshot(accountId, snapshot) {
      return await rpc<string>(db, DB_FN.stageDeviceSnapshot, {
        p_account: accountId,
        p_snapshot: snapshot,
      });
    },
    async applyStagedDeviceSnapshot(accountId, contentHash) {
      return await rpc(db, DB_FN.applyStagedDeviceSnapshot, {
        p_account: accountId,
        p_content_hash: contentHash,
      });
    },

    async demoState(accountId) {
      return (await rpc(db, DB_FN.demoStateGet, { p_account: accountId })) ?? {};
    },
    async demoRecordWrite(accountId, resource, key, item) {
      return await rpc(db, DB_FN.demoStateRecordWrite, {
        p_account: accountId,
        p_resource: resource,
        p_key: key,
        p_item: item,
      });
    },
    async demoSetClock(accountId, resource, clock) {
      await rpc<null>(db, DB_FN.demoStateSetClock, {
        p_account: accountId,
        p_resource: resource,
        p_clock: clock,
      });
    },

    async disconnect(accountId, userId, revocationMode, purgeContent, correlationId) {
      const out = await rpc<{
        account: AccountRecord;
        already: boolean;
        purge_job_id: string | null;
        disconnected_at: string;
      }>(db, DB_FN.disconnectIntegration, {
        p_account: accountId,
        p_user: userId,
        p_revocation_mode: revocationMode,
        p_purge_content: purgeContent,
        p_correlation_id: correlationId,
      });
      return {
        account: out.account,
        already: out.already,
        purgeJobId: out.purge_job_id,
        disconnectedAt: out.disconnected_at,
      };
    },
    async purgeBatch(accountId, disconnectedAt, purgeDerived, batch, reason) {
      return await rpc(db, DB_FN.integrationPurgeBatch, {
        p_account: accountId,
        p_disconnected_at: disconnectedAt,
        p_purge_derived: purgeDerived,
        p_batch: batch,
        p_reason: reason,
      });
    },
    async jobStatuses(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await db
        .from('jobs')
        .select('id,status')
        .in('id', [...ids]);
      throwIf(error);
      return (data ?? []) as JobStatusRow[];
    },
  };
  return store;
}
