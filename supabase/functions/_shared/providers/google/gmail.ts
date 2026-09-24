/**
 * Gmail `MailProvider` (INTEGRATION_PLAN §4.4, §3.12; API_CONTRACTS JOB-01/02, API-MAIL-01; T-4.03):
 * - listing with Gmail search (`in:inbox|in:sent after: before: -category:…`), `format=metadata`
 *   with the triage header allow-list (bodies only for triage survivors and "Orijinal Mail");
 * - incremental changes from `history.list` (404 → `cursor_invalid`), cursor committed only after the
 *   last page; SPAM/TRASH count as deleted;
 * - `users.watch` on INBOX+SENT to `GOOGLE_PUBSUB_TOPIC` (`labelFilterBehavior: include`), renewed
 *   daily; `users.stop` on disconnect;
 * - writes: `messages.send {raw, threadId}` with the marker Message-ID; probe
 *   `rfc822msgid:` first, then a subject/window fallback comparing the normalised body.
 * Every call consumes the per-user unit bucket (`gmail_user_units`).
 */
import {
  type IdempotencyMarker,
  type MailChangeSet,
  type MailCursor,
  type MailProvider,
  type MailWindowQuery,
  type NormalizedMailMessage,
  type OutboundReply,
  type ProviderContext,
  ProviderError,
  type ProviderIdentity,
  type ProviderPage,
  type QuotaPriority,
  type TransientMailBody,
  type WatchHandle,
  type WriteOutcome,
} from '@da/domain';
import { fromBase64Url } from '../../crypto/encoding.ts';
import {
  type AdapterHttp,
  authorizedJson,
  decodeMimeWords,
  excerpt,
  isoOrNull,
  jsonBody,
  mapLimited,
  parseAddress,
  parseAddressList,
} from '../common.ts';
import { GMAIL_COST, GMAIL_METADATA_HEADERS, type GoogleEndpoints } from './config.ts';
import { buildReplyMime, encodeRaw, type GmailPart, parseGmailPayload } from './mime.ts';

export interface GmailConfig {
  readonly endpoints: GoogleEndpoints;
  readonly http: AdapterHttp;
  /** `GOOGLE_PUBSUB_TOPIC`; null → no push, the 10-minute poll fallback applies. */
  readonly pubsubTopic: string | null;
}

interface GmailMessage extends Record<string, unknown> {
  readonly id: string;
  readonly threadId: string;
  readonly labelIds?: readonly string[];
  readonly snippet?: string;
  readonly internalDate?: string;
  readonly sizeEstimate?: number;
  readonly payload?: GmailPart;
}

interface HistoryRecord {
  readonly messagesAdded?: readonly { message: GmailMessage }[];
  readonly messagesDeleted?: readonly { message: GmailMessage }[];
  readonly labelsAdded?: readonly { message: GmailMessage; labelIds?: readonly string[] }[];
  readonly labelsRemoved?: readonly { message: GmailMessage; labelIds?: readonly string[] }[];
}

const CATEGORY: Readonly<Record<string, NormalizedMailMessage['providerCategory']>> = {
  CATEGORY_PERSONAL: 'primary',
  CATEGORY_PROMOTIONS: 'promotions',
  CATEGORY_SOCIAL: 'social',
  CATEGORY_UPDATES: 'updates',
  CATEGORY_FORUMS: 'forums',
};

function headerMap(payload: GmailPart | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of payload?.headers ?? []) {
    const key = h.name.toLowerCase();
    if (!map.has(key)) map.set(key, h.value);
  }
  return map;
}

type AuthValue = 'pass' | 'fail' | 'none' | null;

function authResult(header: string | undefined, method: string): AuthValue {
  const match = new RegExp(
    `\\b${method}=(pass|fail|none|softfail|neutral|temperror|permerror)`,
    'i',
  ).exec(header ?? '');
  if (match === null) return null;
  const v = (match[1] ?? '').toLowerCase();
  return v === 'pass' ? 'pass' : v === 'none' ? 'none' : 'fail';
}

function priorityOf(
  xPriority: string | undefined,
  importance: string | undefined,
): 'high' | 'normal' | 'low' | null {
  const p = Number.parseInt(xPriority ?? '', 10);
  if (p === 1 || p === 2) return 'high';
  if (p === 4 || p === 5) return 'low';
  if (p === 3) return 'normal';
  const i = importance?.trim().toLowerCase();
  return i === 'high' || i === 'low' || i === 'normal' ? i : null;
}

function messageIdList(value: string | undefined): string[] {
  return (value ?? '').match(/<[^<>\s]+>/g)?.slice(-20) ?? [];
}

/** Gmail message (metadata or full) → the stored header subset (§2.2). */
export function normalizeGmailMessage(message: GmailMessage, now: Date): NormalizedMailMessage {
  const h = headerMap(message.payload);
  const labels = (message.labelIds ?? []).map((l) => l.toUpperCase());
  const auth = h.get('authentication-results');
  const dkimDomain = /header\.d=([a-z0-9.-]+)/i.exec(auth ?? '')?.[1]?.toLowerCase() ?? null;
  const authentication =
    auth === undefined
      ? null
      : {
          dkim: authResult(auth, 'dkim'),
          spf: authResult(auth, 'spf'),
          dmarc: authResult(auth, 'dmarc'),
          dkimDomain,
        };
  const priority = priorityOf(h.get('x-priority'), h.get('importance'));
  const autoSubmitted = h.get('auto-submitted')?.trim().toLowerCase() ?? null;
  const received = isoOrNull(
    message.internalDate === undefined ? null : Number(message.internalDate),
  );
  const sent = isoOrNull(h.get('date') ?? null);
  const categoryLabel = labels.find((l) => l in CATEGORY);
  const mimeType = message.payload?.mimeType?.toLowerCase() ?? '';
  return {
    providerMessageId: message.id,
    providerThreadId: message.threadId,
    rfc822MessageId: h.get('message-id')?.trim() ?? null,
    inReplyTo: h.get('in-reply-to')?.trim() ?? null,
    references: messageIdList(h.get('references')),
    folder: labels.includes('SENT')
      ? 'sent'
      : labels.includes('INBOX')
        ? 'inbox'
        : labels.length > 0
          ? 'archive'
          : 'other',
    labels,
    providerCategory: categoryLabel === undefined ? null : (CATEGORY[categoryLabel] ?? null),
    from: parseAddress(h.get('from')),
    replyTo: parseAddressList(h.get('reply-to')),
    to: parseAddressList(h.get('to')),
    cc: parseAddressList(h.get('cc')),
    subject: [
      ...decodeMimeWords(h.get('subject') ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
    ]
      .slice(0, 500)
      .join(''),
    snippet: excerpt(message.snippet ?? '', 200),
    sentAt: sent,
    receivedAt: received ?? sent ?? now.toISOString(),
    isRead: !labels.includes('UNREAD'),
    isFlagged: labels.includes('STARRED'),
    providerImportance: priority,
    hasAttachments:
      mimeType === 'multipart/mixed' ? true : mimeType.startsWith('text/') ? false : null,
    sizeBytes: typeof message.sizeEstimate === 'number' ? message.sizeEstimate : null,
    headers: {
      listUnsubscribe: h.has('list-unsubscribe'),
      listId: h.get('list-id')?.trim() ?? null,
      precedence: h.get('precedence')?.trim().toLowerCase() ?? null,
      autoSubmitted: autoSubmitted === null || autoSubmitted === 'no' ? null : autoSubmitted,
      authentication,
      priority,
    },
    webLink: null,
    deleted: labels.includes('TRASH') || labels.includes('SPAM'),
  };
}

function unix(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

/** Gmail search for a window query (§3.15 stage A). */
export function gmailQuery(q: MailWindowQuery): string {
  const parts = [q.folder === 'sent' ? 'in:sent' : 'in:inbox', `after:${unix(q.receivedAfter)}`];
  if (q.receivedBefore !== undefined) parts.push(`before:${unix(q.receivedBefore)}`);
  if (q.excludeBulkCategories) parts.push('-category:promotions -category:social -category:forums');
  if (q.fromAnyOf !== undefined && q.fromAnyOf.length > 0) {
    parts.push(`from:(${q.fromAnyOf.slice(0, 20).join(' OR ')})`);
  }
  parts.push('-in:chats');
  return parts.join(' ');
}

const METADATA_FIELDS =
  'id,threadId,labelIds,snippet,internalDate,sizeEstimate,historyId,payload(mimeType,headers)';

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export class GmailAdapter implements MailProvider {
  readonly provider = 'google' as const;
  constructor(private readonly config: GmailConfig) {}

  private url(
    path: string,
    query: Record<string, string | readonly string[] | null | undefined> = {},
  ): string {
    const url = new URL(`${this.config.endpoints.gmail}/gmail/v1/users/me${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) for (const v of value) url.searchParams.append(key, v);
      else url.searchParams.set(key, value as string);
    }
    return url.toString();
  }

  private get<T>(
    ctx: ProviderContext,
    url: string,
    units: number,
    priority: QuotaPriority = 'sync',
  ): Promise<T> {
    return authorizedJson<T>(ctx, this.config.http, {
      url,
      quota: { bucket: 'gmail_user_units', units, priority },
    });
  }

  async getProfile(
    ctx: ProviderContext,
  ): Promise<ProviderIdentity & { mailboxCursorHint: string | null }> {
    const profile = await this.get<{ emailAddress?: string; historyId?: string }>(
      ctx,
      this.url('/profile'),
      GMAIL_COST.profile,
    );
    return {
      providerAccountId: ctx.account.providerAccountId,
      email: profile.emailAddress?.toLowerCase() ?? ctx.account.email,
      displayName: null,
      tenantId: null,
      tenantType: null,
      mailboxCursorHint: profile.historyId ?? null,
    };
  }

  async countMessages(ctx: ProviderContext, q: MailWindowQuery): Promise<number> {
    let count = 0;
    let pageToken: string | null = null;
    for (let page = 0; page < 10; page++) {
      const res = await this.listMessageIds(ctx, q, pageToken);
      count += res.items.length;
      pageToken = res.nextPageToken;
      if (pageToken === null) break;
    }
    return count;
  }

  async listMessageIds(
    ctx: ProviderContext,
    q: MailWindowQuery,
    pageToken?: string | null,
  ): Promise<ProviderPage<{ id: string; threadId: string }>> {
    const res = await this.get<{
      messages?: { id: string; threadId: string }[];
      nextPageToken?: string;
    }>(
      ctx,
      this.url('/messages', { q: gmailQuery(q), maxResults: '500', pageToken: pageToken ?? null }),
      GMAIL_COST.messagesList,
    );
    return { items: res.messages ?? [], nextPageToken: res.nextPageToken ?? null };
  }

  async getMessagesMetadata(
    ctx: ProviderContext,
    ids: string[],
  ): Promise<(NormalizedMailMessage | { providerMessageId: string; notFound: true })[]> {
    return await mapLimited(ids, 10, async (id) => {
      try {
        const message = await this.get<GmailMessage>(
          ctx,
          this.url(`/messages/${encodeURIComponent(id)}`, {
            format: 'metadata',
            metadataHeaders: GMAIL_METADATA_HEADERS,
            fields: METADATA_FIELDS,
          }),
          GMAIL_COST.messagesGet,
        );
        return normalizeGmailMessage(message, ctx.clock.now());
      } catch (error) {
        if (error instanceof ProviderError && error.code === 'not_found') {
          return { providerMessageId: id, notFound: true as const };
        }
        throw error;
      }
    });
  }

  async getMessageBody(
    ctx: ProviderContext,
    providerMessageId: string,
    opts: { maxBytes: number },
  ): Promise<TransientMailBody> {
    const message = await this.get<GmailMessage>(
      ctx,
      this.url(`/messages/${encodeURIComponent(providerMessageId)}`, { format: 'full' }),
      GMAIL_COST.messagesGet,
      'interactive',
    );
    return parseGmailPayload(message.payload, opts.maxBytes);
  }

  async getAttachment(
    ctx: ProviderContext,
    providerMessageId: string,
    providerAttachmentId: string,
    opts: { maxBytes: number },
  ): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const res = await this.get<{ data?: string; size?: number }>(
      ctx,
      this.url(
        `/messages/${encodeURIComponent(providerMessageId)}/attachments/${encodeURIComponent(providerAttachmentId)}`,
      ),
      GMAIL_COST.attachmentsGet,
      'interactive',
    );
    if ((res.size ?? 0) > opts.maxBytes)
      throw new ProviderError('payload_invalid', 413, null, 'attachment_too_large');
    return { bytes: fromBase64Url(res.data ?? ''), mimeType: 'application/octet-stream' };
  }

  async baseline(ctx: ProviderContext): Promise<MailCursor> {
    const profile = await this.getProfile(ctx);
    if (profile.mailboxCursorHint === null)
      throw new ProviderError('mailbox_unavailable', null, null, 'no_history_id');
    return { kind: 'gmail_history', value: profile.mailboxCursorHint };
  }

  async changesSince(
    ctx: ProviderContext,
    cursor: MailCursor,
    pageToken?: string | null,
  ): Promise<MailChangeSet> {
    let res: { history?: HistoryRecord[]; nextPageToken?: string; historyId?: string };
    try {
      res = await this.get(
        ctx,
        this.url('/history', {
          startHistoryId: cursor.value,
          historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
          maxResults: '500',
          pageToken: pageToken ?? null,
        }),
        GMAIL_COST.historyList,
      );
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'not_found') {
        throw new ProviderError('cursor_invalid', 404, null, 'history_id_expired');
      }
      throw error;
    }
    const added = new Set<string>();
    const deleted = new Set<string>();
    const labels = new Map<
      string,
      { providerMessageId: string; labels: string[]; isRead: boolean | null }
    >();
    const relevant = (ids: readonly string[] | undefined) =>
      (ids ?? []).some((l) => l === 'INBOX' || l === 'SENT');
    for (const record of res.history ?? []) {
      for (const { message } of record.messagesAdded ?? []) {
        if (relevant(message.labelIds)) added.add(message.id);
      }
      for (const { message } of record.messagesDeleted ?? []) deleted.add(message.id);
      for (const change of [...(record.labelsAdded ?? []), ...(record.labelsRemoved ?? [])]) {
        const current = (change.message.labelIds ?? []).map((l) => l.toUpperCase());
        if (current.includes('TRASH') || current.includes('SPAM')) {
          deleted.add(change.message.id);
          continue;
        }
        labels.set(change.message.id, {
          providerMessageId: change.message.id,
          labels: current,
          isRead: !current.includes('UNREAD'),
        });
      }
    }
    for (const id of deleted) {
      added.delete(id);
      labels.delete(id);
    }
    return {
      upserts: [],
      needsMetadata: [...added],
      labelChanges: [...labels.values()].filter((c) => !added.has(c.providerMessageId)),
      deleted: [...deleted],
      nextCursor: { kind: 'gmail_history', value: res.historyId ?? cursor.value },
      pageToken: res.nextPageToken ?? null,
    };
  }

  async watch(ctx: ProviderContext, resourceKey: string): Promise<WatchHandle> {
    if (this.config.pubsubTopic === null) {
      throw new ProviderError('external_credential_required', null, null, 'pubsub_not_configured');
    }
    const res = await authorizedJson<{ historyId?: string; expiration?: string }>(
      ctx,
      this.config.http,
      {
        url: this.url('/watch'),
        method: 'POST',
        ...jsonBody({
          topicName: this.config.pubsubTopic,
          labelIds: ['INBOX', 'SENT'],
          labelFilterBehavior: 'include',
        }),
        quota: { bucket: 'gmail_user_units', units: GMAIL_COST.watch, priority: 'interactive' },
        idempotent: true,
      },
    );
    const expires = isoOrNull(res.expiration === undefined ? null : Number(res.expiration));
    return {
      resource: 'gmail_mailbox',
      resourceKey,
      watchId: `gmail:${ctx.account.connectedAccountId}`,
      providerResourceId: res.historyId ?? null,
      expiresAt: expires ?? new Date(ctx.clock.now().getTime() + 7 * 86_400_000).toISOString(),
      tokenHash: null,
    };
  }

  async renewWatch(ctx: ProviderContext, handle: WatchHandle): Promise<WatchHandle> {
    return await this.watch(ctx, handle.resourceKey);
  }

  async stopWatch(ctx: ProviderContext): Promise<void> {
    await authorizedJson(ctx, this.config.http, {
      url: this.url('/stop'),
      method: 'POST',
      quota: { bucket: 'gmail_user_units', units: GMAIL_COST.stop, priority: 'interactive' },
      idempotent: true,
    });
  }

  async sendReply(ctx: ProviderContext, reply: OutboundReply): Promise<WriteOutcome> {
    const raw = encodeRaw(buildReplyMime(reply, { date: ctx.clock.now() }));
    const sent = await authorizedJson<{ id: string; threadId?: string }>(ctx, this.config.http, {
      url: this.url('/messages/send'),
      method: 'POST',
      ...jsonBody({ raw, threadId: reply.providerThreadId }),
      quota: {
        bucket: 'gmail_user_units',
        units: GMAIL_COST.messagesSend,
        priority: 'interactive',
      },
      idempotent: false,
    });
    const threadId = sent.threadId ?? reply.providerThreadId;
    return {
      kind: 'created',
      providerId: sent.id,
      providerThreadId: threadId,
      webLink: this.webLinkFor(ctx, {
        providerMessageId: sent.id,
        providerThreadId: threadId,
        webLink: null,
      }),
    };
  }

  async findSentByMarker(
    ctx: ProviderContext,
    marker: IdempotencyMarker,
    reply: OutboundReply,
    sentAfter: string,
  ): Promise<WriteOutcome | null> {
    const byId = await this.get<{ messages?: { id: string; threadId: string }[] }>(
      ctx,
      this.url('/messages', {
        q: `rfc822msgid:${marker.rfc822MessageId.replace(/[<>]/g, '')}`,
        includeSpamTrash: 'true',
        maxResults: '1',
      }),
      GMAIL_COST.messagesList,
      'interactive',
    );
    const hit = byId.messages?.[0];
    if (hit !== undefined) {
      return {
        kind: 'already_exists',
        providerId: hit.id,
        webLink: this.webLinkFor(ctx, {
          providerMessageId: hit.id,
          providerThreadId: hit.threadId,
          webLink: null,
        }),
      };
    }
    // Fallback (Message-ID preservation is [verify]): same subject in Sent since the attempt started,
    // compared on the normalised approved body.
    const subject = reply.subject.replace(/"/g, '');
    const candidates = await this.get<{ messages?: { id: string; threadId: string }[] }>(
      ctx,
      this.url('/messages', {
        q: `in:sent after:${unix(sentAfter) - 60} subject:"${subject}"`,
        maxResults: '5',
      }),
      GMAIL_COST.messagesList,
      'interactive',
    );
    const wanted = normalizeForCompare(reply.bodyText).slice(0, 400);
    for (const candidate of candidates.messages ?? []) {
      const body = await this.getMessageBody(ctx, candidate.id, { maxBytes: 64 * 1024 });
      if (wanted !== '' && normalizeForCompare(body.text).startsWith(wanted)) {
        return {
          kind: 'already_exists',
          providerId: candidate.id,
          webLink: this.webLinkFor(ctx, {
            providerMessageId: candidate.id,
            providerThreadId: candidate.threadId,
            webLink: null,
          }),
        };
      }
    }
    return null;
  }

  /** `https://mail.google.com/mail/?authuser={email}#all/{threadId}` (unofficial pattern; SREQ-15). */
  webLinkFor(
    ctx: ProviderContext,
    msg: Pick<NormalizedMailMessage, 'providerMessageId' | 'providerThreadId' | 'webLink'>,
  ): string | null {
    const base = 'https://mail.google.com/mail/';
    const auth =
      ctx.account.email === null ? '' : `?authuser=${encodeURIComponent(ctx.account.email)}`;
    return msg.providerThreadId === ''
      ? `${base}${auth}`
      : `${base}${auth}#all/${encodeURIComponent(msg.providerThreadId)}`;
  }
}
