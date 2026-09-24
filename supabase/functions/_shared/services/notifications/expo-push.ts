/**
 * Expo Push Service client (ADR-10, INTEGRATION_PLAN §9.1/§9.6, API_CONTRACTS JOB-18/19).
 *
 * - `POST {base}/--/api/v2/push/send` with `Authorization: Bearer EXPO_ACCESS_TOKEN` (enhanced push
 *   security), at most 100 messages per request, gzip-compressed bodies above 1 KiB.
 * - `POST {base}/--/api/v2/push/getReceipts` with at most 1,000 ticket ids per request.
 * - 429 and 5xx are retryable (`Retry-After` honoured); other request-level failures are not.
 * The base URL is `https://exp.host`; `EXPO_PUSH_BASE_URL` points tests and local mocks elsewhere
 * (rejected by the env schema in preview and production).
 */
import { OUTBOUND } from '../../config.ts';
import { credentialStatus, type RawEnv } from '../../env.ts';
import { JobError } from '../../jobs/types.ts';
import type { ExpoErrorCode } from './model.ts';

export const EXPO_SEND_BATCH = 100;
export const EXPO_RECEIPT_BATCH = 1000;
const GZIP_THRESHOLD = 1024;

export interface ExpoMessage {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  /** Exactly `{type, entity_id, deeplink}` (plan §12, M-GL-08). */
  readonly data: {
    readonly type: string;
    readonly entity_id: string | null;
    readonly deeplink: string;
  };
  readonly sound: 'default' | null;
  readonly channelId: string;
  readonly categoryId: string;
  readonly priority: 'high' | 'normal';
  readonly interruptionLevel: 'active' | 'passive' | 'time-sensitive';
  readonly relevanceScore: number;
  readonly threadId: string;
  readonly collapseId: string;
  readonly ttl: number;
}

export type ExpoTicket =
  | { readonly status: 'ok'; readonly id: string }
  | { readonly status: 'error'; readonly message: string; readonly error: ExpoErrorCode };

export type ExpoReceipt =
  | { readonly status: 'ok' }
  | { readonly status: 'error'; readonly message: string; readonly error: ExpoErrorCode };

export interface ExpoPushClient {
  send(messages: readonly ExpoMessage[]): Promise<ExpoTicket[]>;
  receipts(ids: readonly string[]): Promise<Record<string, ExpoReceipt>>;
}

const KNOWN_ERRORS = new Set<ExpoErrorCode>([
  'DeviceNotRegistered',
  'MessageTooBig',
  'MessageRateExceeded',
  'MismatchSenderId',
  'InvalidCredentials',
]);

export function expoErrorCode(value: unknown): ExpoErrorCode {
  return typeof value === 'string' && KNOWN_ERRORS.has(value as ExpoErrorCode)
    ? (value as ExpoErrorCode)
    : 'Unknown';
}

function retryAfterSeconds(response: Response): number | null {
  const value = response.headers.get('Retry-After');
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds));
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(1, Math.ceil((at - Date.now()) / 1000));
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface ExpoClientOptions {
  readonly accessToken: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export function createExpoPushClient(options: ExpoClientOptions): ExpoPushClient {
  const base = (options.baseUrl ?? 'https://exp.host').replace(/\/+$/, '');
  const doFetch = options.fetch ?? fetch;

  async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const text = JSON.stringify(body);
    const compressed = text.length > GZIP_THRESHOLD;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.accessToken}`,
    };
    if (compressed) headers['Content-Encoding'] = 'gzip';
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers,
        body: compressed ? await gzip(text) : text,
        signal: AbortSignal.timeout(options.timeoutMs ?? OUTBOUND.providerTimeoutMs),
      });
    } catch {
      throw new JobError('PROVIDER_UNAVAILABLE', true, null, 'expo_network');
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      throw new JobError(
        response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
        true,
        retryAfterSeconds(response),
        `expo_http_${response.status}`,
      );
    }
    let json: Record<string, unknown>;
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new JobError('PROVIDER_UNAVAILABLE', true, null, 'expo_bad_json');
    }
    if (!response.ok) {
      const errors = Array.isArray(json.errors) ? (json.errors as { code?: string }[]) : [];
      const code = errors[0]?.code ?? `http_${response.status}`;
      const credential =
        response.status === 401 || response.status === 403 || /UNAUTHORIZED|CREDENTIAL/i.test(code);
      throw new JobError(
        credential ? 'EXTERNAL_CREDENTIAL_REQUIRED' : 'PROVIDER_REJECTED',
        false,
        null,
        `expo_${code}`.slice(0, 120),
      );
    }
    return json;
  }

  return {
    async send(messages) {
      const tickets: ExpoTicket[] = [];
      for (let i = 0; i < messages.length; i += EXPO_SEND_BATCH) {
        const batch = messages.slice(i, i + EXPO_SEND_BATCH);
        const json = await post('/--/api/v2/push/send', batch);
        const data = Array.isArray(json.data) ? (json.data as Record<string, unknown>[]) : [];
        batch.forEach((_, index) => {
          const t = data[index];
          if (t?.status === 'ok' && typeof t.id === 'string') {
            tickets.push({ status: 'ok', id: t.id });
          } else {
            const details = (t?.details ?? {}) as { error?: unknown };
            tickets.push({
              status: 'error',
              message: typeof t?.message === 'string' ? t.message.slice(0, 200) : 'missing_ticket',
              error: expoErrorCode(details.error),
            });
          }
        });
      }
      return tickets;
    },
    async receipts(ids) {
      const out: Record<string, ExpoReceipt> = {};
      for (let i = 0; i < ids.length; i += EXPO_RECEIPT_BATCH) {
        const batch = ids.slice(i, i + EXPO_RECEIPT_BATCH);
        const json = await post('/--/api/v2/push/getReceipts', { ids: batch });
        const data = (json.data ?? {}) as Record<string, Record<string, unknown>>;
        for (const [id, receipt] of Object.entries(data)) {
          if (receipt.status === 'ok') out[id] = { status: 'ok' };
          else {
            const details = (receipt.details ?? {}) as { error?: unknown };
            out[id] = {
              status: 'error',
              message: typeof receipt.message === 'string' ? receipt.message.slice(0, 200) : '',
              error: expoErrorCode(details.error),
            };
          }
        }
      }
      return out;
    },
  };
}

/** The client when `EXPO_ACCESS_TOKEN` is configured, else `null` (EXTERNAL_CREDENTIAL_REQUIRED). */
export function expoPushClientFromEnv(
  raw: RawEnv,
  fetchImpl?: typeof fetch,
): ExpoPushClient | null {
  if (credentialStatus('expo_push', raw).status !== 'configured') return null;
  const token = raw.EXPO_ACCESS_TOKEN?.trim() ?? '';
  const base =
    raw.APP_ENV === 'production' || raw.APP_ENV === 'preview' ? undefined : raw.EXPO_PUSH_BASE_URL;
  return createExpoPushClient({
    accessToken: token,
    ...(base === undefined || base.trim() === '' ? {} : { baseUrl: base }),
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
}
