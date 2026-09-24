/**
 * In-memory harness for the `public-api` route tests: a `PublicRepo` with the semantics of the
 * migration 20260924002220 functions, a fake Supabase Auth OTP gateway and a counting rate-limit
 * store. Nothing reaches the network.
 */
import type { Hono } from 'hono';
import { toHex } from '../_shared/crypto/encoding.ts';
import { createLogger, memorySink } from '../_shared/logging/logger.ts';
import type { RateLimitStore } from '../_shared/ratelimit.ts';
import type { AppEnv } from '../_shared/http/context.ts';
import { randomBase64 } from '../_shared/testing/env.ts';
import { createTestIssuer, type TestIssuer } from '../_shared/testing/jwt.ts';
import { createPublicApiApp } from './app.ts';
import type {
  CaptchaVerifier,
  DeletionStatusRow,
  OtpGateway,
  PublicApiServices,
  PublicRepo,
} from './deps.ts';

export const WEB_ORIGIN = 'https://dijitalasistan.example';
export const NOW = new Date('2026-09-24T09:00:00.000Z');

type MutableStatusRow = { -readonly [K in keyof DeletionStatusRow]: DeletionStatusRow[K] };

export interface MemoryPublic extends PublicRepo {
  readonly tickets: {
    id: string;
    reference: string;
    email: string;
    name: string | null;
    category: string;
    subject: string;
    message: string;
    status: string;
    created_at: number;
  }[];
  readonly notes: { ticket_id: string; body: string }[];
  readonly seenMessages: Set<string>;
  readonly users: Map<string, { user_id: string; is_admin: boolean }>;
  readonly failures: Map<string, number>;
  readonly requests: Map<string, MutableStatusRow & { user_id: string }>;
  readonly subscribed: Set<string>;
  readonly codes: Set<string>;
  readonly counters: Map<string, number>;
  pricing: unknown;
}

export function memoryPublicRepo(now: () => Date): MemoryPublic {
  const tickets: MemoryPublic['tickets'] = [];
  const notes: MemoryPublic['notes'] = [];
  const seenMessages = new Set<string>();
  const users: MemoryPublic['users'] = new Map();
  const failures = new Map<string, number>();
  const locks = new Map<string, number>();
  const requests: MemoryPublic['requests'] = new Map();
  const subscribed = new Set<string>();
  const codes = new Set<string>();
  const counters = new Map<string, number>();
  const repo: MemoryPublic = {
    tickets,
    notes,
    seenMessages,
    users,
    failures,
    requests,
    subscribed,
    codes,
    counters,
    pricing: { verified: false },
    supportTicket(input) {
      const t = now().getTime();
      const existing = tickets.find(
        (x) =>
          x.email.toLowerCase() === input.email.toLowerCase() &&
          x.message === input.message &&
          t - x.created_at < 10 * 60 * 1000,
      );
      if (existing !== undefined) {
        return Promise.resolve({ id: existing.id, reference: existing.reference, duplicate: true });
      }
      const row = {
        id: crypto.randomUUID(),
        reference: `DA-2026-${String(tickets.length + 1).padStart(6, '0')}`,
        ...input,
        status: 'open',
        created_at: t,
      };
      tickets.push(row);
      return Promise.resolve({ id: row.id, reference: row.reference, duplicate: false });
    },
    inboundNote(input) {
      if (seenMessages.has(input.messageId))
        return Promise.resolve({ stored: false, reason: 'duplicate' });
      seenMessages.add(input.messageId);
      const ticket = tickets.find((x) => x.reference === input.reference);
      if (ticket === undefined)
        return Promise.resolve({ stored: false, reason: 'ticket_not_found' });
      if (ticket.email.toLowerCase() !== input.sender.toLowerCase()) {
        return Promise.resolve({ stored: false, reason: 'sender_mismatch' });
      }
      notes.push({ ticket_id: ticket.id, body: input.body });
      if (ticket.status === 'waiting_user') ticket.status = 'open';
      return Promise.resolve({ stored: true });
    },
    deletionSubject(email) {
      return Promise.resolve(users.get(email.toLowerCase()) ?? null);
    },
    otpLockSeconds(subject) {
      const at = locks.get(subject);
      if (at === undefined) return Promise.resolve(0);
      return Promise.resolve(Math.max(0, Math.ceil(3600 - (now().getTime() - at) / 1000)));
    },
    otpRecordFailure(subject) {
      const n = (failures.get(subject) ?? 0) + 1;
      failures.set(subject, n);
      if (n >= 5) {
        locks.set(subject, now().getTime());
        return Promise.resolve({ locked: true, failures: n, retry_after: 3600 });
      }
      return Promise.resolve({ locked: false, failures: n, retry_after: 0 });
    },
    createDeletionRequest(input) {
      const hash = toHex(input.statusTokenHash);
      for (const row of requests.values()) {
        if (
          row.user_id === input.userId &&
          ['requested', 'verified', 'queued', 'processing'].includes(row.status)
        ) {
          row.status_token_hash = hash;
          return Promise.resolve({ request_id: row.id, status: row.status, created: false });
        }
      }
      const id = crypto.randomUUID();
      requests.set(id, {
        id,
        user_id: input.userId,
        kind: 'account',
        status: 'queued',
        requested_at: now().toISOString(),
        completed_at: null,
        steps: {},
        status_token_hash: hash,
      });
      return Promise.resolve({ request_id: id, status: 'queued', created: true });
    },
    subscriptionActive(userId) {
      return Promise.resolve(subscribed.has(userId));
    },
    deletionStatus(requestId) {
      const row = requests.get(requestId);
      if (row === undefined) return Promise.resolve(null);
      const { user_id: _user, ...rest } = row;
      return Promise.resolve(rest);
    },
    plans() {
      return Promise.resolve({
        free: { max_mail_accounts: 1, max_calendars: 1, ai_daily_budget_units: 50 },
        pricing: repo.pricing,
        updated_at: '2026-09-20T10:00:00Z',
      });
    },
    referralResolve(code) {
      return Promise.resolve({ valid: codes.has(code), reward_days: 14, apply_window_days: 7 });
    },
    webAnalyticsIncrement(day, event, dims) {
      const key = `${day}|${event}|${JSON.stringify(Object.entries(dims).sort())}`;
      counters.set(key, (counters.get(key) ?? 0) + 1);
      return Promise.resolve();
    },
  };
  return repo;
}

export function fakeOtp(): OtpGateway & {
  readonly codes: Map<string, { code: string; userId: string; isAdmin?: boolean }>;
  readonly sent: string[];
  readonly revoked: string[];
} {
  const codes = new Map<string, { code: string; userId: string; isAdmin?: boolean }>();
  const sent: string[] = [];
  const revoked: string[] = [];
  return {
    codes,
    sent,
    revoked,
    sendCode(email) {
      sent.push(email.toLowerCase());
      return Promise.resolve();
    },
    verifyCode(email, code) {
      const entry = codes.get(email.toLowerCase());
      if (entry === undefined || entry.code !== code) return Promise.resolve(null);
      return Promise.resolve({
        userId: entry.userId,
        accessToken: `session-${entry.userId}`,
        isAdmin: entry.isAdmin === true,
      });
    },
    revokeSessions(token) {
      revoked.push(token);
      return Promise.resolve(true);
    },
  };
}

export function countingLimits(): RateLimitStore & { readonly keys: Map<string, number> } {
  const keys = new Map<string, number>();
  return {
    keys,
    hit(key, limit) {
      const n = (keys.get(key) ?? 0) + 1;
      keys.set(key, n);
      return Promise.resolve({ allowed: n <= limit, count: n });
    },
  };
}

export interface PublicHarness {
  readonly app: Hono<AppEnv>;
  readonly issuer: TestIssuer;
  readonly repo: MemoryPublic;
  readonly otp: ReturnType<typeof fakeOtp>;
  readonly limits: ReturnType<typeof countingLimits>;
  readonly slept: number[];
  readonly pokes: number[];
  readonly clock: { now: Date };
  readonly services: PublicApiServices;
}

export async function publicHarness(
  options: {
    captcha?: CaptchaVerifier | null;
    inboundBasicAuth?: string;
    iosAppStoreId?: string;
    publicWebUrl?: string;
  } = {},
): Promise<PublicHarness> {
  const issuer = await createTestIssuer();
  const clock = { now: NOW };
  const repo = memoryPublicRepo(() => clock.now);
  const otp = fakeOtp();
  const limits = countingLimits();
  const slept: number[] = [];
  const pokes: number[] = [];
  const services: PublicApiServices = {
    repo,
    otp,
    captcha: options.captcha ?? null,
    rateLimits: limits,
    pepper: { HASH_PEPPER: randomBase64(32) },
    inboundBasicAuth: options.inboundBasicAuth,
    publicWebUrl: options.publicWebUrl ?? WEB_ORIGIN,
    iosAppStoreId: options.iosAppStoreId,
    androidPackage: 'com.dijitalasistan.app',
    poke: () => Promise.resolve(void pokes.push(1)),
    now: () => clock.now,
    sleep: (ms) => Promise.resolve(void slept.push(ms)),
  };
  const app = createPublicApiApp({
    webOrigin: `${WEB_ORIGIN}/`,
    verifier: issuer.verifier,
    log: createLogger({ fn: 'public-api', sink: memorySink().sink }),
    services,
  });
  return { app, issuer, repo, otp, limits, slept, pokes, clock, services };
}

/** JSON request helper against `/public-api{path}`. */
export function send(
  h: PublicHarness,
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'X-Forwarded-For': '203.0.113.7', ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  return Promise.resolve(
    h.app.request(`/public-api${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
  );
}
