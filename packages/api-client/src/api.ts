/**
 * Typed client for the Edge `api` function (`${SUPABASE_URL}/functions/v1/api`), derived from the
 * `@da/validation` route registry (`"METHOD /path"` → request/response schemas, idempotency mode,
 * transport). API_CONTRACTS §2:
 * - headers: `Authorization: Bearer`, `apikey`, `X-Correlation-Id` (generated per call, echoed on
 *   the error), `Idempotency-Key` for `[IK]` routes (reused on the internal retry; pass your own
 *   key to reuse it across user retries and offline replays), `X-DA-Client`,
 *   `X-DA-Installation-Id`, `X-DA-Api-Version`, `Accept-Language`;
 * - requests are validated with the route's strict schemas before sending (the raw input is sent);
 * - 2xx bodies are parsed with the route's `Success(...)` schema (non-strict: additive fields pass);
 * - error envelopes become typed `ApiError`s; one token refresh and retry on `401 AUTH_REQUIRED`;
 * - a per-call timeout (`UPSTREAM_TIMEOUT`, kind `timeout`) and caller abort via `signal`;
 * - an offline hook point: `isOffline()` → `OFFLINE_BLOCKED` before any network call (§2.16);
 * - `stream()` for `text/event-stream` routes (API-AST-02), parsed with `parseAssistantSseFrame`.
 */
import type { z } from 'zod';
import type { AssistantSseEvent } from '@da/validation/api/assistant';
import { routes as apiRoutes, type ApiRouteKey, type ApiRoutes } from '@da/validation/api/routes';
import { toFieldErrors } from '@da/validation/errors';
import type { RouteContract } from '@da/validation/route';

import {
  ApiError,
  apiErrorFromBody,
  isAbortError,
  offlineError,
  parseRetryAfter,
} from './errors.ts';
import { readAssistantEvents } from './sse.ts';

type Route<K extends ApiRouteKey> = ApiRoutes[K];
type RequestOf<K extends ApiRouteKey> = Route<K>['request'];
type Part<R, P extends 'params' | 'query' | 'body'> =
  R extends Readonly<Record<P, infer S extends z.ZodType>>
    ? Readonly<Record<P, z.input<S>>>
    : Readonly<Partial<Record<P, undefined>>>;

/** The request parts a route takes: `params`, `query` and `body`, each only when declared. */
export type ApiInput<K extends ApiRouteKey> = Part<RequestOf<K>, 'params'> &
  Part<RequestOf<K>, 'query'> &
  Part<RequestOf<K>, 'body'>;

/** The parsed success envelope `{ data, meta }`. */
export type ApiResponse<K extends ApiRouteKey> = z.output<Route<K>['response']>;
export type ApiData<K extends ApiRouteKey> = ApiResponse<K> extends { data: infer D } ? D : never;

type TransportOf<K extends ApiRouteKey> = Route<K> extends { transport: infer T } ? T : 'json';
/** Routes callable with `call()` (JSON in and out; SSE routes return their JSON replay here). */
export type JsonRouteKey = {
  [K in ApiRouteKey]: TransportOf<K> extends 'multipart' ? never : K;
}[ApiRouteKey];
/** Routes that answer with `text/event-stream`. */
export type SseRouteKey = {
  [K in ApiRouteKey]: TransportOf<K> extends 'sse' ? K : never;
}[ApiRouteKey];

type ArgsFor<K extends ApiRouteKey> =
  Record<string, never> extends ApiInput<K>
    ? [input?: ApiInput<K>, options?: CallOptions]
    : [input: ApiInput<K>, options?: CallOptions];

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ApiClientConfig {
  /** `${SUPABASE_URL}/functions/v1/api` (see `apiBaseUrl`). */
  readonly baseUrl: string;
  /** `sb_publishable_…`; sent as `apikey`. */
  readonly publishableKey?: string;
  /** The current Supabase access token, or null when signed out. */
  readonly getAccessToken: () => Promise<string | null> | string | null;
  /** Refreshes the session once after `401 AUTH_REQUIRED`; returns the new token. */
  readonly refreshAccessToken?: () => Promise<string | null>;
  /** `X-DA-Client`: `<platform>/<semver> (<build>)`, e.g. `ios/1.0.0 (42)`. */
  readonly clientHeader?: string;
  readonly getInstallationId?: () => Promise<string | null> | string | null;
  /** `X-DA-Api-Version` contract date; absent = current. */
  readonly apiVersion?: string;
  readonly getLocale?: () => 'tr-TR' | 'en-US' | null;
  /** Offline hook point; `true` blocks the call with `OFFLINE_BLOCKED`. */
  readonly isOffline?: () => boolean;
  readonly fetch?: FetchLike;
  /** A fetch whose `Response.body` streams (`expo/fetch` on React Native). */
  readonly streamFetch?: FetchLike;
  /** Default 30 s (the `api` handler budget is 25 s). */
  readonly timeoutMs?: number;
  /** Default 130 s (SSE budget 120 s). */
  readonly streamTimeoutMs?: number;
  /** UUID v4 source for correlation and idempotency keys. */
  readonly generateId?: () => string;
  /** Observes every `ApiError` (426 → update screen, `ACCOUNT_DISABLED` → local sign-out). */
  readonly onError?: (error: ApiError, key: ApiRouteKey) => void;
}

export interface CallOptions {
  readonly signal?: AbortSignal;
  /** Reuse for every retry of the same user intent ([IK] routes only). */
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
  readonly timeoutMs?: number;
}

export type StreamResult<K extends SseRouteKey> =
  | {
      readonly mode: 'stream';
      readonly correlationId: string;
      readonly events: AsyncGenerator<AssistantSseEvent>;
    }
  | { readonly mode: 'replay'; readonly correlationId: string; readonly response: ApiResponse<K> };

export interface ApiClient {
  call<K extends JsonRouteKey>(key: K, ...args: ArgsFor<K>): Promise<ApiResponse<K>>;
  stream<K extends SseRouteKey>(
    key: K,
    input: ApiInput<K>,
    options?: CallOptions,
  ): Promise<StreamResult<K>>;
}

const CORRELATION_RE = /^[A-Za-z0-9-]{8,64}$/;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STREAM_TIMEOUT_MS = 130_000;

/** The `api` function base URL for a Supabase project URL. */
export function apiBaseUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/api`;
}

function hexByte(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/** The parts of Web Crypto used here (typed structurally: React Native has no DOM lib). */
interface CryptoSource {
  readonly randomUUID?: () => string;
  readonly getRandomValues?: (array: Uint8Array) => Uint8Array;
}

/** UUID v4 from the platform `crypto` (browsers, Node, React Native with a polyfill). */
export function defaultGenerateId(): string {
  const c = (globalThis as { crypto?: CryptoSource }).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  if (typeof c?.getRandomValues === 'function') {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
    b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
    const h = Array.from(b, hexByte).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  throw new Error(
    '[api-client] No crypto source; pass `generateId` (e.g. expo-crypto randomUUID).',
  );
}

interface PreparedRequest {
  readonly method: string;
  readonly path: string;
  readonly body: string | undefined;
}

function invalidRequest(error: z.ZodError, part: string): ApiError {
  return new ApiError({
    code: 'VALIDATION_FAILED',
    kind: 'invalid_request',
    status: null,
    details: { part },
    fieldErrors: toFieldErrors(error),
  });
}

/**
 * Validates one request part with the route's schema. The raw input is what gets sent: the server
 * parses it with the same schema, and a transformed output (a query `'true'` → `true`, applied
 * defaults) would not necessarily validate again.
 */
function checkPart(schema: z.ZodType | undefined, value: unknown, part: string): unknown {
  if (schema === undefined) return undefined;
  const raw = value ?? {};
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw invalidRequest(parsed.error, part);
  return raw;
}

function scalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function queryString(query: unknown): string {
  if (query === undefined || query === null || typeof query !== 'object') return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    const values: unknown[] = Array.isArray(value) ? value : [value];
    for (const item of values) search.append(key, scalar(item));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

function prepare(route: RouteContract, input: Record<string, unknown>): PreparedRequest {
  const params = (checkPart(route.request.params, input.params, 'params') ?? {}) as Record<
    string,
    unknown
  >;
  const path = route.path.replace(/:([A-Za-z_]+)/g, (_match, name: string) =>
    encodeURIComponent(scalar(params[name])),
  );
  const query = checkPart(route.request.query, input.query, 'query');
  const body = checkPart(route.request.body, input.body, 'body');
  return {
    method: route.method,
    path: `${path}${queryString(query)}`,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function parseJson(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

interface Attempt {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly dispose: () => void;
}

/** Combines the caller's signal with a timeout (no `AbortSignal.any` on Hermes). */
function attemptSignal(timeoutMs: number, outer: AbortSignal | undefined): Attempt {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => {
    controller.abort();
  };
  if (outer?.aborted === true) controller.abort();
  else outer?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    },
  };
}

/** A standard `AbortError` (what fetch rejects with on an aborted signal). */
function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function timeoutError(correlationId: string, cause: unknown): ApiError {
  return new ApiError({
    code: 'UPSTREAM_TIMEOUT',
    kind: 'timeout',
    status: null,
    correlationId,
    details: { reason: 'client_timeout' },
    cause,
  });
}

function networkError(correlationId: string, cause: unknown): ApiError {
  return new ApiError({
    code: 'SERVICE_UNAVAILABLE',
    kind: 'network',
    status: null,
    correlationId,
    details: { reason: 'network' },
    cause,
  });
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));
  const generateId = config.generateId ?? defaultGenerateId;

  function report<E>(error: E, key: ApiRouteKey): E {
    if (error instanceof ApiError) config.onError?.(error, key);
    return error;
  }

  async function headersFor(
    token: string | null,
    correlationId: string,
    idempotencyKey: string | undefined,
    accept: string,
    hasBody: boolean,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Accept: accept,
      'X-Correlation-Id': correlationId,
    };
    if (hasBody) headers['Content-Type'] = 'application/json; charset=utf-8';
    if (token !== null && token !== '') headers.Authorization = `Bearer ${token}`;
    if (config.publishableKey !== undefined) headers.apikey = config.publishableKey;
    if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;
    if (config.clientHeader !== undefined) headers['X-DA-Client'] = config.clientHeader;
    if (config.apiVersion !== undefined) headers['X-DA-Api-Version'] = config.apiVersion;
    const installationId = (await config.getInstallationId?.()) ?? null;
    if (installationId !== null) headers['X-DA-Installation-Id'] = installationId;
    const locale = config.getLocale?.() ?? null;
    if (locale !== null) headers['Accept-Language'] = locale;
    return headers;
  }

  function begin(key: ApiRouteKey, input: Record<string, unknown>, options: CallOptions) {
    const route = apiRoutes[key] as RouteContract;
    const request = prepare(route, input);
    if (config.isOffline?.() === true) throw offlineError();
    const correlationId =
      options.correlationId !== undefined && CORRELATION_RE.test(options.correlationId)
        ? options.correlationId
        : generateId();
    const idempotencyKey =
      route.idempotency === 'header' ? (options.idempotencyKey ?? generateId()) : undefined;
    return { route, request, correlationId, idempotencyKey };
  }

  /** Sends the request; after `401 AUTH_REQUIRED` refreshes the token once and re-sends it. */
  async function exchange(
    request: PreparedRequest,
    correlationId: string,
    idempotencyKey: string | undefined,
    accept: string,
    fetchImpl: FetchLike,
    signal: AbortSignal,
  ): Promise<Response> {
    let token = await config.getAccessToken();
    for (let attempt = 0; ; attempt++) {
      const headers = await headersFor(
        token,
        correlationId,
        idempotencyKey,
        accept,
        request.body !== undefined,
      );
      if (signal.aborted) throw abortError();
      const init: RequestInit = { method: request.method, headers, signal };
      if (request.body !== undefined) init.body = request.body;
      const response = await fetchImpl(`${baseUrl}${request.path}`, init);
      if (response.status !== 401 || attempt > 0 || config.refreshAccessToken === undefined) {
        return response;
      }
      const text = await response.clone().text();
      const error = apiErrorFromBody(parseJson(text), {
        status: 401,
        correlationId,
        retryAfterMs: null,
      });
      if (error.code !== 'AUTH_REQUIRED') return response;
      const refreshed = await config.refreshAccessToken();
      if (refreshed === null) return response;
      token = refreshed;
    }
  }

  function errorFor(response: Response, text: string, correlationId: string): ApiError {
    return apiErrorFromBody(parseJson(text), {
      status: response.status,
      correlationId: response.headers.get('x-correlation-id') ?? correlationId,
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    });
  }

  function parseSuccess(
    route: RouteContract,
    response: Response,
    text: string,
    correlationId: string,
  ): unknown {
    const parsed = route.response.safeParse(parseJson(text));
    if (!parsed.success) {
      throw new ApiError({
        code: 'INTERNAL_ERROR',
        kind: 'invalid_response',
        status: response.status,
        correlationId: response.headers.get('x-correlation-id') ?? correlationId,
        fieldErrors: toFieldErrors(parsed.error),
      });
    }
    return parsed.data;
  }

  async function call<K extends JsonRouteKey>(
    key: K,
    ...args: ArgsFor<K>
  ): Promise<ApiResponse<K>> {
    const [rawInput, rawOptions] = args as unknown as [
      Record<string, unknown> | undefined,
      CallOptions | undefined,
    ];
    const input = rawInput ?? {};
    const options = rawOptions ?? {};
    let started: ReturnType<typeof begin>;
    try {
      started = begin(key, input, options);
    } catch (error) {
      throw report(error, key);
    }
    const { route, request, correlationId, idempotencyKey } = started;
    const attempt = attemptSignal(
      options.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options.signal,
    );
    try {
      const response = await exchange(
        request,
        correlationId,
        idempotencyKey,
        'application/json',
        doFetch,
        attempt.signal,
      );
      const text = await response.text();
      if (!response.ok) throw errorFor(response, text, correlationId);
      return parseSuccess(route, response, text, correlationId) as ApiResponse<K>;
    } catch (error) {
      if (error instanceof ApiError) throw report(error, key);
      if (attempt.timedOut()) throw report(timeoutError(correlationId, error), key);
      if (isAbortError(error) || options.signal?.aborted === true) throw error;
      throw report(networkError(correlationId, error), key);
    } finally {
      attempt.dispose();
    }
  }

  async function stream<K extends SseRouteKey>(
    key: K,
    input: ApiInput<K>,
    options: CallOptions = {},
  ): Promise<StreamResult<K>> {
    let started: ReturnType<typeof begin>;
    try {
      started = begin(key, input, options);
    } catch (error) {
      throw report(error, key);
    }
    const { route, request, correlationId, idempotencyKey } = started;
    const attempt = attemptSignal(
      options.timeoutMs ?? config.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS,
      options.signal,
    );
    let handedOver = false;
    try {
      const response = await exchange(
        request,
        correlationId,
        idempotencyKey,
        'text/event-stream',
        config.streamFetch ?? doFetch,
        attempt.signal,
      );
      if (!response.ok) throw errorFor(response, await response.text(), correlationId);
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/event-stream')) {
        const text = await response.text();
        const parsed = parseSuccess(route, response, text, correlationId) as ApiResponse<K>;
        return { mode: 'replay', correlationId, response: parsed };
      }
      const body = response.body;
      if (body === null) {
        throw new ApiError({
          code: 'INTERNAL_ERROR',
          kind: 'invalid_response',
          status: response.status,
          correlationId,
          details: { reason: 'no_stream_body' },
        });
      }
      handedOver = true;
      const events = (async function* guarded(): AsyncGenerator<AssistantSseEvent> {
        try {
          yield* readAssistantEvents(body, correlationId);
        } catch (error) {
          if (error instanceof ApiError) throw report(error, key);
          if (attempt.timedOut()) throw report(timeoutError(correlationId, error), key);
          if (isAbortError(error) || options.signal?.aborted === true) throw error;
          throw report(networkError(correlationId, error), key);
        } finally {
          attempt.dispose();
        }
      })();
      return { mode: 'stream', correlationId, events };
    } catch (error) {
      if (error instanceof ApiError) throw report(error, key);
      if (attempt.timedOut()) throw report(timeoutError(correlationId, error), key);
      if (isAbortError(error) || options.signal?.aborted === true) throw error;
      throw report(networkError(correlationId, error), key);
    } finally {
      if (!handedOver) attempt.dispose();
    }
  }

  return { call, stream };
}
