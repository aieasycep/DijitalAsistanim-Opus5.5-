/**
 * In-memory `IntegrationStore` and runtime for the integration tests. The semantics mirror the SQL
 * functions of migration 20260924002000 (single-use state consume, R-07 binding window, plan-limit
 * re-check at activation, calendar selection defaults, idempotent demo writes, purge skip after a
 * reconnect). Nothing here reaches the network: providers get a recording `fetch` stub.
 */
import type { AccountStatus, Capability, Provider, QuotaGate } from '@da/domain';
import { toHex } from '../crypto/encoding.ts';
import { loadKeyring, type TokenKeyring } from '../crypto/token-cipher.ts';
import { AppError } from '../errors.ts';
import type { RawEnv } from '../env.ts';
import { createLogger, memorySink } from '../logging/logger.ts';
import type { AuditEntry } from '../services/audit.ts';
import { integrationProviders } from '../services/integrations/providers.ts';
import { integrationConfig, type IntegrationRuntime } from '../services/integrations/runtime.ts';
import type {
  AccountRecord,
  CalendarRecord,
  CredentialRecord,
  DemoResourceState,
  EventRow,
  IntegrationStore,
  MailRow,
  OAuthStateRecord,
  ResumeApproval,
  SyncStateRecord,
  TaskRow,
} from '../services/integrations/types.ts';
import { memoryWebhookLedger } from '../webhooks/ledger.ts';
import { encryptToken } from '../crypto/token-cipher.ts';
import { hmacSha256Hex } from '../crypto/hmac.ts';
import { createRegistry } from '../jobs/registry.ts';
import { runWorker } from '../jobs/runner.ts';
import type { JobType } from '@da/domain';
import { integrationJobDefinitions } from '../services/integrations/jobs.ts';
import { randomBase64, testEnv } from './env.ts';
import { stubFetch, type StubHandler } from './fetch.ts';
import { memoryJobsRepo, type MemoryJobsRepo } from './jobs.ts';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface StoredMail extends MailRow {
  readonly id: string;
  readonly account_id: string;
  readonly user_id: string;
  thread_id: string;
  provider_deleted_at: string | null;
}

export interface StoredEvent extends EventRow {
  readonly id: string;
  readonly calendar_id: string;
  readonly account_id: string;
  updated_at: string;
  provider_deleted_at: string | null;
  origin: string;
}

export interface StoredTask extends TaskRow {
  readonly account_id: string;
  item_status: 'open' | 'done' | 'dismissed';
}

const ACTIVE: ReadonlySet<AccountStatus> = new Set([
  'healthy',
  'syncing',
  'partial',
  'error',
  'needs_reauth',
  'admin_consent_required',
]);

function eq(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return false;
  return toHex(a) === toHex(b);
}

export interface MemoryIntegrationStore extends IntegrationStore {
  readonly accounts: Map<string, Mutable<AccountRecord>>;
  readonly states: Map<string, Mutable<OAuthStateRecord> & { state_hash: Uint8Array }>;
  readonly credentials: Map<string, CredentialRecord>;
  readonly syncStates: Map<string, Mutable<SyncStateRecord>>;
  readonly calendars: Map<string, Mutable<CalendarRecord> & { kind: string }>;
  readonly mails: Map<string, StoredMail>;
  readonly events: Map<string, StoredEvent>;
  readonly tasks: Map<string, StoredTask>;
  readonly demo: Map<
    string,
    Record<
      string,
      { state: { writes: Record<string, Record<string, unknown>> }; demo_clock: string | null }
    >
  >;
  readonly planLimits: Map<string, number | null>;
  readonly timeZones: Map<string, string>;
  readonly approvals: Map<string, ResumeApproval & { requires_scope: string | null }>;
  readonly defaultWrite: Map<string, string | null>;
  readonly staged: Map<string, { snapshot: Record<string, unknown>; applied: boolean }>;
  addAccount(
    input: Partial<AccountRecord> & { user_id: string; provider: Provider },
  ): AccountRecord;
}

export function memoryIntegrationStore(
  jobs: MemoryJobsRepo,
  now: () => Date,
): MemoryIntegrationStore {
  const accounts = new Map<string, Mutable<AccountRecord>>();
  const states = new Map<string, Mutable<OAuthStateRecord> & { state_hash: Uint8Array }>();
  const credentials = new Map<string, CredentialRecord>();
  const syncStates = new Map<string, Mutable<SyncStateRecord>>();
  const calendars = new Map<string, Mutable<CalendarRecord> & { kind: string }>();
  const mails = new Map<string, StoredMail>();
  const events = new Map<string, StoredEvent>();
  const tasks = new Map<string, StoredTask>();
  const demo = new Map<
    string,
    Record<
      string,
      { state: { writes: Record<string, Record<string, unknown>> }; demo_clock: string | null }
    >
  >();
  const planLimits = new Map<string, number | null>();
  const timeZones = new Map<string, string>();
  const approvals = new Map<string, ResumeApproval & { requires_scope: string | null }>();
  const defaultWrite = new Map<string, string | null>();
  const staged = new Map<string, { snapshot: Record<string, unknown>; applied: boolean }>();
  const leases = new Map<string, { owner: string; until: number }>();
  const refreshLocks = new Map<string, { owner: string; until: number }>();
  const iso = () => now().toISOString();

  const limitOf = (userId: string, key: string): number | null =>
    planLimits.has(`${userId}:${key}`) ? (planLimits.get(`${userId}:${key}`) ?? null) : null;

  const countActive = (userId: string, capability: Capability, exceptId?: string) =>
    [...accounts.values()].filter(
      (a) =>
        a.user_id === userId &&
        a.id !== exceptId &&
        a.status !== 'disconnected' &&
        a.status !== 'connecting' &&
        a.pending_binding_until === null &&
        a.capabilities_granted.includes(capability),
    ).length;

  const newAccount = (
    input: Partial<AccountRecord> & { user_id: string; provider: Provider },
  ): Mutable<AccountRecord> => ({
    id: input.id ?? crypto.randomUUID(),
    user_id: input.user_id,
    provider: input.provider,
    provider_account_id: input.provider_account_id ?? crypto.randomUUID(),
    account_email: input.account_email ?? null,
    display_label: input.display_label ?? null,
    tenant_type: input.tenant_type ?? null,
    tenant_id: input.tenant_id ?? null,
    status: input.status ?? 'healthy',
    status_reason: input.status_reason ?? null,
    granted_scopes: input.granted_scopes ?? [],
    capabilities_granted: input.capabilities_granted ?? ['mail_read', 'calendar_read'],
    data_source_toggles: input.data_source_toggles ?? {},
    connected_at: input.connected_at ?? iso(),
    last_sync_at: input.last_sync_at ?? null,
    last_successful_sync_at: input.last_successful_sync_at ?? null,
    last_error_code: input.last_error_code ?? null,
    last_error_at: input.last_error_at ?? null,
    reauth_required_at: input.reauth_required_at ?? null,
    disconnected_at: input.disconnected_at ?? null,
    revocation_mode: input.revocation_mode ?? null,
    pending_binding_until: input.pending_binding_until ?? null,
    demo_flavor: input.demo_flavor ?? null,
    created_at: input.created_at ?? iso(),
    updated_at: input.updated_at ?? iso(),
  });

  const touch = (a: Mutable<AccountRecord>) => {
    const next = new Date(Math.max(now().getTime(), Date.parse(a.updated_at) + 1)).toISOString();
    a.updated_at = next;
  };

  const store: MemoryIntegrationStore = {
    accounts,
    states,
    credentials,
    syncStates,
    calendars,
    mails,
    events,
    tasks,
    demo,
    planLimits,
    timeZones,
    approvals,
    defaultWrite,
    staged,
    addAccount(input) {
      const a = newAccount(input);
      accounts.set(a.id, a);
      return { ...a };
    },

    getAccount: (id) => Promise.resolve(accounts.has(id) ? { ...accounts.get(id)! } : null),
    findAccount: (userId, provider, pid) =>
      Promise.resolve(
        [...accounts.values()].find(
          (a) => a.user_id === userId && a.provider === provider && a.provider_account_id === pid,
        ) ?? null,
      ),
    linkedToOtherUser: (provider, pid, userId) =>
      Promise.resolve(
        [...accounts.values()].some(
          (a) =>
            a.provider === provider &&
            a.provider_account_id === pid &&
            a.user_id !== userId &&
            ACTIVE.has(a.status),
        ),
      ),
    findMailAccountsByEmail: (email) =>
      Promise.resolve(
        [...accounts.values()].filter(
          (a) =>
            (a.account_email ?? '').toLowerCase() === email.toLowerCase() &&
            a.provider === 'google',
        ),
      ),
    countActiveWithCapability: (userId, capability, exceptId) =>
      Promise.resolve(countActive(userId, capability, exceptId)),
    userTimeZone: (userId) => Promise.resolve(timeZones.get(userId) ?? 'Europe/Istanbul'),
    approvalForResume: (approvalId, userId) => {
      const a = approvals.get(approvalId);
      return Promise.resolve(a !== undefined && a.user_id === userId ? a : null);
    },
    planLimit: (userId, key) => Promise.resolve(limitOf(userId, key)),
    updateAccount(id, patch) {
      const a = accounts.get(id);
      if (a === undefined) return Promise.reject(new AppError('NOT_FOUND'));
      Object.assign(a, patch);
      touch(a);
      return Promise.resolve({ ...a });
    },
    pausedByPlan: (id) => {
      const a = accounts.get(id);
      if (a === undefined) return Promise.resolve(false);
      const limit = limitOf(a.user_id, 'max_mail_accounts');
      if (limit === null || !a.capabilities_granted.includes('mail_read'))
        return Promise.resolve(false);
      const older = [...accounts.values()]
        .filter(
          (x) =>
            x.user_id === a.user_id &&
            x.status !== 'disconnected' &&
            x.capabilities_granted.includes('mail_read'),
        )
        .sort((x, y) => x.created_at.localeCompare(y.created_at));
      return Promise.resolve(older.findIndex((x) => x.id === id) >= limit);
    },
    accountCan: (id, capability) =>
      Promise.resolve(accounts.get(id)?.capabilities_granted.includes(capability) ?? false),
    upsertDeviceAccount(userId, provider, installationId, capabilities) {
      const existing = [...accounts.values()].find(
        (a) =>
          a.user_id === userId &&
          a.provider === provider &&
          a.provider_account_id === installationId,
      );
      if (existing !== undefined) {
        existing.status = 'healthy';
        existing.capabilities_granted = [
          ...new Set([...existing.capabilities_granted, ...capabilities]),
        ];
        return Promise.resolve({ accountId: existing.id, created: false });
      }
      const a = newAccount({
        user_id: userId,
        provider,
        provider_account_id: installationId,
        capabilities_granted: [...capabilities],
      });
      accounts.set(a.id, a);
      return Promise.resolve({ accountId: a.id, created: true });
    },

    insertState(state) {
      states.set(state.id, {
        ...state,
        used_at: null,
        completion_code_hash: null,
        token_ciphertext: null,
        token_iv: null,
        result: null,
        error_code: null,
        completed_at: null,
        created_at: iso(),
      });
      return Promise.resolve();
    },
    consumeState(hash) {
      const s = [...states.values()].find((x) => eq(x.state_hash, hash));
      if (s === undefined || s.used_at !== null || Date.parse(s.expires_at) <= now().getTime())
        return Promise.resolve(null);
      s.used_at = iso();
      return Promise.resolve({ ...s });
    },
    findStateByHash: (hash) =>
      Promise.resolve([...states.values()].find((x) => eq(x.state_hash, hash)) ?? null),
    findStateByCompletionHash: (hash) =>
      Promise.resolve([...states.values()].find((x) => eq(x.completion_code_hash, hash)) ?? null),
    getState: (id) => Promise.resolve(states.get(id) ?? null),
    callbackStore(stateId, patch, account, creds) {
      const s = states.get(stateId);
      if (s === undefined) return Promise.reject(new AppError('NOT_FOUND'));
      if (s.used_at === null || s.completion_code_hash !== null)
        return Promise.reject(new AppError('STATE_CONFLICT'));
      if (account !== null) {
        const a = newAccount({
          id: account.id,
          user_id: s.user_id,
          provider: s.provider,
          provider_account_id: account.provider_account_id,
          account_email: account.account_email,
          display_label: account.display_label,
          tenant_type: account.tenant_type,
          tenant_id: account.tenant_id,
          status: 'connecting',
          granted_scopes: account.granted_scopes,
          capabilities_granted: account.capabilities_granted,
          pending_binding_until: new Date(now().getTime() + 600_000).toISOString(),
          demo_flavor: account.demo_flavor,
          connected_at: null,
        });
        accounts.set(a.id, a);
        for (const c of creds) {
          credentials.set(`${a.id}:${c.kind}`, {
            ...c.token,
            id: crypto.randomUUID(),
            connected_account_id: a.id,
            kind: c.kind,
            access_expires_at: c.accessExpiresAt,
          });
        }
      }
      s.result = patch.result;
      s.completion_code_hash = patch.completionCodeHash;
      s.error_code = patch.errorCode;
      s.token_ciphertext = patch.token?.ciphertext ?? null;
      s.token_iv = patch.token?.iv ?? null;
      if (patch.token !== null) s.key_version = patch.token.keyVersion;
      s.connected_account_id = patch.connectedAccountId;
      return Promise.resolve();
    },
    completeBinding(stateId, userId, accountId, patch, creds) {
      const s = states.get(stateId);
      if (s === undefined || s.user_id !== userId) return Promise.reject(new AppError('NOT_FOUND'));
      if (
        s.used_at === null ||
        s.completed_at !== null ||
        Date.parse(s.used_at) < now().getTime() - 600_000
      ) {
        return Promise.reject(new AppError('STATE_CONFLICT'));
      }
      const a = accounts.get(accountId);
      if (a === undefined || a.user_id !== userId) return Promise.reject(new AppError('NOT_FOUND'));
      if (patch.capabilities_granted.includes('mail_read')) {
        const limit = limitOf(userId, 'max_mail_accounts');
        if (limit !== null && countActive(userId, 'mail_read', a.id) >= limit) {
          return Promise.reject(
            new AppError('ENTITLEMENT_REQUIRED', { details: { limit_key: 'max_mail_accounts' } }),
          );
        }
      }
      for (const c of creds) {
        credentials.set(`${a.id}:${c.kind}`, {
          ...c.token,
          id: crypto.randomUUID(),
          connected_account_id: a.id,
          kind: c.kind,
          access_expires_at: c.accessExpiresAt,
        });
      }
      a.status = patch.status;
      a.capabilities_granted = [...patch.capabilities_granted];
      if (patch.granted_scopes !== null) a.granted_scopes = [...patch.granted_scopes];
      if (a.connected_at === null || a.status === 'disconnected' || a.disconnected_at !== null)
        a.connected_at = iso();
      a.pending_binding_until = null;
      a.disconnected_at = null;
      a.revocation_mode = null;
      a.reauth_required_at = null;
      a.status_reason = null;
      a.last_error_code = null;
      touch(a);
      s.completed_at = iso();
      s.token_ciphertext = null;
      s.token_iv = null;
      s.connected_account_id = a.id;
      if (s.approval_id !== null) {
        const ap = approvals.get(s.approval_id);
        if (ap !== undefined) ap.requires_scope = null;
      }
      return Promise.resolve({ ...a, paused_by_plan: false });
    },
    closeFlow(stateId, result, errorCode) {
      const s = states.get(stateId);
      if (s === undefined) return Promise.reject(new AppError('NOT_FOUND'));
      let deleted: string | null = null;
      if (s.purpose === 'connect' && s.connected_account_id !== null) {
        const a = accounts.get(s.connected_account_id);
        if (a !== undefined && a.status === 'connecting' && a.pending_binding_until !== null) {
          accounts.delete(a.id);
          for (const kind of ['access', 'refresh']) credentials.delete(`${a.id}:${kind}`);
          deleted = a.id;
          s.connected_account_id = null;
        }
      }
      s.completed_at = s.completed_at ?? iso();
      s.token_ciphertext = null;
      s.token_iv = null;
      s.result = result;
      s.error_code = errorCode ?? s.error_code;
      return Promise.resolve({ deletedAccountId: deleted });
    },
    expiredHeldStates: (accountId) =>
      Promise.resolve(
        [...states.values()].filter(
          (s) =>
            s.connected_account_id === accountId &&
            s.token_ciphertext !== null &&
            s.completed_at === null &&
            s.used_at !== null &&
            Date.parse(s.used_at) < now().getTime() - 600_000,
        ),
      ),

    getCredential: (accountId, kind) =>
      Promise.resolve(credentials.get(`${accountId}:${kind}`) ?? null),
    saveCredential(account, write) {
      credentials.set(`${account.id}:${write.kind}`, {
        ...write.token,
        id: crypto.randomUUID(),
        connected_account_id: account.id,
        kind: write.kind,
        access_expires_at: write.accessExpiresAt,
      });
      return Promise.resolve();
    },
    deleteCredentials(accountId) {
      for (const kind of ['access', 'refresh']) credentials.delete(`${accountId}:${kind}`);
      return Promise.resolve();
    },
    tryLockRefresh(accountId, owner, seconds) {
      const lock = refreshLocks.get(accountId);
      if (lock !== undefined && lock.owner !== owner && lock.until > now().getTime())
        return Promise.resolve(false);
      refreshLocks.set(accountId, { owner, until: now().getTime() + seconds * 1000 });
      return Promise.resolve(true);
    },
    releaseRefreshLock(accountId, owner) {
      if (refreshLocks.get(accountId)?.owner === owner) refreshLocks.delete(accountId);
      return Promise.resolve();
    },

    ensureSyncState(input) {
      const existing = [...syncStates.values()].find(
        (s) =>
          s.connected_account_id === input.accountId &&
          s.resource === input.resource &&
          s.resource_key === input.resourceKey,
      );
      if (existing !== undefined) return Promise.resolve({ ...existing });
      const s: Mutable<SyncStateRecord> = {
        id: crypto.randomUUID(),
        user_id: input.userId,
        connected_account_id: input.accountId,
        calendar_id: input.calendarId ?? null,
        resource: input.resource,
        resource_key: input.resourceKey,
        cursor: null,
        status: 'idle',
        page_token: null,
        backfill_until: null,
        backfill_cursor: null,
        window_start: null,
        window_end: null,
        rebaseline_due_at: null,
        watch_kind: 'none',
        watch_id: null,
        watch_resource_id: null,
        watch_token_hash: null,
        watch_history_id: null,
        watch_expires_at: null,
        watch_renew_after: null,
        lifecycle_last_event: null,
        lifecycle_last_at: null,
        next_poll_at: null,
        cursor_invalidated_at: null,
        last_full_sync_at: null,
        last_incremental_sync_at: null,
        last_success_at: null,
        last_error_code: null,
        consecutive_failures: 0,
        stats: {},
      };
      syncStates.set(s.id, s);
      return Promise.resolve({ ...s });
    },
    getSyncState: (id) => Promise.resolve(syncStates.has(id) ? { ...syncStates.get(id)! } : null),
    listSyncStates: (accountId) =>
      Promise.resolve(
        [...syncStates.values()]
          .filter((s) => s.connected_account_id === accountId)
          .map((s) => ({ ...s })),
      ),
    findSyncStateByWatch: (kind, watchId) =>
      Promise.resolve(
        [...syncStates.values()].find((s) => s.watch_kind === kind && s.watch_id === watchId) ??
          null,
      ),
    updateSyncState(id, patch) {
      const s = syncStates.get(id);
      if (s === undefined) return Promise.reject(new AppError('NOT_FOUND'));
      Object.assign(s, patch);
      return Promise.resolve({ ...s });
    },
    acquireLease(id, owner, seconds) {
      const lease = leases.get(id);
      if (lease !== undefined && lease.owner !== owner && lease.until > now().getTime())
        return Promise.resolve(false);
      leases.set(id, { owner, until: now().getTime() + seconds * 1000 });
      return Promise.resolve(true);
    },
    releaseLease(id, owner) {
      if (leases.get(id)?.owner === owner) leases.delete(id);
      return Promise.resolve();
    },

    upsertCalendars(accountId, list) {
      const a = accounts.get(accountId);
      if (a === undefined) return Promise.reject(new AppError('NOT_FOUND'));
      const limit = limitOf(a.user_id, 'max_calendars');
      let selectedCount = [...calendars.values()].filter(
        (c) => c.user_id === a.user_id && c.selected,
      ).length;
      for (const c of list) {
        const existing = [...calendars.values()].find(
          (x) =>
            x.connected_account_id === accountId &&
            x.provider_calendar_id === c.provider_calendar_id,
        );
        if (existing !== undefined) {
          Object.assign(existing, {
            name: c.name,
            color: c.color,
            time_zone: c.time_zone,
            access_role: c.access_role,
            is_primary: c.is_primary,
            can_write: c.can_write,
            kind: c.kind,
          });
          continue;
        }
        const eligible =
          c.kind !== 'holidays' &&
          c.kind !== 'birthdays' &&
          (c.is_primary ||
            ((limit === null || limit > 1) &&
              (c.access_role === 'owner' || c.access_role === 'writer')));
        const selected = eligible && (limit === null || selectedCount < limit);
        if (selected) selectedCount++;
        const id = crypto.randomUUID();
        calendars.set(id, {
          id,
          user_id: a.user_id,
          connected_account_id: accountId,
          provider: a.provider,
          provider_calendar_id: c.provider_calendar_id,
          name: c.name,
          color: c.color,
          time_zone: c.time_zone,
          access_role: c.access_role,
          is_primary: c.is_primary,
          selected,
          can_write: c.can_write,
          kind: c.kind,
        });
      }
      const listed = new Set(list.map((c) => c.provider_calendar_id));
      const mine = [...calendars.values()].filter((c) => c.connected_account_id === accountId);
      return Promise.resolve({
        calendars: mine.filter((c) => listed.has(c.provider_calendar_id)).map((c) => ({ ...c })),
        missing: mine.filter((c) => !listed.has(c.provider_calendar_id)).map((c) => c.id),
      });
    },
    listCalendars: (accountId) =>
      Promise.resolve(
        [...calendars.values()]
          .filter((c) => c.connected_account_id === accountId)
          .map((c) => ({ ...c })),
      ),
    getCalendar: (id) => Promise.resolve(calendars.has(id) ? { ...calendars.get(id)! } : null),
    deleteCalendars(ids) {
      for (const id of ids) {
        calendars.delete(id);
        for (const [key, e] of events) if (e.calendar_id === id) events.delete(key);
      }
      return Promise.resolve();
    },
    setCalendarSelected(id, selected) {
      const c = calendars.get(id);
      if (c === undefined) return Promise.reject(new AppError('NOT_FOUND'));
      if (selected && !c.selected) {
        const limit = limitOf(c.user_id, 'max_calendars');
        const count = [...calendars.values()].filter(
          (x) => x.user_id === c.user_id && x.selected,
        ).length;
        if (limit !== null && count >= limit)
          return Promise.reject(
            new AppError('ENTITLEMENT_REQUIRED', { details: { limit_key: 'max_calendars' } }),
          );
      }
      c.selected = selected;
      return Promise.resolve();
    },
    countSelectedCalendars: (userId) =>
      Promise.resolve(
        [...calendars.values()].filter((c) => c.user_id === userId && c.selected).length,
      ),
    defaultWriteCalendar: (userId) => Promise.resolve(defaultWrite.get(userId) ?? null),
    setDefaultWriteCalendar(userId, calendarId) {
      defaultWrite.set(userId, calendarId);
      return Promise.resolve();
    },

    upsertMail(accountId, rows) {
      const a = accounts.get(accountId);
      if (a === undefined) return Promise.reject(new AppError('NOT_FOUND'));
      return Promise.resolve(
        rows.map((row) => {
          const key = `${accountId}:${row.provider_message_id}`;
          const existing = mails.get(key);
          const threadId = existing?.thread_id ?? `thread:${accountId}:${row.provider_thread_id}`;
          const id = existing?.id ?? crypto.randomUUID();
          mails.set(key, {
            ...row,
            snippet: row.snippet.slice(0, 200),
            id,
            account_id: accountId,
            user_id: a.user_id,
            thread_id: threadId,
            provider_deleted_at: row.deleted ? iso() : (existing?.provider_deleted_at ?? null),
          });
          return {
            id,
            provider_message_id: row.provider_message_id,
            thread_id: threadId,
            inserted: existing === undefined,
          };
        }),
      );
    },
    applyMailChanges(accountId, labelChanges, deleted) {
      let labels = 0;
      let removed = 0;
      for (const change of labelChanges) {
        const m = mails.get(`${accountId}:${change.provider_message_id}`);
        if (m === undefined) continue;
        mails.set(`${accountId}:${change.provider_message_id}`, {
          ...m,
          labels: [...change.labels],
          is_read: change.is_read ?? m.is_read,
        });
        labels++;
      }
      for (const id of deleted) {
        const m = mails.get(`${accountId}:${id}`);
        if (m !== undefined && m.provider_deleted_at === null) {
          m.provider_deleted_at = iso();
          removed++;
        }
      }
      return Promise.resolve({ label_changes: labels, deleted: removed });
    },
    listRecentMessageIds: (accountId, since) =>
      Promise.resolve(
        [...mails.values()]
          .filter((m) => m.account_id === accountId && m.received_at >= since)
          .map((m) => m.provider_message_id),
      ),
    getMessage(id) {
      const m = [...mails.values()].find((x) => x.id === id);
      if (m === undefined) return Promise.resolve(null);
      return Promise.resolve({
        id: m.id,
        user_id: m.user_id,
        connected_account_id: m.account_id,
        provider_message_id: m.provider_message_id,
        provider_thread_id: m.provider_thread_id,
        subject: m.subject,
        from_email: m.from_email,
        from_name: m.from_name,
        to_emails: m.to_emails,
        cc_emails: m.cc_emails,
        received_at: m.received_at,
        web_link: m.web_link,
        provider_deleted_at: m.provider_deleted_at,
      });
    },
    upsertEvents(accountId, calendarId, rows, origin) {
      let cancelled = 0;
      for (const row of rows) {
        const key = `${calendarId}:${row.provider_event_id}`;
        const existing = events.get(key);
        const gone = row.deleted || row.status === 'cancelled';
        if (gone) cancelled++;
        events.set(key, {
          ...row,
          id: existing?.id ?? crypto.randomUUID(),
          calendar_id: calendarId,
          account_id: accountId,
          updated_at: iso(),
          provider_deleted_at: gone ? iso() : null,
          origin,
        });
      }
      return Promise.resolve({ upserted: rows.length, cancelled });
    },
    markEventsDeleted(calendarId, ids) {
      let n = 0;
      for (const id of ids) {
        const e = events.get(`${calendarId}:${id}`);
        if (e !== undefined && e.provider_deleted_at === null) {
          e.provider_deleted_at = iso();
          n++;
        }
      }
      return Promise.resolve(n);
    },
    pruneEvents(calendarId, since, windowStart, windowEnd) {
      let n = 0;
      for (const [key, e] of events) {
        if (e.calendar_id !== calendarId || e.updated_at >= since) continue;
        if (windowStart !== null && e.end_at < windowStart) continue;
        if (windowEnd !== null && e.start_at > windowEnd) continue;
        events.delete(key);
        n++;
      }
      return Promise.resolve(n);
    },
    upsertTasks(accountId, rows) {
      let n = 0;
      for (const row of rows) {
        const key = `${accountId}:${row.provider_list_id}:${row.provider_task_id}`;
        const existing = tasks.get(key);
        if (row.title.trim() === '') {
          if (row.deleted && existing !== undefined) existing.item_status = 'dismissed';
          continue;
        }
        tasks.set(key, {
          ...row,
          account_id: accountId,
          item_status: row.deleted ? 'dismissed' : row.status === 'completed' ? 'done' : 'open',
        });
        n++;
      }
      return Promise.resolve({ upserted: n });
    },
    stageDeviceSnapshot(accountId, snapshot) {
      const key = `${accountId}:${String(snapshot.content_hash)}`;
      if (!staged.has(key)) staged.set(key, { snapshot, applied: false });
      return Promise.resolve(key);
    },
    applyStagedDeviceSnapshot(accountId, contentHash) {
      const entry = staged.get(`${accountId}:${contentHash}`);
      if (entry === undefined) return Promise.reject(new AppError('NOT_FOUND'));
      if (entry.applied) return Promise.resolve({ skipped: 'already_applied' });
      entry.applied = true;
      const s = entry.snapshot as {
        calendars: {
          device_calendar_hash: string;
          title: string;
          selected: boolean;
          allows_modifications: boolean;
          color: string | null;
        }[];
        events: {
          event_key_hash: string;
          device_calendar_hash: string;
          title: string;
          start_at: string;
          end_at: string;
          all_day: boolean;
          location: string | null;
          meeting_url: string | null;
          status: 'confirmed' | 'tentative' | 'cancelled';
        }[];
      };
      const a = accounts.get(accountId);
      if (a === undefined) return Promise.reject(new AppError('NOT_FOUND'));
      const limit = limitOf(a.user_id, 'max_calendars');
      let kept = 0;
      const calIds = new Map<string, string>();
      for (const c of s.calendars) {
        if (!c.selected || (limit !== null && kept >= limit)) continue;
        kept++;
        const id = crypto.randomUUID();
        calIds.set(c.device_calendar_hash, id);
        calendars.set(id, {
          id,
          user_id: a.user_id,
          connected_account_id: accountId,
          provider: a.provider,
          provider_calendar_id: c.device_calendar_hash,
          name: c.title,
          color: c.color,
          time_zone: null,
          access_role: c.allows_modifications ? 'owner' : 'reader',
          is_primary: false,
          selected: true,
          can_write: false,
          kind: 'other',
        });
      }
      let n = 0;
      for (const e of s.events) {
        const cal = calIds.get(e.device_calendar_hash);
        if (cal === undefined) continue;
        n++;
        events.set(`${cal}:${e.event_key_hash}`, {
          provider_event_id: e.event_key_hash,
          ical_uid: null,
          recurring_event_id: null,
          etag: null,
          title: e.title,
          description_excerpt: null,
          location: e.location,
          conference_url: e.meeting_url,
          start_at: e.start_at,
          end_at: e.end_at,
          all_day: e.all_day,
          start_date: null,
          end_date: null,
          time_zone: null,
          status: e.status,
          organizer_email: null,
          organizer_self: false,
          can_modify: false,
          attendees: [],
          attendee_count: 0,
          da_approval_id: null,
          provider_updated_at: null,
          deleted: false,
          id: crypto.randomUUID(),
          calendar_id: cal,
          account_id: accountId,
          updated_at: iso(),
          provider_deleted_at: null,
          origin: 'device',
        });
      }
      return Promise.resolve({ calendars: kept, events: n });
    },

    demoState(accountId) {
      const all = demo.get(accountId) ?? {};
      const out: Record<string, DemoResourceState> = {};
      for (const [k, v] of Object.entries(all))
        out[k] = { state: v.state, demo_clock: v.demo_clock };
      return Promise.resolve(out);
    },
    demoRecordWrite(accountId, resource, key, item) {
      const a = accounts.get(accountId);
      if (a === undefined || a.provider !== 'demo')
        return Promise.reject(new AppError('VALIDATION_FAILED'));
      const all = demo.get(accountId) ?? {};
      const entry = all[resource] ?? { state: { writes: {} }, demo_clock: null };
      const existing = entry.state.writes[key];
      if (existing !== undefined) return Promise.resolve({ created: false, item: existing });
      entry.state.writes[key] = item;
      all[resource] = entry;
      demo.set(accountId, all);
      return Promise.resolve({ created: true, item });
    },
    demoSetClock(accountId, resource, clock) {
      const all = demo.get(accountId) ?? {};
      const entry = all[resource] ?? { state: { writes: {} }, demo_clock: null };
      entry.demo_clock = clock;
      all[resource] = entry;
      demo.set(accountId, all);
      return Promise.resolve();
    },

    async disconnect(accountId, userId, revocationMode, purgeContent) {
      const a = accounts.get(accountId);
      if (a === undefined || a.user_id !== userId) throw new AppError('NOT_FOUND');
      const epochOf = (at: string) => Math.floor(Date.parse(at) / 1000);
      if (a.status === 'disconnected') {
        const job = jobs.byKey(`integration_purge:${a.id}:${epochOf(a.disconnected_at ?? iso())}`);
        return {
          account: { ...a },
          already: true,
          purgeJobId: job?.id ?? null,
          disconnectedAt: a.disconnected_at ?? iso(),
        };
      }
      const at = iso();
      for (const kind of ['access', 'refresh']) credentials.delete(`${a.id}:${kind}`);
      for (const s of syncStates.values()) {
        if (s.connected_account_id !== a.id) continue;
        Object.assign(s, {
          cursor: null,
          page_token: null,
          status: 'paused',
          watch_kind: 'none',
          watch_id: null,
          watch_resource_id: null,
          watch_token_hash: null,
          watch_expires_at: null,
        });
      }
      for (const c of calendars.values()) if (c.connected_account_id === a.id) c.selected = false;
      for (const j of jobs.jobs.values()) {
        if (
          j.connected_account_id === a.id &&
          (j.status === 'queued' || j.status === 'retrying') &&
          [
            'initial_sync',
            'gmail_sync',
            'outlook_sync',
            'calendar_sync',
            'tasks_sync',
            'device_calendar_ingest',
            'watch_renewal',
            'reconciliation',
            'provider_webhook',
          ].includes(j.type)
        ) {
          j.status = 'completed';
          j.last_error_code = 'CANCELLED';
        }
      }
      a.status = 'disconnected';
      a.disconnected_at = at;
      a.revocation_mode = revocationMode;
      touch(a);
      const purgeJobId = await jobs.enqueue({
        type: 'integration_purge',
        idempotencyKey: `integration_purge:${a.id}:${epochOf(at)}`,
        payload: {
          connected_account_id: a.id,
          user_id: a.user_id,
          purge_content: purgeContent,
          disconnected_at: at,
        },
        userId: a.user_id,
        accountId: a.id,
        runAfter: purgeContent ? now() : new Date(now().getTime() + 30 * 86_400_000),
        priority: 150,
        maxAttempts: 6,
      });
      return { account: { ...a }, already: false, purgeJobId, disconnectedAt: at };
    },
    purgeBatch(accountId, disconnectedAt, _purgeDerived, _batch, reason) {
      const a = accounts.get(accountId);
      if (a === undefined) return Promise.resolve({ done: true, skipped: 'account_gone' });
      if (reason === 'binding_expired') {
        if (a.status !== 'connecting' || a.pending_binding_until === null)
          return Promise.resolve({ done: true, skipped: 'bound' });
      } else if (
        a.status !== 'disconnected' ||
        (disconnectedAt !== null &&
          a.disconnected_at !== null &&
          a.disconnected_at > disconnectedAt)
      ) {
        return Promise.resolve({ done: true, skipped: 'reconnected' });
      }
      let m = 0;
      let e = 0;
      let t = 0;
      for (const [k, v] of mails) if (v.account_id === accountId) (mails.delete(k), m++);
      for (const [k, v] of events) if (v.account_id === accountId) (events.delete(k), e++);
      for (const [k, v] of tasks) if (v.account_id === accountId) (tasks.delete(k), t++);
      for (const [k, v] of calendars) if (v.connected_account_id === accountId) calendars.delete(k);
      for (const [k, v] of syncStates)
        if (v.connected_account_id === accountId) syncStates.delete(k);
      for (const j of jobs.jobs.values())
        if (j.connected_account_id === accountId) j.connected_account_id = null;
      accounts.delete(accountId);
      return Promise.resolve({
        done: true,
        deleted: { email_messages: m, calendar_events: e, tasks: t },
      });
    },
    jobStatuses: (ids) =>
      Promise.resolve(
        ids
          .map((id) => jobs.jobs.get(id))
          .filter((j) => j !== undefined)
          .map((j) => ({ id: j!.id, status: j!.status })),
      ),
  };
  return store;
}

export const NO_QUOTA: QuotaGate = { acquire: () => Promise.resolve() };

export interface IntegrationHarness {
  readonly runtime: IntegrationRuntime;
  readonly store: MemoryIntegrationStore;
  readonly jobs: MemoryJobsRepo;
  readonly audit: AuditEntry[];
  readonly fetchCalls: ReturnType<typeof stubFetch>['calls'];
  readonly logLines: string[];
  readonly webhooks: ReturnType<typeof memoryWebhookLedger>;
  readonly raw: RawEnv;
  readonly keyring: TokenKeyring;
  readonly pokes: string[];
  setNow(date: Date): void;
}

export const START = new Date('2026-09-24T07:30:00.000Z');

/** A runtime over the memory store, demo mode on and a recording fetch. */
export async function integrationHarness(
  options: {
    env?: Record<string, string | undefined>;
    fetch?: StubHandler;
    now?: Date;
    googleJwks?: Parameters<typeof integrationProviders>[0]['googleJwks'];
  } = {},
): Promise<IntegrationHarness> {
  let current = options.now ?? START;
  const now = () => current;
  const raw = testEnv({
    DEMO_MODE: 'true',
    API_PUBLIC_BASE_URL: 'https://api.example.test',
    HASH_PEPPER: randomBase64(32),
    ...options.env,
  });
  const jobs = memoryJobsRepo(() => current.getTime());
  const store = memoryIntegrationStore(jobs, now);
  const keyring = await loadKeyring({
    token_encryption_keys: { 1: raw.TOKEN_ENC_KEY_V1 ?? randomBase64(32) },
    TOKEN_ENC_ACTIVE_VERSION: 1,
  });
  const audit: AuditEntry[] = [];
  const sink = memorySink();
  const log = createLogger({ fn: 'worker', sink: sink.sink });
  const stub = stubFetch(options.fetch ?? (() => new Response('unexpected', { status: 599 })));
  const config = integrationConfig(raw);
  const pokes: string[] = [];
  const runtime: IntegrationRuntime = {
    store,
    providers: integrationProviders({
      raw,
      config,
      store,
      fetch: stub.fetch,
      now,
      sleep: () => Promise.resolve(),
      ...(options.googleJwks === undefined ? {} : { googleJwks: options.googleJwks }),
    }),
    keyring: () => Promise.resolve(keyring),
    quotaFor: () => NO_QUOTA,
    enqueue: (input) => jobs.enqueue(input),
    poke: (reason) => {
      pokes.push(reason);
      return Promise.resolve();
    },
    audit: { append: (entry) => Promise.resolve(void audit.push(entry)) },
    log,
    config,
    now,
  };
  return {
    runtime,
    store,
    jobs,
    audit,
    fetchCalls: stub.calls,
    logLines: sink.lines,
    webhooks: memoryWebhookLedger(),
    raw,
    keyring,
    pokes,
    setNow(date) {
      current = date;
    },
  };
}

/** An active demo account with encrypted demo tokens (as a completed connect leaves it). */
export async function activeDemoAccount(
  h: IntegrationHarness,
  input: {
    userId: string;
    flavor?: 'google' | 'microsoft';
    capabilities?: Capability[];
    status?: AccountStatus;
    toggles?: Record<string, boolean>;
  },
): Promise<AccountRecord> {
  const flavor = input.flavor ?? 'google';
  const subject = (
    await hmacSha256Hex(h.runtime.config.pepper, `demo-subject:${input.userId}`)
  ).slice(0, 16);
  const account = h.store.addAccount({
    user_id: input.userId,
    provider: 'demo',
    provider_account_id: `demo-${flavor}-${subject}`,
    account_email: flavor === 'google' ? 'yunus@gmail.com' : 'yunus@outlook.com',
    demo_flavor: flavor,
    status: input.status ?? 'syncing',
    capabilities_granted: input.capabilities ?? ['mail_read', 'calendar_read', 'tasks_read'],
    data_source_toggles: input.toggles ?? {},
  });
  const binding = (kind: 'access' | 'refresh') =>
    ({ account: account.id, provider: 'demo', kind }) as const;
  await h.store.saveCredential(account, {
    kind: 'refresh',
    token: await encryptToken(h.keyring, `demo-rt.${flavor}.${subject}.test`, binding('refresh')),
    accessExpiresAt: null,
    scopeSnapshot: null,
  });
  await h.store.saveCredential(account, {
    kind: 'access',
    token: await encryptToken(h.keyring, `demo-at.${flavor}.${subject}.test`, binding('access')),
    accessExpiresAt: new Date(h.runtime.now().getTime() + 3_600_000).toISOString(),
    scopeSnapshot: null,
  });
  return account;
}

export const INTEGRATION_JOB_TYPES: readonly JobType[] = [
  'initial_sync',
  'gmail_sync',
  'outlook_sync',
  'calendar_sync',
  'tasks_sync',
  'device_calendar_ingest',
  'watch_renewal',
  'reconciliation',
  'provider_webhook',
  'integration_purge',
];

/** Runs every claimable integration job (optionally of some types) through the real runner. */
export async function drain(
  h: IntegrationHarness,
  types: readonly JobType[] = INTEGRATION_JOB_TYPES,
  rounds = 5,
) {
  const registry = createRegistry(
    integrationJobDefinitions({ runtime: h.runtime, webhooks: h.webhooks }),
  );
  let claimed = 0;
  for (let i = 0; i < rounds; i++) {
    const summary = await runWorker({
      repo: h.jobs,
      registry,
      log: h.runtime.log,
      maxJobs: 50,
      budgetMs: 120_000,
      types: [...types],
      now: () => h.runtime.now().getTime(),
    });
    claimed += summary.claimed;
    if (summary.claimed === 0) break;
  }
  return claimed;
}
