/**
 * Contract-validated mock for the Playwright `bo-contract` project (BACKOFFICE_PLAN §13.4): one Node
 * HTTP server that plays
 * - Supabase Auth (GoTrue) under `/auth/v1/*`: email one-time code, TOTP enrol/challenge/verify,
 *   refresh, sign-out, and ES256-signed JWTs with a JWKS endpoint (so `getClaims()` verifies them);
 * - admin-api under `/functions/v1/admin-api/*`: BFF key and bearer checks, idle/absolute/revoked
 *   session state, and every response parsed with the route's own `@da/validation` contract before
 *   it is sent (a drift fails the request with 500 and the test).
 * Test-only control endpoints live under `/__mock/*`. Run with `node e2e/mock-server.ts`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';

import { adminRoutes } from '@da/validation';

import {
  ADMIN_EMAIL,
  ADMIN_ID,
  BFF_SECRET,
  EMAIL_CODE,
  MFA_CODE,
  MOCK_PORT,
  RECOVERY_CODES,
  meta,
} from './fixtures.ts';
import {
  accessDenied,
  auditDenied,
  auditMutation,
  handleModule,
  matchRoute,
  mock,
  permissionsOf,
  requiresStepUp,
  resetData,
  type Ctx,
  type PageInfo,
} from './mock-admin.ts';
import type { Role } from './mock-data.ts';

type Json = Record<string, unknown>;

interface Factor {
  id: string;
  status: 'verified' | 'unverified';
}

interface AdminSession {
  id: string;
  authSessionId: string;
  createdAt: number;
  lastActivity: number;
  ended: boolean;
  stepUpUntil: number | null;
}

const IDLE_MS = 30 * 60_000;
const ABSOLUTE_MS = 12 * 3_600_000;

/**
 * Server clock for admin sessions. `/__mock/advance` moves it forward in lockstep with Playwright's
 * `page.clock.fastForward`, so browser and server agree on elapsed time as they do in production.
 */
let clockOffsetMs = 0;
function serverNow(): number {
  return Date.now() + clockOffsetMs;
}

const state = {
  factors: [] as Factor[],
  sessions: new Map<string, AdminSession>(),
  refresh: new Map<string, { aal: 'aal1' | 'aal2'; sessionId: string }>(),
  preferences: {
    theme: 'light',
    locale: 'tr',
    timezone: 'Europe/Istanbul',
    density: 'comfortable',
    table_prefs: {} as Record<string, unknown>,
    dashboard_range: '7d',
    recent_items: [] as unknown[],
    sidebar_collapsed: false,
  },
  recoveryCodesRemaining: 0,
  calls: [] as {
    method: string;
    path: string;
    headers: Record<string, string | undefined>;
    body: unknown;
  }[],
};

const ROLES: readonly Role[] = [
  'super_admin',
  'operations',
  'support',
  'finance',
  'ai_ops',
  'analyst',
  'readonly',
];

function reset(options: { enrolled?: boolean; role?: string } = {}): void {
  const role = ROLES.find((r) => r === options.role) ?? 'operations';
  resetData(serverNow(), role);
  state.factors = options.enrolled === true ? [{ id: randomUUID(), status: 'verified' }] : [];
  state.sessions.clear();
  state.refresh.clear();
  state.preferences = {
    ...state.preferences,
    theme: 'light',
    dashboard_range: '7d',
    table_prefs: {},
    sidebar_collapsed: false,
  };
  state.recoveryCodesRemaining = options.enrolled === true ? 10 : 0;
  state.calls = [];
  clockOffsetMs = 0;
}

// ── JWT (ES256) ──────────────────────────────────────────────────────────────
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const KID = 'mock-es256';
const jwk = {
  ...(publicKey.export({ format: 'jwk' }) as Json),
  kid: KID,
  alg: 'ES256',
  use: 'sig',
};

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function signJwt(payload: Json, key: KeyObject = privateKey): string {
  const head = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: KID }));
  const body = b64url(JSON.stringify(payload));
  const signature = sign('sha256', Buffer.from(`${head}.${body}`), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return `${head}.${body}.${b64url(signature)}`;
}

function readJwt(token: string | undefined): Json | null {
  if (token === undefined) return null;
  const [head, body, signature] = token.split('.');
  if (head === undefined || body === undefined || signature === undefined) return null;
  const ok = verify(
    'sha256',
    Buffer.from(`${head}.${body}`),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signature, 'base64url'),
  );
  if (!ok) return null;
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Json;
  return typeof claims.exp === 'number' && claims.exp * 1000 > Date.now() ? claims : null;
}

function user(): Json {
  return {
    id: ADMIN_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: ADMIN_EMAIL,
    email_confirmed_at: '2026-09-01T09:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'], da_kind: 'admin' },
    user_metadata: {},
    identities: [],
    created_at: '2026-09-01T09:00:00Z',
    updated_at: '2026-09-01T09:00:00Z',
    factors: state.factors.map((f) => ({
      id: f.id,
      friendly_name: 'Birincil',
      factor_type: 'totp',
      status: f.status,
      created_at: '2026-09-01T09:00:00Z',
      updated_at: '2026-09-01T09:00:00Z',
    })),
  };
}

function issueSession(aal: 'aal1' | 'aal2', sessionId: string = randomUUID()): Json {
  const now = Math.floor(Date.now() / 1000);
  const amr =
    aal === 'aal2'
      ? [
          { method: 'totp', timestamp: now },
          { method: 'otp', timestamp: now },
        ]
      : [{ method: 'otp', timestamp: now }];
  const accessToken = signJwt({
    iss: `http://127.0.0.1:${String(MOCK_PORT)}/auth/v1`,
    sub: ADMIN_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: ADMIN_EMAIL,
    aal,
    amr,
    session_id: sessionId,
    admin_role: mock.role,
    iat: now,
    exp: now + 3600,
  });
  const refreshToken = randomBytes(12).toString('hex');
  state.refresh.set(refreshToken, { aal, sessionId });
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: user(),
  };
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function adminError(res: ServerResponse, status: number, code: string, details?: Json): void {
  send(res, status, {
    error: {
      code,
      message: code,
      message_key: `errors.${code.toLowerCase()}`,
      retryable: false,
      correlation_id: randomUUID(),
      ...(details === undefined ? {} : { details }),
    },
  });
}

/** Sends `data` in the success envelope after validating it against the route contract. */
function reply(
  res: ServerResponse,
  key: keyof typeof adminRoutes,
  data: unknown,
  status = 200,
  page?: PageInfo,
): void {
  const body = { data, meta: { ...meta(serverNow()), ...page } };
  const parsed = adminRoutes[key].response.safeParse(body);
  if (!parsed.success) {
    console.error(`mock-admin-api: contract drift on ${key}: ${parsed.error.message}`);
    adminError(res, 500, 'INTERNAL_ERROR');
    return;
  }
  send(res, status, body);
}

// ── GoTrue ───────────────────────────────────────────────────────────────────
async function handleAuth(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  url: URL,
): Promise<void> {
  const method = req.method ?? 'GET';
  const bearer = req.headers.authorization?.replace(/^Bearer /, '');
  if (method === 'GET' && path === '/.well-known/jwks.json') {
    send(res, 200, { keys: [jwk] });
    return;
  }
  if (method === 'POST' && path === '/otp') {
    const body = (await readBody(req)) as { email?: string; create_user?: boolean };
    if (body.email?.toLowerCase() !== ADMIN_EMAIL) {
      send(res, 422, { code: 'otp_disabled', msg: 'Signups not allowed for otp' });
      return;
    }
    send(res, 200, {});
    return;
  }
  if (method === 'POST' && path === '/verify') {
    const body = (await readBody(req)) as { email?: string; token?: string };
    if (body.email?.toLowerCase() !== ADMIN_EMAIL || body.token !== EMAIL_CODE) {
      send(res, 403, { code: 'otp_expired', msg: 'Token has expired or is invalid' });
      return;
    }
    send(res, 200, issueSession('aal1'));
    return;
  }
  if (
    method === 'POST' &&
    path === '/token' &&
    url.searchParams.get('grant_type') === 'refresh_token'
  ) {
    const body = (await readBody(req)) as { refresh_token?: string };
    const known =
      body.refresh_token === undefined ? undefined : state.refresh.get(body.refresh_token);
    if (known === undefined) {
      send(res, 400, { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      return;
    }
    send(res, 200, issueSession(known.aal, known.sessionId));
    return;
  }
  const claims = readJwt(bearer);
  if (claims === null) {
    send(res, 401, { code: 'bad_jwt', msg: 'invalid JWT' });
    return;
  }
  if (method === 'GET' && path === '/user') {
    send(res, 200, user());
    return;
  }
  if (method === 'POST' && path === '/logout') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (method === 'POST' && path === '/factors') {
    const factor: Factor = { id: randomUUID(), status: 'unverified' };
    state.factors.push(factor);
    send(res, 200, {
      id: factor.id,
      type: 'totp',
      friendly_name: 'Birincil',
      totp: {
        qr_code:
          '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 10 10"><rect width="10" height="10" fill="white"/><rect x="1" y="1" width="3" height="3"/><rect x="6" y="1" width="3" height="3"/><rect x="1" y="6" width="3" height="3"/></svg>',
        secret: 'JBSWY3DPEHPK3PXP',
        uri: 'otpauth://totp/DijitalAsistan:ops?secret=JBSWY3DPEHPK3PXP',
      },
    });
    return;
  }
  const factorMatch = /^\/factors\/([^/]+)(\/challenge|\/verify)?$/.exec(path);
  if (factorMatch !== null) {
    const factor = state.factors.find((f) => f.id === factorMatch[1]);
    if (factor === undefined) {
      send(res, 404, { code: 'mfa_factor_not_found', msg: 'Factor not found' });
      return;
    }
    if (method === 'DELETE') {
      state.factors = state.factors.filter((f) => f !== factor);
      send(res, 200, { id: factor.id });
      return;
    }
    if (factorMatch[2] === '/challenge') {
      send(res, 200, {
        id: randomUUID(),
        type: 'totp',
        expires_at: Math.floor(Date.now() / 1000) + 300,
      });
      return;
    }
    if (factorMatch[2] === '/verify') {
      const body = (await readBody(req)) as { code?: string };
      if (body.code !== MFA_CODE) {
        send(res, 422, { code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' });
        return;
      }
      factor.status = 'verified';
      send(res, 200, issueSession('aal2', String(claims.session_id)));
      return;
    }
  }
  send(res, 404, { code: 'not_found', msg: 'not found' });
}

// ── admin-api ────────────────────────────────────────────────────────────────
function sessionFor(claims: Json): AdminSession | undefined {
  return state.sessions.get(String(claims.session_id));
}

function sessionDeadlines(session: AdminSession): { idle: string; absolute: string } {
  return {
    idle: new Date(session.lastActivity + IDLE_MS).toISOString(),
    absolute: new Date(session.createdAt + ABSOLUTE_MS).toISOString(),
  };
}

function meData(session: AdminSession): Json {
  const deadlines = sessionDeadlines(session);
  return {
    admin: {
      id: ADMIN_ID,
      email: ADMIN_EMAIL,
      display_name: 'Ayşe Operasyon',
      role: mock.role,
      status: 'active',
      mfa_enrolled: state.factors.some((f) => f.status === 'verified'),
      mfa_factor_count: state.factors.filter((f) => f.status === 'verified').length,
      recovery_codes_remaining: state.recoveryCodesRemaining,
    },
    permissions: permissionsOf(mock.role),
    session: {
      id: session.id,
      idle_expires_at: deadlines.idle,
      absolute_expires_at: deadlines.absolute,
      step_up_valid_until:
        session.stepUpUntil !== null && session.stepUpUntil > serverNow()
          ? new Date(session.stepUpUntil).toISOString()
          : null,
    },
    preferences: state.preferences,
  };
}

async function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  url: URL,
): Promise<void> {
  const method = req.method ?? 'GET';
  const body = method === 'GET' ? {} : await readBody(req);
  state.calls.push({
    method,
    path,
    headers: {
      'idempotency-key': req.headers['idempotency-key'] as string | undefined,
      'x-da-activity': req.headers['x-da-activity'] as string | undefined,
      'x-correlation-id': req.headers['x-correlation-id'] as string | undefined,
    },
    body,
  });
  if (req.headers.origin !== undefined) {
    adminError(res, 403, 'FORBIDDEN', { reason: 'browser_origin' });
    return;
  }
  if (req.headers['x-da-bff'] !== BFF_SECRET) {
    adminError(res, 401, 'AUTH_REQUIRED', { reason: 'bff_required' });
    return;
  }
  const matched = matchRoute(method, path);
  if (matched === null) {
    adminError(res, 404, 'NOT_FOUND');
    return;
  }
  const { key } = matched;
  const route = adminRoutes[key];
  const request = route.request as {
    params?: { safeParse(v: unknown): { success: boolean; data?: unknown } };
    query?: { safeParse(v: unknown): { success: boolean; data?: unknown } };
    body?: { safeParse(v: unknown): { success: boolean; data?: unknown } };
  };
  const params = request.params?.safeParse(matched.params);
  const query = request.query?.safeParse(Object.fromEntries(url.searchParams.entries()));
  const parsedBody = request.body?.safeParse(body);
  if (params?.success === false || query?.success === false || parsedBody?.success === false) {
    adminError(res, 422, 'VALIDATION_FAILED');
    return;
  }
  if (method !== 'GET' && typeof req.headers['idempotency-key'] !== 'string') {
    adminError(res, 422, 'VALIDATION_FAILED', { reason: 'idempotency_key_required' });
    return;
  }

  // BFF-only pre-auth routes.
  if (key === 'POST /auth/preflight') {
    reply(res, key, { allowed: true });
    return;
  }
  if (key === 'POST /auth/attempt') {
    reply(res, key, { recorded: true });
    return;
  }
  if (key === 'POST /auth/invite/redeem') {
    reply(res, key, { email: ADMIN_EMAIL, accepted: true });
    return;
  }

  const claims = readJwt(req.headers.authorization?.replace(/^Bearer /, ''));
  if (claims === null) {
    adminError(res, 401, 'AUTH_REQUIRED', { reason: 'unauthenticated' });
    return;
  }
  if (key === 'GET /auth/status') {
    reply(res, key, {
      is_admin: true,
      status: 'active',
      mfa_verified_factors: state.factors.filter((f) => f.status === 'verified').length,
    });
    return;
  }
  if (key === 'POST /auth/recovery-code/redeem') {
    state.factors = [];
    reply(res, key, { factors_removed: 1, reenrol_required: true });
    return;
  }
  if (claims.aal !== 'aal2') {
    adminError(res, 401, 'AAL2_REQUIRED');
    return;
  }

  if (key === 'POST /session/start') {
    const now = serverNow();
    const session: AdminSession = {
      id: randomUUID(),
      authSessionId: String(claims.session_id),
      createdAt: now,
      lastActivity: now,
      ended: false,
      stepUpUntil: null,
    };
    state.sessions.set(session.authSessionId, session);
    const deadlines = sessionDeadlines(session);
    reply(res, key, {
      admin: { id: ADMIN_ID, email: ADMIN_EMAIL, role: mock.role, mfa_enrolled: true },
      permissions: permissionsOf(mock.role),
      idle_expires_at: deadlines.idle,
      absolute_expires_at: deadlines.absolute,
    });
    return;
  }

  const session = sessionFor(claims);
  if (session === undefined || session.ended) {
    adminError(res, 401, 'AUTH_REQUIRED', { reason: 'session_revoked' });
    return;
  }
  const now = serverNow();
  if (now > session.createdAt + ABSOLUTE_MS) {
    adminError(res, 401, 'AUTH_REQUIRED', { reason: 'absolute_timeout' });
    return;
  }
  if (now > session.lastActivity + IDLE_MS) {
    adminError(res, 401, 'AUTH_REQUIRED', { reason: 'idle_timeout' });
    return;
  }
  if (req.headers['x-da-activity'] !== 'background') session.lastActivity = now;

  const ctx: Ctx = {
    key,
    params: (params?.data ?? {}) as Record<string, string>,
    query: (query?.data ?? {}) as Record<string, unknown>,
    body: (parsedBody?.data ?? {}) as Json,
    now,
    permissions: permissionsOf(mock.role),
  };
  const denied = accessDenied(ctx);
  if (denied !== null) {
    auditDenied(ctx, denied);
    adminError(res, 403, 'FORBIDDEN', { reason: 'permission_denied', permission: denied });
    return;
  }
  if (requiresStepUp(key) && (session.stepUpUntil === null || session.stepUpUntil < now)) {
    adminError(res, 403, 'FORBIDDEN', { reason: 'step_up_required' });
    return;
  }

  switch (key) {
    case 'GET /me': {
      reply(res, key, meData(session));
      return;
    }
    case 'POST /session/heartbeat': {
      reply(res, key, { idle_expires_at: sessionDeadlines(session).idle });
      return;
    }
    case 'POST /session/step-up': {
      session.stepUpUntil = now + 10 * 60_000;
      reply(res, key, { step_up_valid_until: new Date(session.stepUpUntil).toISOString() });
      return;
    }
    case 'POST /me/recovery-codes': {
      state.recoveryCodesRemaining = RECOVERY_CODES.length;
      auditMutation(ctx);
      reply(res, key, { codes: RECOVERY_CODES, generated_at: new Date(now).toISOString() }, 201);
      return;
    }
    case 'POST /session/logout': {
      session.ended = true;
      reply(res, key, { ended_sessions: 1 });
      return;
    }
    case 'POST /session/logout-all': {
      let ended = 0;
      const othersOnly = (ctx.body as { scope?: string }).scope === 'others';
      for (const s of state.sessions.values()) {
        if (othersOnly && s === session) continue;
        if (!s.ended) ended += 1;
        s.ended = true;
      }
      reply(res, key, { ended_sessions: ended });
      return;
    }
    case 'GET /preferences': {
      reply(res, key, state.preferences);
      return;
    }
    case 'PATCH /preferences': {
      state.preferences = { ...state.preferences, ...ctx.body };
      reply(res, key, state.preferences);
      return;
    }
    default:
      break;
  }

  const outcome = handleModule(ctx);
  if (outcome === null) {
    adminError(res, 404, 'NOT_FOUND');
    return;
  }
  if (!outcome.ok) {
    adminError(res, outcome.status, outcome.code, outcome.details);
    return;
  }
  if (method !== 'GET') auditMutation(ctx);
  reply(res, key, outcome.data, route.status, outcome.page);
}

// ── Control endpoints (tests only) ───────────────────────────────────────────
async function handleControl(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<void> {
  if (path === '/health') {
    send(res, 200, { ok: true });
    return;
  }
  if (path === '/reset' && req.method === 'POST') {
    reset((await readBody(req)) as { enrolled?: boolean; role?: string });
    send(res, 200, { ok: true });
    return;
  }
  if (path === '/calls') {
    send(res, 200, { calls: state.calls });
    return;
  }
  if (path === '/advance' && req.method === 'POST') {
    const { ms } = (await readBody(req)) as { ms?: number };
    clockOffsetMs += typeof ms === 'number' && ms > 0 ? ms : 0;
    send(res, 200, { offset: clockOffsetMs });
    return;
  }
  if (path === '/revoke' && req.method === 'POST') {
    for (const session of state.sessions.values()) session.ended = true;
    send(res, 200, { ok: true });
    return;
  }
  if (path === '/state') {
    send(res, 200, {
      sessions: [...state.sessions.values()].map((s) => ({ ended: s.ended })),
      preferences: state.preferences,
      factors: state.factors,
      audit: mock.data.audit.map((entry) => entry.row),
    });
    return;
  }
  send(res, 404, {});
}

function notFound(res: ServerResponse): Promise<void> {
  send(res, 404, {});
  return Promise.resolve();
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${String(MOCK_PORT)}`);
  const path = url.pathname;
  const handle = path.startsWith('/auth/v1')
    ? handleAuth(req, res, path.slice('/auth/v1'.length), url)
    : path.startsWith('/functions/v1/admin-api')
      ? handleAdmin(req, res, path.slice('/functions/v1/admin-api'.length), url)
      : path.startsWith('/__mock')
        ? handleControl(req, res, path.slice('/__mock'.length))
        : notFound(res);
  handle.catch((error: unknown) => {
    console.error('mock-server error', error);
    if (!res.headersSent) send(res, 500, {});
  });
});

reset();
server.listen(MOCK_PORT, '127.0.0.1', () => {
  console.info(`mock admin-api + auth listening on http://127.0.0.1:${String(MOCK_PORT)}`);
});
