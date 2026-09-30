/** Email adapter types shared by `provider.ts` and the adapters (JOB-31). */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly replyTo?: string | null;
  /** Provider tag / category for delivery analytics (template key; never content). */
  readonly tag: string;
  /** Non-content metadata (ids only). */
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface EmailSendResult {
  readonly messageId: string;
}

export interface EmailProvider {
  readonly id: 'postmark' | 'resend';
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** A provider refusal; `retryable` for throttling and 5xx, not for rejected recipients or keys. */
export class EmailSendError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly status: number | null,
  ) {
    super(`email_send_${code}`);
    this.name = 'EmailSendError';
  }
}

export interface EmailConfig {
  readonly provider: 'postmark' | 'resend';
  readonly apiKey: string;
  readonly from: string;
  readonly replyTo: string | null;
}

/** Maps an HTTP status to the retry semantics shared by the adapters. */
export function sendErrorFor(status: number, code: string): EmailSendError {
  return new EmailSendError(code, status === 429 || status >= 500, status);
}
