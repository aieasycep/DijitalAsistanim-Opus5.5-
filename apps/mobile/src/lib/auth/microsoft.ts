/**
 * Microsoft sign-in (ADR-06, INTEGRATION_PLAN §8.3): Supabase `azure` provider, tenant `common`,
 * `email` scope, PKCE through the system auth session. The Entra app is an external credential;
 * when the project has not enabled the provider the button shows "Harici kimlik bilgisi gerekli".
 */
import { signInWithBrowserOAuth, type BrowserOAuthDeps } from './browser-oauth';
import type { AuthResult } from './result';

export function signInWithMicrosoft(deps: BrowserOAuthDeps = {}): Promise<AuthResult> {
  return signInWithBrowserOAuth('azure', deps);
}
