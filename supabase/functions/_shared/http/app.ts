/**
 * Hono application factory (API_CONTRACTS §1 `http/app.ts`, IMPLEMENTATION_PLAN T-3.02).
 *
 * `createApp({fn})` returns a Hono app with `basePath('/<fn>')` and, in order: correlation and
 * request ids → request log → security headers → CORS (only when configured, `public-api`) →
 * browser-origin rejection (native / server-to-server functions) → 1 MB body limit. Errors become
 * the standard envelope; unknown routes answer `NOT_FOUND`.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { CORRELATION_ID_PATTERN, type FunctionName, MAX_BODY_BYTES } from '../config.ts';
import { AppError, normalizeError, resolveLocale, toErrorBody } from '../errors.ts';
import { createLogger, type Logger } from '../logging/logger.ts';
import type { Sentry } from '../observability/sentry.ts';
import type { AppContext, AppEnv } from './context.ts';

export interface CorsOptions {
  /** Exact origins allowed (e.g. `PUBLIC_WEB_URL`); nothing else gets CORS headers. */
  readonly origins: readonly string[];
}

export interface CreateAppOptions {
  readonly fn: FunctionName;
  readonly logger?: Logger;
  readonly sentry?: Sentry;
  /** CORS for browser callers (`public-api` only, API_CONTRACTS §2.15). */
  readonly cors?: CorsOptions;
  /** Reject requests carrying a browser `Origin` header (`api`, `admin-api`: §2.15). */
  readonly rejectBrowserOrigin?: boolean;
  readonly maxBodyBytes?: number;
  readonly now?: () => number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_RE = /^(ios|android)\/(\d+\.\d+\.\d+)(?:\s+\(([^)]{1,16})\))?$/;

function parseClient(header: string | undefined): AppEnv['Variables']['client'] {
  const match = header === undefined ? null : CLIENT_RE.exec(header.trim());
  if (match === null) return { platform: null, version: null, build: null };
  return {
    platform: match[1] as 'ios' | 'android',
    version: match[2] ?? null,
    build: match[3] ?? null,
  };
}

/** Renders an `AppError` (or anything else, as `INTERNAL_ERROR`) as the §2.4 envelope. */
export function errorResponse(c: AppContext, error: unknown): Response {
  const appErr = normalizeError(error);
  c.set('errorCode', appErr.code);
  const body = toErrorBody(appErr, c.get('correlationId'), c.get('locale'));
  const headers = new Headers(appErr.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  if (appErr.code === 'RATE_LIMITED' && !headers.has('Retry-After'))
    headers.set('Retry-After', '1');
  return new Response(JSON.stringify(body), { status: appErr.status, headers });
}

export function createApp(options: CreateAppOptions): Hono<AppEnv> {
  const log = options.logger ?? createLogger({ fn: options.fn });
  const now = options.now ?? (() => Date.now());
  const app = new Hono<AppEnv>().basePath(`/${options.fn}`);

  app.use('*', async (c, next) => {
    const incoming = c.req.header('X-Correlation-Id');
    const correlationId =
      incoming !== undefined && CORRELATION_ID_PATTERN.test(incoming)
        ? incoming
        : crypto.randomUUID();
    const requestId = crypto.randomUUID();
    c.set('correlationId', correlationId);
    c.set('requestId', requestId);
    c.set('startedAt', now());
    c.set('locale', resolveLocale(c.req.header('Accept-Language')));
    c.set('log', log.child({ correlation_id: correlationId, request_id: requestId }));
    c.set('validated', {});
    c.set('client', parseClient(c.req.header('X-DA-Client')));
    const installation = c.req.header('X-DA-Installation-Id');
    c.set(
      'installationId',
      installation !== undefined && UUID_RE.test(installation) ? installation.toLowerCase() : null,
    );
    c.set('auth', undefined);
    c.set('userHash', undefined);
    c.set('admin', undefined);
    c.set('errorCode', undefined);
    c.set('routeKey', undefined);
    try {
      await next();
    } finally {
      c.header('X-Correlation-Id', correlationId);
      c.header('X-Request-Id', requestId);
      c.header('X-Content-Type-Options', 'nosniff');
      if (c.res.headers.get('Cache-Control') === null) c.header('Cache-Control', 'no-store');
      c.get('log').info('request', {
        method: c.req.method,
        route: c.get('routeKey') ?? c.req.routePath,
        status: c.res.status,
        duration_ms: now() - c.get('startedAt'),
        error_code: c.get('errorCode'),
      });
    }
  });

  if (options.cors !== undefined) {
    const allowed = new Set(options.cors.origins.map((o) => o.replace(/\/+$/, '')));
    app.use(
      '*',
      cors({
        origin: (origin) => (allowed.has(origin) ? origin : null),
        allowMethods: ['GET', 'POST'],
        allowHeaders: [
          'Content-Type',
          'X-Correlation-Id',
          'Accept-Language',
          'apikey',
          'Authorization',
        ],
        exposeHeaders: ['X-Correlation-Id', 'X-Request-Id', 'Retry-After'],
        credentials: false,
        maxAge: 600,
      }),
    );
  } else if (options.rejectBrowserOrigin === true) {
    app.use('*', async (c, next) => {
      if (c.req.header('Origin') !== undefined) {
        throw new AppError('FORBIDDEN', { details: { reason: 'browser_origin' } });
      }
      await next();
    });
  }

  app.use(
    '*',
    bodyLimit({
      maxSize: options.maxBodyBytes ?? MAX_BODY_BYTES,
      onError: () => {
        throw new AppError('PAYLOAD_TOO_LARGE', {
          details: { limit_bytes: options.maxBodyBytes ?? MAX_BODY_BYTES },
        });
      },
    }),
  );

  app.onError(async (err, c) => {
    const appErr =
      err instanceof HTTPException && !(err instanceof AppError)
        ? new AppError(
            err.status === 413
              ? 'PAYLOAD_TOO_LARGE'
              : err.status === 401
                ? 'AUTH_REQUIRED'
                : 'BAD_REQUEST',
            {
              cause: err,
            },
          )
        : normalizeError(err);
    if (appErr.status >= 500) {
      const cause = appErr.cause ?? appErr;
      c.get('log').error('unhandled_error', {
        error_code: appErr.code,
        error_name: cause instanceof Error ? cause.name : typeof cause,
        error_message: cause instanceof Error ? cause.message : undefined,
      });
      if (appErr.code === 'INTERNAL_ERROR' && options.sentry !== undefined) {
        await options.sentry.captureException(cause, {
          fn: options.fn,
          correlationId: c.get('correlationId'),
          code: appErr.code,
          route: c.get('routeKey') ?? c.req.routePath,
        });
      }
    }
    return errorResponse(c, appErr);
  });

  app.notFound((c) => errorResponse(c, new AppError('NOT_FOUND')));

  return app;
}
