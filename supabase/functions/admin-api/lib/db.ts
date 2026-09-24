/**
 * `admin_api` access for one request (BACKOFFICE_PLAN §2.5 step 4, §2.6): every call runs through
 * PostgREST with the admin's JWT and the `x-da-admin-gateway` header, so each SQL function re-runs
 * its own guard (gateway, `aal2`, active admin, permission, live session). SQL errors are mapped to
 * API codes here; guard failures carry a `guard` tag the pipeline uses to end an expired session
 * (`admin_api.session_expire`) or record a denial (`admin_api.audit_denied`).
 */
import { AppError, type DbErrorLike, fieldError, mapDbError } from '../../_shared/errors.ts';
import { adminGatewayClient, type ClientConfig, type DbClient } from '../../_shared/db/clients.ts';
import { ADMIN_API_FN, type AdminApiFunctionName } from '../../_shared/db/admin-functions.ts';
import { rpcRaw } from '../../_shared/db/functions.ts';

/** Guard outcomes the pipeline reacts to. */
export type GuardFailure = 'session_expired' | 'forbidden';

const GUARD_TAG = Symbol('admin_guard');

interface Tagged {
  [GUARD_TAG]?: GuardFailure;
}

export function guardFailureOf(error: unknown): GuardFailure | null {
  return error instanceof AppError ? ((error as Tagged)[GUARD_TAG] ?? null) : null;
}

function tagged(error: AppError, guard: GuardFailure): AppError {
  (error as Tagged)[GUARD_TAG] = guard;
  return error;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function conflictDetails(message: string, detail: string): Record<string, unknown> {
  if (message.includes('LAST_SUPER_ADMIN')) return { reason: 'last_super_admin' };
  if (message.includes('EVAL_REQUIRED')) return { reason: 'eval_required' };
  if (message.includes('PROMPT_VERSION_IMMUTABLE')) return { reason: 'immutable' };
  if (message.includes('ILLEGAL_TRANSITION')) return { reason: 'illegal_transition' };
  const active = /^active_request_id=(.+)$/.exec(detail);
  if (active?.[1] !== undefined && UUID.test(active[1])) {
    return { reason: 'active_request', active_request_id: active[1].toLowerCase() };
  }
  if (detail !== '') return { reason: detail.slice(0, 64) };
  return {};
}

/**
 * Maps an `admin_api` error (DATABASE_AND_RLS_PLAN §6.8 guard messages and the §6 conventions) to
 * the API error. `permission` names the route permission for `FORBIDDEN {permission}`.
 */
export function mapAdminDbError(error: DbErrorLike, permission: string | null = null): AppError {
  const code = error.code ?? '';
  const message = error.message ?? '';
  const detail = typeof error.details === 'string' ? error.details : '';
  if (code === '42501') {
    if (message.includes('ADMIN_SESSION_EXPIRED')) {
      return tagged(
        new AppError('AUTH_REQUIRED', {
          details: { reason: 'admin_session_expired' },
          cause: error,
        }),
        'session_expired',
      );
    }
    if (message.includes('ADMIN_AAL2_REQUIRED'))
      return new AppError('AAL2_REQUIRED', { cause: error });
    if (message.includes('ADMIN_GATEWAY_REQUIRED')) {
      return new AppError('FORBIDDEN', { details: { reason: 'gateway' }, cause: error });
    }
    if (message.includes('ADMIN_LOCKED')) {
      return new AppError('FORBIDDEN', { details: { reason: 'locked' }, cause: error });
    }
    if (message.includes('ADMIN_REQUIRED')) {
      return new AppError('FORBIDDEN', { details: { reason: 'admin_inactive' }, cause: error });
    }
    if (detail === 'step_up_required') {
      return new AppError('FORBIDDEN', { details: { reason: 'step_up_required' }, cause: error });
    }
    if (message.includes('SUPPORT_ACCESS_DENIED')) {
      return new AppError('FORBIDDEN', {
        details: { reason: 'support_access_denied' },
        cause: error,
      });
    }
    const denied = detail !== '' && /^[a-z_.|]+$/.test(detail) ? detail.split('|')[0] : permission;
    return tagged(
      new AppError('FORBIDDEN', {
        details: denied === null || denied === undefined ? {} : { permission: denied },
        cause: error,
      }),
      'forbidden',
    );
  }
  if (code === 'P0001' && message.includes('RATE_LIMITED')) {
    return new AppError('RATE_LIMITED', { headers: { 'Retry-After': '60' }, cause: error });
  }
  if (code === '22023' || code === '23514') {
    if (message.includes('EMAIL_IN_USE_BY_APP_USER'))
      return fieldError('email', 'email_in_use_by_app_user');
    if (message.includes('INVITE_INVALID')) return fieldError('token', 'invite_invalid');
    if (message.includes('RECOVERY_CODE_INVALID'))
      return fieldError('code', 'recovery_code_invalid');
    const field = /VALIDATION_FAILED:([a-z_]+)/.exec(message)?.[1];
    if (field !== undefined) return fieldError(field, 'invalid');
  }
  if (code === '55000' || message.includes('STATE_CONFLICT')) {
    return new AppError('STATE_CONFLICT', {
      details: conflictDetails(message, detail),
      cause: error,
    });
  }
  return mapDbError(error);
}

/** One request's `admin_api` caller. */
export interface AdminDb {
  call<T = unknown>(fn: AdminApiFunctionName, args?: Record<string, unknown>): Promise<T>;
}

export function gatewayAdminDb(options: {
  readonly jwt: string;
  readonly gatewaySecret: string | undefined;
  readonly config: ClientConfig;
  readonly permission: string | null;
}): AdminDb {
  let client: DbClient | null = null;
  return {
    async call<T>(fn: AdminApiFunctionName, args: Record<string, unknown> = {}): Promise<T> {
      if (options.gatewaySecret === undefined || options.gatewaySecret === '') {
        throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
          details: { feature: 'admin', credential_keys: ['ADMIN_GATEWAY_SECRET'] },
        });
      }
      client ??= adminGatewayClient(options.jwt, options.gatewaySecret, options.config);
      const { data, error } = await rpcRaw<T>(client, ADMIN_API_FN[fn], args);
      if (error !== null) throw mapAdminDbError(error, options.permission);
      return data as T;
    },
  };
}

/** Service-role `admin_api` functions (the BFF sign-in routes). */
export async function callServiceAdminFn<T>(
  system: DbClient,
  fn: 'login_preflight' | 'login_attempt_record' | 'invite_redeem',
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await rpcRaw<T>(system, ADMIN_API_FN[fn], args);
  if (error !== null) throw mapAdminDbError(error);
  return data as T;
}
