/**
 * Postmark adapter (`POST https://api.postmarkapp.com/email`, header `X-Postmark-Server-Token`,
 * message stream `outbound`). A response with `ErrorCode = 0` carries the `MessageID`; 422 codes
 * (invalid or inactive recipient, sender signature) are final, 429 and 5xx are retried by the job.
 */
import { OUTBOUND } from '../config.ts';
import type { EmailConfig, EmailMessage, EmailProvider, EmailSendResult } from './types.ts';
import { EmailSendError, sendErrorFor } from './types.ts';

export const POSTMARK_URL = 'https://api.postmarkapp.com/email';

export function createPostmarkProvider(
  config: EmailConfig,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): EmailProvider {
  const doFetch = options.fetch ?? fetch;
  return {
    id: 'postmark',
    async send(message: EmailMessage): Promise<EmailSendResult> {
      let response: Response;
      try {
        response = await doFetch(POSTMARK_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Postmark-Server-Token': config.apiKey,
          },
          body: JSON.stringify({
            From: config.from,
            To: message.to,
            Subject: message.subject,
            TextBody: message.text,
            HtmlBody: message.html,
            ...(message.replyTo ? { ReplyTo: message.replyTo } : {}),
            Tag: message.tag,
            Metadata: message.metadata ?? {},
            MessageStream: 'outbound',
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? OUTBOUND.providerTimeoutMs),
        });
      } catch {
        throw new EmailSendError('network', true, null);
      }
      const body = (await response.json().catch(() => ({}))) as {
        ErrorCode?: number;
        MessageID?: string;
      };
      if (!response.ok || (body.ErrorCode ?? 0) !== 0 || typeof body.MessageID !== 'string') {
        throw sendErrorFor(
          response.ok ? 422 : response.status,
          `postmark_${body.ErrorCode ?? response.status}`,
        );
      }
      return { messageId: body.MessageID };
    },
  };
}
