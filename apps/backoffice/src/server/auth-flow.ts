import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';

import { serverEnv } from '@/env';
import { adminApi } from './admin-api';
import { LOGIN_COOKIE, seal, sealingKey, unseal } from './cookie-seal';
import {
  LOCALE_COOKIE,
  PREFERENCE_COOKIE_OPTIONS,
  THEME_COOKIE,
  parseLocale,
  parseTheme,
} from './preference-cookies';
import { clientIp } from './request-meta';

/*
 * Pre-session sign-in plumbing (BACKOFFICE_PLAN §3.2, SECURITY_AND_PRIVACY_PLAN R-18):
 * - the email and client IP reach admin-api only as SHA-256 digests (`email_hash`, `ip_hash`); admin-api
 *   keys its rate limits and lockout on HMAC(PII_LOOKUP_PEPPER, digest), so the backoffice never needs
 *   the pepper and the raw email never leaves this server for throttling;
 * - the email is kept between the code request and its verification in the sealed
 *   `__Host-da_admin_login` cookie (10 min), never in the URL;
 * - responses for unknown emails are identical and padded to the same minimum duration.
 */

const MFA_COOKIE = '__Host-da_admin_mfa';
const LOGIN_MAX_AGE = 600;
/** Minimum duration of a code request, so a skipped Auth call is not measurable. */
export const CODE_REQUEST_MIN_MS = 700;
/** The resend link unlocks 60 s after a code request (§6.0). */
export const RESEND_COOLDOWN_S = 60;
/** Consecutive MFA failures in one session that force a sign-out (§3.2 step 7). */
export const MFA_MAX_FAILURES = 5;

const SEALED_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
} as const;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function subjectHashes(
  email: string,
): Promise<{ email_hash: string; ip_hash: string }> {
  const ip = clientIp(await headers());
  return { email_hash: await sha256Hex(normaliseEmail(email)), ip_hash: await sha256Hex(ip) };
}

export async function padTo(startedAt: number, minimumMs: number): Promise<void> {
  const wait = minimumMs - (Date.now() - startedAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

// ── Login-step cookie ────────────────────────────────────────────────────────
export interface LoginStep {
  readonly email: string;
  readonly sentAt: number;
  readonly next: string;
}

export async function writeLoginStep(step: LoginStep): Promise<void> {
  const key = await sealingKey(serverEnv().ADMIN_BFF_SECRET);
  const store = await cookies();
  store.set(LOGIN_COOKIE, await seal(key, JSON.stringify(step), LOGIN_COOKIE), {
    ...SEALED_COOKIE_OPTIONS,
    maxAge: LOGIN_MAX_AGE,
  });
}

export async function readLoginStep(): Promise<LoginStep | null> {
  const store = await cookies();
  const sealed = store.get(LOGIN_COOKIE)?.value;
  if (sealed === undefined || sealed === '') return null;
  const key = await sealingKey(serverEnv().ADMIN_BFF_SECRET);
  const plain = await unseal(key, sealed, LOGIN_COOKIE);
  if (plain === null) return null;
  try {
    const value = JSON.parse(plain) as Partial<LoginStep>;
    if (typeof value.email !== 'string' || typeof value.sentAt !== 'number') return null;
    return {
      email: value.email,
      sentAt: value.sentAt,
      next: typeof value.next === 'string' ? value.next : '/dashboard',
    };
  } catch {
    return null;
  }
}

export async function clearLoginStep(): Promise<void> {
  (await cookies()).set(LOGIN_COOKIE, '', { ...SEALED_COOKIE_OPTIONS, maxAge: 0 });
}

// ── MFA failure counter (per sign-in) ────────────────────────────────────────
export async function readMfaFailures(): Promise<number> {
  const sealed = (await cookies()).get(MFA_COOKIE)?.value;
  if (sealed === undefined || sealed === '') return 0;
  const key = await sealingKey(serverEnv().ADMIN_BFF_SECRET);
  const plain = await unseal(key, sealed, MFA_COOKIE);
  const count = plain === null ? 0 : Number(plain);
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

export async function writeMfaFailures(count: number): Promise<void> {
  const store = await cookies();
  if (count <= 0) {
    store.set(MFA_COOKIE, '', { ...SEALED_COOKIE_OPTIONS, maxAge: 0 });
    return;
  }
  const key = await sealingKey(serverEnv().ADMIN_BFF_SECRET);
  store.set(MFA_COOKIE, await seal(key, String(count), MFA_COOKIE), {
    ...SEALED_COOKIE_OPTIONS,
    maxAge: LOGIN_MAX_AGE,
  });
}

// ── admin-api pre-auth calls ─────────────────────────────────────────────────
export type PreflightOutcome =
  | { kind: 'allowed' }
  | { kind: 'throttled'; retryAfter: number }
  | { kind: 'locked' }
  | { kind: 'unavailable' };

export async function preflight(email: string): Promise<PreflightOutcome> {
  const result = await adminApi('POST /auth/preflight', { body: await subjectHashes(email) });
  if (!result.ok) {
    if (result.error.code === 'RATE_LIMITED') {
      return { kind: 'throttled', retryAfter: result.error.retryAfter ?? 900 };
    }
    return { kind: 'unavailable' };
  }
  if (result.data.locked === true) return { kind: 'locked' };
  if (!result.data.allowed)
    return { kind: 'throttled', retryAfter: result.data.retry_after ?? 900 };
  return { kind: 'allowed' };
}

/** Records a sign-in attempt for throttling and lockout; failures of this call never block sign-in. */
export async function recordAttempt(
  email: string,
  kind: 'email_otp' | 'mfa',
  success: boolean,
): Promise<void> {
  await adminApi('POST /auth/attempt', {
    body: { ...(await subjectHashes(email)), kind, success },
  });
}

/**
 * Sends the email one-time code (R-08: `shouldCreateUser: false`, no magic link, no password). Only
 * an unreachable Auth service is reported; every other Auth answer (unknown email, per-email send
 * limit) looks exactly like a sent code.
 */
export async function sendEmailCode(
  supabase: SupabaseClient,
  email: string,
): Promise<'sent' | 'unavailable'> {
  const { error } = await supabase.auth.signInWithOtp({
    email: normaliseEmail(email),
    options: { shouldCreateUser: false },
  });
  if (error === null) return 'sent';
  const status = (error as { status?: number }).status ?? 0;
  return status === 0 || status >= 500 ? 'unavailable' : 'sent';
}

// ── Preferences mirrored into cookies at sign-in ─────────────────────────────
export async function syncPreferenceCookies(token: string): Promise<void> {
  const prefs = await adminApi('GET /preferences', {}, { token });
  if (!prefs.ok) return;
  const store = await cookies();
  store.set(THEME_COOKIE, parseTheme(prefs.data.theme), PREFERENCE_COOKIE_OPTIONS);
  store.set(LOCALE_COOKIE, parseLocale(prefs.data.locale), PREFERENCE_COOKIE_OPTIONS);
}
