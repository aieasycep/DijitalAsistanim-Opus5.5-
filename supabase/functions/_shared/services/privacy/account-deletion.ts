/**
 * JOB-23 `account_deletion` (API_CONTRACTS §11.4; SECURITY_AND_PRIVACY_PLAN §4.8; IMPLEMENTATION_PLAN
 * T-11.03; M§41, M§129; Apple 5.1.1(v)). Serves app requests (API-PRV-03), web requests
 * (PUB-03, `origin='web_otp'`) and admin retries (ADM-16, payload `{request_id}` only).
 *
 * Ordered steps, each recorded in `data_deletion_requests.steps` and skipped when already done, so
 * a crashed or retried attempt resumes where it stopped:
 *  1. begin: `processing`, profile `deletion_pending`, push off, pending approvals expired, other
 *     jobs cancelled; new sign-ins banned (`sign_in_blocked`);
 *  2. the confirmation address is sealed on the request while the auth user still exists
 *     (`notify_email`: stored | not_configured | no_address);
 *  3. every connected account goes through the integrations disconnect service: watches stopped,
 *     Google revoked, Microsoft purged locally (`local_only` + the manual link), credentials deleted
 *     (`watches_stopped`, `provider_revoke:{provider: revoked|local_only|failed}`, `tokens_purged`);
 *  4. Sign in with Apple revoke with the stored refresh token (`apple_siwa_revoked`: revoked |
 *     no_token | not_configured | failed after 3 tries);
 *  5. RevenueCat customer delete (`revenuecat_deleted`: deleted | not_found | not_configured |
 *     failed after 5 tries); the store subscription itself is not cancelled;
 *  6. Storage purge of `{user}/` in captures, exports and briefing-audio until empty
 *     (`storage_purged`);
 *  7. system tables without cascade: analytics, AI requests, jobs deleted; tickets anonymised;
 *     billing events pseudonymised (`system_purged`); tombstone hashes (`tombstones`);
 *  8. the auth user is deleted, cascading every user table incl. embeddings and credentials
 *     (`auth_user_deleted`, `db_purged`, `embeddings_purged`); audit subjects pseudonymised;
 *  9. schema-driven verification: no row with the user id in any public table and no object under
 *     the prefix (`verified`), otherwise the attempt is retried and the request stays `processing`;
 * 10. the JOB-31 confirmation e-mail is queued when the e-mail API is configured
 *     (`confirmation_email`), then the request is `completed`.
 * A failed revoke never blocks deletion; it is recorded in `steps`. The status is never
 * `completed` before step 9 passed; the last failed attempt sets `failed`.
 */
import { SIWA_PROVIDER } from '../apple.ts';
import { sha256Hex } from '../../crypto/hmac.ts';
import type { Pepper } from '../../crypto/hash.ts';
import { decryptToken, type TokenKeyring } from '../../crypto/token-cipher.ts';
import { canonicalJson } from '../../idempotency.ts';
import type { Logger } from '../../logging/logger.ts';
import { type Json, JobError, type JobContext, type JobResult } from '../../jobs/types.ts';
import type { CredentialsRepo } from '../credentials.ts';
import { signalHash } from '../referrals/signals.ts';
import {
  type DeletionJobDeps,
  type DeletionJobPayload,
  failIfFinal,
  isRetryable,
  loadDeletionRequest,
} from './history.ts';
import { sealNotifyEmail } from './notify-email.ts';
import type { AppleRevoker, AuthAdmin } from './providers.ts';
import type { Steps } from './repo.ts';
import { PRIVATE_BUCKETS, removeInBatches } from './storage.ts';

export type Revocation = 'provider_revoked' | 'local_only' | 'revoke_failed';

export interface AccountDeletionDeps extends DeletionJobDeps {
  readonly authAdmin: AuthAdmin;
  /** Integrations disconnect (stop watches, revoke, delete credentials) of one connected account. */
  readonly teardown: (input: {
    userId: string;
    accountId: string;
    correlationId: string;
    log: Logger;
  }) => Promise<Revocation>;
  readonly credentials: CredentialsRepo;
  readonly keyring: () => Promise<TokenKeyring>;
  readonly apple: AppleRevoker | null;
  /** RevenueCat customer delete, or null while the credential is missing. */
  readonly revenueCat:
    ((appUserId: string, signal?: AbortSignal) => Promise<'deleted' | 'not_found'>) | null;
  readonly pepper: Pepper;
  /** The JOB-31 e-mail API is configured (`EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM_ADDRESS`). */
  readonly emailConfigured: boolean;
}

export interface AccountDeletionPayload extends DeletionJobPayload {
  readonly source?: 'app' | 'web' | 'admin' | undefined;
}

export const ACCOUNT_DELETED_TEMPLATE = 'account_deleted';
const STORAGE_ROUNDS = 20;
const DEVICE_PROVIDERS = new Set(['apple_device', 'android_device']);
const REVOKE_RANK: Readonly<Record<string, number>> = {
  skipped: 0,
  revoked: 1,
  local_only: 2,
  failed: 3,
};

/** Human reference of a deletion request (`DEL-` + 8 hex digits), as PUB-03/PUB-07 show it. */
export function deletionReference(requestId: string): string {
  return `DEL-${requestId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function lang(locale: string | null): 'tr' | 'en' {
  return locale !== null && locale.toLowerCase().startsWith('en') ? 'en' : 'tr';
}

function worst(current: unknown, next: string): string {
  const now = typeof current === 'string' ? current : 'skipped';
  return (REVOKE_RANK[next] ?? 0) > (REVOKE_RANK[now] ?? 0) ? next : now;
}

export async function runAccountDeletionJob(
  deps: AccountDeletionDeps,
  ctx: JobContext<AccountDeletionPayload>,
): Promise<JobResult> {
  const row = await loadDeletionRequest(deps.repo, ctx.payload, 'account');
  if (row === null) return { skipped: 'request_gone' };
  if (row.status === 'completed' || row.status === 'cancelled')
    return { skipped: `status_${row.status}` };
  if (
    row.user_id !== null &&
    ctx.payload.user_id !== undefined &&
    ctx.payload.user_id !== row.user_id
  ) {
    throw new JobError('FORBIDDEN', false, null, 'user_mismatch');
  }
  const userId = row.user_id ?? ctx.payload.user_id ?? null;
  const steps: Steps = { ...row.steps };
  const record = async (patch: Steps): Promise<void> => {
    Object.assign(steps, patch);
    await deps.repo.updateDeletionRequest(row.id, { steps: patch });
  };
  /** A retryable failure is retried up to `max` job attempts, then recorded and skipped. */
  const retryOrRecord = async (key: string, max: number, error: unknown): Promise<void> => {
    const tries =
      (typeof steps[`${key}_tries`] === 'number' ? (steps[`${key}_tries`] as number) : 0) + 1;
    if (isRetryable(error) && tries < max) {
      await record({ [`${key}_tries`]: tries });
      throw error;
    }
    ctx.log.warn('account_deletion_step_failed', { step: key, tries });
    await record({ [key]: 'failed', [`${key}_tries`]: tries });
  };

  try {
    if (userId === null) throw new JobError('SUBJECT_UNKNOWN', false);
    const begun = await deps.repo.beginAccountDeletion(row.id, userId, ctx.job.id);
    if (begun.state === 'completed' || begun.state === 'cancelled') {
      return { skipped: `status_${begun.state}` };
    }
    const context = await deps.repo.accountContext(userId);

    // 1. No new sign-in while the deletion runs.
    if (steps.sign_in_blocked !== 'done') {
      if (context.user_exists) await deps.authAdmin.ban(userId);
      await record({ sign_in_blocked: 'done' });
    }

    // 2. Confirmation address, sealed while it can still be read.
    if (steps.notify_email === undefined) {
      if (!deps.emailConfigured) await record({ notify_email: 'not_configured' });
      else if (context.email === null || context.email === '')
        await record({ notify_email: 'no_address' });
      else {
        const sealed = await sealNotifyEmail(await deps.keyring(), row.id, context.email);
        Object.assign(steps, { notify_email: 'stored' });
        await deps.repo.updateDeletionRequest(row.id, {
          notify: sealed,
          notifyLocale: lang(context.locale),
          steps: { notify_email: 'stored' },
        });
      }
    }

    // 3. Watches, provider revoke, credentials (integrations disconnect service).
    if (steps.watches_stopped !== 'done') {
      const revoke: Record<string, Json> =
        typeof steps.provider_revoke === 'object' && steps.provider_revoke !== null
          ? { ...(steps.provider_revoke as Record<string, Json>) }
          : {};
      const done = new Set(
        Array.isArray(steps.accounts_done) ? (steps.accounts_done as string[]) : [],
      );
      for (const account of context.accounts) {
        if (done.has(account.id)) continue;
        let state = 'skipped';
        if (!DEVICE_PROVIDERS.has(account.provider)) {
          const mode = await deps.teardown({
            userId,
            accountId: account.id,
            correlationId: ctx.correlationId,
            log: ctx.log,
          });
          state =
            mode === 'provider_revoked'
              ? 'revoked'
              : mode === 'local_only'
                ? 'local_only'
                : 'failed';
        }
        revoke[account.provider] = worst(revoke[account.provider], state);
        done.add(account.id);
        await record({ provider_revoke: revoke, accounts_done: [...done] });
      }
      await record({
        watches_stopped: 'done',
        tokens_purged: 'done',
        provider_revoke: Object.keys(revoke).length === 0 ? 'skipped' : revoke,
      });
    }

    // 4. Sign in with Apple.
    if (steps.apple_siwa_revoked === undefined) {
      const credential = context.user_exists
        ? await deps.credentials.findUserCredential(userId, 'apple_siwa_refresh')
        : null;
      if (credential === null) await record({ apple_siwa_revoked: 'no_token' });
      else if (deps.apple === null) await record({ apple_siwa_revoked: 'not_configured' });
      else {
        try {
          const token = await decryptToken(await deps.keyring(), credential, {
            account: userId,
            provider: SIWA_PROVIDER,
            kind: 'apple_siwa_refresh',
          });
          await deps.apple.revoke(token, ctx.signal);
          await record({ apple_siwa_revoked: 'revoked' });
        } catch (error) {
          await retryOrRecord('apple_siwa_revoked', 3, error);
        }
      }
    }

    // 5. RevenueCat customer.
    if (steps.revenuecat_deleted === undefined) {
      if (deps.revenueCat === null) await record({ revenuecat_deleted: 'not_configured' });
      else {
        try {
          await record({ revenuecat_deleted: await deps.revenueCat(userId, ctx.signal) });
        } catch (error) {
          await retryOrRecord('revenuecat_deleted', 5, error);
        }
      }
    }

    // 6. Storage (Storage API; SQL deletes on storage.objects are not allowed).
    if (steps.storage_purged !== 'done') {
      let removed = 0;
      for (const bucket of PRIVATE_BUCKETS) {
        let emptied = false;
        for (let round = 0; round < STORAGE_ROUNDS; round++) {
          const paths = await deps.store.list(bucket, userId);
          if (paths.length === 0) {
            emptied = true;
            break;
          }
          removed += await removeInBatches(deps.store, bucket, paths);
        }
        if (!emptied) throw new JobError('STORAGE_NOT_EMPTY', true, null, bucket);
      }
      await record({ storage_purged: 'done', objects_removed: removed });
    }

    // 7. System tables and tombstones.
    if (steps.system_purged !== 'done') {
      const purged = await deps.repo.systemPurge(userId, ctx.job.id);
      await record({ system_purged: 'done', system: purged });
    }
    if (steps.tombstones === undefined) {
      const signals: { kind: string; hash: string }[] = [];
      const add = async (kind: 'email' | 'installation' | 'apple_sub', value: string | null) => {
        const hash = await signalHash(deps.pepper, kind, value);
        if (hash !== null) signals.push({ kind, hash });
      };
      await add('email', context.email);
      await add('apple_sub', context.apple_sub);
      for (const id of context.installation_ids) await add('installation', id);
      await record({
        tombstones: signals.length === 0 ? 0 : await deps.repo.upsertTombstones(signals),
      });
    }

    // 8. Auth user (cascade) and audit pseudonymisation.
    if (steps.auth_user_deleted !== 'done') {
      await deps.authAdmin.deleteUser(userId);
      await record({ auth_user_deleted: 'done', db_purged: 'done', embeddings_purged: 'done' });
    }
    if (steps.audit_pseudonymized !== 'done') {
      await deps.repo.pseudonymizeAudit(userId);
      await record({ audit_pseudonymized: 'done' });
    }

    // 9. Nothing may remain.
    const remaining = await deps.repo.rowsRemaining(userId);
    if (Object.keys(remaining).length > 0) {
      await record({ verified: 'rows_remaining', remaining_tables: Object.keys(remaining).length });
      throw new JobError('DELETION_VERIFY_FAILED', true, null, Object.keys(remaining).join(','));
    }
    await record({ verified: 'done' });

    // 10. Confirmation e-mail (JOB-31) and completion.
    if (steps.confirmation_email === undefined) {
      if (steps.notify_email === 'stored') {
        const params = { reference: deletionReference(row.id) };
        const paramsHash = (await sha256Hex(canonicalJson(params))).slice(0, 16);
        await ctx.enqueue({
          type: 'transactional_email',
          idempotencyKey: `transactional_email:${ACCOUNT_DELETED_TEMPLATE}:${row.id}:${paramsHash}`,
          payload: {
            template_key: ACCOUNT_DELETED_TEMPLATE,
            recipient_ref: { type: 'deletion_request', id: row.id },
            locale: lang(context.locale),
            params,
          },
          userId: null,
          priority: 60,
          maxAttempts: 5,
        });
        await record({ confirmation_email: 'queued' });
      } else {
        await record({
          confirmation_email:
            steps.notify_email === 'not_configured' ? 'not_configured' : 'no_address',
        });
      }
    }
    const warnings = Object.entries(steps).filter(
      ([key, value]) =>
        !key.endsWith('_tries') &&
        (value === 'failed' ||
          (typeof value === 'object' &&
            value !== null &&
            Object.values(value as Record<string, unknown>).includes('failed'))),
    ).length;
    await deps.repo.updateDeletionRequest(row.id, {
      status: 'completed',
      steps: { completed_at: ctx.now().toISOString(), warnings },
    });
    await deps.audit.append({
      actorType: 'system',
      actorId: null,
      action: 'system.privacy.account_deletion_completed',
      targetType: 'data_deletion_request',
      targetId: row.id,
      targetUserId: null,
      result: 'success',
      details: { warnings, source: ctx.payload.source ?? row.origin },
      correlationId: ctx.correlationId,
    });
    return { status: 'completed', warnings };
  } catch (error) {
    return await failIfFinal(deps.repo, ctx as JobContext<unknown>, row.id, error);
  }
}
