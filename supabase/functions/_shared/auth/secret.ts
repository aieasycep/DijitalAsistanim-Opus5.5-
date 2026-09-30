/**
 * Secret-key authentication for machine callers (`worker`, `health`; API_CONTRACTS §3
 * `secret:automations`). pg_net sends the `automations` secret key (`CRON_SECRET`) in `apikey`;
 * `Authorization: Bearer <secret>` is accepted as well. Comparison is constant time. Without a
 * configured secret every request is refused.
 */
import type { MiddlewareHandler } from 'hono';
import { AppError } from '../errors.ts';
import { secretsEqual } from '../crypto/hmac.ts';
import type { AppContext, AppEnv } from '../http/context.ts';
import { bearerToken } from './user.ts';

export type SecretName = 'automations';

export interface SecretAuthOptions {
  readonly name: SecretName;
  /** The expected value (`CRON_SECRET`); `undefined` refuses every request. */
  readonly secret: string | undefined;
}

function presented(c: AppContext): string[] {
  const values: string[] = [];
  const apikey = c.req.header('apikey');
  if (apikey !== undefined && apikey !== '') values.push(apikey);
  const bearer = bearerToken(c.req.header('Authorization'));
  if (bearer !== null) values.push(bearer);
  return values;
}

/** True when the request carries the named secret. */
export async function hasSecret(c: AppContext, options: SecretAuthOptions): Promise<boolean> {
  if (options.secret === undefined || options.secret === '') return false;
  for (const value of presented(c)) {
    if (await secretsEqual(value, options.secret)) return true;
  }
  return false;
}

export function requireSecret(options: SecretAuthOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!(await hasSecret(c, options))) {
      if (options.secret === undefined || options.secret === '') {
        c.get('log').warn('secret_not_configured', { secret: options.name });
      }
      throw new AppError('AUTH_REQUIRED', { details: { reason: 'secret_required' } });
    }
    await next();
  };
}
