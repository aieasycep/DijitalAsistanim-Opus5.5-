'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { currentOriginCheck } from '@/server/action';
import { adminApi } from '@/server/admin-api';
import {
  CODE_REQUEST_MIN_MS,
  MFA_MAX_FAILURES,
  RESEND_COOLDOWN_S,
  clearLoginStep,
  padTo,
  preflight,
  readLoginStep,
  readMfaFailures,
  recordAttempt,
  sendEmailCode,
  syncPreferenceCookies,
  writeLoginStep,
  writeMfaFailures,
} from '@/server/auth-flow';
import { safeNextPath } from '@/server/request-meta';
import { verifyTotpCode } from '@/server/mfa';
import { serverSupabase } from '@/server/supabase';

/*
 * Admin sign-in (BACKOFFICE_PLAN §3.2–§3.5, R-08): email one-time code → TOTP (aal2) → admin session
 * → recovery codes. Every action re-checks the Origin (the proxy already did). Copy is generic
 * wherever an answer could reveal whether an admin account exists.
 */

export type AuthFormState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'error';
      /** Key under `backoffice.*`. */
      readonly messageKey: string;
      readonly values?: Readonly<Record<string, string | number>>;
    }
  | {
      readonly status: 'notice';
      readonly messageKey: string;
      readonly values?: Readonly<Record<string, string | number>>;
    }
  | { readonly status: 'codes'; readonly codes: readonly string[]; readonly next: string };

const EmailField = z.email().max(254);
const SixDigits = z.string().regex(/^\d{6}$/);

function error(messageKey: string, values?: Record<string, string | number>): AuthFormState {
  return values === undefined
    ? { status: 'error', messageKey }
    : { status: 'error', messageKey, values };
}

async function originGuard(): Promise<AuthFormState | null> {
  const check = await currentOriginCheck();
  return check.ok ? null : error('errors.csrf');
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** Preflight + code send + login-step cookie; shared by the login form and invite acceptance. */
async function startEmailCode(email: string, next: string): Promise<AuthFormState | null> {
  const startedAt = Date.now();
  const gate = await preflight(email);
  if (gate.kind === 'locked') return error('auth.locked');
  if (gate.kind === 'throttled') {
    return error('auth.tooMany', { minutes: Math.max(1, Math.ceil(gate.retryAfter / 60)) });
  }
  if (gate.kind === 'unavailable') return error('auth.unavailable');
  const sent = await sendEmailCode(await serverSupabase(), email);
  await padTo(startedAt, CODE_REQUEST_MIN_MS);
  if (sent === 'unavailable') return error('auth.unavailable');
  await writeLoginStep({ email, sentAt: Date.now(), next });
  return null;
}

/** Step 1: request the 6-digit email code (`/login`). */
export async function requestCodeAction(
  _prev: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const blocked = await originGuard();
  if (blocked !== null) return blocked;
  const email = EmailField.safeParse(field(form, 'email').toLowerCase());
  if (!email.success) return error('auth.emailInvalid');
  const next = safeNextPath(field(form, 'next'));
  const failed = await startEmailCode(email.data, next);
  if (failed !== null) return failed;
  redirect('/login?step=code');
}

/** "Kodu tekrar gönder", available 60 s after the previous code. */
export async function resendCodeAction(_prev: AuthFormState): Promise<AuthFormState> {
  const blocked = await originGuard();
  if (blocked !== null) return blocked;
  const step = await readLoginStep();
  if (step === null) return error('auth.stepExpired');
  const waited = Math.floor((Date.now() - step.sentAt) / 1000);
  if (waited < RESEND_COOLDOWN_S) {
    return {
      status: 'notice',
      messageKey: 'auth.resendIn',
      values: { seconds: RESEND_COOLDOWN_S - waited },
    };
  }
  const failed = await startEmailCode(step.email, step.next);
  if (failed !== null) return failed;
  redirect('/login?step=code');
}

/** Step 2: verify the email code → aal1 session → admin gate → `/mfa`. */
export async function verifyCodeAction(
  _prev: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const blocked = await originGuard();
  if (blocked !== null) return blocked;
  const step = await readLoginStep();
  if (step === null) return error('auth.stepExpired');
  const code = SixDigits.safeParse(field(form, 'code'));
  if (!code.success) return error('auth.codeFormat');

  const supabase = await serverSupabase();
  const verified = await supabase.auth.verifyOtp({
    email: step.email,
    token: code.data,
    type: 'email',
  });
  if (verified.error !== null || verified.data.session === null) {
    const status = (verified.error as { status?: number } | null)?.status ?? 400;
    if (status === 0 || status >= 500) return error('auth.unavailable');
    await recordAttempt(step.email, 'email_otp', false);
    return error('auth.codeInvalid');
  }
  await recordAttempt(step.email, 'email_otp', true);

  const status = await adminApi(
    'GET /auth/status',
    {},
    { token: verified.data.session.access_token },
  );
  if (!status.ok || !status.data.is_admin || status.data.status === 'disabled') {
    await supabase.auth.signOut({ scope: 'local' });
    await clearLoginStep();
    return status.ok || status.error.code === 'FORBIDDEN' || status.error.code === 'AUTH_REQUIRED'
      ? error('auth.notAdmin')
      : error('auth.unavailable');
  }
  await clearLoginStep();
  await writeMfaFailures(0);
  redirect(step.next === '/dashboard' ? '/mfa' : `/mfa?next=${encodeURIComponent(step.next)}`);
}

/** Step 3: TOTP enrolment or challenge → aal2 → `POST /session/start` → recovery codes or `next`. */
export async function verifyMfaAction(
  _prev: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const blocked = await originGuard();
  if (blocked !== null) return blocked;
  const code = SixDigits.safeParse(field(form, 'code'));
  if (!code.success) return error('auth.codeFormat');
  const factorId = z.uuid().safeParse(field(form, 'factorId'));
  if (!factorId.success) return error('auth.mfaInvalid');
  const enrolling = field(form, 'mode') === 'enroll';
  const next = safeNextPath(field(form, 'next'));

  const supabase = await serverSupabase();
  const claims = (await supabase.auth.getClaims()).data?.claims;
  const email = typeof claims?.email === 'string' ? claims.email : '';
  // Enrolment verifies the new factor; a challenge accepts either verified device (§3.3 backup).
  let accessToken: string | null = null;
  let status = 400;
  if (enrolling) {
    const verified = await supabase.auth.mfa.challengeAndVerify({
      factorId: factorId.data,
      code: code.data,
    });
    if (verified.error === null) accessToken = verified.data.access_token;
    else status = (verified.error as { status?: number }).status ?? 400;
  } else {
    const verified = await verifyTotpCode(supabase, code.data, factorId.data);
    if (verified.ok) accessToken = verified.accessToken;
    else status = verified.status;
  }
  if (accessToken === null) {
    if (status === 0 || status >= 500) return error('auth.unavailable');
    const failures = (await readMfaFailures()) + 1;
    if (email !== '') await recordAttempt(email, 'mfa', false);
    if (failures >= MFA_MAX_FAILURES) {
      await writeMfaFailures(0);
      await supabase.auth.signOut({ scope: 'local' });
      redirect('/login?reason=mfa_failed');
    }
    await writeMfaFailures(failures);
    return error('auth.mfaInvalid');
  }
  await writeMfaFailures(0);
  if (email !== '') await recordAttempt(email, 'mfa', true);

  const token = accessToken;
  const started = await adminApi('POST /session/start', { body: {} }, { token });
  if (!started.ok) {
    if (started.error.code === 'FORBIDDEN' || started.error.code === 'AUTH_REQUIRED') {
      await supabase.auth.signOut({ scope: 'local' });
      redirect('/login?reason=not_admin');
    }
    return error('auth.unavailable');
  }
  await syncPreferenceCookies(token);

  const me = await adminApi('GET /me', {}, { token });
  const needsCodes = enrolling || (me.ok && me.data.admin.recovery_codes_remaining === 0);
  if (!needsCodes) redirect(next);
  const codes = await issueRecoveryCodes(token);
  return codes === null ? error('auth.codes.failed') : { status: 'codes', codes, next };
}

/** Fresh step-up (the TOTP was just verified), then `POST /me/recovery-codes` (§3.4). */
async function issueRecoveryCodes(token: string): Promise<readonly string[] | null> {
  const stepUp = await adminApi('POST /session/step-up', { body: {} }, { token });
  if (!stepUp.ok) return null;
  const issued = await adminApi('POST /me/recovery-codes', { body: {} }, { token });
  return issued.ok ? issued.data.codes : null;
}

/** Retry for the recovery-code screen when issuing failed right after MFA. */
export async function retryRecoveryCodesAction(
  _prev: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const blocked = await originGuard();
  if (blocked !== null) return blocked;
  const next = safeNextPath(field(form, 'next'));
  const supabase = await serverSupabase();
  const { data } = await supabase.auth.getSession();
  if (data.session === null) redirect('/login');
  const codes = await issueRecoveryCodes(data.session.access_token);
  return codes === null ? error('auth.codes.failed') : { status: 'codes', codes, next };
}

/** "Kimlik doğrulayıcıma erişemiyorum": consume a recovery code at aal1, then re-enrol (§3.4). */
export async function redeemRecoveryCodeAction(
  _prev: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const blocked = await originGuard();
  if (blocked !== null) return blocked;
  const code = field(form, 'code').toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9]{4}-?[A-Z0-9]{4}-?[A-Z0-9]{2,4}$/.test(code))
    return error('auth.recovery.invalid');
  const next = safeNextPath(field(form, 'next'));
  const result = await adminApi('POST /auth/recovery-code/redeem', { body: { code } });
  if (!result.ok) {
    if (result.error.code === 'RATE_LIMITED') {
      return error('auth.tooMany', {
        minutes: Math.max(1, Math.ceil((result.error.retryAfter ?? 3600) / 60)),
      });
    }
    if (result.error.code === 'AUTH_REQUIRED') redirect('/login');
    if (result.error.code === 'NETWORK_ERROR' || result.error.status >= 500)
      return error('auth.unavailable');
    return error('auth.recovery.invalid');
  }
  redirect(`/mfa?recovered=1${next === '/dashboard' ? '' : `&next=${encodeURIComponent(next)}`}`);
}

/**
 * `/invite`: the button-only page defeats link prefetchers. Redeeming marks the invitation accepted
 * and hands the email back to this server only; sign-in then continues with an email code (§3.5).
 */
export async function acceptInviteAction(
  _prev: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const blocked = await originGuard();
  if (blocked !== null) return blocked;
  const token = field(form, 'token');
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return error('auth.invite.invalid');
  const redeemed = await adminApi('POST /auth/invite/redeem', { body: { token } });
  if (!redeemed.ok) {
    const reason = JSON.stringify(redeemed.error.details ?? {});
    if (redeemed.error.code === 'NETWORK_ERROR' || redeemed.error.status >= 500)
      return error('auth.unavailable');
    if (redeemed.error.code === 'STATE_CONFLICT' || reason.includes('expired'))
      return error('auth.invite.expired');
    return error('auth.invite.invalid');
  }
  const failed = await startEmailCode(redeemed.data.email, '/dashboard');
  if (failed !== null) return failed;
  redirect('/login?step=code');
}
