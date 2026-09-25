/**
 * Helpers for the per-route cases of the table-driven route test (`routes.test.ts`): the case
 * shape, fixture constants and small accessors over the recorded calls.
 */
import type { AdminRouteKey } from '@da/validation';
import type { RecordedCall } from '../../_shared/testing/fetch.ts';
import type { Harness, SqlHandler, TableHandler } from './harness.ts';

export interface RouteCase {
  readonly sql?: Readonly<Record<string, SqlHandler>>;
  readonly tables?: Readonly<Record<string, TableHandler>>;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly outbound?: (call: RecordedCall) => Response | null;
  /** Replaces parts of the fixture's valid request. */
  readonly request?: {
    readonly params?: Record<string, unknown>;
    readonly query?: Record<string, unknown>;
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
  };
  /** SQL functions the success path must call. */
  readonly calls?: readonly string[];
  readonly expect?: (
    h: Harness,
    body: { data: unknown; meta: Record<string, unknown> },
  ) => void | Promise<void>;
}

export type Cases = Partial<Record<AdminRouteKey, RouteCase>>;

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const TS = '2026-09-24T08:00:00Z';
export const LATER = '2026-09-24T09:30:00Z';
export const REASON = 'Kullanıcı talebi üzerine inceleme yapıldı.';

/** Arguments of the first call of `fn`. */
export function argsOf(h: Harness, fn: string): Record<string, unknown> | undefined {
  return h.rpc.find((r) => r.fn === fn)?.args;
}

/** Every recorded call of `fn`. */
export function callsOf(h: Harness, fn: string): Record<string, unknown>[] {
  return h.rpc.filter((r) => r.fn === fn).map((r) => r.args);
}

export function data<T = Record<string, unknown>>(body: { data: unknown }): T {
  return body.data as T;
}

export function rows<T = Record<string, unknown>>(body: { data: unknown }): T[] {
  return body.data as T[];
}

/** `private.audit_row_json` of one row (bigint id). */
export function sqlAuditRow(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    chain_seq: 1042,
    ts: TS,
    actor_type: 'admin',
    actor: { id: uuid(100), display_name: null, email_masked: 'op***@dijitalasistan.app' },
    role: 'operations',
    action: 'job.retried',
    target_type: 'job',
    target_id: uuid(70),
    target_user: { id: uuid(2), email_masked: 'yu***@gmail.com', display_name_masked: 'Y***' },
    reason: REASON,
    result: 'success',
    correlation_id: '77777777-7777-4777-8777-777777777777',
    metadata: { job_type: 'gmail_sync' },
    prev_hash: 'a'.repeat(64),
    hash: 'b'.repeat(64),
    ...extra,
  };
}

/** `{rows,total,page,page_size}` of a list function. */
export function sqlPage(list: unknown[], total = list.length, page = 1, pageSize = 25) {
  return { rows: list, total, page, page_size: pageSize };
}

/** Outbound requests to the Auth admin API. */
export function authCalls(h: Harness): string[] {
  return h.calls
    .filter((c) => c.url.includes('/auth/v1/'))
    .map(
      (c) =>
        `${c.method} ${new URL(c.url).pathname.replace('/auth/v1', '')}${new URL(c.url).search}`,
    );
}

export function pokes(h: Harness): string[] {
  return h.calls
    .filter((c) => c.url.endsWith('/functions/v1/worker/run'))
    .map((c) => c.headers.get('x-da-reason') ?? '');
}
