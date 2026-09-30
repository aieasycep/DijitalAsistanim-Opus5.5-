/**
 * A PostgREST double for the Supabase adapters: a real supabase-js client (`testDb`) over a
 * stubbed `fetch`, with every request decoded into table/RPC, filters, `select=` columns, body and
 * `Prefer`, so a test can assert the exact request and feed back rows or a Postgres error.
 */
import type { DbClient } from '../db/clients.ts';
import { testDb } from './db.ts';
import { stubFetch } from './fetch.ts';

export interface PgRequest {
  readonly method: string;
  /** `email_messages`, or `rpc/<name>` for a function call. */
  readonly path: string;
  /** The function name for `POST /rest/v1/rpc/<name>`, else null. */
  readonly rpc: string | null;
  readonly select: string | null;
  /** Every query parameter except `select` (filters, `order`, `limit`, `on_conflict`, …). */
  readonly params: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly prefer: string;
  readonly accept: string;
  /** `Accept-Profile` / `Content-Profile` (the exposed schema). */
  readonly profile: string | null;
  readonly url: string;
}

/** A reply: rows or a value (sent as JSON), a ready `Response`, or `undefined` (empty 204). */
export type PgReply = unknown;
export type PgHandler = (req: PgRequest) => PgReply | Promise<PgReply>;

/** A Postgres/PostgREST error body (`code`, `message`) with its HTTP status. */
export function pgError(code: string, message: string = code, status = 400): Response {
  return new Response(JSON.stringify({ code, message, details: null, hint: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** An exact-count reply (`Prefer: count=exact`, usually with `head: true`). */
export function pgCount(count: number, rows: readonly unknown[] = []): Response {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Range': `${rows.length === 0 ? '*' : `0-${String(rows.length - 1)}`}/${String(count)}`,
    },
  });
}

function decode(call: { url: string; method: string; headers: Headers; body: string | null }) {
  const url = new URL(call.url);
  const path = url.pathname.replace(/^\/rest\/v1\//, '');
  const params: Record<string, string> = {};
  for (const [k, v] of url.searchParams) {
    if (k === 'select') continue;
    params[k] = params[k] === undefined ? v : `${params[k]}&${v}`;
  }
  let body: unknown = null;
  if (call.body !== null && call.body !== '') {
    try {
      body = JSON.parse(call.body);
    } catch {
      body = call.body;
    }
  }
  const req: PgRequest = {
    method: call.method,
    path,
    rpc: path.startsWith('rpc/') ? path.slice(4) : null,
    select: url.searchParams.get('select'),
    params,
    body,
    prefer: call.headers.get('Prefer') ?? '',
    accept: call.headers.get('Accept') ?? '',
    profile: call.headers.get('Content-Profile') ?? call.headers.get('Accept-Profile'),
    url: call.url,
  };
  return req;
}

async function respond(req: PgRequest, reply: PgReply): Promise<Response> {
  const value = await reply;
  if (value instanceof Response) return value;
  if (value === undefined) return new Response(null, { status: 204 });
  if (req.accept.includes('vnd.pgrst.object+json') && Array.isArray(value)) {
    if (value.length !== 1)
      return pgError('PGRST116', 'JSON object requested, multiple (or no) rows returned', 406);
    return Response.json(value[0]);
  }
  return Response.json(value);
}

export interface PgStub {
  readonly db: DbClient;
  readonly fetch: typeof fetch;
  readonly calls: PgRequest[];
  /** Calls to `path` (optionally with `method`). */
  to(path: string, method?: string): PgRequest[];
}

/**
 * `handler` answers every request; a route map `{'GET email_messages': rows | (req) => reply}`
 * matches `"<METHOD> <path>"` first, then `"<path>"`. An unmatched request answers a 500 with
 * `code: 'UNMATCHED'`, which the adapters surface as an error.
 */
export function postgrest(
  routes: PgHandler | Readonly<Record<string, PgReply | PgHandler>>,
): PgStub {
  const calls: PgRequest[] = [];
  const handler: PgHandler =
    typeof routes === 'function'
      ? routes
      : (req) => {
          const key = [`${req.method} ${req.path}`, req.path].find((k) => Object.hasOwn(routes, k));
          if (key === undefined) return pgError('UNMATCHED', `${req.method} ${req.path}`, 500);
          const hit = routes[key];
          if (typeof hit === 'function') return (hit as PgHandler)(req);
          return hit instanceof Response ? hit.clone() : structuredClone(hit);
        };
  const stub = stubFetch(async (call) => {
    const req = decode(call);
    calls.push(req);
    return await respond(req, handler(req));
  });
  return {
    db: testDb(stub.fetch),
    fetch: stub.fetch,
    calls,
    to: (path, method) =>
      calls.filter((c) => c.path === path && (method === undefined || c.method === method)),
  };
}
