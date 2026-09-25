/**
 * Service-side operations the admin routes run after their SQL gate (BACKOFFICE_PLAN §2.5 step 10):
 * worker pokes, `transactional_email` jobs (JOB-31), Supabase Auth admin calls (ban, factors,
 * sign-out, user creation) and PII-lookup hashes. The service client is used only after the
 * permission was checked in SQL.
 */
import type { JobStatus } from '@da/domain';
import { emailConfig } from '../../_shared/email/provider.ts';
import { toByteaHex } from '../../_shared/crypto/encoding.ts';
import { hmacSha256Hex, sha256, sha256Hex } from '../../_shared/crypto/hmac.ts';
import { AppError, mapDbError } from '../../_shared/errors.ts';
import { enqueueJob, pokeWorker } from '../../_shared/jobs/client.ts';
import type { Json as JobJson } from '../../_shared/jobs/types.ts';
import type { Logger } from '../../_shared/logging/logger.ts';
import { sealEmailParam } from '../../_shared/email/seal.ts';
import type { AdminRuntime } from './runtime.ts';

/** `JobRef` of a freshly queued job (API_CONTRACTS §4 `JobRef`). */
export function jobRef(jobId: string, status: JobStatus = 'queued') {
  return { job_id: jobId, status, poll_after_ms: 1500 };
}

/** Wakes the worker right away (best effort; the 15 s cron poke is the backstop). */
export async function poke(rt: AdminRuntime, log: Logger, reason: string): Promise<void> {
  await pokeWorker({
    baseUrl: rt.env.supabaseUrl,
    secret: rt.env.cronSecret,
    reason,
    fetch: rt.fetch,
    log,
  });
}

/** Refuses with `503 EXTERNAL_CREDENTIAL_REQUIRED` when the email API is not configured. */
export function requireEmailCredential(rt: AdminRuntime): void {
  const config = emailConfig(rt.env.raw);
  if (!config.configured) {
    throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
      details: { feature: 'email', reason: config.reason, credential_keys: [...config.missing] },
    });
  }
}

export function emailConfigured(rt: AdminRuntime): boolean {
  return emailConfig(rt.env.raw).configured;
}

export interface EmailJobInput {
  readonly templateKey: 'admin_invite' | 'support_reply' | 'admin_security_recovery_used';
  readonly recipient: { readonly type: 'admin_user' | 'support_ticket'; readonly id: string };
  readonly locale: 'tr' | 'en';
  readonly params: Record<string, string | number>;
  /** Unique part of the idempotency key (`transactional_email:{template}:{recipient}:{unique}`). */
  readonly unique: string;
  readonly correlationId: string | null;
}

/** Enqueues one `transactional_email` job; the payload never carries an address. */
export async function enqueueEmail(rt: AdminRuntime, input: EmailJobInput): Promise<string> {
  const payload: JobJson = {
    template_key: input.templateKey,
    recipient_ref: { type: input.recipient.type, id: input.recipient.id },
    locale: input.locale,
    params: input.params,
  };
  return await enqueueJob(rt.system, {
    type: 'transactional_email',
    idempotencyKey: `transactional_email:${input.templateKey}:${input.recipient.id}:${input.unique}`,
    payload,
    priority: 20,
    maxAttempts: 5,
    correlationId: input.correlationId,
  });
}

/** Seals an invite token for the job payload (AES-GCM with the token keyring, bound to the admin). */
export async function sealInviteToken(
  rt: AdminRuntime,
  adminId: string,
  token: string,
): Promise<string> {
  return await sealEmailParam(await rt.keyring(), token, `admin_invite|${adminId}`);
}

/** `\x…` bytea literal of sha256(value). */
export async function sha256Bytea(value: string): Promise<string> {
  return toByteaHex(await sha256(value));
}

/**
 * Sign-in subject hashes (SECURITY_AND_PRIVACY_PLAN R-18, BACKOFFICE_PLAN §3.9, §849). The backoffice
 * server holds no pepper: it sends `email_hash = sha256(lower(trim(email)))` and `ip_hash =
 * sha256(ip)` as hex digests. admin-api peppers them on receipt — `HMAC(PII_LOOKUP_PEPPER, digest)`,
 * or `HMAC(HASH_PEPPER, digest)` while the lookup pepper is not configured — so only peppered
 * hashes reach `rate_limits` and `audit_logs`.
 */
export function subjectPepper(rt: AdminRuntime): string {
  return rt.env.piiLookupPepper ?? rt.env.hashPepper;
}

/** The plain digest the backoffice sends for an email. */
export async function emailDigest(email: string): Promise<string> {
  return await sha256Hex(email.trim().toLowerCase());
}

/** Peppered rate-limit key of a backoffice digest (email or IP). */
export async function pepperedSubject(rt: AdminRuntime, digest: string): Promise<string> {
  return await hmacSha256Hex(subjectPepper(rt), digest.toLowerCase());
}

/** The peppered key of an admin email (`admin_unlock` clears the counters stored under it). */
export async function emailLookupHash(rt: AdminRuntime, email: string): Promise<string> {
  return await pepperedSubject(rt, await emailDigest(email));
}

/**
 * The admin email whose digest equals `emailDigestHex` (service role; admin identities are few).
 * `null` when nothing matches; the SQL sign-in functions then answer exactly as for an unknown
 * email (no enumeration).
 */
export async function adminEmailForHash(
  rt: AdminRuntime,
  _log: Logger,
  emailDigestHex: string,
): Promise<string | null> {
  const { data, error } = await rt.system.from('admin_users').select('email');
  if (error !== null) throw mapDbError(error);
  const wanted = emailDigestHex.toLowerCase();
  for (const row of (data ?? []) as { email: string }[]) {
    if ((await emailDigest(row.email)) === wanted) return row.email;
  }
  return null;
}

// ── Supabase Auth admin (service role) ───────────────────────────────────────

function authError(step: string, error: unknown): AppError {
  return new AppError('SERVICE_UNAVAILABLE', {
    details: { reason: 'auth_admin', step },
    cause: error,
  });
}

/** Bans (disable) or unbans (restore) an Auth user; bans refresh-token use immediately. */
export async function setAuthBan(rt: AdminRuntime, userId: string, banned: boolean): Promise<void> {
  const { error } = await rt.system.auth.admin.updateUserById(userId, {
    ban_duration: banned ? '876000h' : 'none',
  });
  if (error !== null) throw authError(banned ? 'ban' : 'unban', error);
}

/** Deletes every MFA factor of an Auth user; returns how many were removed. */
export async function deleteMfaFactors(rt: AdminRuntime, userId: string): Promise<number> {
  const listed = await rt.system.auth.admin.mfa.listFactors({ userId });
  if (listed.error !== null) throw authError('list_factors', listed.error);
  let removed = 0;
  for (const factor of listed.data?.factors ?? []) {
    const { error } = await rt.system.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    if (error !== null) throw authError('delete_factor', error);
    removed += 1;
  }
  return removed;
}

/** The verified TOTP factor ids of an Auth user (Auth admin API, service client). */
export async function verifiedTotpFactorIds(rt: AdminRuntime, userId: string): Promise<string[]> {
  const listed = await rt.system.auth.admin.mfa.listFactors({ userId });
  if (listed.error !== null) throw authError('list_factors', listed.error);
  return (listed.data?.factors ?? [])
    .filter((f) => f.factor_type === 'totp' && f.status === 'verified')
    .map((f) => f.id);
}

/** Deletes one MFA factor of an Auth user. */
export async function deleteMfaFactor(
  rt: AdminRuntime,
  userId: string,
  factorId: string,
): Promise<void> {
  const { error } = await rt.system.auth.admin.mfa.deleteFactor({ id: factorId, userId });
  if (error !== null) throw authError('delete_factor', error);
}

/** Revokes refresh tokens of the JWT's session(s); failures are logged (the SQL row is ended). */
export async function authSignOut(
  rt: AdminRuntime,
  log: Logger,
  jwt: string,
  scope: 'local' | 'global' | 'others',
): Promise<void> {
  const { error } = await rt.system.auth.admin.signOut(jwt, scope);
  if (error !== null)
    log.warn('admin_auth_sign_out_failed', { scope, status: error.status ?? null });
}
