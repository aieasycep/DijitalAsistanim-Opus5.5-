/**
 * Disconnect, revoke and purge (API_CONTRACTS API-INT-03, JOB-29; INTEGRATION_PLAN §3.14; T-4.13).
 *
 * Provider effects run first, sequentially, inside an 8-second budget and never fail the request:
 * stop Gmail watch / Calendar channels / Graph subscriptions, then revoke (Google `POST /revoke` with
 * the refresh token; Microsoft has no per-app revoke → `local_only` + the manual revoke page; demo
 * ends its grant with the credentials). The database step is one transaction
 * (`private.disconnect_integration`): credentials deleted, cursors and watches cleared, calendars
 * deselected, queued sync jobs cancelled, status `disconnected`, and `integration_purge` enqueued
 * (now with `purge_content`, else after 30 days; content is hidden meanwhile).
 */
import { ProviderError, type RevokeResult } from '@da/domain';
import { decryptToken } from '../../crypto/token-cipher.ts';
import { AppError } from '../../errors.ts';
import type { JobResult } from '../../jobs/types.ts';
import type { Logger } from '../../logging/logger.ts';
import { providerContextFor } from './context.ts';
import { enqueueInsightRefresh, jobRef, type JobRefData } from './enqueue.ts';
import type { IntegrationRuntime } from './runtime.ts';
import { manualRevokeUrl, summaryOf } from './status.ts';
import type { AccountRecord } from './types.ts';
import type { AccountSummary } from '@da/validation';

const PROVIDER_BUDGET_MS = 8_000;

export interface DisconnectResult {
  readonly account: AccountSummary;
  readonly revocation: 'provider_revoked' | 'local_only' | 'revoke_failed';
  readonly manual_revoke_url: string | null;
  readonly purge_job: JobRefData;
}

function withBudget<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const left = deadline - Date.now();
  if (left <= 0)
    return Promise.reject(new ProviderError('provider_unavailable', null, null, 'budget'));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ProviderError('provider_unavailable', null, null, 'budget')),
      left,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Stops watches and revokes at the provider (best effort, bounded). */
async function providerTeardown(
  rt: IntegrationRuntime,
  account: AccountRecord,
  log: Logger,
  correlationId: string,
): Promise<RevokeResult | null> {
  if (account.provider === 'apple_device' || account.provider === 'android_device')
    return { mode: 'device_local' };
  const deadline = Date.now() + PROVIDER_BUDGET_MS;
  let adapters;
  try {
    adapters = rt.providers.resolve(account.provider as 'google' | 'microsoft' | 'demo');
  } catch {
    return account.provider === 'microsoft'
      ? {
          mode: 'local_only',
          userActionUrl: manualRevokeUrl({ ...account, revocation_mode: 'local_only' }) ?? '',
        }
      : null;
  }
  try {
    const ctx = await providerContextFor(rt, account, {
      owner: `disconnect:${correlationId}`,
      correlationId,
      log,
    });
    const calendars = new Map(
      (await rt.store.listCalendars(account.id)).map((c) => [c.id, c] as const),
    );
    for (const state of await rt.store.listSyncStates(account.id)) {
      if (state.watch_kind === 'none' || state.watch_id === null) continue;
      const calendar =
        state.calendar_id === null ? null : (calendars.get(state.calendar_id) ?? null);
      const adapter =
        state.watch_kind === 'gcal_channel' || state.resource === 'graph_calendar_view'
          ? adapters.calendar
          : adapters.mail;
      if (adapter === undefined) continue;
      try {
        await withBudget(
          adapter.stopWatch(ctx, {
            resource: state.resource,
            resourceKey: calendar?.provider_calendar_id ?? '',
            watchId: state.watch_id,
            providerResourceId: state.watch_resource_id,
            expiresAt: state.watch_expires_at ?? new Date(0).toISOString(),
            tokenHash: state.watch_token_hash,
          }),
          deadline,
        );
      } catch (error) {
        log.warn('integration_watch_stop_failed', {
          provider: account.provider,
          error_code: error instanceof ProviderError ? error.code : 'unknown',
        });
      }
    }
  } catch (error) {
    log.warn('integration_teardown_context_failed', {
      provider: account.provider,
      error_code: error instanceof ProviderError ? error.code : 'unknown',
    });
  }
  try {
    const row = await rt.store.getCredential(account.id, 'refresh');
    if (row === null) {
      return account.provider === 'microsoft'
        ? await adapters.oauth.revoke({ refreshToken: '' })
        : null;
    }
    const token = await decryptToken(await rt.keyring(), row, {
      account: account.id,
      provider: account.provider,
      kind: 'refresh',
    });
    return await withBudget(adapters.oauth.revoke({ refreshToken: token }), deadline);
  } catch (error) {
    log.warn('integration_revoke_failed', {
      provider: account.provider,
      error_code: error instanceof ProviderError ? error.code : 'unknown',
    });
    return null;
  }
}

export async function disconnectAccount(
  rt: IntegrationRuntime,
  input: {
    userId: string;
    accountId: string;
    purgeContent: boolean;
    correlationId: string;
    log: Logger;
  },
): Promise<DisconnectResult> {
  const account = await rt.store.getAccount(input.accountId);
  if (account === null || account.user_id !== input.userId) {
    throw new AppError('NOT_FOUND', { details: { resource: 'connected_account' } });
  }
  const revoke =
    account.status === 'disconnected'
      ? null
      : await providerTeardown(rt, account, input.log, input.correlationId);
  const mode = revoke?.mode ?? null;
  const outcome = await rt.store.disconnect(
    account.id,
    input.userId,
    mode,
    input.purgeContent,
    input.correlationId,
  );
  const revocation: DisconnectResult['revocation'] = outcome.already
    ? outcome.account.revocation_mode === 'provider_revoked'
      ? 'provider_revoked'
      : outcome.account.revocation_mode === null
        ? 'revoke_failed'
        : 'local_only'
    : mode === 'provider_revoked'
      ? 'provider_revoked'
      : mode === null
        ? 'revoke_failed'
        : 'local_only';
  if (!outcome.already) {
    await rt.audit.append({
      actorType: 'user',
      actorId: input.userId,
      action: 'user.integration.disconnected',
      targetType: 'connected_account',
      targetId: account.id,
      targetUserId: input.userId,
      result: 'success',
      details: { provider: account.provider, revocation, purge_content: input.purgeContent },
      correlationId: input.correlationId,
    });
    if (input.purgeContent) await rt.poke('integration_purge');
  }
  // A repeat call whose purge job row is gone re-enqueues it under the same key (JOB-29).
  const disconnectedAt = new Date(outcome.disconnectedAt);
  const purgeJobId =
    outcome.purgeJobId ??
    (await rt.enqueue({
      type: 'integration_purge',
      idempotencyKey: `integration_purge:${account.id}:${Math.floor(disconnectedAt.getTime() / 1000)}`,
      payload: {
        connected_account_id: account.id,
        user_id: account.user_id,
        purge_content: input.purgeContent,
        disconnected_at: outcome.disconnectedAt,
      },
      userId: account.user_id,
      accountId: account.id,
      runAfter: new Date(
        Math.max(
          rt.now().getTime(),
          disconnectedAt.getTime() + (input.purgeContent ? 0 : 30 * 86_400_000),
        ),
      ),
      priority: 150,
      maxAttempts: 6,
    }));
  const statuses = await rt.store.jobStatuses([purgeJobId]);
  return {
    account: await summaryOf(rt, outcome.account),
    revocation,
    manual_revoke_url: manualRevokeUrl(outcome.account),
    purge_job: jobRef(purgeJobId, statuses[0]?.status ?? 'queued'),
  };
}

export interface PurgePayload {
  readonly connected_account_id?: string;
  readonly account_id?: string;
  readonly user_id?: string;
  readonly purge_content?: boolean;
  readonly disconnected_at?: string;
  readonly reason?: 'binding_expired' | 'disconnect';
}

const PURGE_BATCH = 1000;
const PURGE_BUDGET_MS = 200_000;

/** JOB-29 `integration_purge` (also the R-07 binding-expiry purge from `scheduler_tick`). */
export async function runIntegrationPurge(
  rt: IntegrationRuntime,
  payload: PurgePayload,
  job: {
    id: string;
    idempotencyKey: string;
    correlationId: string;
    log: Logger;
    enqueue: IntegrationRuntime['enqueue'];
  },
): Promise<JobResult> {
  const accountId = payload.connected_account_id ?? payload.account_id;
  if (accountId === undefined) return { skipped: 'no_account' };
  const account = await rt.store.getAccount(accountId);
  if (account === null) return { done: true, skipped: 'account_gone' };
  const bindingExpired = payload.reason === 'binding_expired';
  if (bindingExpired) {
    if (account.status !== 'connecting' || account.pending_binding_until === null)
      return { skipped: 'bound' };
    // Unbound tokens of an abandoned connect: revoke, then delete the row (R-07).
    try {
      const row = await rt.store.getCredential(account.id, 'refresh');
      if (row !== null) {
        const token = await decryptToken(await rt.keyring(), row, {
          account: account.id,
          provider: account.provider,
          kind: 'refresh',
        });
        await rt.providers
          .resolve(account.provider as 'google' | 'microsoft' | 'demo')
          .oauth.revoke({ refreshToken: token });
      }
    } catch (error) {
      job.log.warn('binding_expired_revoke_failed', {
        error_code: error instanceof ProviderError ? error.code : 'unknown',
      });
    }
  }
  const started = Date.now();
  const totals: Record<string, number> = {};
  while (true) {
    const step = await rt.store.purgeBatch(
      account.id,
      bindingExpired ? null : (payload.disconnected_at ?? account.disconnected_at),
      !bindingExpired,
      PURGE_BATCH,
      bindingExpired ? 'binding_expired' : 'disconnect',
    );
    for (const [key, n] of Object.entries(step.deleted ?? {})) totals[key] = (totals[key] ?? 0) + n;
    if (step.skipped !== undefined) return { skipped: step.skipped, ...totals };
    if (step.done) break;
    if (Date.now() - started > PURGE_BUDGET_MS) {
      await job.enqueue({
        type: 'integration_purge',
        idempotencyKey: `${job.idempotencyKey}:c${Math.floor(Date.now() / 1000)}`,
        payload: { ...payload },
        userId: account.user_id,
        priority: 150,
        maxAttempts: 6,
      });
      return { continued: true, ...totals };
    }
  }
  if (!bindingExpired) {
    await rt.audit.append({
      actorType: 'system',
      actorId: null,
      action: 'system.integration.purged',
      targetType: 'connected_account',
      targetId: account.id,
      targetUserId: account.user_id,
      result: 'success',
      details: { provider: account.provider, ...totals },
      correlationId: job.correlationId,
    });
    await enqueueInsightRefresh(
      { ...rt, enqueue: job.enqueue },
      account,
      'all',
      'integration_purge',
    );
  }
  return { done: true, ...totals };
}
