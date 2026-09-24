import { z } from './zod.ts';

/**
 * `/oauth/done` view model (SCREEN_AND_FLOW_MAP Part 5 W-OAUTH-01; API_CONTRACTS OAUTH-01 redirect
 * contract; plan R-07). Only allow-listed parameters are read; everything else (`code`, `state`,
 * `error_description`, …) is ignored and never rendered, logged or forwarded. The page never says
 * "connected": the account is bound only when the initiating app calls
 * `POST /integrations/oauth/complete` with its own session and device nonce.
 */

export const OAUTH_PROVIDERS = ['google', 'microsoft', 'demo'] as const;
export const OAUTH_RESULTS = [
  'pending_confirmation',
  'denied',
  'error',
  'expired_state',
  'admin_consent_required',
] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
export type OAuthVariant =
  'pending' | 'denied' | 'mismatch' | 'scope' | 'error' | 'expired' | 'admin';

const Params = z.object({
  provider: z.enum(OAUTH_PROVIDERS).optional().catch(undefined),
  result: z.enum(OAUTH_RESULTS).optional().catch(undefined),
  completion_code: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .optional()
    .catch(undefined),
  error_code: z
    .string()
    .regex(/^[a-z_]{1,40}$/)
    .optional()
    .catch(undefined),
  state_id: z.uuid().optional().catch(undefined),
});

export interface OAuthDoneModel {
  readonly variant: OAuthVariant;
  readonly provider: OAuthProvider | null;
  /** Analytics value (`web_oauth_done_view.result`). */
  readonly resultForAnalytics: (typeof OAUTH_RESULTS)[number] | 'unknown';
  /** Allow-listed parameters to forward to `dijitalasistan://integrations/callback`. */
  readonly callbackQuery: URLSearchParams;
}

type Raw = Readonly<Record<string, string | readonly string[] | undefined>>;

function first(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.[0];
}

export function oauthDoneModel(raw: Raw): OAuthDoneModel {
  const parsed = Params.parse({
    provider: first(raw.provider),
    result: first(raw.result),
    completion_code: first(raw.completion_code),
    error_code: first(raw.error_code),
    state_id: first(raw.state_id),
  });
  const provider = parsed.provider ?? null;
  const result = parsed.result;

  let variant: OAuthVariant;
  switch (result) {
    case 'pending_confirmation':
      variant = parsed.completion_code !== undefined && provider !== null ? 'pending' : 'error';
      break;
    case 'denied':
      variant = parsed.error_code === 'scope_missing' ? 'scope' : 'denied';
      break;
    case 'error':
      variant =
        parsed.error_code === 'account_mismatch'
          ? 'mismatch'
          : parsed.error_code === 'scope_missing'
            ? 'scope'
            : 'error';
      break;
    case 'expired_state':
      variant = 'expired';
      break;
    case 'admin_consent_required':
      variant = 'admin';
      break;
    case undefined:
      variant = 'error';
      break;
  }

  const callbackQuery = new URLSearchParams();
  if (provider !== null) callbackQuery.set('provider', provider);
  if (result !== undefined) callbackQuery.set('result', result);
  if (variant === 'pending' && parsed.completion_code !== undefined) {
    callbackQuery.set('completion_code', parsed.completion_code);
  }
  if (parsed.state_id !== undefined) callbackQuery.set('state_id', parsed.state_id);
  if (parsed.error_code !== undefined) callbackQuery.set('error_code', parsed.error_code);

  return {
    variant,
    provider,
    resultForAnalytics: result ?? 'unknown',
    callbackQuery,
  };
}
