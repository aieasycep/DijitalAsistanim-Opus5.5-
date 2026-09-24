/**
 * What every successful sign-in does next: analytics, the post-auth pipeline, and the
 * new-account notice when a sign-in-mode login created a fresh profile. Routing is left to the root
 * guards: the session flips `(auth)` off and the entry resolver picks the next screen.
 */
import type { AuthMode } from '../../lib/auth/email-otp';
import { runPostSignIn } from '../../lib/auth/post-sign-in';
import type { AuthMethod, AuthResult } from '../../lib/auth/result';
import { track } from '../../lib/events';
import { sheets } from '../../providers/SheetHost';
import { NEW_ACCOUNT_NOTICE_SHEET } from './NewAccountNotice';

export async function completeSignIn(
  result: Extract<AuthResult, { ok: true }>,
  method: AuthMethod,
  mode: AuthMode,
): Promise<void> {
  if (result.completedElsewhere === true) return;
  track('auth_succeeded', { method, is_new_user: result.isNewUser });
  const post = await runPostSignIn({
    userId: result.userId,
    method,
    mode,
    isNewUser: result.isNewUser,
  });
  if (post.showNewAccountNotice) sheets.open(NEW_ACCOUNT_NOTICE_SHEET, undefined);
}

/** `mode` as the analytics vocabulary spells it. */
export function analyticsMode(mode: AuthMode): 'sign_in' | 'sign_up' {
  return mode === 'signin' ? 'sign_in' : 'sign_up';
}
