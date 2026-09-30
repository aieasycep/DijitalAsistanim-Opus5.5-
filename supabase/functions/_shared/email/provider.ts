/**
 * Transactional email over HTTPS (Edge Functions cannot open SMTP ports; INTEGRATION_PLAN §11,
 * API_CONTRACTS JOB-31; IMPLEMENTATION_PLAN T-10.01). `EMAIL_PROVIDER` selects the adapter:
 * `postmark` (`_shared/email/postmark.ts`) or `resend` (`_shared/email/resend.ts`), both with
 * `EMAIL_API_KEY` from `EMAIL_FROM_ADDRESS`. External credential required: without the three keys
 * (or with an unsupported provider) no adapter exists and callers report
 * `EXTERNAL_CREDENTIAL_REQUIRED`. Addresses and bodies are never logged.
 */
import { credentialStatus, type RawEnv } from '../env.ts';
import { createPostmarkProvider } from './postmark.ts';
import { createResendProvider } from './resend.ts';
import type { EmailConfig, EmailProvider } from './types.ts';

export type { EmailConfig, EmailMessage, EmailProvider, EmailSendResult } from './types.ts';
export { EmailSendError } from './types.ts';

export type EmailConfigResult =
  | { readonly configured: true; readonly config: EmailConfig }
  | { readonly configured: false; readonly missing: readonly string[]; readonly reason: string };

export function emailConfig(raw: RawEnv): EmailConfigResult {
  const status = credentialStatus('email_delivery', raw);
  if (status.status !== 'configured') {
    return { configured: false, missing: status.missing, reason: 'external_credential_required' };
  }
  const provider = raw.EMAIL_PROVIDER?.trim();
  if (provider !== 'postmark' && provider !== 'resend') {
    return { configured: false, missing: ['EMAIL_PROVIDER'], reason: 'unsupported_provider' };
  }
  return {
    configured: true,
    config: {
      provider,
      apiKey: (raw.EMAIL_API_KEY ?? '').trim(),
      from: (raw.EMAIL_FROM_ADDRESS ?? '').trim(),
      replyTo: raw.EMAIL_REPLY_TO?.trim() || null,
    },
  };
}

export function createEmailProvider(
  config: EmailConfig,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): EmailProvider {
  return config.provider === 'postmark'
    ? createPostmarkProvider(config, options)
    : createResendProvider(config, options);
}
