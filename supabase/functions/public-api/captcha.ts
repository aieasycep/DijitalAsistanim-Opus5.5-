/**
 * Cloudflare Turnstile verification for PUB-01 / PUB-02 (API_CONTRACTS §13 common rules). Used only
 * when `TURNSTILE_SECRET_KEY` is configured (External credential required for production anti-spam);
 * without it the rate limits and the honeypot apply. A missing, invalid or unverifiable token fails.
 */
import { OUTBOUND } from '../_shared/config.ts';
import type { CaptchaVerifier } from './deps.ts';

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function turnstileVerifier(
  secret: string | undefined,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): CaptchaVerifier | null {
  const key = secret?.trim() ?? '';
  if (key === '') return null;
  const doFetch = options.fetch ?? fetch;
  return {
    async verify(token) {
      if (token === undefined || token.trim() === '') return false;
      try {
        const response = await doFetch(TURNSTILE_VERIFY_URL, {
          method: 'POST',
          body: new URLSearchParams({ secret: key, response: token }),
          signal: AbortSignal.timeout(options.timeoutMs ?? OUTBOUND.providerTimeoutMs),
        });
        if (!response.ok) {
          await response.body?.cancel();
          return false;
        }
        const body = (await response.json().catch(() => null)) as { success?: unknown } | null;
        return body?.success === true;
      } catch {
        return false;
      }
    },
  };
}
