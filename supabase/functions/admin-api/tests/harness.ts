/**
 * Test harness for `admin-api` (TEST_PLAN EF-ADM-01): the real app and pipeline over a stubbed
 * `fetch`. PostgREST RPCs are answered by SQL-shaped stubs keyed by function name (guard failures
 * are raised as the SQL guard raises them), the Auth admin API, table selects, the worker poke and
 * the `health` run are recorded; any other URL fails the test. Tests never reach the network.
 */
import {
  admin as adminSchemas,
  type AdminRouteContract,
  type AdminRouteKey,
  adminRoutes,
} from '@da/validation';
import { createAiProviders } from '../../_shared/ai/providers/index.ts';
import { loadKeyring } from '../../_shared/crypto/token-cipher.ts';
import { memoryIdempotencyRepo } from '../../_shared/idempotency.ts';
import { createLogger, memorySink } from '../../_shared/logging/logger.ts';
import type { RateLimitStore } from '../../_shared/ratelimit.ts';
import { randomBase64, TEST_SUPABASE_URL, testEnv } from '../../_shared/testing/env.ts';
import { jsonResponse, type RecordedCall, stubFetch } from '../../_shared/testing/fetch.ts';
import { testDb } from '../../_shared/testing/db.ts';
import {
  ADMIN_ID,
  createTestIssuer,
  type TestIssuer,
  userClaims,
} from '../../_shared/testing/jwt.ts';
import { createAdminApi } from '../app.ts';
import { adminEnvFrom, type AdminRuntime } from '../lib/runtime.ts';

export { ADMIN_ID };
export const BFF = 'bff-key-for-admin-api-tests-0001';
export const GATEWAY = 'gateway-key-for-admin-api-tests-01';
export const NOW = Date.parse('2026-09-24T10:00:00Z');
export const SESSION_ID = '44444444-4444-4444-8444-444444444444';
export const FACTOR_ID = '55555555-5555-4555-8555-555555555555';
export const NEW_AUTH_USER = '66666666-6666-4666-8666-666666666666';

/** A PostgREST error raised by a stub (`code` = SQLSTATE). */
export class SqlError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail: string | null = null,
  ) {
    super(message);
  }
}

export interface RpcCall {
  readonly schema: string;
  readonly fn: string;
  readonly args: Record<string, unknown>;
  readonly headers: Headers;
}

export type SqlHandler = (args: Record<string, unknown>, call: RpcCall) => unknown;
export type TableHandler = (call: RecordedCall) => unknown;

export interface HarnessOptions {
  /** Stubbed SQL functions (both `admin_api` and service-role `public`). */
  readonly sql?: Readonly<Record<string, SqlHandler>>;
  /** Stubbed table selects (`/rest/v1/<table>`), rows array. */
  readonly tables?: Readonly<Record<string, TableHandler>>;
  /** Environment overrides (`undefined` removes a key). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Permissions returned by `admin_me` (default: every permission). */
  readonly permissions?: readonly string[];
  /** `step_up_valid_until` of the session (default: now + 5 min; `null` = none). */
  readonly stepUpUntil?: string | null;
  /** `recovery_codes_remaining` of the admin (default 8). */
  readonly recoveryCodesRemaining?: number;
  /** Rate-limit decision (default: allowed). */
  readonly rateAllowed?: boolean;
  /** Checked before the built-in stubs (return `null` to fall through). */
  readonly outbound?: (call: RecordedCall) => Response | null;
}

export interface Harness {
  readonly app: ReturnType<typeof createAdminApi>['app'];
  readonly issuer: TestIssuer;
  readonly runtime: AdminRuntime;
  readonly calls: RecordedCall[];
  readonly rpc: RpcCall[];
  readonly missing: string[];
  readonly rateKeys: string[];
  readonly logs: () => Record<string, unknown>[];
  /** An aal2 admin JWT (or aal1 with `aal: 'aal1'`). */
  token(extra?: Record<string, unknown>): Promise<string>;
  /** `/admin-api<path>` with the BFF key and, unless `auth: false`, an aal2 admin JWT. */
  request(
    method: string,
    path: string,
    init?: {
      body?: unknown;
      rawBody?: string;
      headers?: Record<string, string>;
      auth?: boolean | string;
      bff?: boolean;
    },
  ): Promise<Response>;
  rpcNames(): string[];
}

/** Every backoffice permission (the super_admin set). */
export const ALL_PERMISSIONS: readonly string[] = [...adminSchemas.ADMIN_PERMISSION_VALUES];

export function adminMe(options: {
  permissions: readonly string[];
  stepUpUntil: string | null;
  recoveryCodesRemaining: number;
}) {
  return {
    admin: {
      id: ADMIN_ID,
      email: 'ops@dijitalasistan.app',
      display_name: 'Ops',
      role: 'super_admin',
      status: 'active',
      mfa_enrolled: true,
      mfa_factor_count: 1,
      recovery_codes_remaining: options.recoveryCodesRemaining,
    },
    permissions: options.permissions,
    session: {
      id: SESSION_ID,
      idle_expires_at: '2026-09-24T10:30:00Z',
      absolute_expires_at: '2026-09-24T21:00:00Z',
      step_up_valid_until: options.stepUpUntil,
    },
    preferences: {
      theme: 'system',
      locale: 'tr-TR',
      timezone: 'Europe/Istanbul',
      density: 'comfortable',
      table_prefs: {},
      dashboard_range: '7d',
      recent_items: [],
      sidebar_collapsed: false,
    },
  };
}

function sqlErrorResponse(error: SqlError): Response {
  return jsonResponse(
    { code: error.code, message: error.message, details: error.detail, hint: null },
    error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 400,
  );
}

function memoryRateLimits(keys: string[], allowed: () => boolean): RateLimitStore {
  const counts = new Map<string, number>();
  return {
    hit(key) {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return Promise.resolve({ allowed: allowed(), count: n });
    },
  };
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const issuer = await createTestIssuer();
  const rpc: RpcCall[] = [];
  const missing: string[] = [];
  const rateKeys: string[] = [];
  const sink = memorySink();
  const permissions = options.permissions ?? ALL_PERMISSIONS;
  const stepUpUntil =
    options.stepUpUntil === undefined
      ? new Date(NOW + 5 * 60_000).toISOString()
      : options.stepUpUntil;
  const defaults: Record<string, SqlHandler> = {
    admin_me: () =>
      adminMe({
        permissions,
        stepUpUntil,
        recoveryCodesRemaining: options.recoveryCodesRemaining ?? 8,
      }),
    audit_denied: () => null,
    audit_write: () => 1,
    authorize: () => null,
    session_expire: () => ({ ended: true, end_reason: 'idle' }),
    enqueue_job: () => '00000000-0000-4000-8000-000000000070',
    audit_log_append: () => 1,
  };
  const sql = { ...defaults, ...(options.sql ?? {}) };
  const tables = options.tables ?? {};

  const stub = stubFetch(async (call) => {
    const override = options.outbound?.(call) ?? null;
    if (override !== null) return override;
    const url = new URL(call.url);
    if (url.origin === TEST_SUPABASE_URL) {
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const fn = decodeURIComponent(url.pathname.slice('/rest/v1/rpc/'.length));
        const schema =
          call.headers.get('content-profile') ?? call.headers.get('accept-profile') ?? 'public';
        const args =
          call.body === null || call.body === ''
            ? {}
            : (JSON.parse(call.body) as Record<string, unknown>);
        const entry: RpcCall = { schema, fn, args, headers: call.headers };
        rpc.push(entry);
        const handler = sql[fn];
        if (handler === undefined) {
          missing.push(fn);
          return jsonResponse(
            { code: 'PGRST202', message: `stub missing for ${fn}`, details: null },
            404,
          );
        }
        try {
          const out = await handler(args, entry);
          return jsonResponse(out === undefined ? null : out);
        } catch (error) {
          if (error instanceof SqlError) return sqlErrorResponse(error);
          throw error;
        }
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.slice('/rest/v1/'.length);
        const handler = tables[table];
        const rows = handler === undefined ? [] : handler(call);
        const accept = call.headers.get('accept') ?? '';
        if (accept.includes('vnd.pgrst.object')) {
          const list = Array.isArray(rows) ? rows : [rows];
          return list.length === 0
            ? jsonResponse({ code: 'PGRST116', message: 'no rows', details: null }, 406)
            : jsonResponse(list[0]);
        }
        return jsonResponse(rows);
      }
      if (url.pathname.startsWith('/auth/v1/')) {
        const path = url.pathname.slice('/auth/v1'.length);
        if (path === '/logout') return new Response(null, { status: 204 });
        if (path === '/admin/users' && call.method === 'POST') {
          const body = JSON.parse(call.body ?? '{}') as { email?: string };
          return jsonResponse({ id: NEW_AUTH_USER, email: body.email ?? null, app_metadata: {} });
        }
        if (/\/factors$/.test(path) && call.method === 'GET') {
          return jsonResponse([{ id: FACTOR_ID, factor_type: 'totp', status: 'verified' }]);
        }
        if (/\/factors\/[0-9a-f-]+$/.test(path) && call.method === 'DELETE') {
          return jsonResponse({ id: FACTOR_ID });
        }
        if (/^\/admin\/users\/[0-9a-f-]+$/.test(path)) {
          return jsonResponse({ id: path.split('/').at(-1), app_metadata: {} });
        }
      }
      if (url.pathname === '/functions/v1/worker/run') return jsonResponse({ ok: true });
    }
    throw new Error(`unexpected outbound call in test: ${call.method} ${call.url}`);
  });

  const raw = testEnv({
    ADMIN_BFF_SECRET: BFF,
    ADMIN_GATEWAY_SECRET: GATEWAY,
    ADMIN_ORIGIN: 'https://admin.dijitalasistan.app',
    PII_LOOKUP_PEPPER: randomBase64(32),
    RECOVERY_CODE_PEPPER: randomBase64(32),
    EMAIL_PROVIDER: 'postmark',
    EMAIL_API_KEY: 'postmark-server-token-for-tests',
    EMAIL_FROM_ADDRESS: 'destek@mail.dijitalasistan.app',
    AI_FIXTURE_PROVIDER_ENABLED: 'true',
    ...(options.env ?? {}),
  });
  const config = {
    url: TEST_SUPABASE_URL,
    publishableKey: 'sb_publishable_testkey',
    secretKey: 'test-secret-key',
    fetch: stub.fetch,
  };
  const encKey = raw.TOKEN_ENC_KEY_V1 ?? randomBase64(32);
  const runtime: AdminRuntime = {
    env: adminEnvFrom(raw, 'development'),
    config,
    system: testDb(stub.fetch),
    verifier: issuer.verifier,
    idempotency: memoryIdempotencyRepo(),
    rateLimits: memoryRateLimits(rateKeys, () => options.rateAllowed ?? true),
    fetch: stub.fetch,
    ai: createAiProviders(raw, { fetch: stub.fetch }),
    keyring: () =>
      loadKeyring({ token_encryption_keys: { 1: encKey }, TOKEN_ENC_ACTIVE_VERSION: 1 }),
    now: () => NOW,
  };
  const { app } = createAdminApi({
    auth: {
      verifier: issuer.verifier,
      gate: { authorize: () => Promise.resolve() },
      bffSecret: BFF,
    },
    log: createLogger({ fn: 'admin-api', sink: sink.sink }),
    runtime,
  });

  const token = (extra: Record<string, unknown> = {}) =>
    issuer.sign(
      userClaims(ADMIN_ID, {
        aal: 'aal2',
        session_id: SESSION_ID,
        app_metadata: { da_kind: 'admin' },
        admin_role: 'super_admin',
        ...extra,
      }),
    );

  return {
    app,
    issuer,
    runtime,
    calls: stub.calls,
    rpc,
    missing,
    rateKeys,
    logs: sink.records,
    token,
    async request(method, path, init = {}) {
      const headers: Record<string, string> = { ...(init.headers ?? {}) };
      if (init.bff !== false) headers['x-da-bff'] = BFF;
      if (init.auth !== false) {
        headers.Authorization = `Bearer ${typeof init.auth === 'string' ? init.auth : await token()}`;
      }
      let body: string | undefined;
      if (init.rawBody !== undefined) body = init.rawBody;
      else if (init.body !== undefined) body = JSON.stringify(init.body);
      if (body !== undefined && headers['Content-Type'] === undefined) {
        headers['Content-Type'] = 'application/json';
      }
      if (method !== 'GET' && headers['Idempotency-Key'] === undefined) {
        headers['Idempotency-Key'] = crypto.randomUUID();
      }
      return await app.request(`/admin-api${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      });
    },
    rpcNames: () => rpc.map((r) => r.fn),
  };
}

/** The route contract of a registry key. */
export function contractOf(key: AdminRouteKey): AdminRouteContract {
  return adminRoutes[key] as AdminRouteContract;
}

/** `/users/:id` + `{id}` → `/users/<id>`. */
export function fillPath(path: string, params: Record<string, unknown> = {}): string {
  return path.replace(/:([A-Za-z_]+)/g, (_m, name: string) =>
    encodeURIComponent(String(params[name] ?? `missing-${name}`)),
  );
}

/** Query object → `?a=1&b=2` (arrays repeat the key). */
export function queryString(query: Record<string, unknown> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const v of value) search.append(key, String(v));
    else search.append(key, String(value));
  }
  const s = search.toString();
  return s === '' ? '' : `?${s}`;
}

export async function errorOf(
  res: Response,
): Promise<{ status: number; code: string; details: Record<string, unknown> }> {
  const body = (await res.json()) as {
    error?: { code?: string; details?: Record<string, unknown> };
  };
  return { status: res.status, code: body.error?.code ?? '', details: body.error?.details ?? {} };
}
