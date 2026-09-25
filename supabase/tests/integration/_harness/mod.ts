/**
 * Integration-suite harness (TEST_PLAN §6; IMPLEMENTATION_PLAN T-12.01).
 *
 * - The function apps are the real entrypoints (`supabase/functions/<fn>/index.ts`), imported
 *   in-process with `Deno.serve` captured, so their production wiring (env schema, demo guard,
 *   service clients, provider registry, job queue) runs unchanged against `SUPABASE_URL` (the tier-C
 *   gateway over PostgREST, or the local Supabase stack in tier A). An env profile (for example
 *   `DEMO_MODE=true`) re-imports the entrypoint under a distinct specifier.
 * - The database is reached directly (`DA_IT_DB_URL`, a superuser) for fixtures and assertions.
 * - The mock provider server (`DA_IT_MOCK_URL`) is reset before every test.
 * - `it(id, name, fn, {needs})` names each test with its TEST_PLAN ID and tags (`needs:gotrue`,
 *   `needs:storage`); the tags in `DA_IT_SKIP_TAGS` are skipped (tier C).
 * - Function logs (JSON lines on `console.log`) are buffered and printed only when a test fails.
 */
import postgres from 'npm:postgres@3.4.7';
import { SignJWT } from 'jose';

// ── env ────────────────────────────────────────────────────────────────────────────────────
export function env(key: string): string {
  const value = Deno.env.get(key);
  if (value === undefined || value === '')
    throw new Error(`${key} is not set: run the suites through scripts/integration/run.ts`);
  return value;
}

export const MOCK_URL = () => env('DA_IT_MOCK_URL');
export const SUPABASE_URL = () => env('SUPABASE_URL');

const BASE_ENV: Record<string, string> = Deno.env.toObject();

// ── logs ───────────────────────────────────────────────────────────────────────────────────
const logBuffer: string[] = [];
const originalLog = console.log;
console.log = (...args: unknown[]) => {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  if (line.startsWith('{"ts":')) {
    logBuffer.push(line);
    if (logBuffer.length > 4000) logBuffer.splice(0, logBuffer.length - 4000);
    return;
  }
  originalLog(...args);
};

/** Function log records emitted since the test started (parsed JSON lines). */
export function logs(): Record<string, unknown>[] {
  return logBuffer.map((line) => JSON.parse(line) as Record<string, unknown>);
}

// ── database ───────────────────────────────────────────────────────────────────────────────
let client: ReturnType<typeof postgres> | null = null;

export function db(): ReturnType<typeof postgres> {
  client ??= postgres(env('DA_IT_DB_URL'), {
    max: 4,
    onnotice: () => {},
    idle_timeout: 5,
    prepare: false,
  });
  return client;
}

/** Rows of a parameterised query (`$1`, `$2`, …). */
export async function q<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await db().unsafe(text, params as never[])) as unknown as T[];
}

export async function one<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T> {
  const rows = await q<T>(text, params);
  if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}: ${text}`);
  return rows[0] as T;
}

export async function count(text: string, params: unknown[] = []): Promise<number> {
  const rows = await q<{ n: string | number }>(`select count(*) as n from (${text}) x`, params);
  return Number(rows[0]?.n ?? 0);
}

// ── mock providers ─────────────────────────────────────────────────────────────────────────
export interface MockRequest {
  seq: number;
  method: string;
  path: string;
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
  body: string;
  status: number;
  scripted: boolean;
}

async function mockPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${MOCK_URL()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`mock ${path} → ${res.status} ${text}`);
  return (text === '' ? {} : JSON.parse(text)) as T;
}

export const mock = {
  reset: () => mockPost('/__reset', {}),
  script: (
    route: string,
    responses: {
      status?: number;
      headers?: Record<string, string>;
      body?: unknown;
      fixture?: string;
      delay_ms?: number;
      times?: number;
      passthrough?: boolean;
    }[],
  ) => mockPost('/__script', { route, responses }),
  async requests(prefix = ''): Promise<MockRequest[]> {
    const res = await fetch(`${MOCK_URL()}/__requests?prefix=${encodeURIComponent(prefix)}`);
    return ((await res.json()) as { requests: MockRequest[] }).requests;
  },
  async maxInFlight(): Promise<Record<string, number>> {
    const res = await fetch(`${MOCK_URL()}/__requests?prefix=/none`);
    return ((await res.json()) as { max_in_flight: Record<string, number> }).max_in_flight;
  },
  google: <T = unknown>(body: Record<string, unknown>) => mockPost<T>('/__google', body),
  graph: <T = unknown>(body: Record<string, unknown>) => mockPost<T>('/__graph', body),
  apple: <T = unknown>(body: Record<string, unknown> = {}) => mockPost<T>('/__apple', body),
  revenuecat: <T = unknown>(body: Record<string, unknown>) => mockPost<T>('/__revenuecat', body),
  expo: <T = unknown>(body: Record<string, unknown>) => mockPost<T>('/__expo', body),
};

// ── function apps ──────────────────────────────────────────────────────────────────────────
export type FunctionName =
  | 'api'
  | 'oauth'
  | 'worker'
  | 'webhooks-google'
  | 'webhooks-microsoft'
  | 'webhooks-revenuecat'
  | 'admin-api'
  | 'public-api'
  | 'health';

type Handler = (req: Request, info: Deno.ServeHandlerInfo) => Response | Promise<Response>;
const loaded = new Map<string, Promise<Handler>>();
const FUNCTIONS = new URL('../../../functions/', import.meta.url);

/** Loads a function entrypoint with `overrides` applied to the env while it initialises. */
export async function fn(name: FunctionName, overrides: Record<string, string | undefined> = {}) {
  const profile = JSON.stringify(Object.entries(overrides).sort());
  const key = `${name}:${profile}`;
  let pending = loaded.get(key);
  if (pending === undefined) {
    pending = load(name, overrides, loaded.size);
    loaded.set(key, pending);
  }
  const h = await pending;
  return {
    fetch: (req: Request) =>
      Promise.resolve(
        h(req, {
          remoteAddr: { transport: 'tcp', hostname: '127.0.0.1', port: 50000 },
          completed: Promise.resolve(),
        } as Deno.ServeHandlerInfo),
      ),
  };
}

/** Imports one entrypoint under a unique specifier with `Deno.serve` captured (serialised: env). */
let loading: Promise<unknown> = Promise.resolve();
function load(
  name: FunctionName,
  overrides: Record<string, string | undefined>,
  index: number,
): Promise<Handler> {
  const next = loading.then(async () => {
    const serve = Deno.serve;
    let captured: Handler | null = null;
    const applied: [string, string | undefined][] = [];
    for (const [k, v] of Object.entries(overrides)) {
      applied.push([k, Deno.env.get(k)]);
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
    (Deno as { serve: unknown }).serve = (arg1: unknown, arg2?: unknown) => {
      captured = (typeof arg1 === 'function' ? arg1 : arg2) as Handler;
      return {
        finished: Promise.resolve(),
        shutdown: () => Promise.resolve(),
        ref() {},
        unref() {},
      };
    };
    try {
      const url = new URL(`${name}/index.ts`, FUNCTIONS);
      url.searchParams.set('profile', String(index));
      await import(url.href);
    } finally {
      (Deno as { serve: unknown }).serve = serve;
      for (const [k, v] of applied) {
        if (v === undefined) Deno.env.delete(k);
        else Deno.env.set(k, v);
      }
    }
    if (captured === null) throw new Error(`${name}/index.ts did not call Deno.serve`);
    return captured as Handler;
  });
  loading = next.catch(() => undefined);
  return next;
}

export interface CallOptions {
  jwt?: string | null;
  body?: unknown;
  rawBody?: string;
  key?: string | null;
  headers?: Record<string, string>;
  overrides?: Record<string, string | undefined>;
}

/** A request to `/<fn><path>` through the loaded app (`fetch` semantics, no redirects followed). */
export async function call(
  name: FunctionName,
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  const app = await fn(name, options.overrides);
  const headers: Record<string, string> = {
    'X-DA-Client': 'ios/1.4.0 (812)',
    'Accept-Language': 'tr-TR',
    ...options.headers,
  };
  if (options.jwt !== undefined && options.jwt !== null)
    headers.Authorization = `Bearer ${options.jwt}`;
  if (options.key !== undefined && options.key !== null) headers['Idempotency-Key'] = options.key;
  let body: string | undefined;
  if (options.rawBody !== undefined) body = options.rawBody;
  else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['Content-Type'] ??= 'application/json';
  }
  return await app.fetch(
    new Request(`${SUPABASE_URL()}/${name}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: 'manual',
    }),
  );
}

export async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`expected JSON (${res.status}): ${text.slice(0, 300)}`);
  }
}

/** Drains the queue through `POST /worker/run` (types optional) until nothing is claimable. */
export async function drain(
  options: {
    types?: string[];
    rounds?: number;
    overrides?: Record<string, string | undefined>;
  } = {},
): Promise<{
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
  dead_lettered: number;
}> {
  const total = { claimed: 0, completed: 0, retried: 0, failed: 0, dead_lettered: 0 };
  for (let round = 0; round < (options.rounds ?? 8); round++) {
    const res = await call('worker', 'POST', '/run', {
      headers: { apikey: env('CRON_SECRET') },
      body: {
        max_jobs: 50,
        budget_ms: 60000,
        ...(options.types === undefined ? {} : { types: options.types }),
      },
      ...(options.overrides === undefined ? {} : { overrides: options.overrides }),
    });
    const out = await json<{ data: typeof total }>(res);
    if (res.status !== 200) throw new Error(`worker run → ${res.status} ${JSON.stringify(out)}`);
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += out.data[k];
    if (out.data.claimed === 0) break;
  }
  return total;
}

/** Makes every queued / retrying job claimable now (the tests own the clock of the queue). */
export async function releaseJobs(where = 'true'): Promise<void> {
  await q(
    `update public.jobs set run_after = now() - interval '1 second' where status in ('queued','retrying') and (${where})`,
  );
}

// ── users and tokens ───────────────────────────────────────────────────────────────────────
let authColumns: Set<string> | null = null;

export interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly sessionId: string;
  readonly jwt: string;
  token(extra?: Record<string, unknown>): Promise<string>;
}

export async function mintUserToken(
  userId: string,
  sessionId: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const secret = new TextEncoder().encode(env('DA_IT_JWT_SECRET'));
  const iat = Math.floor(Date.now() / 1000) - 5;
  return await new SignJWT({
    role: 'authenticated',
    aal: 'aal1',
    session_id: sessionId,
    email: `${userId.slice(0, 8)}@example.com`,
    app_metadata: { provider: 'apple', providers: ['apple'] },
    user_metadata: {},
    is_anonymous: false,
    ...extra,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(`${SUPABASE_URL()}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(secret);
}

/** A new end user (auth.users row → profile, preferences, referral code) with a session and JWT. */
export async function createUser(
  options: { timezone?: string; email?: string; pro?: boolean; appleSub?: string } = {},
): Promise<TestUser> {
  const id = crypto.randomUUID();
  const email = options.email ?? `it-${id.slice(0, 8)}@example.com`;
  authColumns ??= new Set(
    (
      await q<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema='auth' and table_name='users'`,
      )
    ).map((r) => r.column_name),
  );
  const cols: Record<string, unknown> = {
    id,
    email,
    aud: 'authenticated',
    role: 'authenticated',
    email_confirmed_at: new Date().toISOString(),
    last_sign_in_at: new Date().toISOString(),
    raw_app_meta_data: JSON.stringify({ provider: 'apple', providers: ['apple'] }),
    raw_user_meta_data: JSON.stringify({ timezone: options.timezone ?? 'Europe/Istanbul' }),
  };
  // Real GoTrue (tier A) scans these as non-null strings.
  for (const c of [
    'instance_id',
    'encrypted_password',
    'confirmation_token',
    'recovery_token',
    'email_change_token_new',
    'email_change',
  ]) {
    if (authColumns.has(c))
      cols[c] = c === 'instance_id' ? '00000000-0000-0000-0000-000000000000' : '';
  }
  const names = Object.keys(cols);
  await q(
    `insert into auth.users (${names.join(',')}) values (${names.map((n, i) => (n.startsWith('raw_') ? `$${i + 1}::text::jsonb` : `$${i + 1}`)).join(',')})`,
    Object.values(cols),
  );
  const sessionId = crypto.randomUUID();
  await q(
    `insert into auth.sessions (id, user_id, aal, created_at, updated_at) values ($1, $2, 'aal1', now(), now())`,
    [sessionId, id],
  );
  if (options.appleSub !== undefined) {
    await q(
      `insert into auth.identities (id, user_id, provider, provider_id, identity_data, created_at, updated_at)
       values (gen_random_uuid(), $1, 'apple', $2, $3::text::jsonb, now(), now())`,
      [id, options.appleSub, JSON.stringify({ sub: options.appleSub, email })],
    );
  }
  if (options.pro === true) await makePro(id);
  const jwt = await mintUserToken(id, sessionId, { email });
  return {
    id,
    email,
    sessionId,
    jwt,
    token: (extra) => mintUserToken(id, sessionId, { email, ...(extra ?? {}) }),
  };
}

/** An active production Pro store subscription mirror row. */
export async function makePro(userId: string, until = "now() + interval '30 days'"): Promise<void> {
  await q(
    `insert into public.subscriptions (user_id, rc_app_user_id, is_active, status, store, environment, product_id,
       period_type, purchased_at, expires_at, will_renew, synced_at)
     values ($1::uuid, $1::text, true, 'active', 'app_store', 'production', 'da_pro_annual:annual', 'normal', now(), ${until}, true, now())
     on conflict (user_id, entitlement) do update set is_active = true, status = 'active', expires_at = ${until}`,
    [userId],
  );
}

/**
 * A fresh Google / Microsoft identity on the mock: an identity already linked by another user makes a
 * connect answer `already_linked` (called before every test and before a second user connects).
 */
export async function freshIdentities(): Promise<void> {
  const tag = crypto.randomUUID().replace(/-/g, '');
  await mock.google({
    op: 'identity',
    identity: {
      sub: `1${BigInt(`0x${tag.slice(0, 15)}`)
        .toString()
        .padStart(20, '0')}`,
      email: `yunus.${tag.slice(0, 8)}@example.com`,
    },
  });
  await mock.graph({
    op: 'identity',
    identity: {
      oid: `00000000-0000-0000-${tag.slice(0, 4)}-${tag.slice(4, 16)}`,
      mail: `yunus.${tag.slice(0, 8)}@kuzeylojistik.example`,
    },
  });
}

/**
 * Runs `sqlText` as a backoffice admin, the way `admin-api` reaches `admin_api` functions: the
 * gateway header (`ADMIN_GATEWAY_SECRET`, whose SHA-256 is `app_settings.admin.gateway_secret_sha256`),
 * an aal2 admin identity with an active `admin_users` row and a live admin session.
 */
export async function asAdmin<T = Record<string, unknown>>(
  role: string,
  sqlText: string,
  params: unknown[] = [],
): Promise<T[]> {
  const id = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const email = `ops-${id.slice(0, 8)}@admin.example.com`;
  const secret = env('ADMIN_GATEWAY_SECRET');
  return (await db().begin(async (tx) => {
    await tx.unsafe(
      `insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, '{"provider":"email","da_kind":"admin"}'::jsonb)`,
      [id, email],
    );
    await tx.unsafe(
      `insert into public.admin_users (user_id, role, status, display_name, email, activated_at)
       values ($1, $2::public.admin_role, 'active', 'Operasyon', $3, now())`,
      [id, role, email],
    );
    await tx.unsafe(
      `insert into public.admin_sessions (admin_user_id, auth_session_id, aal, idle_expires_at, absolute_expires_at)
       values ($1, $2, 'aal2', now() + interval '30 minutes', now() + interval '12 hours')`,
      [id, sid],
    );
    await tx.unsafe(
      `insert into public.app_settings (key, value, description, updated_at)
       values ('admin.gateway_secret_sha256', to_jsonb(encode(sha256(convert_to($1, 'UTF8')), 'hex')), 'integration gateway', now())
       on conflict (key) do update set value = excluded.value`,
      [secret],
    );
    await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({
        sub: id,
        role: 'authenticated',
        aal: 'aal2',
        session_id: sid,
        app_metadata: { da_kind: 'admin' },
      }),
    ]);
    await tx.unsafe(`select set_config('request.headers', $1, true)`, [
      JSON.stringify({ 'x-da-admin-gateway': secret }),
    ]);
    return await tx.unsafe(sqlText, params as never[]);
  })) as unknown as T[];
}

// ── test wrapper ───────────────────────────────────────────────────────────────────────────
const SKIP = new Set(
  (Deno.env.get('DA_IT_SKIP_TAGS') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== ''),
);

export interface ItOptions {
  readonly needs?: readonly ('gotrue' | 'storage')[];
}

/** One TEST_PLAN integration case: `IT-<AREA>-<NN> <name> [needs:…]`. */
export function it(
  id: string,
  name: string,
  body: () => Promise<void>,
  options: ItOptions = {},
): void {
  const tags = (options.needs ?? []).map((n) => `needs:${n}`);
  const title = `${id} ${name}${tags.length === 0 ? '' : ` [${tags.join(' ')}]`}`;
  Deno.test({
    name: title,
    ignore: tags.some((t) => SKIP.has(t)),
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      logBuffer.length = 0;
      await mock.reset();
      await freshIdentities();
      await q(`delete from public.jobs`);
      try {
        await body();
      } catch (error) {
        const tail = logBuffer.slice(-60).join('\n');
        if (tail !== '') originalLog(`--- function logs (last 60) ---\n${tail}`);
        throw error;
      }
    },
  });
}

export { BASE_ENV };
