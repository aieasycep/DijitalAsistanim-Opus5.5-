import 'server-only';

import { ErrorBody, adminRoutes, type ErrorCodeValue, type FieldError } from '@da/validation';
import { headers } from 'next/headers';
import type { z } from 'zod';

import { serverEnv } from '@/env';
import { uuidv7 } from '@/lib/ids';
import { clientIp, userAgent } from './request-meta';
import { adminAccessToken } from './supabase';
import {
  ADMIN_RESPONSES,
  type RouteData,
  type RouteMeta,
  type TypedRouteKey,
} from './admin-contracts';

/*
 * Typed server-side admin-api client (BACKOFFICE_PLAN §2.3, API_CONTRACTS §12). Every call:
 * - looks the route up in the `@da/validation` registry and validates params, query and body with the
 *   route's own zod contracts before anything is sent;
 * - sends `x-da-bff` (ADMIN_BFF_SECRET), `Authorization: Bearer <admin JWT>` (not for BFF-only routes),
 *   `x-correlation-id` (uuid v7), `x-da-activity` and, for mutations, `Idempotency-Key`;
 * - never sends a browser `Origin` (admin-api refuses those) and uses `cache: 'no-store'`;
 * - parses 2xx bodies with the route's response schema and errors with the shared `ErrorBody`;
 * - retries reads twice on network errors and retryable 5xx; never retries mutations (§12.1).
 * `createAdminApiClient` is pure (unit-tested with a fake fetch); `adminApi` wires it to the request:
 * env, the sealed session's access token, the client IP and user agent.
 */

export type AdminApiErrorCode =
  | ErrorCodeValue
  /** The request did not satisfy the route's own contract; nothing was sent. */
  | 'REQUEST_INVALID'
  /** admin-api answered with a body that violates the response contract. */
  | 'CONTRACT_VIOLATION'
  /** admin-api could not be reached (DNS, TLS, timeout, connection reset). */
  | 'NETWORK_ERROR';

export interface AdminApiFailure {
  readonly code: AdminApiErrorCode;
  readonly status: number;
  readonly correlationId: string;
  readonly retryAfter?: number;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly fieldErrors?: readonly FieldError[];
}

export type AdminApiResult<K extends TypedRouteKey> =
  | {
      readonly ok: true;
      readonly status: number;
      readonly data: RouteData<K>;
      readonly meta: RouteMeta<K>;
      readonly correlationId: string;
    }
  | { readonly ok: false; readonly error: AdminApiFailure };

export interface AdminApiInput {
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
}

export interface AdminApiCallOptions {
  /** The admin's access token; ignored for BFF-only routes. */
  readonly token?: string | null;
  /** `background` for polling: admin-api does not extend the idle window (§3.7). */
  readonly activity?: 'user' | 'background';
  /** Required for mutations; generated when absent. */
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
  /** Forwarded for `/session/start` (ip hash, browser family) and pre-auth throttling. */
  readonly clientIp?: string;
  readonly userAgent?: string;
}

export interface AdminApiConfig {
  /** `${API_PUBLIC_BASE_URL}/functions/v1/admin-api` */
  readonly baseUrl: string;
  readonly bffSecret: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /** Delays between read retries, ms (two retries by default). */
  readonly retryDelaysMs?: readonly number[];
}

const HTTP_FALLBACK: Readonly<Record<number, ErrorCodeValue>> = {
  400: 'BAD_REQUEST',
  401: 'AUTH_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'STATE_CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  502: 'PROVIDER_UNAVAILABLE',
  503: 'SERVICE_UNAVAILABLE',
  504: 'UPSTREAM_TIMEOUT',
};

const RETRYABLE_STATUS = new Set([502, 503, 504]);

/** Substitutes `:name` segments with URI-encoded params; `null` when a param is missing. */
export function buildPath(
  template: string,
  params: Readonly<Record<string, string>> = {},
): string | null {
  const missing: string[] = [];
  const path = template.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined || value === '') {
      missing.push(name);
      return '';
    }
    return encodeURIComponent(value);
  });
  return missing.length > 0 ? null : path;
}

/** Serialises a validated query (`filter[x]` keys kept verbatim; undefined dropped). */
export function buildQuery(query: AdminApiInput['query']): string {
  if (query === undefined) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    search.append(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

function retryAfterSeconds(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function invalid(correlationId: string, error: z.ZodError, prefix: string): AdminApiFailure {
  return {
    code: 'REQUEST_INVALID',
    status: 0,
    correlationId,
    fieldErrors: error.issues.map((issue) => ({
      path: [prefix, ...issue.path.map(String)].join('.'),
      code: issue.code,
      message_key: `validation.${issue.code}`,
    })),
  };
}

export interface AdminApiClient {
  call<K extends TypedRouteKey>(
    key: K,
    input?: AdminApiInput,
    options?: AdminApiCallOptions,
  ): Promise<AdminApiResult<K>>;
}

export function createAdminApiClient(config: AdminApiConfig): AdminApiClient {
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 10_000;
  const retryDelays = config.retryDelaysMs ?? [150, 450];

  async function call<K extends TypedRouteKey>(
    key: K,
    input: AdminApiInput = {},
    options: AdminApiCallOptions = {},
  ): Promise<AdminApiResult<K>> {
    const route = adminRoutes[key];
    const correlationId = options.correlationId ?? uuidv7();

    // 1. Contracts first: nothing leaves the server unless it satisfies the route's schemas.
    if (route.request.params !== undefined) {
      const parsed = route.request.params.safeParse(input.params ?? {});
      if (!parsed.success)
        return { ok: false, error: invalid(correlationId, parsed.error, 'params') };
    }
    if (route.request.query !== undefined) {
      const parsed = route.request.query.safeParse(input.query ?? {});
      if (!parsed.success)
        return { ok: false, error: invalid(correlationId, parsed.error, 'query') };
    }
    let body: unknown = undefined;
    if (route.request.body !== undefined) {
      const parsed = route.request.body.safeParse(input.body ?? {});
      if (!parsed.success)
        return { ok: false, error: invalid(correlationId, parsed.error, 'body') };
      body = parsed.data;
    }
    const path = buildPath(route.path, input.params);
    if (path === null) {
      return { ok: false, error: { code: 'REQUEST_INVALID', status: 0, correlationId } };
    }

    // 2. Headers (§2.3). BFF-only routes run before a session exists and carry no bearer token.
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-da-bff': config.bffSecret,
      'x-correlation-id': correlationId,
      'x-da-activity': options.activity ?? 'user',
    };
    if (route.access.require !== 'bff') {
      if (options.token === undefined || options.token === null || options.token === '') {
        return { ok: false, error: { code: 'AUTH_REQUIRED', status: 401, correlationId } };
      }
      headers.authorization = `Bearer ${options.token}`;
    }
    if (route.method !== 'GET') {
      headers['content-type'] = 'application/json';
      headers['idempotency-key'] = options.idempotencyKey ?? uuidv7();
    }
    if (options.clientIp !== undefined) headers['x-forwarded-for'] = options.clientIp;
    if (options.userAgent !== undefined && options.userAgent !== '') {
      headers['x-da-user-agent'] = options.userAgent;
    }

    const url = `${config.baseUrl}${path}${route.method === 'GET' ? buildQuery(input.query) : ''}`;
    const attempts = route.method === 'GET' ? retryDelays.length + 1 : 1;
    let last: AdminApiFailure = { code: 'NETWORK_ERROR', status: 0, correlationId };

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await sleep(retryDelays[attempt - 1] ?? 0);
      let response: Response;
      try {
        response = await doFetch(url, {
          method: route.method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        last = { code: 'NETWORK_ERROR', status: 0, correlationId };
        continue;
      }
      const responseCorrelation = response.headers.get('x-correlation-id') ?? correlationId;
      let json: unknown = null;
      try {
        json = response.status === 204 ? {} : await response.json();
      } catch {
        json = null;
      }

      if (response.ok) {
        const parsed = ADMIN_RESPONSES[key].safeParse(json);
        if (!parsed.success) {
          console.error(
            JSON.stringify({
              level: 'error',
              msg: 'admin_api_contract_violation',
              route: key,
              correlation_id: responseCorrelation,
            }),
          );
          return {
            ok: false,
            error: {
              code: 'CONTRACT_VIOLATION',
              status: response.status,
              correlationId: responseCorrelation,
            },
          };
        }
        const envelope = parsed.data as { data: RouteData<K>; meta: RouteMeta<K> };
        return {
          ok: true,
          status: response.status,
          data: envelope.data,
          meta: envelope.meta,
          correlationId: responseCorrelation,
        };
      }

      const errorBody = ErrorBody.safeParse(json);
      last = errorBody.success
        ? {
            code: errorBody.data.error.code,
            status: response.status,
            correlationId: errorBody.data.error.correlation_id,
            retryAfter: retryAfterSeconds(response.headers.get('retry-after')),
            ...(errorBody.data.error.details === undefined
              ? {}
              : { details: errorBody.data.error.details }),
            ...(errorBody.data.error.field_errors === undefined
              ? {}
              : { fieldErrors: errorBody.data.error.field_errors }),
          }
        : {
            code: HTTP_FALLBACK[response.status] ?? 'INTERNAL_ERROR',
            status: response.status,
            correlationId: responseCorrelation,
            retryAfter: retryAfterSeconds(response.headers.get('retry-after')),
          };
      if (!RETRYABLE_STATUS.has(response.status)) break;
    }
    return { ok: false, error: last };
  }

  return { call };
}

/**
 * Calls admin-api for the current request (server components, server actions, route handlers).
 * The admin's token comes from the sealed session unless `options.token` is given.
 */
export async function adminApi<K extends TypedRouteKey>(
  key: K,
  input: AdminApiInput = {},
  options: AdminApiCallOptions = {},
): Promise<AdminApiResult<K>> {
  // Request headers first: during `next build` prerendering this opts the page into dynamic
  // rendering before any server-only environment value is read, so a build without runtime
  // secrets stays quiet; at request time the environment is validated as before.
  const requestHeaders = await headers();
  const env = serverEnv();
  const client = createAdminApiClient({
    baseUrl: env.adminApiBaseUrl,
    bffSecret: env.ADMIN_BFF_SECRET,
  });
  const token =
    adminRoutes[key].access.require === 'bff'
      ? null
      : options.token === undefined
        ? await adminAccessToken()
        : options.token;
  return client.call(key, input, {
    ...options,
    token,
    clientIp: options.clientIp ?? clientIp(requestHeaders),
    userAgent: options.userAgent ?? userAgent(requestHeaders),
  });
}
