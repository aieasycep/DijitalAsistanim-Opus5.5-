'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { remainingMs } from '@/lib/admin-context';
import { sessionRedirect } from '@/lib/error-copy';
import { currentOriginCheck, failure, runAdminMutation, type ActionResult } from '@/server/action';
import { adminApi } from '@/server/admin-api';
import { serverSupabase } from '@/server/supabase';

/*
 * Session lifecycle (BACKOFFICE_PLAN §3.7): heartbeat from the idle warning, sign-out, sign-out
 * everywhere and the local sign-out the SessionWatcher performs when a deadline passes.
 */

export type HeartbeatResult =
  | { readonly ok: true; readonly idleRemainingMs: number }
  | { readonly ok: false; readonly redirectTo: string | null };

/** "Oturumu sürdür": `POST /session/heartbeat` (user activity extends the idle window). */
export async function heartbeatAction(): Promise<HeartbeatResult> {
  const origin = await currentOriginCheck();
  if (!origin.ok) return { ok: false, redirectTo: null };
  const result = await adminApi('POST /session/heartbeat', { body: {} });
  if (result.ok) {
    return {
      ok: true,
      idleRemainingMs: remainingMs(result.data.idle_expires_at, result.meta.server_time),
    };
  }
  return { ok: false, redirectTo: sessionRedirect(result.error) };
}

async function signOutLocally(): Promise<void> {
  try {
    const supabase = await serverSupabase();
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Cookies are cleared by the sealed adapter even when Auth is unreachable.
  }
}

/** "Çıkış yap": `POST /session/logout` → local sign-out → `/login?reason=logged_out`. */
export async function logoutAction(): Promise<ActionResult<never>> {
  const origin = await currentOriginCheck();
  if (!origin.ok) return failure('CSRF_ORIGIN', 'errors.csrf', 403);
  // An already-ended session answers AUTH_REQUIRED; the local sign-out happens either way.
  await adminApi('POST /session/logout', { body: {} });
  await signOutLocally();
  redirect('/login?reason=logged_out');
}

/** "Tüm oturumlardan çık" (L2 confirm): ends every admin session, then revokes all refresh tokens. */
export async function logoutAllAction(
  envelope: unknown,
): Promise<ActionResult<{ ended_sessions: number }>> {
  const result = await runAdminMutation({
    route: 'POST /session/logout-all',
    body: { scope: 'all' },
    envelope,
  });
  if (!result.ok) return result;
  try {
    const supabase = await serverSupabase();
    await supabase.auth.signOut({ scope: 'global' });
  } catch {
    await signOutLocally();
  }
  redirect('/login?reason=logged_out');
}

const EndReason = z.enum(['idle', 'expired', 'revoked']);

/**
 * Called by the SessionWatcher when the idle or absolute deadline has passed or the session was
 * revoked: signs out on this device and lands on `/login?reason=…` with the matching banner.
 */
export async function endSessionAction(reason: unknown): Promise<ActionResult<never>> {
  const origin = await currentOriginCheck();
  if (!origin.ok) return failure('CSRF_ORIGIN', 'errors.csrf', 403);
  const parsed = EndReason.safeParse(reason);
  await signOutLocally();
  redirect(`/login?reason=${parsed.success ? parsed.data : 'idle'}`);
}
