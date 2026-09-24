/**
 * Tier-C stand-in for the `public-api` Edge Function (SCREEN_AND_FLOW_MAP Part 5 §16; TEST_PLAN
 * §11). It implements the API_CONTRACTS §13 shapes the website calls — PUB-01…PUB-07 — with
 * deterministic fixtures, so the E2E suite exercises the real web client against the contract.
 * CI tier A runs the same specs against `supabase functions serve public-api`.
 *
 * Fixtures:
 * - known accounts: yunus@example.com and any …@known.example.com; subscriber@example.com and
 *   any subscriber…@known.example.com have an active store subscription; an account's OTP is
 *   readable at GET /__stub/otp?email=…
 * - ratelimited@example.com → 429 on every route; server-error@example.com → 500
 * - referral codes: STUB_VALID_REFERRAL is valid, STUB_UNAVAILABLE_REFERRAL answers 503
 *
 * Usage: node e2e/stub/public-api.ts   (PORT, STUB_ALLOWED_ORIGIN)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  STUB_PORT,
  STUB_UNAVAILABLE_REFERRAL,
  STUB_VALID_REFERRAL,
  WEB_ORIGIN,
} from './constants.ts';

const PORT = Number(process.env.PORT ?? STUB_PORT);
const ALLOWED_ORIGIN = process.env.STUB_ALLOWED_ORIGIN ?? WEB_ORIGIN;
const BASE = '/functions/v1/public-api';
const KNOWN_ACCOUNTS = new Set(['yunus@example.com', 'subscriber@example.com']);
const isKnownAccount = (email: string): boolean =>
  KNOWN_ACCOUNTS.has(email) || email.endsWith('@known.example.com');
const isSubscriber = (email: string): boolean =>
  email === 'subscriber@example.com' ||
  (email.startsWith('subscriber') && email.endsWith('@known.example.com'));
const TICKET_CATEGORIES = new Set([
  'account',
  'integration',
  'sync',
  'billing',
  'ai_quality',
  'notification',
  'privacy',
  'other',
]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RecordedRequest {
  method: string;
  path: string;
  origin: string | null;
  bodyKeys: string[];
  body: unknown;
}

const state = {
  requests: [] as RecordedRequest[],
  tickets: [] as {
    reference: string;
    email: string;
    message: string;
    category: string;
    at: number;
  }[],
  events: [] as unknown[],
  otps: new Map<string, string>(),
  failures: new Map<string, number>(),
  deletions: new Map<
    string,
    { reference: string; requestId: string; token: string; requestedAt: string }
  >(),
};

function reset(): void {
  state.requests = [];
  state.tickets = [];
  state.events = [];
  state.otps.clear();
  state.failures.clear();
  state.deletions.clear();
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

const meta = (): Record<string, string> => ({
  correlation_id: randomUUID(),
  request_id: randomUUID(),
  server_time: new Date().toISOString(),
});

function ok(
  res: ServerResponse,
  status: number,
  data: unknown,
  headers?: Record<string, string>,
): void {
  send(res, status, { data, meta: meta() }, headers);
}

function fail(
  res: ServerResponse,
  status: number,
  code: string,
  extra: {
    field_errors?: { path: string; code: string; message_key: string }[];
    headers?: Record<string, string>;
  } = {},
): void {
  send(
    res,
    status,
    {
      error: {
        code,
        message: code,
        message_key: `errors.${code.toLowerCase()}`,
        retryable: status >= 500 || status === 429,
        correlation_id: randomUUID(),
        ...(extra.field_errors === undefined ? {} : { field_errors: extra.field_errors }),
      },
    },
    extra.headers,
  );
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function record(req: IncomingMessage, path: string, body: unknown): void {
  state.requests.push({
    method: req.method ?? 'GET',
    path,
    origin: req.headers.origin ?? null,
    bodyKeys: body !== null && typeof body === 'object' ? Object.keys(body).sort() : [],
    body,
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${String(PORT)}`);
  res.setHeader('access-control-allow-origin', ALLOWED_ORIGIN);
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, apikey, x-client-info');
  res.setHeader('access-control-expose-headers', 'retry-after');
  res.setHeader('vary', 'origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Test controls
  if (url.pathname === '/__stub/state') {
    send(res, 200, { requests: state.requests, tickets: state.tickets, events: state.events });
    return;
  }
  if (url.pathname === '/__stub/reset') {
    reset();
    send(res, 200, { ok: true });
    return;
  }
  if (url.pathname === '/__stub/otp') {
    send(res, 200, { code: state.otps.get(url.searchParams.get('email') ?? '') ?? null });
    return;
  }

  if (!url.pathname.startsWith(BASE)) {
    fail(res, 404, 'NOT_FOUND');
    return;
  }
  const path = url.pathname.slice(BASE.length);
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  record(req, path, body);
  const input = (body ?? {}) as Record<string, unknown>;
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';

  if (req.method === 'GET' && path === '/plans') {
    ok(
      res,
      200,
      {
        free: { mail_accounts: 1, calendars: 1, ai_analyses_per_day: 50 },
        pro: { mail_accounts: 'multiple', calendars: 'multiple', ai_policy: 'fair_use' },
        pricing: {
          storefront: 'TR',
          currency: 'TRY',
          as_of: isoDaysAgo(10),
          verified: true,
          monthly: { app_store: 199, play: 209 },
          annual: { app_store: 1490, play: 1490 },
          intro_offer: null,
        },
        updated_at: new Date().toISOString(),
      },
      { 'cache-control': 'public, max-age=300' },
    );
    return;
  }

  const referral = /^\/referrals\/([^/]+)$/.exec(path);
  if (req.method === 'GET' && referral?.[1] !== undefined) {
    const code = decodeURIComponent(referral[1]);
    if (code === STUB_UNAVAILABLE_REFERRAL) {
      fail(res, 503, 'SERVICE_UNAVAILABLE');
      return;
    }
    const valid = code === STUB_VALID_REFERRAL;
    ok(res, 200, {
      valid,
      reward_days: 14,
      apply_window_days: 7,
      store_urls: {
        ios: 'https://apps.apple.com/tr/app/id1234567890',
        android: `https://play.google.com/store/apps/details?id=com.dijitalasistan.app&referrer=code%3D${code}`,
      },
      deep_link: `dijitalasistan://settings/referral?code=${code}`,
      message_key: 'referral.landing',
    });
    return;
  }

  if (req.method === 'POST' && path === '/web-events') {
    state.events.push(body);
    send(res, 204, undefined);
    return;
  }

  if (req.method === 'POST' && path === '/support') {
    if (typeof input.website === 'string' && input.website !== '') {
      ok(res, 202, { reference: 'DA-2026-000000' });
      return;
    }
    if (email === 'ratelimited@example.com') {
      fail(res, 429, 'RATE_LIMITED', { headers: { 'retry-after': '3600' } });
      return;
    }
    if (email === 'server-error@example.com') {
      fail(res, 500, 'INTERNAL_ERROR');
      return;
    }
    const allowed = new Set([
      'name',
      'email',
      'category',
      'message',
      'locale',
      'website',
      'captcha_token',
    ]);
    const fieldErrors: { path: string; code: string; message_key: string }[] = [];
    for (const key of Object.keys(input)) {
      if (!allowed.has(key))
        fieldErrors.push({
          path: key,
          code: 'unrecognized_keys',
          message_key: 'validation.unrecognized_keys',
        });
    }
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    if (!EMAIL.test(email))
      fieldErrors.push({
        path: 'email',
        code: 'invalid_format',
        message_key: 'validation.invalid_format',
      });
    if (typeof input.category !== 'string' || !TICKET_CATEGORIES.has(input.category)) {
      fieldErrors.push({
        path: 'category',
        code: 'invalid_value',
        message_key: 'validation.invalid_value',
      });
    }
    if (message.length < 10)
      fieldErrors.push({ path: 'message', code: 'too_small', message_key: 'validation.too_small' });
    if (message.length > 5000)
      fieldErrors.push({ path: 'message', code: 'too_big', message_key: 'validation.too_big' });
    if (input.locale !== 'tr' && input.locale !== 'en')
      fieldErrors.push({
        path: 'locale',
        code: 'invalid_value',
        message_key: 'validation.invalid_value',
      });
    if (fieldErrors.length > 0) {
      fail(res, 422, 'VALIDATION_FAILED', { field_errors: fieldErrors });
      return;
    }
    const duplicate = state.tickets.find(
      (t) => t.email === email && t.message === message && Date.now() - t.at < 600_000,
    );
    const reference =
      duplicate?.reference ?? `DA-2026-${String(100_123 + state.tickets.length).padStart(6, '0')}`;
    if (duplicate === undefined) {
      state.tickets.push({
        reference,
        email,
        message,
        category: String(input.category),
        at: Date.now(),
      });
    }
    ok(res, 202, { reference });
    return;
  }

  if (req.method === 'POST' && path === '/data-deletion/start') {
    const started = Date.now();
    if (email === 'ratelimited@example.com') {
      fail(res, 429, 'RATE_LIMITED', { headers: { 'retry-after': '1800' } });
      return;
    }
    if (!EMAIL.test(email)) {
      fail(res, 422, 'VALIDATION_FAILED', {
        field_errors: [
          { path: 'email', code: 'invalid_format', message_key: 'validation.invalid_format' },
        ],
      });
      return;
    }
    if (email === 'server-error@example.com') {
      fail(res, 503, 'SERVICE_UNAVAILABLE');
      return;
    }
    if (isKnownAccount(email) && (typeof input.website !== 'string' || input.website === '')) {
      state.otps.set(email, String(100_000 + (randomBytes(3).readUIntBE(0, 3) % 900_000)));
    }
    await sleep(Math.max(0, 400 - (Date.now() - started)));
    ok(res, 202, { status: 'code_sent_if_account_exists' });
    return;
  }

  if (req.method === 'POST' && path === '/data-deletion/verify') {
    const failures = state.failures.get(email) ?? 0;
    if (failures >= 5) {
      fail(res, 429, 'OTP_LOCKED', { headers: { 'retry-after': '3600' } });
      return;
    }
    const expected = state.otps.get(email);
    const confirmationOk = input.confirmation === (input.locale === 'en' ? 'DELETE' : 'SİL');
    if (
      expected === undefined ||
      input.code !== expected ||
      !confirmationOk ||
      input.kind !== 'account'
    ) {
      state.failures.set(email, failures + 1);
      fail(res, 422, 'OTP_INVALID');
      return;
    }
    const existing = state.deletions.get(email);
    const receipt = existing ?? {
      reference: `DS-${randomBytes(3).toString('hex').toUpperCase()}`,
      requestId: randomUUID(),
      token: randomBytes(32).toString('base64url'),
      requestedAt: new Date().toISOString(),
    };
    state.deletions.set(email, receipt);
    ok(res, 202, {
      reference: receipt.reference,
      request_id: receipt.requestId,
      status: 'queued',
      status_token: receipt.token,
      subscription_notice: { active: isSubscriber(email) },
    });
    return;
  }

  const status = /^\/data-deletion\/([^/]+)\/status$/.exec(path);
  if (req.method === 'GET' && status?.[1] !== undefined) {
    const receipt = [...state.deletions.values()].find(
      (r) => r.requestId === status[1] && r.token === url.searchParams.get('token'),
    );
    if (receipt === undefined) {
      fail(res, 404, 'NOT_FOUND');
      return;
    }
    ok(res, 200, {
      reference: receipt.reference,
      kind: 'account',
      status: 'processing',
      requested_at: receipt.requestedAt,
      completed_at: null,
      steps_public: {
        provider_revoke: true,
        storage_purged: false,
        db_purged: false,
        auth_user_deleted: false,
      },
    });
    return;
  }

  fail(res, 404, 'NOT_FOUND');
}

createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    console.error(error);
    fail(res, 500, 'INTERNAL_ERROR');
  });
}).listen(PORT, '127.0.0.1', () => {
  console.info(`public-api stub on http://127.0.0.1:${String(PORT)}${BASE}`);
});
