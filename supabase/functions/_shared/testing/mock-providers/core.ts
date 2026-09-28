/**
 * Mock provider server core (TEST_PLAN §6.1): request recording, scripted responses and fixtures.
 *
 * - Every request is recorded (`GET /__requests`): method, path, query, lower-cased headers, the
 *   decoded body (gzip request bodies are inflated), the answered status and whether a script
 *   answered it.
 * - `POST /__script {route, responses}` queues responses for a route key `"<METHOD> <path>"`, where
 *   the path may end with `*` (prefix match) or contain `:param` segments. Each response is
 *   `{status, headers?, body?, fixture?, delay_ms?, times?, match?}` or `{passthrough: true, body?}`
 *   (let the emulator answer this call; emulators that build a provider envelope around scripted
 *   content, like the AI routes, read the entry's `body`). `match` restricts an entry to calls whose
 *   request body contains that substring. Queued responses are consumed in order; unmatched calls
 *   fall through to the provider emulators.
 * - `POST /__reset` clears the recordings, the scripts and every emulator state.
 */
import type { Context, Hono } from 'hono';

export type MockEnv = {
  Variables: { mockBody: string; mockScripted: ScriptedResponse | undefined };
};
type Ctx = Context<MockEnv>;

export interface RecordedRequest {
  readonly seq: number;
  readonly at: string;
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string | string[]>;
  readonly headers: Record<string, string>;
  readonly body: string;
  status: number;
  scripted: boolean;
}

export interface ScriptedResponse {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  /** `<provider>/<name>.json` under `../fixtures/`. */
  readonly fixture?: string;
  readonly delay_ms?: number;
  readonly times?: number;
  readonly passthrough?: boolean;
  /** Only calls whose request body contains this substring consume the entry. */
  readonly match?: string;
}

interface QueueItem {
  response: ScriptedResponse;
  remaining: number;
}

const FIXTURES = new URL('../fixtures/', import.meta.url);
const fixtureCache = new Map<string, unknown>();

/** A fixture file (parsed JSON, cached); throws on an unknown name. */
export function fixture<T = unknown>(name: string): T {
  if (!/^[a-z0-9_-]+\/[A-Za-z0-9_.-]+\.json$/.test(name)) throw new Error(`bad fixture: ${name}`);
  let value = fixtureCache.get(name);
  if (value === undefined) {
    value = JSON.parse(Deno.readTextFileSync(new URL(name, FIXTURES)));
    fixtureCache.set(name, value);
  }
  return structuredClone(value) as T;
}

function matches(pattern: string, method: string, path: string): boolean {
  const [pMethod, pPath] = pattern.split(' ', 2) as [string, string | undefined];
  if (pPath === undefined || (pMethod !== '*' && pMethod.toUpperCase() !== method)) return false;
  if (pPath.endsWith('*')) return path.startsWith(pPath.slice(0, -1));
  const a = pPath.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
}

export class MockState {
  requests: RecordedRequest[] = [];
  private seq = 0;
  private scripts: { route: string; queue: QueueItem[] }[] = [];
  private readonly resetters: (() => void)[] = [];
  /** Concurrency observed per route family (`graph`), for IT-SYNC-15. */
  inFlight = new Map<string, number>();
  maxInFlight = new Map<string, number>();

  onReset(fn: () => void): void {
    this.resetters.push(fn);
    fn();
  }

  reset(): void {
    this.requests = [];
    this.seq = 0;
    this.scripts = [];
    this.inFlight.clear();
    this.maxInFlight.clear();
    for (const fn of this.resetters) fn();
  }

  script(route: string, responses: readonly ScriptedResponse[]): void {
    this.scripts.push({
      route,
      queue: responses.map((response) => ({ response, remaining: response.times ?? 1 })),
    });
  }

  /** The next scripted response for this call, or null (emulator answers). */
  take(method: string, path: string, body = ''): ScriptedResponse | null {
    for (const entry of this.scripts) {
      if (!matches(entry.route, method, path)) continue;
      const head = entry.queue[0];
      if (head === undefined) continue;
      if (head.response.match !== undefined && !body.includes(head.response.match)) continue;
      head.remaining -= 1;
      if (head.remaining <= 0) entry.queue.shift();
      return head.response;
    }
    return null;
  }

  record(entry: Omit<RecordedRequest, 'seq' | 'at' | 'status' | 'scripted'>): RecordedRequest {
    const recorded: RecordedRequest = {
      ...entry,
      seq: ++this.seq,
      at: new Date().toISOString(),
      status: 0,
      scripted: false,
    };
    this.requests.push(recorded);
    return recorded;
  }

  enter(family: string): void {
    const now = (this.inFlight.get(family) ?? 0) + 1;
    this.inFlight.set(family, now);
    this.maxInFlight.set(family, Math.max(now, this.maxInFlight.get(family) ?? 0));
  }

  leave(family: string): void {
    this.inFlight.set(family, Math.max(0, (this.inFlight.get(family) ?? 1) - 1));
  }
}

async function readBody(req: Request): Promise<string> {
  if (req.body === null) return '';
  if ((req.headers.get('content-encoding') ?? '').toLowerCase() === 'gzip') {
    const stream = req.body.pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  return await req.text();
}

/** The decoded request body of the current call (recorded by the middleware). */
export function bodyOf(c: Ctx): string {
  return c.get('mockBody') ?? '';
}

export function jsonOf<T = Record<string, unknown>>(c: Ctx): T {
  const text = bodyOf(c);
  return (text === '' ? {} : JSON.parse(text)) as T;
}

export function formOf(c: Ctx): URLSearchParams {
  return new URLSearchParams(bodyOf(c));
}

function scriptedResponse(r: ScriptedResponse): Response {
  const body = r.fixture !== undefined ? fixture(r.fixture) : r.body;
  const headers = new Headers(r.headers ?? {});
  if (body === undefined || body === null)
    return new Response(null, { status: r.status ?? 200, headers });
  if (typeof body === 'string') return new Response(body, { status: r.status ?? 200, headers });
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { status: r.status ?? 200, headers });
}

/** Recording + script middleware and the control endpoints. */
export function mountCore(app: Hono<MockEnv>, state: MockState): void {
  app.get('/__health', (c) => c.json({ ok: true }));
  app.post('/__reset', (c) => {
    state.reset();
    return c.json({ ok: true });
  });
  app.post('/__script', async (c) => {
    const body = (await c.req.json()) as { route?: string; responses?: ScriptedResponse[] };
    if (typeof body.route !== 'string' || !Array.isArray(body.responses)) {
      return c.json({ error: 'route and responses are required' }, 400);
    }
    state.script(body.route, body.responses);
    return c.json({ ok: true });
  });
  app.get('/__requests', (c) => {
    const prefix = c.req.query('prefix') ?? '';
    return c.json({
      requests: state.requests.filter((r) => r.path.startsWith(prefix)),
      max_in_flight: Object.fromEntries(state.maxInFlight),
    });
  });
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    if (url.pathname.startsWith('/__')) return await next();
    const body = await readBody(c.req.raw);
    c.set('mockBody', body);
    const query: Record<string, string | string[]> = {};
    for (const key of new Set(url.searchParams.keys())) {
      const all = url.searchParams.getAll(key);
      query[key] = all.length === 1 ? (all[0] ?? '') : all;
    }
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const recorded = state.record({
      method: c.req.method,
      path: url.pathname,
      query,
      headers,
      body,
    });
    const family = url.pathname.split('/')[1] ?? '';
    state.enter(family);
    try {
      const scripted = state.take(c.req.method, url.pathname, body);
      if (scripted !== null && scripted.passthrough !== true) {
        if (scripted.delay_ms !== undefined)
          await new Promise((r) => setTimeout(r, scripted.delay_ms));
        recorded.scripted = true;
        const response = scriptedResponse(scripted);
        recorded.status = response.status;
        return response;
      }
      if (scripted?.passthrough === true) {
        c.set('mockScripted', scripted);
        if (scripted.delay_ms !== undefined)
          await new Promise((r) => setTimeout(r, scripted.delay_ms));
      }
      await next();
      recorded.status = c.res.status;
    } finally {
      state.leave(family);
    }
  });
}

/** Google-style JSON error body. */
export function googleError(status: number, reason: string, message: string) {
  return {
    error: {
      code: status,
      message,
      errors: [{ message, domain: 'global', reason }],
      status:
        status === 404
          ? 'NOT_FOUND'
          : status === 401
            ? 'UNAUTHENTICATED'
            : status === 403
              ? 'PERMISSION_DENIED'
              : status === 409
                ? 'ALREADY_EXISTS'
                : status === 412
                  ? 'FAILED_PRECONDITION'
                  : status === 429
                    ? 'RESOURCE_EXHAUSTED'
                    : 'UNAVAILABLE',
    },
  };
}

export function bearerOf(c: Ctx): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
  return match?.[1] ?? null;
}

export function b64url(bytes: Uint8Array | string): string {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let bin = '';
  for (const b of data) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

export async function sha256b64url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return b64url(new Uint8Array(digest));
}

export function randomId(prefix = ''): string {
  return `${prefix}${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
