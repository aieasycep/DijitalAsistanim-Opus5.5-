/**
 * Route-registry driven validation (API_CONTRACTS §1 `http/validate.ts`). Routes are declared once
 * in `@da/validation` (`routes`, `adminRoutes`, `publicRoutes`); the functions mount them with
 * `mountRoute` and validate path params, query and JSON body with the declared zod schemas.
 *
 * Failures: malformed JSON or a bad path parameter → `BAD_REQUEST`; a non-JSON body →
 * `UNSUPPORTED_MEDIA_TYPE`; a body over the route limit → `PAYLOAD_TOO_LARGE`; schema failures →
 * `VALIDATION_FAILED` with `field_errors[]`.
 */
import type { Hono, MiddlewareHandler } from 'hono';
import { type RouteContract, routeKey } from '@da/validation';
import type { z } from 'zod';
import { DEFAULT_JSON_BODY_BYTES, ROUTE_BODY_BYTES } from '../config.ts';
import { AppError, validationError } from '../errors.ts';
import type { AppContext, AppEnv } from './context.ts';

export interface ParsedBody {
  /** The parsed JSON value (before schema validation), used for the idempotency fingerprint. */
  readonly json: unknown;
}

const JSON_CONTENT = /^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;.*)?$/i;

function bodyLimitFor(key: string): number {
  return ROUTE_BODY_BYTES[key] ?? DEFAULT_JSON_BODY_BYTES;
}

/** Reads and parses the JSON body once; `c.var.validated.body` is filled by `validateRequest`. */
export function parseJsonBody(contract: RouteContract): MiddlewareHandler<AppEnv> {
  const key = routeKey(contract);
  return async (c, next) => {
    if (contract.request.body === undefined) {
      c.set('validated', { ...c.get('validated'), body: undefined });
      await next();
      return;
    }
    const contentType = c.req.header('Content-Type') ?? '';
    if (!JSON_CONTENT.test(contentType.trim())) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', { details: { expected: 'application/json' } });
    }
    const text = await c.req.text();
    const limit = bodyLimitFor(key);
    if (new TextEncoder().encode(text).byteLength > limit) {
      throw new AppError('PAYLOAD_TOO_LARGE', { details: { limit_bytes: limit } });
    }
    let json: unknown;
    try {
      json = text.trim() === '' ? {} : JSON.parse(text);
    } catch {
      throw new AppError('BAD_REQUEST', { details: { reason: 'malformed_json' } });
    }
    c.set('validated', { ...c.get('validated'), raw: json });
    await next();
  };
}

export function rawBody(c: AppContext): unknown {
  return c.get('validated').raw;
}

/** Validates params, query and body against the route contract. */
export function validateRequest(contract: RouteContract): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const validated = { ...c.get('validated') };
    if (contract.request.params !== undefined) {
      const parsed = contract.request.params.safeParse(c.req.param());
      if (!parsed.success) {
        throw new AppError('BAD_REQUEST', { details: { reason: 'invalid_path_parameter' } });
      }
      validated.params = parsed.data;
    }
    if (contract.request.query !== undefined) {
      const parsed = contract.request.query.safeParse(c.req.query());
      if (!parsed.success) throw validationError(parsed.error, 'query');
      validated.query = parsed.data;
    }
    if (contract.request.body !== undefined) {
      const parsed = contract.request.body.safeParse(validated.raw);
      if (!parsed.success) throw validationError(parsed.error);
      validated.body = parsed.data;
    }
    c.set('validated', validated);
    await next();
  };
}

/** Typed accessors for handlers. */
export function validBody<S extends z.ZodType>(c: AppContext, _schema: S): z.infer<S> {
  return c.get('validated').body as z.infer<S>;
}
export function validParams<S extends z.ZodType>(c: AppContext, _schema: S): z.infer<S> {
  return c.get('validated').params as z.infer<S>;
}
export function validQuery<S extends z.ZodType>(c: AppContext, _schema: S): z.infer<S> {
  return c.get('validated').query as z.infer<S>;
}

/**
 * Mounts one registry route: tags the request with its `"METHOD /path"` key, then runs the given
 * middleware chain and handler. Hono patterns are the registry paths verbatim.
 */
export function mountRoute(
  app: Hono<AppEnv>,
  contract: RouteContract,
  ...handlers: MiddlewareHandler<AppEnv>[]
): void {
  const key = routeKey(contract);
  const tag: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('routeKey', key);
    await next();
  };
  app.on(contract.method, contract.path, tag, ...handlers);
}
