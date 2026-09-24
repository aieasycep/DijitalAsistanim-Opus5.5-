/**
 * Supabase Auth (GoTrue) e-mail OTP for the web deletion flow (PUB-02 / PUB-03; C-24;
 * INTEGRATION_PLAN §8.4). The six-digit code is sent through the Auth custom SMTP template
 * (External credential required: SMTP). Calls go server-side only:
 * - `POST /auth/v1/otp {email, create_user:false}` (never creates an account);
 * - `POST /auth/v1/verify {type:'email', email, token}` → the user id and a session;
 * - `POST /auth/v1/logout?scope=global` with that session → every session of the user is revoked,
 *   so no web session survives and the phone app is signed out.
 * A wrong or expired code is `null`; an Auth outage is `SERVICE_UNAVAILABLE`.
 */
import { OUTBOUND } from '../_shared/config.ts';
import { AppError } from '../_shared/errors.ts';
import type { OtpGateway } from './deps.ts';

export interface GoTrueOptions {
  readonly supabaseUrl: string;
  /** Publishable key (`apikey` header). */
  readonly apiKey: string | null;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export function goTrueOtpGateway(options: GoTrueOptions): OtpGateway {
  const base = `${options.supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  const doFetch = options.fetch ?? fetch;
  const timeout = options.timeoutMs ?? OUTBOUND.providerTimeoutMs;
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(options.apiKey === null ? {} : { apikey: options.apiKey }),
    ...extra,
  });
  const requireKey = (): void => {
    if (options.apiKey === null) {
      throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
        details: { feature: 'data_deletion', credential_keys: ['SUPABASE_PUBLISHABLE_KEYS'] },
      });
    }
  };
  const post = async (path: string, body: unknown, extra: Record<string, string> = {}) => {
    try {
      return await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: headers(extra),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      throw new AppError('SERVICE_UNAVAILABLE', {
        details: { reason: 'auth_unavailable' },
        cause: error,
      });
    }
  };

  return {
    async sendCode(email, locale) {
      requireKey();
      const response = await post('/otp', { email, create_user: false, data: { locale } });
      await response.body?.cancel();
    },
    async verifyCode(email, code) {
      requireKey();
      const response = await post('/verify', { type: 'email', email, token: code });
      if (response.status >= 500) {
        await response.body?.cancel();
        throw new AppError('SERVICE_UNAVAILABLE', { details: { reason: 'auth_unavailable' } });
      }
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const session = (await response.json().catch(() => null)) as {
        access_token?: unknown;
        user?: { id?: unknown; app_metadata?: { da_kind?: unknown } };
      } | null;
      const userId = session?.user?.id;
      const accessToken = session?.access_token;
      if (typeof userId !== 'string' || typeof accessToken !== 'string') return null;
      return { userId, accessToken, isAdmin: session?.user?.app_metadata?.da_kind === 'admin' };
    },
    async revokeSessions(accessToken) {
      try {
        const response = await post(
          '/logout?scope=global',
          {},
          { Authorization: `Bearer ${accessToken}` },
        );
        await response.body?.cancel();
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
