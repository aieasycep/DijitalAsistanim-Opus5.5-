/**
 * Minimal fetch-based Sentry adapter (ADR-13, IMPLEMENTATION_PLAN T-3.02). It posts one envelope per
 * captured exception to `https://<host>/api/<project>/envelope/`. Without `SENTRY_DSN` it is a
 * no-op. Events carry the error type, a scrubbed message, the stack frames' function/file/line,
 * and tags (`fn`, `correlation_id`, `code`) — never request bodies, headers or user identifiers.
 */
import { scrubString } from '../logging/logger.ts';

export interface SentryEventContext {
  readonly fn: string;
  readonly correlationId?: string;
  readonly code?: string;
  readonly jobId?: string;
  readonly route?: string;
}

export interface Sentry {
  readonly enabled: boolean;
  captureException(error: unknown, context: SentryEventContext): Promise<void>;
}

export interface SentryOptions {
  dsn: string | undefined;
  environment: string;
  release?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

interface ParsedDsn {
  readonly publicKey: string;
  readonly envelopeUrl: string;
  readonly dsn: string;
}

export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\/+/, '').split('/').pop() ?? '';
    if (url.username === '' || projectId === '' || url.protocol !== 'https:') return null;
    const pathPrefix = url.pathname.replace(/\/[^/]*$/, '');
    return {
      publicKey: url.username,
      envelopeUrl: `${url.protocol}//${url.host}${pathPrefix}/api/${projectId}/envelope/`,
      dsn,
    };
  } catch {
    return null;
  }
}

const noop: Sentry = { enabled: false, captureException: () => Promise.resolve() };

interface Frame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}

function parseStack(stack: string | undefined): Frame[] {
  if (stack === undefined) return [];
  const frames: Frame[] = [];
  for (const line of stack.split('\n').slice(1, 30)) {
    const match = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
    if (match === null) continue;
    const frame: Frame = {
      filename: scrubString(match[2] ?? ''),
      lineno: Number(match[3]),
      colno: Number(match[4]),
    };
    if (match[1] !== undefined) frame.function = scrubString(match[1]);
    frames.push(frame);
  }
  return frames.reverse();
}

function eventId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

export function createSentry(options: SentryOptions): Sentry {
  const parsed = options.dsn === undefined ? null : parseDsn(options.dsn);
  if (parsed === null) return noop;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 2_000;

  return {
    enabled: true,
    async captureException(error, context) {
      const id = eventId();
      const at = now();
      const err =
        error instanceof Error
          ? error
          : new Error(typeof error === 'string' ? error : 'non_error_thrown');
      const tags: Record<string, string> = { fn: context.fn };
      if (context.correlationId !== undefined) tags.correlation_id = context.correlationId;
      if (context.code !== undefined) tags.code = context.code;
      if (context.jobId !== undefined) tags.job_id = context.jobId;
      if (context.route !== undefined) tags.route = context.route;
      const event = {
        event_id: id,
        timestamp: at.getTime() / 1000,
        platform: 'javascript',
        level: 'error',
        logger: context.fn,
        environment: options.environment,
        ...(options.release === undefined ? {} : { release: options.release }),
        tags,
        exception: {
          values: [
            {
              type: err.name,
              value: scrubString(err.message),
              stacktrace: { frames: parseStack(err.stack) },
            },
          ],
        },
      };
      const envelope = [
        JSON.stringify({ event_id: id, sent_at: at.toISOString(), dsn: parsed.dsn }),
        JSON.stringify({ type: 'event' }),
        JSON.stringify(event),
      ].join('\n');
      try {
        const response = await doFetch(parsed.envelopeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-sentry-envelope',
            'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=da-edge/1.0`,
          },
          body: envelope,
          signal: AbortSignal.timeout(timeoutMs),
        });
        await response.body?.cancel();
      } catch {
        // Reporting must never break the request; the structured log already carries the error.
      }
    },
  };
}
