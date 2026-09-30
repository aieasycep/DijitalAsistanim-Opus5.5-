/**
 * "Orijinal Mail" (API_CONTRACTS API-MAIL-01; M§15, ADR-05, SREQ-15; T-4.03, T-4.07). The body is
 * fetched from the provider on demand, sanitised (allow-list; remote images blocked unless the user
 * allows them) and returned; it is never stored and never logged. A provider 404 marks the message
 * deleted (`SOURCE_GONE`). Attachments are listed with an opaque, HMAC-signed `attachment_ref`
 * (`v1.{message_id}.{index}.{expires_epoch}.{sig}`, valid 1 hour) that API-CAP-02 resolves with
 * `verifyAttachmentRef` and a fresh body fetch.
 */
import { ProviderError } from '@da/domain';
import { hmacSha256Base64Url, timingSafeEqual } from '../../crypto/hmac.ts';
import { utf8 } from '../../crypto/encoding.ts';
import { AppError } from '../../errors.ts';
import type { Logger } from '../../logging/logger.ts';
import { providerErrorToAppError } from '../../providers/errors.ts';
import { sanitizeHtml } from '../../security/html-sanitize.ts';
import { providerContextFor } from './context.ts';
import type { IntegrationRuntime } from './runtime.ts';
import { togglesOf } from './status.ts';

const MAX_BODY_BYTES = 512 * 1024;
const MAX_CONTENT_CHARS = 524_288;
const REF_TTL_S = 3600;

export interface MailOriginal {
  readonly message_id: string;
  readonly subject: string;
  readonly from: { email: string; name?: string };
  readonly to: { email: string }[];
  readonly cc: { email: string }[];
  readonly date: string;
  readonly body: {
    readonly format: 'html_sanitized' | 'text';
    readonly content: string;
    readonly truncated: boolean;
    readonly remote_images_blocked: boolean;
  };
  readonly attachments: {
    attachment_ref: string;
    name: string;
    mime: string;
    size_bytes: number;
  }[];
  readonly web_link: string | null;
  readonly fetched_at: string;
}

export async function signAttachmentRef(
  secret: string,
  messageId: string,
  index: number,
  now: Date,
): Promise<string> {
  const exp = Math.floor(now.getTime() / 1000) + REF_TTL_S;
  const head = `v1.${messageId}.${index}.${exp}`;
  return `${head}.${(await hmacSha256Base64Url(secret, `attachment-ref:${head}`)).slice(0, 32)}`;
}

/** `{messageId, index}` of a valid, unexpired reference; null otherwise. */
export async function verifyAttachmentRef(
  secret: string,
  ref: string,
  now: Date,
): Promise<{ messageId: string; index: number } | null> {
  const match = /^v1\.([0-9a-f-]{36})\.(\d{1,2})\.(\d{10})\.([A-Za-z0-9_-]{32})$/.exec(ref);
  if (match === null) return null;
  const [, messageId = '', index = '0', exp = '0', sig = ''] = match;
  const expected = (
    await hmacSha256Base64Url(secret, `attachment-ref:v1.${messageId}.${index}.${exp}`)
  ).slice(0, 32);
  if (!timingSafeEqual(utf8.encode(expected), utf8.encode(sig))) return null;
  if (Number(exp) * 1000 < now.getTime()) return null;
  return { messageId, index: Number(index) };
}

export async function fetchMailOriginal(
  rt: IntegrationRuntime,
  input: {
    userId: string;
    messageId: string;
    remoteImages: 'blocked' | 'allowed';
    correlationId: string;
    log: Logger;
  },
): Promise<MailOriginal> {
  const message = await rt.store.getMessage(input.messageId);
  if (message === null || message.user_id !== input.userId)
    throw new AppError('NOT_FOUND', { details: { resource: 'email_message' } });
  if (message.provider_deleted_at !== null)
    throw new AppError('SOURCE_GONE', { details: { resource: 'email_message' } });
  const account = await rt.store.getAccount(message.connected_account_id);
  if (account === null || account.status === 'disconnected')
    throw new AppError('NOT_FOUND', { details: { resource: 'email_message' } });
  if (!togglesOf(account).mail_read)
    throw new AppError('DATA_SOURCE_DISABLED', { details: { account_id: account.id } });
  if (account.status === 'needs_reauth') {
    throw new AppError('PROVIDER_REAUTH_REQUIRED', {
      details: { account_id: account.id, provider: account.provider },
    });
  }
  const provider = account.provider as 'google' | 'microsoft' | 'demo';
  let body;
  try {
    const adapters = rt.providers.resolve(provider);
    if (adapters.mail === undefined)
      throw new AppError('FEATURE_DISABLED', { details: { reason: 'mail_adapter_missing' } });
    const ctx = await providerContextFor(rt, account, {
      owner: `mail_original:${input.correlationId}`,
      correlationId: input.correlationId,
      log: input.log,
    });
    body = await adapters.mail.getMessageBody(ctx, message.provider_message_id, {
      maxBytes: MAX_BODY_BYTES,
    });
  } catch (error) {
    if (error instanceof ProviderError) {
      if (error.code === 'not_found') {
        await rt.store.applyMailChanges(account.id, [], [message.provider_message_id]);
        throw new AppError('SOURCE_GONE', { details: { resource: 'email_message' } });
      }
      if (error.code === 'provider_unavailable' && error.providerReason === 'timeout') {
        throw new AppError('UPSTREAM_TIMEOUT', { details: { provider } });
      }
      throw providerErrorToAppError(error, provider, account.id);
    }
    throw error;
  }

  const allowImages = input.remoteImages === 'allowed';
  let content: string;
  let format: 'html_sanitized' | 'text';
  let imagesBlocked = false;
  if (body.html !== null && body.html.trim() !== '') {
    const clean = sanitizeHtml(body.html, { allowRemoteImages: allowImages });
    content = clean.html;
    format = 'html_sanitized';
    imagesBlocked = !allowImages && clean.removedImages > 0;
  } else {
    content = body.text;
    format = 'text';
  }
  const truncated = body.truncated || content.length > MAX_CONTENT_CHARS;
  const now = rt.now();
  const attachments = [];
  for (const [index, a] of body.attachments.slice(0, 50).entries()) {
    if (a.inline) continue;
    attachments.push({
      attachment_ref: await signAttachmentRef(rt.config.pepper, message.id, index, now),
      name: a.filename.slice(0, 255),
      mime: a.mimeType,
      size_bytes: a.sizeBytes,
    });
  }
  return {
    message_id: message.id,
    subject: message.subject ?? '',
    from: {
      email: message.from_email,
      ...(message.from_name === null ? {} : { name: message.from_name.slice(0, 200) }),
    },
    to: message.to_emails.map((email) => ({ email })),
    cc: message.cc_emails.map((email) => ({ email })),
    date: new Date(message.received_at).toISOString(),
    body: {
      format,
      content: content.slice(0, MAX_CONTENT_CHARS),
      truncated,
      remote_images_blocked: imagesBlocked,
    },
    attachments,
    web_link: message.web_link,
    fetched_at: now.toISOString(),
  };
}
