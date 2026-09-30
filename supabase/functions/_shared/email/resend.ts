/**
 * Resend adapter (`POST https://api.resend.com/emails`, bearer `EMAIL_API_KEY`; the provider named
 * in INTEGRATION_PLAN §11 for the launch stack). The response `id` is the message id; 4xx refusals
 * are final, 429 and 5xx are retried by the job.
 */
import { OUTBOUND } from '../config.ts';
import type { EmailConfig, EmailMessage, EmailProvider, EmailSendResult } from './types.ts';
import { EmailSendError, sendErrorFor } from './types.ts';

export const RESEND_URL = 'https://api.resend.com/emails';

export function createResendProvider(
  config: EmailConfig,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): EmailProvider {
  const doFetch = options.fetch ?? fetch;
  return {
    id: 'resend',
    async send(message: EmailMessage): Promise<EmailSendResult> {
      let response: Response;
      try {
        response = await doFetch(RESEND_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            ...(message.replyTo ? { reply_to: message.replyTo } : {}),
            tags: [{ name: 'template', value: message.tag }],
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? OUTBOUND.providerTimeoutMs),
        });
      } catch {
        throw new EmailSendError('network', true, null);
      }
      const body = (await response.json().catch(() => ({}))) as { id?: string; name?: string };
      if (!response.ok || typeof body.id !== 'string') {
        throw sendErrorFor(
          response.ok ? 422 : response.status,
          `resend_${body.name ?? response.status}`,
        );
      }
      return { messageId: body.id };
    },
  };
}
