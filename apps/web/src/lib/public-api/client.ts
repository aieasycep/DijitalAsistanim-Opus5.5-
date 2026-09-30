import type { z } from '../zod.ts';
import { clientEnv } from '../../env/client.ts';
import { PUBLIC_API_PATH } from '../site.ts';
import { ErrorBodySchema, successOf, type FieldError } from './schemas.ts';

/**
 * Browser calls to `public-api` (SCREEN_AND_FLOW_MAP Part 5 §0.8): plain `fetch`, no Supabase
 * client, no credentials, no cookies. The web maps `error.code` and `field_errors[].path` to its
 * own copy and never renders the server's `message`.
 */

export type PublicApiResult<T> =
  | { readonly ok: true; readonly status: number; readonly data: T }
  | {
      readonly ok: false;
      readonly kind: 'http';
      readonly status: number;
      readonly code: string;
      readonly fieldErrors: readonly FieldError[];
      readonly retryAfterSeconds: number | null;
    }
  | { readonly ok: false; readonly kind: 'network' }
  | { readonly ok: false; readonly kind: 'unconfigured' };

export function publicApiBaseUrl(): string | null {
  const base = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  return base === undefined ? null : `${base}${PUBLIC_API_PATH}`;
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.round((date - Date.now()) / 1000));
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export async function callPublicApi<T extends z.ZodType>(
  path: string,
  schema: T,
  options: RequestOptions = {},
): Promise<PublicApiResult<z.infer<T>>> {
  const base = publicApiBaseUrl();
  if (base === null) return { ok: false, kind: 'unconfigured' };
  const headers: Record<string, string> = { accept: 'application/json', 'x-client-info': 'da-web' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const publishableKey = clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (publishableKey !== undefined) headers.apikey = publishableKey;

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch {
    return { ok: false, kind: 'network' };
  }

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (response.ok) {
    const parsed = successOf(schema).safeParse(json);
    if (parsed.success) {
      const body = parsed.data as { data: z.infer<T> };
      return { ok: true, status: response.status, data: body.data };
    }
    return {
      ok: false,
      kind: 'http',
      status: 502,
      code: 'BAD_RESPONSE',
      fieldErrors: [],
      retryAfterSeconds: null,
    };
  }

  const error = ErrorBodySchema.safeParse(json);
  return {
    ok: false,
    kind: 'http',
    status: response.status,
    code: error.success ? error.data.error.code : `HTTP_${String(response.status)}`,
    fieldErrors: error.success ? (error.data.error.field_errors ?? []) : [],
    retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
  };
}
