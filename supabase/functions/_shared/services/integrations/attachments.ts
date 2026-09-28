/**
 * Mail attachment metadata (DATABASE_AND_RLS_PLAN `email_messages.attachment_meta`; API_CONTRACTS
 * API-MAIL-09, API-CAP-02; SCREEN_AND_FLOW_MAP M-CAP-03, M-MAIL-03; DESIGN_MAPPING DEV-41).
 *
 * - Only metadata is ever stored: `{name, mime, size, provider_attachment_id, kind}` (≤ 20, inline
 *   parts excluded). Content is fetched only on the user's request (`POST /captures`), through the
 *   provider API of the message's own account (fixed provider hosts, never a URL taken from mail):
 *   Graph item and reference attachments (a reference is a cloud link) are never fetched.
 * - `attachment_ref` v2 (`v2.{message_id}.{index}.{exp}.{sig}`, HMAC of `HASH_PEPPER`, 1 hour)
 *   names the index in the stored metadata; v1 refs of API-MAIL-01 name the index in the fetched
 *   body and keep working.
 * - The `attachments` Data Source Control (`ai_data_access.attachments`) gates storing and every
 *   use; the account toggle "Ekleri analiz et" (`attachments_analyze`) gates listing for capture
 *   and downloads.
 */
import { CAPTURE_LIMITS, CAPTURE_MIME_EXTENSIONS, type MailAttachmentView } from '@da/validation';
import { type MailAttachmentMeta, type MailProvider, ProviderError } from '@da/domain';
import { utf8 } from '../../crypto/encoding.ts';
import { hmacSha256Base64Url, timingSafeEqual } from '../../crypto/hmac.ts';
import { AppError } from '../../errors.ts';
import type { Logger } from '../../logging/logger.ts';
import { providerErrorToAppError } from '../../providers/errors.ts';
import { providerContextFor } from './context.ts';
import type { IntegrationRuntime } from './runtime.ts';
import { togglesOf } from './status.ts';

export const MAX_STORED_ATTACHMENTS = 20;
export const ATTACHMENT_REF_TTL_S = 3600;

/** One `email_messages.attachment_meta` element. */
export interface StoredAttachment {
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly provider_attachment_id: string;
  readonly kind: 'file' | 'item' | 'reference';
}

const KINDS: ReadonlySet<string> = new Set(['file', 'item', 'reference']);
const EXTENSION_MIME: ReadonlyMap<string, string> = new Map(
  Object.entries(CAPTURE_MIME_EXTENSIONS).flatMap(([mime, exts]) =>
    (exts as readonly string[]).map((ext) => [ext, mime] as const),
  ),
);

/** `type/subtype` in lower case, parameters removed. */
export function baseMime(mime: string): string {
  return (mime.split(';')[0] ?? '').trim().toLowerCase();
}

/** The capture MIME of an attachment: its own, or its file extension's when the type is generic. */
export function effectiveMime(a: Pick<StoredAttachment, 'name' | 'mime'>): string {
  const mime = baseMime(a.mime);
  if (mime !== '' && mime !== 'application/octet-stream' && mime !== 'binary/octet-stream')
    return mime;
  const ext = /\.([a-z0-9]{2,5})$/i.exec(a.name)?.[1]?.toLowerCase();
  return (
    (ext === undefined ? undefined : EXTENSION_MIME.get(ext)) ??
    (mime || 'application/octet-stream')
  );
}

/**
 * Provider metadata → the stored subset (≤ 20, bounded strings). Inline parts and parts without a
 * file name (no honest name to show or import under) are dropped.
 */
export function toStoredAttachments(list: readonly MailAttachmentMeta[]): StoredAttachment[] {
  return list
    .filter((a) => !a.inline && a.providerAttachmentId !== '' && a.filename.trim() !== '')
    .slice(0, MAX_STORED_ATTACHMENTS)
    .map((a) => ({
      name: a.filename.trim().slice(0, 255),
      mime: baseMime(a.mimeType).slice(0, 255) || 'application/octet-stream',
      size: Math.max(0, Math.floor(a.sizeBytes)),
      provider_attachment_id: a.providerAttachmentId.slice(0, 1024),
      kind: a.kind ?? 'file',
    }));
}

/** Defensive read of a stored `attachment_meta` array. */
export function parseStoredAttachments(value: unknown): StoredAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: StoredAttachment[] = [];
  for (const raw of value.slice(0, MAX_STORED_ATTACHMENTS)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.name !== 'string' || typeof r.provider_attachment_id !== 'string') continue;
    out.push({
      name: r.name.slice(0, 255),
      mime: typeof r.mime === 'string' ? r.mime : 'application/octet-stream',
      size: typeof r.size === 'number' && Number.isFinite(r.size) ? r.size : 0,
      provider_attachment_id: r.provider_attachment_id,
      kind:
        typeof r.kind === 'string' && KINDS.has(r.kind)
          ? (r.kind as StoredAttachment['kind'])
          : 'file',
    });
  }
  return out;
}

/** Whether `POST /captures` can import the attachment, and why not. */
export function capturability(a: StoredAttachment): {
  capturable: boolean;
  blocked_reason: MailAttachmentView['blocked_reason'];
} {
  if (a.kind !== 'file') return { capturable: false, blocked_reason: 'not_a_file' };
  const mime = effectiveMime(a);
  if (!(mime in CAPTURE_MIME_EXTENSIONS))
    return { capturable: false, blocked_reason: 'unsupported_type' };
  const limit = mime === 'application/pdf' ? CAPTURE_LIMITS.pdf_bytes : CAPTURE_LIMITS.image_bytes;
  if (a.size > limit) return { capturable: false, blocked_reason: 'too_large' };
  return { capturable: true, blocked_reason: null };
}

export async function signStoredAttachmentRef(
  secret: string,
  messageId: string,
  index: number,
  now: Date,
): Promise<string> {
  const exp = Math.floor(now.getTime() / 1000) + ATTACHMENT_REF_TTL_S;
  const head = `v2.${messageId}.${index}.${exp}`;
  return `${head}.${(await hmacSha256Base64Url(secret, `attachment-ref:${head}`)).slice(0, 32)}`;
}

/** `{messageId, index}` of a valid, unexpired v2 reference (index into `attachment_meta`). */
export async function verifyStoredAttachmentRef(
  secret: string,
  ref: string,
  now: Date,
): Promise<{ messageId: string; index: number } | null> {
  const match = /^v2\.([0-9a-f-]{36})\.(\d{1,2})\.(\d{10})\.([A-Za-z0-9_-]{32})$/.exec(ref);
  if (match === null) return null;
  const [, messageId = '', index = '0', exp = '0', sig = ''] = match;
  const expected = (
    await hmacSha256Base64Url(secret, `attachment-ref:v2.${messageId}.${index}.${exp}`)
  ).slice(0, 32);
  if (!timingSafeEqual(utf8.encode(expected), utf8.encode(sig))) return null;
  if (Number(exp) * 1000 < now.getTime()) return null;
  return { messageId, index: Number(index) };
}

/** Metadata of one message from its provider (list call, or the body's attachment list). */
export async function providerAttachments(
  adapter: MailProvider,
  ctx: Parameters<MailProvider['getMessageBody']>[0],
  providerMessageId: string,
): Promise<MailAttachmentMeta[]> {
  if (adapter.listAttachments !== undefined)
    return await adapter.listAttachments(ctx, providerMessageId);
  return (await adapter.getMessageBody(ctx, providerMessageId, { maxBytes: 16 * 1024 }))
    .attachments;
}

const READABLE: ReadonlySet<string> = new Set(['healthy', 'syncing', 'partial']);

export interface AttachmentAccess {
  readonly userId: string;
  readonly messageId: string;
  /** `ai_data_access.attachments` of the user. */
  readonly attachmentsAllowed: boolean;
  readonly correlationId: string;
  readonly log: Logger;
}

async function accessibleMessage(rt: IntegrationRuntime, input: AttachmentAccess) {
  if (!input.attachmentsAllowed) {
    throw new AppError('DATA_SOURCE_DISABLED', {
      details: { toggle: 'ai_data_access.attachments' },
    });
  }
  const message = await rt.store.getMessage(input.messageId);
  if (message === null || message.user_id !== input.userId)
    throw new AppError('NOT_FOUND', { details: { resource: 'email_message' } });
  if (message.provider_deleted_at !== null)
    throw new AppError('SOURCE_GONE', { details: { resource: 'email_message' } });
  const account = await rt.store.getAccount(message.connected_account_id);
  if (account === null || account.user_id !== input.userId || account.status === 'disconnected')
    throw new AppError('NOT_FOUND', { details: { resource: 'email_message' } });
  const toggles = togglesOf(account);
  if (!toggles.mail_read || !toggles.attachments_analyze) {
    throw new AppError('DATA_SOURCE_DISABLED', {
      details: {
        account_id: account.id,
        toggle: toggles.mail_read ? 'attachments_analyze' : 'mail_read',
      },
    });
  }
  return { message, account };
}

function providerFailure(
  error: unknown,
  provider: string,
  accountId: string,
): AppError | ProviderError | unknown {
  if (!(error instanceof ProviderError)) return error;
  if (error.code === 'not_found')
    return new AppError('SOURCE_GONE', { details: { resource: 'email_message' } });
  if (error.code === 'provider_unavailable' && error.providerReason === 'timeout')
    return new AppError('UPSTREAM_TIMEOUT', { details: { provider } });
  return providerErrorToAppError(error, provider as 'google' | 'microsoft' | 'demo', accountId);
}

/**
 * API-MAIL-09: the stored metadata with fresh v2 refs; a message synced before metadata existed
 * (or whose triage could not list it) is listed from its provider once and stored.
 */
export async function listMessageAttachments(
  rt: IntegrationRuntime,
  input: AttachmentAccess,
): Promise<{
  message_id: string;
  attachments: MailAttachmentView[];
  source: 'stored' | 'provider';
  refs_expire_at: string;
}> {
  const { message, account } = await accessibleMessage(rt, input);
  let stored = parseStoredAttachments(message.attachment_meta);
  let source: 'stored' | 'provider' = 'stored';
  if (stored.length === 0 && message.has_attachments === true) {
    if (!READABLE.has(account.status)) {
      throw new AppError('PROVIDER_REAUTH_REQUIRED', {
        details: { account_id: account.id, provider: account.provider },
      });
    }
    const adapter = rt.providers.resolve(account.provider as 'google' | 'microsoft' | 'demo').mail;
    if (adapter === undefined)
      throw new AppError('FEATURE_DISABLED', { details: { reason: 'mail_adapter_missing' } });
    try {
      const ctx = await providerContextFor(rt, account, {
        owner: `mail_attachments:${input.correlationId}`,
        correlationId: input.correlationId,
        log: input.log,
      });
      stored = toStoredAttachments(
        await providerAttachments(adapter, ctx, message.provider_message_id),
      );
    } catch (error) {
      throw providerFailure(error, account.provider, account.id);
    }
    await rt.store.setAttachmentMeta(message.id, stored);
    source = 'provider';
  }
  const now = rt.now();
  const attachments: MailAttachmentView[] = [];
  for (const [index, a] of stored.entries()) {
    attachments.push({
      attachment_ref: await signStoredAttachmentRef(rt.config.pepper, message.id, index, now),
      name: a.name,
      mime: effectiveMime(a),
      size_bytes: a.size,
      ...capturability(a),
    });
  }
  return {
    message_id: message.id,
    attachments,
    source,
    refs_expire_at: new Date(now.getTime() + ATTACHMENT_REF_TTL_S * 1000).toISOString(),
  };
}

export interface ImportedAttachment {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly name: string;
}

/**
 * API-CAP-02 with a v2 ref: the stored attachment is downloaded through the account's provider API
 * with the capture size cap. A Gmail attachment id can change between fetches: when the stored id
 * is gone, the message is listed again and the same file (name, type and size) is fetched once.
 */
export async function downloadStoredAttachment(
  rt: IntegrationRuntime,
  input: AttachmentAccess & { readonly index: number },
): Promise<ImportedAttachment> {
  const { message, account } = await accessibleMessage(rt, input);
  if (!READABLE.has(account.status)) {
    throw new AppError('PROVIDER_REAUTH_REQUIRED', {
      details: { account_id: account.id, provider: account.provider },
    });
  }
  const stored = parseStoredAttachments(message.attachment_meta);
  const target = stored[input.index];
  if (target === undefined)
    throw new AppError('SOURCE_GONE', { details: { resource: 'attachment' } });
  const check = capturability(target);
  if (!check.capturable) {
    if (check.blocked_reason === 'too_large') {
      throw new AppError('PAYLOAD_TOO_LARGE', {
        details: {
          limit_bytes:
            effectiveMime(target) === 'application/pdf'
              ? CAPTURE_LIMITS.pdf_bytes
              : CAPTURE_LIMITS.image_bytes,
        },
      });
    }
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', { details: { mime: effectiveMime(target) } });
  }
  const mime = effectiveMime(target);
  const limit = mime === 'application/pdf' ? CAPTURE_LIMITS.pdf_bytes : CAPTURE_LIMITS.image_bytes;
  const adapter = rt.providers.resolve(account.provider as 'google' | 'microsoft' | 'demo').mail;
  if (adapter === undefined)
    throw new AppError('FEATURE_DISABLED', { details: { reason: 'mail_adapter_missing' } });
  try {
    const ctx = await providerContextFor(rt, account, {
      owner: `capture:${input.correlationId}`,
      correlationId: input.correlationId,
      log: input.log,
    });
    let file;
    try {
      file = await adapter.getAttachment(
        ctx,
        message.provider_message_id,
        target.provider_attachment_id,
        {
          maxBytes: limit,
        },
      );
    } catch (error) {
      if (!(error instanceof ProviderError) || error.code !== 'not_found') throw error;
      const fresh = toStoredAttachments(
        await providerAttachments(adapter, ctx, message.provider_message_id),
      );
      const same = fresh.find(
        (a) =>
          a.name === target.name &&
          a.size === target.size &&
          baseMime(a.mime) === baseMime(target.mime),
      );
      if (same === undefined)
        throw new AppError('SOURCE_GONE', { details: { resource: 'attachment' } });
      await rt.store.setAttachmentMeta(message.id, fresh);
      file = await adapter.getAttachment(
        ctx,
        message.provider_message_id,
        same.provider_attachment_id,
        {
          maxBytes: limit,
        },
      );
    }
    if (file.bytes.byteLength > limit)
      throw new AppError('PAYLOAD_TOO_LARGE', { details: { limit_bytes: limit } });
    return { bytes: file.bytes, mime, name: target.name };
  } catch (error) {
    throw providerFailure(error, account.provider, account.id);
  }
}

/** Meeting prep "İLGİLİ DOSYALAR" (DEV-41): capturable-or-not files of the given mails, newest first. */
export async function relevantFiles(
  secret: string,
  mails: readonly { id: string; attachment_meta: unknown }[],
  now: Date,
  limit = 5,
): Promise<{ name: string; attachment_ref: string; email_message_id: string }[]> {
  const out: { name: string; attachment_ref: string; email_message_id: string }[] = [];
  const seen = new Set<string>();
  for (const mail of mails) {
    for (const [index, a] of parseStoredAttachments(mail.attachment_meta).entries()) {
      if (a.kind !== 'file') continue;
      const key = `${a.name.toLowerCase()}|${a.size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: a.name,
        attachment_ref: await signStoredAttachmentRef(secret, mail.id, index, now),
        email_message_id: mail.id,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
