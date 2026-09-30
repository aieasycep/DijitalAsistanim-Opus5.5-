/**
 * PUB-02 `POST /data-deletion/start`, PUB-03 `POST /data-deletion/verify` and PUB-07
 * `GET /data-deletion/:requestId/status` (API_CONTRACTS §13; IMPLEMENTATION_PLAN T-9.04; C-24,
 * R-16; SECURITY_AND_PRIVACY_PLAN §4.8).
 *
 * - start: the answer is always `202 {status:'code_sent_if_account_exists'}`, padded to ≥ 400 ms, so
 *   nothing reveals whether an account exists. Only an existing, non-admin account gets a code
 *   (Supabase Auth OTP, `shouldCreateUser:false`, custom SMTP). IP-hash 10/h, e-mail-hash 3/h.
 * - verify: the OTP is the re-authentication. A wrong or expired code is `OTP_INVALID` whether or
 *   not the account exists; 5 failures in 15 minutes lock the address for 1 hour (`OTP_LOCKED`).
 *   A verified code creates (or returns) the account deletion request (`origin='web_otp'`,
 *   `confirmation_method='email_otp'`, `status='queued'`), sets the profile `deletion_pending`,
 *   enqueues JOB-23, revokes every session of the user and returns a one-time status token (only
 *   its sha256 is stored). History deletion needs the signed-in app (R-16, W-DEL-01), so
 *   `kind:'history'` is refused before any code is checked.
 * - status: `sha256(token)` is compared in constant time; an unknown id and a wrong token are the
 *   same 404. The body carries no identifier.
 */
import type { Hono } from 'hono';
import { publicApi, publicRoutes } from '@da/validation';
import { toBase64Url } from '../../_shared/crypto/encoding.ts';
import { hashId, normalizeEmailForHash } from '../../_shared/crypto/hash.ts';
import { secretsEqual, sha256, sha256Hex } from '../../_shared/crypto/hmac.ts';
import { AppError, fieldError } from '../../_shared/errors.ts';
import type { AppEnv } from '../../_shared/http/context.ts';
import { sendData } from '../../_shared/http/respond.ts';
import {
  mountRoute,
  parseJsonBody,
  rawBody,
  validateRequest,
  validBody,
  validParams,
  validQuery,
} from '../../_shared/http/validate.ts';
import type { DeletionStatusRow, PublicApiServices } from '../deps.ts';
import { emailSubject, enforcePublicLimit, ipSubject, OTP_POLICY } from '../limits.ts';
import { honeypotFilled } from './support.ts';

/** PUB-02 minimum response time (constant-time padding). */
export const START_MIN_MS = 400;

/** Human reference of a deletion request (`DEL-` + the first 8 hex digits of its id). */
export function deletionReference(requestId: string): string {
  return `DEL-${requestId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

type PublicStep = 'pending' | 'done' | 'skipped' | 'failed';

function step(value: unknown, requestStatus: DeletionStatusRow['status']): PublicStep {
  if (value === true || value === 'done' || value === 'revoked' || value === 'deleted')
    return 'done';
  if (value === false || value === 'failed') return 'failed';
  if (value === 'skipped' || value === 'no_token' || value === 'local_only') return 'skipped';
  if (typeof value === 'object' && value !== null) {
    const states = Object.values(value as Record<string, unknown>);
    if (states.some((s) => s === 'failed')) return 'failed';
    return states.length > 0 ? 'done' : 'pending';
  }
  return requestStatus === 'failed'
    ? 'failed'
    : requestStatus === 'completed'
      ? 'skipped'
      : 'pending';
}

/** `steps_public` from `data_deletion_requests.steps` (DATABASE_AND_RLS_PLAN §4.8). */
export function publicSteps(row: DeletionStatusRow): Record<string, PublicStep> {
  const steps = row.steps;
  const history = row.kind === 'history';
  return {
    provider_revoke: history ? 'skipped' : step(steps.provider_revoke, row.status),
    storage_purged: step(steps.storage_purged, row.status),
    db_purged: step(steps.db_purged, row.status),
    auth_user_deleted: history ? 'skipped' : step(steps.auth_user_deleted, row.status),
  };
}

export function registerDeletionRoutes(app: Hono<AppEnv>, services: PublicApiServices): void {
  const pad = async (startedAt: number): Promise<void> => {
    const elapsed = services.now().getTime() - startedAt;
    if (elapsed < START_MIN_MS) await services.sleep(START_MIN_MS - elapsed);
  };

  const start = publicRoutes['POST /data-deletion/start'];
  mountRoute(
    app,
    start,
    parseJsonBody(start),
    async (c, next) => {
      if (honeypotFilled(rawBody(c))) {
        await pad(services.now().getTime());
        return sendData(c, { status: 'code_sent_if_account_exists' }, 202);
      }
      await next();
    },
    validateRequest(start),
    async (c) => {
      const startedAt = services.now().getTime();
      const body = validBody(c, publicApi.DataDeletionStartBody);
      if (services.captcha !== null && !(await services.captcha.verify(body.captcha_token))) {
        throw fieldError('captcha_token', 'captcha_failed');
      }
      await enforcePublicLimit(
        c,
        services,
        'deletion_start_ip',
        await ipSubject(c, services.pepper),
      );
      await enforcePublicLimit(
        c,
        services,
        'deletion_start_email',
        await emailSubject(services.pepper, body.email),
      );
      const subject = await services.repo.deletionSubject(body.email);
      if (subject !== null && !subject.is_admin) {
        try {
          await services.otp.sendCode(body.email, body.locale);
        } catch {
          c.get('log').warn('deletion_otp_send_failed');
        }
      }
      await pad(startedAt);
      return sendData(c, { status: 'code_sent_if_account_exists' }, 202);
    },
  );

  const verify = publicRoutes['POST /data-deletion/verify'];
  mountRoute(app, verify, parseJsonBody(verify), validateRequest(verify), async (c) => {
    const body = validBody(c, publicApi.DataDeletionVerifyBody);
    if (body.kind === 'history') throw fieldError('kind', 'history_requires_app');
    const subject = await emailSubject(services.pepper, body.email);
    const locked = await services.repo.otpLockSeconds(subject);
    if (locked > 0) {
      throw new AppError('OTP_LOCKED', { headers: { 'Retry-After': String(locked) } });
    }
    const verified = await services.otp.verifyCode(body.email, body.code);
    if (verified === null || verified.isAdmin) {
      if (verified !== null) await services.otp.revokeSessions(verified.accessToken);
      const failure = await services.repo.otpRecordFailure(subject);
      if (failure.locked) {
        throw new AppError('OTP_LOCKED', {
          headers: { 'Retry-After': String(failure.retry_after || OTP_POLICY.lockSeconds) },
        });
      }
      throw new AppError('OTP_INVALID');
    }
    const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const request = await services.repo.createDeletionRequest({
      userId: verified.userId,
      statusTokenHash: await sha256(token),
      subjectEmailHash: await hashId(services.pepper, `email:${normalizeEmailForHash(body.email)}`),
      correlationId: c.get('correlationId'),
    });
    const active = await services.repo.subscriptionActive(verified.userId);
    if (!(await services.otp.revokeSessions(verified.accessToken))) {
      c.get('log').error('deletion_session_revoke_failed');
    }
    if (request.created) await services.poke();
    return sendData(
      c,
      {
        reference: deletionReference(request.request_id),
        request_id: request.request_id,
        status: 'queued',
        status_token: token,
        subscription_notice: { active },
      },
      202,
    );
  });

  const status = publicRoutes['GET /data-deletion/:requestId/status'];
  mountRoute(app, status, validateRequest(status), async (c) => {
    const params = validParams(c, publicApi.DeletionStatusParams);
    const query = validQuery(c, publicApi.DeletionStatusQuery);
    await enforcePublicLimit(c, services, 'deletion_status_request', `req:${params.requestId}`);
    await enforcePublicLimit(
      c,
      services,
      'deletion_status_ip',
      await ipSubject(c, services.pepper),
    );
    const row = await services.repo.deletionStatus(params.requestId);
    const presented = await sha256Hex(query.token);
    const expected = row?.status_token_hash ?? '0'.repeat(64);
    const matches = await secretsEqual(presented, expected);
    if (row === null || row.status_token_hash === null || !matches) throw new AppError('NOT_FOUND');
    c.header('Cache-Control', 'no-store');
    return sendData(c, {
      reference: deletionReference(row.id),
      kind: row.kind,
      status: row.status,
      requested_at: new Date(row.requested_at).toISOString(),
      completed_at: row.completed_at === null ? null : new Date(row.completed_at).toISOString(),
      steps_public: publicSteps(row),
    });
  });
}
