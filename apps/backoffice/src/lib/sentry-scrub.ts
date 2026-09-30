/*
 * Sentry scrubbing for the backoffice (BACKOFFICE_PLAN §2.2 "sendDefaultPii:false, beforeSend
 * scrubber"; INTEGRATION_PLAN Sentry row; SECURITY_AND_PRIVACY_PLAN CTL-3.14). The same rules as the
 * other apps' adapters:
 * - no request body, headers, cookies, query string or environment; the URL is a route template
 *   (`/users/:id`), and no `user` object is ever attached;
 * - e-mail addresses (admin or user), bearer tokens, JWTs, Supabase keys and secret query
 *   parameters (`code`, `state`, `token`, …) are redacted in every string;
 * - UUIDs (user, admin, ticket ids) in free text are masked to their first eight characters;
 * - content-like and secret-like keys are removed from structured data, local variables are
 *   dropped from stack frames, HTTP breadcrumbs keep method, route template and status only, UI
 *   and console breadcrumbs keep no text;
 * - tags are kept only from an allow-list (`correlation_id`, `boundary`, …).
 * Every scan is linear: strings are cut into whitespace-free runs by one character class and each
 * run is inspected with `indexOf` / anchored patterns (no backtracking over the whole text).
 */
import type { Breadcrumb, ErrorEvent, Event } from '@sentry/nextjs';

export const REDACTED = '[Filtered]';

const SECRET_PARAMS = new Set([
  'code',
  'state',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'key',
  'apikey',
  'signature',
  'sig',
  'nonce',
  'email',
  'next',
]);

/** Keys whose values are content, secrets or personal data: always removed. */
const SENSITIVE_KEY =
  /^(?:authorization|cookie|cookies|set-cookie|headers|password|secret|token|access_token|refresh_token|id_token|api[_-]?key|body|content|html|text|snippet|subject|title|message_body|draft|transcript|prompt|email|e-mail|emails|phone|name|display_name|full_name|address|data|request_body|response_body|reason|note|notes|comment|query_string|user|ip_address)$/i;

/** Supabase API keys (secret and publishable), anchored at the start of a run. */
const SUPABASE_KEY_PREFIX = /^sb_(?:secret|publishable)_/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_IN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** `0190f5e0-0000-7000-8000-00000000f001` → `0190f5e0…`. */
export function maskId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

function isEmailRun(run: string): boolean {
  const at = run.indexOf('@');
  return at > 0 && run.indexOf('.', at + 2) > at + 1 && !run.startsWith('@');
}

function isJwtRun(run: string): boolean {
  const start = run.indexOf('eyJ');
  if (start === -1) return false;
  const dot1 = run.indexOf('.', start + 3);
  return dot1 !== -1 && run.includes('.', dot1 + 2);
}

/** Secret query parameters of a URL-like run: `?code=abc&x=1` → `?code=[Filtered]&x=1`. */
function redactParams(run: string): string {
  const q = run.search(/[?#]/);
  if (q === -1) return run;
  const head = run.slice(0, q + 1);
  const parts = run.slice(q + 1).split(/([&#])/);
  return (
    head +
    parts
      .map((part) => {
        if (part === '&' || part === '#') return part;
        const eq = part.indexOf('=');
        if (eq === -1) return part;
        return SECRET_PARAMS.has(part.slice(0, eq).toLowerCase())
          ? `${part.slice(0, eq)}=${REDACTED}`
          : part;
      })
      .join('')
  );
}

function scrubRun(run: string): string {
  if (isEmailRun(run) || isJwtRun(run)) return REDACTED;
  if (SUPABASE_KEY_PREFIX.test(run)) return REDACTED;
  return redactParams(run).replace(UUID_IN, (id) => maskId(id));
}

/** Redacts secrets and personal data inside one string (linear in its length). */
export function scrubString(value: string): string {
  return value
    .replace(/\b(Bearer|Basic)\s+\S+/gi, `$1 ${REDACTED}`)
    .replace(/[^\s"'<>()[\]{},;]+/g, (run) => scrubRun(run));
}

/** Deep scrub: sensitive keys removed, every string redacted, depth and size bounded. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 6) return REDACTED;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrubValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) continue;
    out[key] = scrubValue(inner, depth + 1);
  }
  return out;
}

/** `https://admin.example/users/<uuid>?tab=audit` → `/users/:id`. */
export function routeTemplate(url: string): string {
  let path: string;
  try {
    path = new URL(url, 'http://route.invalid').pathname;
  } catch {
    path = url.split(/[?#]/)[0] ?? '';
  }
  return path
    .split('/')
    .map((segment) => (UUID.test(segment) ? ':id' : /^\d{3,}$/.test(segment) ? ':n' : segment))
    .join('/');
}

/** `beforeBreadcrumb`: HTTP keeps method, route template and status; UI keeps no text. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  const category = breadcrumb.category ?? '';
  const data = (breadcrumb.data ?? {}) as Record<string, unknown>;
  if (category === 'fetch' || category === 'xhr' || breadcrumb.type === 'http') {
    const { message: _message, ...rest } = breadcrumb;
    return {
      ...rest,
      data: {
        ...(typeof data.method === 'string' ? { method: data.method } : {}),
        ...(typeof data.url === 'string' ? { url: routeTemplate(data.url) } : {}),
        ...(typeof data.status_code === 'number' ? { status_code: data.status_code } : {}),
      },
    };
  }
  if (category === 'navigation') {
    const { message: _message, ...rest } = breadcrumb;
    return {
      ...rest,
      data: {
        ...(typeof data.from === 'string' ? { from: routeTemplate(data.from) } : {}),
        ...(typeof data.to === 'string' ? { to: routeTemplate(data.to) } : {}),
      },
    };
  }
  if (category === 'console' || category.startsWith('ui')) {
    // Logged values and clicked element text can hold names, e-mail addresses or ticket text.
    const { message: _message, data: _data, ...rest } = breadcrumb;
    return rest;
  }
  return {
    ...breadcrumb,
    ...(breadcrumb.message === undefined ? {} : { message: scrubString(breadcrumb.message) }),
    ...(breadcrumb.data === undefined
      ? {}
      : { data: scrubValue(breadcrumb.data) as Record<string, unknown> }),
  };
}

/** Tags that may leave the app (values are still scrubbed). */
const TAG_ALLOWLIST = new Set([
  'correlation_id',
  'boundary',
  'digest',
  'route',
  'runtime',
  'environment',
  'release',
  'handled',
  'mechanism',
  'level',
  'url',
  'transaction',
]);

/** Contexts kept (scrubbed); everything else is dropped. */
const CONTEXT_ALLOWLIST = new Set([
  'os',
  'runtime',
  'browser',
  'device',
  'app',
  'culture',
  'trace',
  'nextjs',
  'cloud_resource',
]);

/** `beforeSend`: no user, no request body, headers or cookies, every string scrubbed. */
export function scrubEvent<T extends Event = ErrorEvent>(event: T): T | null {
  const out: T = { ...event };
  delete out.user;
  delete out.server_name;
  delete out.extra;
  if (out.request !== undefined) {
    out.request = {
      ...(out.request.method === undefined ? {} : { method: out.request.method }),
      ...(out.request.url === undefined ? {} : { url: routeTemplate(out.request.url) }),
    };
  }
  if (out.transaction !== undefined) out.transaction = routeTemplate(out.transaction);
  if (out.message !== undefined) out.message = scrubString(out.message);
  if (out.logentry !== undefined) {
    out.logentry = {
      ...(out.logentry.message === undefined ? {} : { message: scrubString(out.logentry.message) }),
    };
  }
  if (out.exception?.values !== undefined) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((value) => ({
        ...value,
        ...(value.value === undefined ? {} : { value: scrubString(value.value) }),
        ...(value.stacktrace?.frames === undefined
          ? {}
          : {
              stacktrace: {
                ...value.stacktrace,
                frames: value.stacktrace.frames.map((frame) => {
                  const { vars: _vars, ...rest } = frame;
                  return rest;
                }),
              },
            }),
      })),
    };
  }
  if (out.breadcrumbs !== undefined) {
    out.breadcrumbs = out.breadcrumbs
      .map((breadcrumb) => scrubBreadcrumb(breadcrumb))
      .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null);
  }
  if (out.contexts !== undefined) {
    const contexts: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(out.contexts)) {
      if (CONTEXT_ALLOWLIST.has(name)) contexts[name] = scrubValue(value);
    }
    out.contexts = contexts as T['contexts'];
  }
  if (out.tags !== undefined) {
    const tags: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(out.tags)) {
      if (TAG_ALLOWLIST.has(name)) tags[name] = scrubValue(value);
    }
    out.tags = tags as T['tags'];
  }
  return out;
}

export interface SentryRuntimeConfig {
  readonly dsn: string;
  readonly environment: string;
  readonly release?: string;
}

/**
 * The shared `Sentry.init` options: no default PII, no tracing, no replay, the scrubber on events,
 * transactions and breadcrumbs.
 */
export function sentryInitOptions(config: SentryRuntimeConfig) {
  return {
    dsn: config.dsn,
    environment: config.environment,
    ...(config.release === undefined ? {} : { release: config.release }),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    maxBreadcrumbs: 50,
    beforeSend: (event: ErrorEvent) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb: Breadcrumb) => scrubBreadcrumb(breadcrumb),
  };
}
