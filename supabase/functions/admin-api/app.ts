/**
 * `admin-api` (`/functions/v1/admin-api`; API_CONTRACTS §12, BACKOFFICE_PLAN §2.5, §12;
 * IMPLEMENTATION_PLAN T-10.01 and the admin-api side of T-10.05…T-10.14). Server-to-server only:
 * browser `Origin` requests are refused.
 *
 * Every route of the `@da/validation` admin registry is mounted from its contract; the pipeline,
 * in order (BACKOFFICE_PLAN §2.5):
 *   1 correlation id, JSON log, security headers (app factory);
 *   2 the BFF key `x-da-bff` (every route);
 *   3 the admin JWT verified in code (`verify_jwt=false`): dedicated admin identity, `aal2` (aal1
 *     for `GET /auth/status` and `POST /auth/recovery-code/redeem`); none on the BFF-only routes;
 *   4 the admin context `admin_api.admin_me(p_activity)`: active admin, live session (idle ≤ 30
 *     min, absolute ≤ 12 h; an expired session is ended through `session_expire`), permissions,
 *     step-up state and the read-class rate limit;
 *   5 the route permission (`require` + `also` / `or`; a denial is audited via `audit_denied`);
 *   6 step-up (10 min) where the registry or the route requires it;
 *   7 the rate class S / M / X (`bo_s`, `bo_m`, `bo_x`);
 *   8 the zod contract of params, query, headers and body;
 *   9 the `Idempotency-Key` of mutations;
 *   10 the handler (the matching `admin_api` function; Edge-side operations call `authorize`
 *      first and `audit_write` after), `Cache-Control: no-store`.
 */
import type { Hono, MiddlewareHandler } from 'hono';
import { type AdminRouteContract, type AdminRouteKey, adminRoutes } from '@da/validation';
import type { z } from 'zod';
import { type AdminAuthOptions, requireAdmin } from '../_shared/auth/admin.ts';
import { DEFAULT_JSON_BODY_BYTES } from '../_shared/config.ts';
import { AppError, validationError } from '../_shared/errors.ts';
import { idempotencyKey } from '../_shared/idempotency.ts';
import { createApp } from '../_shared/http/app.ts';
import type { AppContext, AppEnv } from '../_shared/http/context.ts';
import type { Logger } from '../_shared/logging/logger.ts';
import type { Sentry } from '../_shared/observability/sentry.ts';
import { type AdminDb, gatewayAdminDb, guardFailureOf } from './lib/db.ts';
import type { Json } from './lib/map.ts';
import { renderResult } from './lib/respond.ts';
import type { AdminContext, RouteCtx, RouteResult, RouteSpec } from './lib/route.ts';
import type { AdminRuntime } from './lib/runtime.ts';
import { type AdminIdentity, checkBffKey, verifyAdminIdentity } from './middleware/auth.ts';
import { runIdempotent } from './middleware/idempotency.ts';
import {
  assertStepUp,
  denied,
  missingPermission,
  primaryPermission,
} from './middleware/permission.ts';
import { enforceAdminRateLimit } from './middleware/ratelimit.ts';
import { activityOf, expireSession, loadAdminContext } from './middleware/session.ts';
import { ADMIN_ROUTE_SPECS, orderedRouteKeys } from './routes/index.ts';

export interface AdminApiDeps {
  /** The core gate used by `adminRoute(permission)` (and by `health`'s admin path). */
  readonly auth: AdminAuthOptions;
  readonly log: Logger;
  readonly sentry?: Sentry;
  /** When present, every registry route is mounted with this runtime. */
  readonly runtime?: AdminRuntime;
}

export interface AdminApi {
  readonly app: Hono<AppEnv>;
  /** Authentication and SQL permission gate for one ad-hoc admin route. */
  adminRoute(permission: string): MiddlewareHandler<AppEnv>;
}

const JSON_CONTENT = /^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;.*)?$/i;

const NO_DB: AdminDb = {
  call() {
    return Promise.reject(new AppError('AUTH_REQUIRED', { details: { reason: 'missing_token' } }));
  },
};

async function readJsonBody(c: AppContext, contract: AdminRouteContract): Promise<unknown> {
  if (contract.request.body === undefined) return undefined;
  const text = await c.req.text();
  if (new TextEncoder().encode(text).byteLength > DEFAULT_JSON_BODY_BYTES) {
    throw new AppError('PAYLOAD_TOO_LARGE', { details: { limit_bytes: DEFAULT_JSON_BODY_BYTES } });
  }
  if (text.trim() === '') return {};
  const contentType = c.req.header('Content-Type') ?? '';
  if (!JSON_CONTENT.test(contentType.trim())) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', { details: { expected: 'application/json' } });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('BAD_REQUEST', { details: { reason: 'malformed_json' } });
  }
}

function parsePart(schema: z.ZodType | undefined, value: unknown, prefix: string): Json {
  if (schema === undefined) return {};
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validationError(parsed.error, prefix);
  return (parsed.data ?? {}) as Json;
}

async function parseInput(c: AppContext, contract: AdminRouteContract) {
  const request = contract.request;
  let params: Json = {};
  if (request.params !== undefined) {
    const parsed = request.params.safeParse(c.req.param());
    if (!parsed.success) {
      throw new AppError('BAD_REQUEST', { details: { reason: 'invalid_path_parameter' } });
    }
    params = parsed.data as Json;
  }
  const query = parsePart(request.query, c.req.query(), 'query');
  const headerValues: Record<string, string> = {};
  c.req.raw.headers.forEach((value, name) => {
    headerValues[name.toLowerCase()] = value;
  });
  const headers = parsePart(request.headers, headerValues, 'headers');
  const raw = await readJsonBody(c, contract);
  const body = request.body === undefined ? {} : parsePart(request.body, raw, '');
  return { params, query, headers, body, raw };
}

async function runRoute(
  c: AppContext,
  key: AdminRouteKey,
  contract: AdminRouteContract,
  spec: RouteSpec,
  rt: AdminRuntime,
): Promise<Response> {
  c.set('routeKey', key);
  const access = contract.access;
  const log = c.get('log');

  // 2 BFF key
  await checkBffKey(c, rt.env.bffSecret);

  // 3 identity
  let identity: AdminIdentity | null = null;
  if (access.require !== 'bff') {
    identity = await verifyAdminIdentity(c, rt.verifier, access.require !== 'aal1');
    c.set('admin', {
      adminId: identity.adminId,
      sessionId: identity.sessionId,
      jwt: identity.jwt,
      role: typeof identity.claims.admin_role === 'string' ? identity.claims.admin_role : null,
    });
    c.set('log', log.child({ admin_id: identity.adminId }));
  }
  const permission = primaryPermission(access);
  const db =
    identity === null
      ? NO_DB
      : gatewayAdminDb({
          jwt: identity.jwt,
          gatewaySecret: rt.env.gatewaySecret,
          config: rt.config,
          permission,
        });

  // 4 context
  let context: AdminContext | null = null;
  if (identity !== null && access.require !== 'aal1' && spec.skipContext !== true) {
    const activity =
      key === 'POST /session/heartbeat' ? true : activityOf(c.req.header('x-da-activity'));
    context = await loadAdminContext(db, c.get('log'), activity);
  }

  // 5 permission
  if (context !== null) {
    const missing = missingPermission(access, context.permissions);
    if (missing !== null) throw await denied(db, c.get('log'), key, missing);
    // 6 step-up
    const needsStepUp = spec.stepUp !== undefined ? spec.stepUp(context) : access.step_up === true;
    if (needsStepUp) assertStepUp(context, rt.now());
  }

  // 7 rate class
  if (identity !== null) {
    await enforceAdminRateLimit({
      c,
      store: rt.rateLimits,
      rate: spec.rate,
      adminId: identity.adminId,
      db,
      log: c.get('log'),
      routeKey: key,
      nowMs: rt.now(),
    });
  }

  // 8 contract
  const input = await parseInput(c, contract);

  // 9 idempotency
  const mutation = contract.method !== 'GET';
  const idemKey = mutation ? idempotencyKey(c) : null;

  const ctx: RouteCtx = {
    c,
    key,
    contract,
    rt,
    jwt: identity?.jwt ?? null,
    adminId: identity?.adminId ?? null,
    context,
    db,
    params: input.params,
    query: input.query,
    body: input.body,
    headers: input.headers,
    idempotencyKey: idemKey,
    log: c.get('log'),
    can: (p) => context?.permissions.has(p) === true,
  };

  const execute = async (): Promise<RouteResult> => {
    try {
      return await spec.handle(ctx);
    } catch (error) {
      const guard = guardFailureOf(error);
      if (guard === 'session_expired' && error instanceof AppError) {
        throw await expireSession(db, ctx.log, error);
      }
      if (guard === 'forbidden' && error instanceof AppError) {
        const perm =
          typeof error.details?.permission === 'string' ? error.details.permission : permission;
        throw await denied(db, ctx.log, key, perm ?? 'unknown');
      }
      throw error;
    }
  };

  // 10 handler
  if (mutation && idemKey !== null && identity !== null) {
    const outcome = await runIdempotent(
      {
        repo: rt.idempotency,
        adminId: identity.adminId,
        key: idemKey,
        routeKey: key,
        method: contract.method,
        path: c.req.path,
        body: input.raw ?? {},
        replay: spec.replay ?? 'store',
        log: ctx.log,
        now: rt.now,
      },
      execute,
    );
    return renderResult(c, contract, outcome.result, outcome.replayed);
  }
  return renderResult(c, contract, await execute(), false);
}

/** Mounts every registry route (literal paths before their `/:param` siblings). */
export function mountAdminRoutes(app: Hono<AppEnv>, rt: AdminRuntime): void {
  for (const key of orderedRouteKeys()) {
    const contract = adminRoutes[key] as AdminRouteContract;
    const spec = ADMIN_ROUTE_SPECS[key];
    app.on(contract.method, contract.path, (c) => runRoute(c, key, contract, spec, rt));
  }
}

export function createAdminApi(deps: AdminApiDeps): AdminApi {
  const app = createApp({
    fn: 'admin-api',
    logger: deps.log,
    ...(deps.sentry === undefined ? {} : { sentry: deps.sentry }),
    rejectBrowserOrigin: true,
  });
  if (deps.runtime !== undefined) mountAdminRoutes(app, deps.runtime);
  return { app, adminRoute: (permission) => requireAdmin(deps.auth, permission) };
}
