/**
 * External calls of account deletion (JOB-23; SECURITY_AND_PRIVACY_PLAN §4.8):
 * - Sign in with Apple revoke: `POST https://appleid.apple.com/auth/revoke` with the ES256 client
 *   secret (`crypto/jwt-sign.ts`), the stored `apple_siwa_refresh` token and
 *   `token_type_hint=refresh_token`. External credential required: `APPLE_TEAM_ID`,
 *   `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY`, `APPLE_SIWA_NATIVE_CLIENT_ID`.
 * - Supabase Auth admin: ban further sign-in, sign out the other sessions, delete the auth user
 *   (which cascades every user-data table).
 */
import { signAppleClientSecret } from '../../crypto/jwt-sign.ts';
import { appleIdBase } from '../apple.ts';
import type { DbClient } from '../../db/clients.ts';
import { credentialStatus, type RawEnv } from '../../env.ts';
import { AppError } from '../../errors.ts';

export const APPLE_REVOKE_ENDPOINT = 'https://appleid.apple.com/auth/revoke';

export interface AppleRevoker {
  /** `revoked` also covers a token Apple already considers invalid (`invalid_grant`). */
  revoke(refreshToken: string, signal?: AbortSignal): Promise<'revoked'>;
}

/** The SIWA revoker, or null while the Apple key is not configured. */
export function appleRevokerFromEnv(
  env: RawEnv,
  options: { fetch?: typeof fetch; now?: () => Date; timeoutMs?: number } = {},
): AppleRevoker | null {
  if (credentialStatus('apple_siwa', env).status !== 'configured') return null;
  const clientId = (env.APPLE_SIWA_NATIVE_CLIENT_ID ?? '').trim();
  return {
    async revoke(refreshToken, signal) {
      const clientSecret = await signAppleClientSecret({
        teamId: (env.APPLE_TEAM_ID ?? '').trim(),
        clientId,
        keyId: (env.APPLE_SIWA_KEY_ID ?? '').trim(),
        privateKeyPem: (env.APPLE_SIWA_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
        ...(options.now === undefined ? {} : { now: options.now() }),
      });
      const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000);
      let response: Response;
      try {
        response = await (options.fetch ?? fetch)(`${appleIdBase(env)}/auth/revoke`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            token: refreshToken,
            token_type_hint: 'refresh_token',
          }).toString(),
          signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        throw new AppError(
          name === 'TimeoutError' || name === 'AbortError'
            ? 'UPSTREAM_TIMEOUT'
            : 'PROVIDER_UNAVAILABLE',
          { details: { provider: 'apple' }, cause: error },
        );
      }
      let reason = '';
      try {
        reason = String(((await response.json()) as { error?: unknown }).error ?? '');
      } catch {
        reason = '';
      }
      if (response.ok || reason === 'invalid_grant') return 'revoked';
      if (response.status >= 500 || response.status === 429) {
        throw new AppError('PROVIDER_UNAVAILABLE', {
          details: { provider: 'apple', provider_status: response.status },
        });
      }
      throw new AppError('PROVIDER_REJECTED', {
        details: { provider: 'apple', provider_reason: reason.slice(0, 40) || 'rejected' },
      });
    },
  };
}

export interface AuthAdmin {
  /** Blocks every new sign-in (ban for 100 years). */
  ban(userId: string): Promise<void>;
  /** Revokes every session except the one of `jwt`. */
  signOutOthers(jwt: string): Promise<boolean>;
  deleteUser(userId: string): Promise<'deleted' | 'not_found'>;
}

function authFailure(operation: string, cause: unknown): AppError {
  return new AppError('SERVICE_UNAVAILABLE', {
    details: { reason: 'auth_admin_unavailable', operation },
    retryable: true,
    cause,
  });
}

export function supabaseAuthAdmin(system: DbClient): AuthAdmin {
  return {
    async ban(userId) {
      const { error } = await system.auth.admin.updateUserById(userId, {
        ban_duration: '876000h',
      });
      if (error !== null && (error as { status?: number }).status !== 404) {
        throw authFailure('ban', error);
      }
    },
    async signOutOthers(jwt) {
      const { error } = await system.auth.admin.signOut(jwt, 'others');
      return error === null;
    },
    async deleteUser(userId) {
      const { error } = await system.auth.admin.deleteUser(userId);
      if (error === null) return 'deleted';
      if ((error as { status?: number }).status === 404) return 'not_found';
      throw authFailure('delete_user', error);
    },
  };
}
