/**
 * Microsoft Graph client (INTEGRATION_PLAN §5.4, §3.6; T-4.07):
 * - every request sends `Prefer: IdType="ImmutableId"` (plus call-specific preferences);
 * - at most 4 concurrent requests per mailbox (in-process semaphore per connected account);
 * - the `graph_mailbox_requests` budget (8,000 per 10 min) per call;
 * - 429 honours `Retry-After` (inline when short, else `rate_limited` for the job to reschedule);
 *   `MailboxConcurrency` counts as throttling; `MailboxNotEnabledForRESTAPI` → `mailbox_unavailable`;
 * - `nextLink` / `deltaLink` URLs are followed only on the configured Graph origin;
 * - JSON batching (≤ 20 requests per `$batch`).
 */
import { type ProviderContext, ProviderError, type QuotaPriority } from '@da/domain';
import { type AdapterHttp, authorizedFetch, Semaphore } from '../common.ts';
import type { ProviderErrorBody } from '../errors.ts';

export interface GraphClientConfig {
  readonly base: string;
  readonly http: AdapterHttp;
  /** Concurrent requests per mailbox (Outlook allows 4). */
  readonly concurrency?: number;
}

export interface GraphRequest {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly prefer?: readonly string[];
  readonly headers?: Record<string, string>;
  readonly priority?: QuotaPriority;
  readonly idempotent?: boolean;
}

const semaphores = new Map<string, Semaphore>();

function semaphoreFor(accountId: string, slots: number): Semaphore {
  let s = semaphores.get(accountId);
  if (s === undefined) {
    s = new Semaphore(slots);
    if (semaphores.size > 500) semaphores.clear();
    semaphores.set(accountId, s);
  }
  return s;
}

/** Graph error body `{error:{code,message,innerError}}` → classifier input (never the message). */
export async function parseGraphError(response: Response): Promise<ProviderErrorBody> {
  try {
    const json = (await response.json()) as {
      error?: { code?: unknown; innerError?: { code?: unknown } } | string;
    };
    if (typeof json.error === 'string') return { code: json.error };
    const code = typeof json.error?.code === 'string' ? json.error.code : null;
    const inner =
      typeof json.error?.innerError?.code === 'string' ? json.error.innerError.code : null;
    if (code === 'MailboxConcurrency' || code === 'ApplicationThrottled')
      return { code: 'TooManyRequests', reason: code };
    return { code, reason: inner ?? code };
  } catch {
    return {};
  }
}

export class GraphClient {
  constructor(private readonly config: GraphClientConfig) {}

  get base(): string {
    return this.config.base;
  }

  /** Absolute URL for a Graph path; absolute links must stay on the Graph origin. */
  resolve(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      const origin = new URL(this.config.base).origin;
      if (new URL(pathOrUrl).origin !== origin) {
        throw new ProviderError('payload_invalid', null, null, 'foreign_link');
      }
      return pathOrUrl;
    }
    return `${this.config.base}${pathOrUrl}`;
  }

  async fetch(ctx: ProviderContext, pathOrUrl: string, init: GraphRequest = {}): Promise<Response> {
    const url = this.resolve(pathOrUrl);
    const headers: Record<string, string> = {
      Prefer: ['IdType="ImmutableId"', ...(init.prefer ?? [])].join(', '),
      ...(init.headers ?? {}),
    };
    let body: string | null = null;
    if (init.body !== undefined) {
      body = JSON.stringify(init.body);
      headers['Content-Type'] = 'application/json';
    }
    const method = init.method ?? 'GET';
    return await semaphoreFor(ctx.account.connectedAccountId, this.config.concurrency ?? 4).run(
      async () => {
        try {
          return await authorizedFetch(ctx, this.config.http, {
            url,
            method,
            headers,
            body,
            idempotent: init.idempotent ?? (method === 'GET' || method === 'DELETE'),
            quota: {
              bucket: 'graph_mailbox_requests',
              units: 1,
              priority: init.priority ?? 'sync',
            },
            parseError: parseGraphError,
          });
        } catch (error) {
          if (
            error instanceof ProviderError &&
            /MailboxNotEnabledForRESTAPI/i.test(error.providerReason ?? '')
          ) {
            throw new ProviderError(
              'mailbox_unavailable',
              error.httpStatus,
              null,
              'MailboxNotEnabledForRESTAPI',
            );
          }
          throw error;
        }
      },
    );
  }

  async json<T>(ctx: ProviderContext, pathOrUrl: string, init: GraphRequest = {}): Promise<T> {
    const response = await this.fetch(ctx, pathOrUrl, init);
    if (response.status === 202 || response.status === 204) {
      await response.body?.cancel();
      return {} as T;
    }
    const text = await response.text();
    return (text === '' ? {} : JSON.parse(text)) as T;
  }

  /** `$batch` of GET requests (≤ 20 each); returns the bodies by request id (404 → null). */
  async batchGet<T>(
    ctx: ProviderContext,
    requests: readonly { id: string; url: string; prefer?: readonly string[] }[],
    priority: QuotaPriority = 'sync',
  ): Promise<Map<string, { status: number; body: T | null }>> {
    const out = new Map<string, { status: number; body: T | null }>();
    for (let i = 0; i < requests.length; i += 20) {
      const chunk = requests.slice(i, i + 20);
      const res = await this.json<{ responses?: { id: string; status: number; body?: T }[] }>(
        ctx,
        '/$batch',
        {
          method: 'POST',
          priority,
          idempotent: true,
          body: {
            requests: chunk.map((r) => ({
              id: r.id,
              method: 'GET',
              url: r.url,
              headers: { Prefer: ['IdType="ImmutableId"', ...(r.prefer ?? [])].join(', ') },
            })),
          },
        },
      );
      for (const item of res.responses ?? []) {
        if (item.status === 429) {
          throw new ProviderError('rate_limited', 429, 1_000, 'batch_throttled');
        }
        out.set(item.id, {
          status: item.status,
          body: item.status >= 200 && item.status < 300 ? (item.body ?? null) : null,
        });
      }
    }
    return out;
  }
}
