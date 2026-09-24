/**
 * Error monitoring (T-8.28; SECURITY_AND_PRIVACY_PLAN CTL-3.14, INTEGRATION_PLAN Sentry row,
 * ADR-39). `@sentry/react-native` 8.27 starts only when `EXPO_PUBLIC_SENTRY_DSN` is set:
 * - `sendDefaultPii:false`, `attachScreenshot:false`, `attachViewHierarchy:false`, no Session
 *   Replay: no screenshot or view dump of a content screen ever leaves the device;
 * - no user id is set; tags are platform, app version, release and correlation id only;
 * - `beforeSend` and `beforeBreadcrumb` share one scrubber: e-mail addresses, bearer tokens, JWTs,
 *   Supabase keys, Expo push tokens and secret query parameters (`code`, `state`, `token`, …) are
 *   redacted; request bodies, cookies, headers and content-like fields (bodies, subjects, snippets,
 *   drafts, transcripts, titles) are removed; HTTP breadcrumbs keep only method, route template and
 *   status; UI and console breadcrumbs keep no text;
 * - `release` = `<application id>@<version>+<build>` and `dist` = the build number, from the app
 *   config; `environment` = the build variant (`EXPO_PUBLIC_APP_ENV`). Source maps are uploaded by
 *   CI only (`disableAutoUpload` in `app.config.ts`; the Metro serializer from
 *   `getSentryExpoConfig` adds the debug ids).
 */
import type { ExpoClientEnv } from '@da/validation/env';
import * as Sentry from '@sentry/react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';

import { appVersion, buildNumber, platform } from './device';
import { getClientEnv } from './env';

const REDACTED = '[Filtered]';

const PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/[^\s@"'<>()[\]{},;:]+@[^\s@"'<>()[\]{},;:]+\.[a-z]{2,}/gi, REDACTED],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, REDACTED],
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, REDACTED],
  [/ExponentPushToken\[[^\]]*\]/g, REDACTED],
  [
    /([?&#](?:code|state|token|access_token|refresh_token|id_token|key|apikey|signature|sig|nonce|device_nonce|completion_code|email)=)[^&#\s"']*/gi,
    `$1${REDACTED}`,
  ],
];

/** Keys whose values are content, secrets or personal data: always removed. */
const SENSITIVE_KEY =
  /^(?:authorization|cookie|set-cookie|password|secret|token|access_token|refresh_token|id_token|api[_-]?key|body|content|html|text|snippet|subject|title|message_body|draft|transcript|prompt|email|e-mail|phone|name|display_name|address|data|request_body|response_body)$/i;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Redacts secrets and personal data inside one string. */
export function scrubString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** Deep scrub: sensitive keys removed, every string redacted, depth and size bounded. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 6) return REDACTED;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrubValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrubValue(inner, depth + 1);
  }
  return out;
}

/** `https://host/functions/v1/api/mail/<uuid>?x=1` → `/functions/v1/api/mail/:id`. */
export function routeTemplate(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split(/[?#]/)[0] ?? '';
  }
  return path.replace(UUID, ':id').replace(/\/\d{3,}(?=\/|$)/g, '/:n');
}

type Breadcrumb = Sentry.Breadcrumb;

/** `beforeBreadcrumb`: HTTP keeps method, route template and status; UI keeps no text. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  const category = breadcrumb.category ?? '';
  if (category === 'fetch' || category === 'xhr' || breadcrumb.type === 'http') {
    const data = (breadcrumb.data ?? {}) as Record<string, unknown>;
    const url = typeof data.url === 'string' ? routeTemplate(data.url) : undefined;
    return {
      ...breadcrumb,
      message: undefined,
      data: {
        ...(typeof data.method === 'string' ? { method: data.method } : {}),
        ...(url === undefined ? {} : { url }),
        ...(typeof data.status_code === 'number' ? { status_code: data.status_code } : {}),
      },
    };
  }
  if (category === 'navigation') {
    const data = (breadcrumb.data ?? {}) as Record<string, unknown>;
    return {
      ...breadcrumb,
      message: undefined,
      data: {
        ...(typeof data.from === 'string' ? { from: routeTemplate(data.from) } : {}),
        ...(typeof data.to === 'string' ? { to: routeTemplate(data.to) } : {}),
      },
    };
  }
  if (category === 'console' || category.startsWith('ui') || category === 'touch') {
    // Logged values and accessibility labels can hold names or message text.
    return { ...breadcrumb, message: undefined, data: undefined };
  }
  return {
    ...breadcrumb,
    ...(breadcrumb.message === undefined ? {} : { message: scrubString(breadcrumb.message) }),
    ...(breadcrumb.data === undefined
      ? {}
      : { data: scrubValue(breadcrumb.data) as Record<string, unknown> }),
  };
}

type SentryEvent = Sentry.ErrorEvent;

/** `beforeSend`: no user, no request body or headers, every string scrubbed. */
export function scrubEvent(event: SentryEvent): SentryEvent | null {
  const out: SentryEvent = { ...event };
  delete out.user;
  delete out.server_name;
  if (out.request !== undefined) {
    out.request = {
      ...(out.request.method === undefined ? {} : { method: out.request.method }),
      ...(out.request.url === undefined ? {} : { url: routeTemplate(out.request.url) }),
    };
  }
  if (out.message !== undefined) out.message = scrubString(out.message);
  if (out.exception?.values !== undefined) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((value) => ({
        ...value,
        ...(value.value === undefined ? {} : { value: scrubString(value.value) }),
      })),
    };
  }
  if (out.breadcrumbs !== undefined) {
    out.breadcrumbs = out.breadcrumbs
      .map((breadcrumb) => scrubBreadcrumb(breadcrumb))
      .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null);
  }
  if (out.extra !== undefined) out.extra = scrubValue(out.extra) as Record<string, unknown>;
  if (out.contexts !== undefined)
    out.contexts = scrubValue(out.contexts) as SentryEvent['contexts'];
  if (out.tags !== undefined) out.tags = scrubValue(out.tags) as SentryEvent['tags'];
  return out;
}

/** `<application id>@<version>+<build>` (the app config's version and the native build). */
export function sentryRelease(): string {
  const version = Constants.expoConfig?.version ?? appVersion();
  const id = Application.applicationId ?? 'com.dijitalasistan.app';
  return `${id}@${version}+${buildNumber()}`;
}

export function sentryDist(): string {
  return buildNumber();
}

let started = false;

/** Starts Sentry once; `false` when this build has no DSN. */
export function initSentry(env: ExpoClientEnv = getClientEnv()): boolean {
  if (started) return true;
  const dsn = env.EXPO_PUBLIC_SENTRY_DSN;
  if (dsn === undefined) return false;
  Sentry.init({
    dsn,
    environment: env.EXPO_PUBLIC_APP_ENV,
    release: sentryRelease(),
    dist: sentryDist(),
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableCaptureFailedRequests: false,
    maxBreadcrumbs: 50,
    // Preview builds measure the startup budget; production samples a tenth of the sessions.
    tracesSampleRate: env.EXPO_PUBLIC_APP_ENV === 'production' ? 0.1 : 1,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  Sentry.setTags({ platform: platform(), app_version: appVersion() });
  started = true;
  return true;
}

export function isSentryStarted(): boolean {
  return started;
}

/** Reports a render error from the error boundary; returns the event id when Sentry runs. */
export function captureError(
  error: unknown,
  context: { readonly routePattern?: string; readonly correlationId?: string | null } = {},
): string | null {
  if (!started) return null;
  return Sentry.captureException(error, (scope) => {
    if (context.routePattern !== undefined) scope.setTag('route_pattern', context.routePattern);
    if (context.correlationId !== undefined && context.correlationId !== null) {
      scope.setTag('correlation_id', context.correlationId);
    }
    return scope;
  });
}

/** Test seam. */
export function resetSentryForTests(): void {
  started = false;
}
