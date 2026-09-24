/**
 * Route specifications of `admin-api`: each `@da/validation` admin registry route (142, keyed
 * `"METHOD /path"`) gets exactly one spec with its rate class (BACKOFFICE_PLAN §3.9, §12) and its
 * handler. The pipeline in `app.ts` runs the access rule, session, permission, step-up, rate limit,
 * contract and idempotency steps before a handler; handlers only call `admin_api` and map shapes.
 */
import type { AdminRouteContract, AdminRouteKey } from '@da/validation';
import type { AppContext } from '../../_shared/http/context.ts';
import type { Logger } from '../../_shared/logging/logger.ts';
import type { AdminDb } from './db.ts';
import type { Json } from './map.ts';
import type { AdminRuntime } from './runtime.ts';

/** R read · S search · M mutation · X sensitive · A sign-in (limits inside the SQL functions). */
export type RateClass = 'R' | 'S' | 'M' | 'X' | 'A';

export interface AdminSessionInfo {
  readonly id: string | null;
  readonly idle_expires_at: string | null;
  readonly absolute_expires_at: string | null;
  readonly step_up_valid_until: string | null;
}

/** The request's admin context: the `admin_api.admin_me` result (BACKOFFICE_PLAN §2.5 step 4). */
export interface AdminContext {
  readonly adminId: string;
  readonly role: string | null;
  readonly permissions: ReadonlySet<string>;
  readonly session: AdminSessionInfo;
  readonly recoveryCodesRemaining: number;
  /** The raw `admin_me` JSON (`GET /me`, `POST /session/heartbeat`). */
  readonly me: Json;
}

export interface RouteCtx {
  readonly c: AppContext;
  readonly key: AdminRouteKey;
  readonly contract: AdminRouteContract;
  readonly rt: AdminRuntime;
  /** The verified admin JWT (`null` on BFF-only routes). */
  readonly jwt: string | null;
  readonly adminId: string | null;
  readonly context: AdminContext | null;
  /** `admin_api` with the admin JWT and the gateway header. */
  readonly db: AdminDb;
  readonly params: Json;
  readonly query: Json;
  readonly body: Json;
  readonly headers: Json;
  readonly idempotencyKey: string | null;
  readonly log: Logger;
  /** Whether the admin holds a permission (from the context). */
  can(permission: string): boolean;
}

export interface PageInfo {
  readonly page: number;
  readonly page_size: number;
  readonly total: number;
  readonly total_is_estimate?: boolean;
}

export interface RouteResult {
  readonly data: unknown;
  readonly page?: PageInfo;
  readonly status?: 200 | 201 | 202;
}

export interface RouteSpec {
  readonly rate: RateClass;
  /**
   * `refuse`: responses that carry a one-time secret or revealed PII are never stored for an
   * idempotent replay; reusing the key answers `IDEMPOTENCY_REPLAY {reason:'not_replayable'}`.
   */
  readonly replay?: 'store' | 'refuse';
  /** Runs before the `admin_me` context exists (`POST /session/start`). */
  readonly skipContext?: boolean;
  /** Overrides the registry step-up rule (recovery codes: only once codes exist). */
  readonly stepUp?: (context: AdminContext) => boolean;
  handle(ctx: RouteCtx): Promise<RouteResult>;
}

export type RouteSpecs = Partial<Record<AdminRouteKey, RouteSpec>>;

/** Identity helper that keeps a module's route map typed against the registry keys. */
export function defineRoutes<const T extends RouteSpecs>(routes: T): T {
  return routes;
}
