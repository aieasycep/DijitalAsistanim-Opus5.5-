import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** The parts of a request a router validates: path params, query string, body and headers. */
export interface RouteRequest {
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  readonly headers?: z.ZodType;
}

/**
 * HTTP idempotency class of a route (docs/API_CONTRACTS.md §2.11): `header` routes are marked [IK]
 * and require `Idempotency-Key`; `client_id` routes dedupe on a client-generated id in the body.
 */
export type RouteIdempotency = 'header' | 'client_id' | 'natural' | 'none';

export interface RouteContract {
  /** Contract id from API_CONTRACTS, e.g. `API-APR-03`, `ADM-05`, `PUB-02`. */
  readonly id: string;
  readonly method: HttpMethod;
  /** Hono-style path relative to the function base path, e.g. `/approvals/:id/approve`. */
  readonly path: string;
  readonly request: RouteRequest;
  /** Full response body schema (the `Success(...)` envelope for JSON routes). */
  readonly response: z.ZodType;
  /** Status of the success response. */
  readonly status: 200 | 201 | 202 | 204;
  readonly idempotency: RouteIdempotency;
  /** `json` (default), `sse` (assistant stream), `multipart` (transcribe upload). */
  readonly transport?: 'json' | 'sse' | 'multipart';
  /** SSE event union for `transport: 'sse'`. */
  readonly stream?: z.ZodType;
}

/** Identity helper that keeps the literal types of a route declaration. */
export function defineRoute<const R extends RouteContract>(route: R): R {
  return route;
}

/** Registry key `"METHOD /path"`. */
export type RouteKey<R extends RouteContract = RouteContract> = `${R['method']} ${R['path']}`;

export function routeKey(route: Pick<RouteContract, 'method' | 'path'>): string {
  return `${route.method} ${route.path}`;
}
