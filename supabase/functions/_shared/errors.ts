/**
 * Application errors and the standard error envelope (API_CONTRACTS §2.4–§2.6).
 *
 * Handlers throw `AppError(code, details?)`; the Hono error handler renders
 * `{error:{code, message, message_key, retryable, correlation_id, details?, field_errors?}}` with the
 * HTTP status of the code. Messages come from the i18n catalogues (`errors.<code_lower>`), chosen by
 * `Accept-Language`. `details` never carries PII, secrets, SQL or provider bodies.
 */
import {
  ERROR_HTTP_STATUS,
  ERROR_RETRYABLE,
  type ErrorBody,
  type ErrorCodeValue,
  errorMessageKey,
  type FieldError,
  toFieldErrors,
} from '@da/validation';
import type { z } from 'zod';
import trErrors from '@da/i18n/messages/tr/errors.json' with { type: 'json' };
import enErrors from '@da/i18n/messages/en/errors.json' with { type: 'json' };

export type Locale = 'tr-TR' | 'en-US';

export type ErrorDetails = Record<string, unknown>;

export interface AppErrorOptions {
  details?: ErrorDetails;
  fieldErrors?: FieldError[];
  /** Overrides the per-code default (e.g. `IDEMPOTENCY_REPLAY` with `reason='in_progress'`). */
  retryable?: boolean;
  /** Extra response headers (`Retry-After`, `RateLimit-*`). */
  headers?: Record<string, string>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: ErrorDetails | undefined;
  readonly fieldErrors: FieldError[] | undefined;
  readonly headers: Record<string, string>;

  constructor(code: ErrorCodeValue, options: AppErrorOptions = {}) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_HTTP_STATUS[code] ?? 500;
    this.retryable = options.retryable ?? ERROR_RETRYABLE[code];
    this.details = options.details;
    this.fieldErrors = options.fieldErrors;
    this.headers = options.headers ?? {};
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function appError(code: ErrorCodeValue, details?: ErrorDetails): AppError {
  return new AppError(code, details === undefined ? {} : { details });
}

/** Zod failure → `VALIDATION_FAILED` with `field_errors[]` (paths prefixed by the request part). */
export function validationError(error: z.ZodError, prefix?: string): AppError {
  const fieldErrors = toFieldErrors(error).map((fe) => ({
    ...fe,
    path:
      prefix === undefined || prefix === ''
        ? fe.path
        : fe.path === ''
          ? prefix
          : `${prefix}.${fe.path}`,
  }));
  return new AppError('VALIDATION_FAILED', { fieldErrors });
}

/** A single field error, for checks that are not expressed in a zod schema. */
export function fieldError(path: string, code: string): AppError {
  return new AppError('VALIDATION_FAILED', {
    fieldErrors: [{ path, code, message_key: `validation.${code}` }],
  });
}

type Catalogue = Record<string, unknown>;
const CATALOGUES: Readonly<Record<Locale, Catalogue>> = {
  'tr-TR': trErrors as Catalogue,
  'en-US': enErrors as Catalogue,
};

/** `tr-TR` unless `Accept-Language` prefers English (§2.13). */
export function resolveLocale(acceptLanguage: string | null | undefined): Locale {
  if (acceptLanguage === null || acceptLanguage === undefined) return 'tr-TR';
  const first = acceptLanguage.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('en') ? 'en-US' : 'tr-TR';
}

/** The catalogue message for a code; falls back to the generic message, then to the code. */
export function localizedMessage(code: ErrorCodeValue, locale: Locale): string {
  const catalogue = CATALOGUES[locale];
  const key = code.toLowerCase();
  const direct = catalogue[key];
  if (typeof direct === 'string') return direct;
  const generic = catalogue.internal_error ?? catalogue.internal;
  return typeof generic === 'string' ? generic : code;
}

/** Renders the §2.4 envelope for an error. */
export function toErrorBody(error: AppError, correlationId: string, locale: Locale): ErrorBody {
  const body: ErrorBody['error'] = {
    code: error.code,
    message: localizedMessage(error.code, locale),
    message_key: errorMessageKey(error.code),
    retryable: error.retryable,
    correlation_id: correlationId,
  };
  if (error.details !== undefined && Object.keys(error.details).length > 0)
    body.details = error.details;
  if (error.fieldErrors !== undefined && error.fieldErrors.length > 0)
    body.field_errors = error.fieldErrors;
  return { error: body };
}

/** Anything that is not an `AppError` becomes `INTERNAL_ERROR` (the cause is kept for Sentry). */
export function normalizeError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return new AppError('INTERNAL_ERROR', { cause: error });
}

// ── Database errors ──────────────────────────────────────────────────────────

/** The shape of a PostgREST / Postgres error as surfaced by supabase-js. */
export interface DbErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Maps a database error to an `AppError` (API_CONTRACTS §15): `P0002` → `NOT_FOUND`,
 * `P0001 ENTITLEMENT_REQUIRED:<feature>` / `PLAN_LIMIT:<key>` → `ENTITLEMENT_REQUIRED`,
 * `23505` → `STATE_CONFLICT`, auth failures → `AUTH_REQUIRED`, connectivity → `SERVICE_UNAVAILABLE`.
 * The SQL message itself is never exposed.
 */
export function mapDbError(error: DbErrorLike): AppError {
  const code = error.code ?? '';
  const message = error.message ?? '';
  const entitlement = /ENTITLEMENT_REQUIRED:([a-z0-9_]+)/.exec(message);
  if (entitlement?.[1] !== undefined) {
    return new AppError('ENTITLEMENT_REQUIRED', {
      details: { feature: entitlement[1] },
      cause: error,
    });
  }
  const planLimit = /PLAN_LIMIT:([a-z0-9_]+)/.exec(message);
  if (planLimit?.[1] !== undefined) {
    return new AppError('ENTITLEMENT_REQUIRED', {
      details: { limit_key: planLimit[1] },
      cause: error,
    });
  }
  if (code === 'P0002' || code === 'PGRST116') return new AppError('NOT_FOUND', { cause: error });
  if (code === '23505') return new AppError('STATE_CONFLICT', { cause: error });
  if (code === '23514' || code === '22023' || code === '22P02') {
    return new AppError('VALIDATION_FAILED', { cause: error });
  }
  if (code === 'PGRST301' || code === 'PGRST302' || code === '28000') {
    return new AppError('AUTH_REQUIRED', { cause: error });
  }
  if (code === '42501') return new AppError('FORBIDDEN', { cause: error });
  if (
    code === '57014' ||
    code === '08006' ||
    code === '08001' ||
    code === 'PGRST000' ||
    code === ''
  ) {
    return new AppError('SERVICE_UNAVAILABLE', { cause: error });
  }
  return new AppError('INTERNAL_ERROR', { cause: error });
}

/** Throws the mapped error when a supabase-js result carries one. */
export function throwIfDbError(error: DbErrorLike | null | undefined): void {
  if (error !== null && error !== undefined) throw mapDbError(error);
}
