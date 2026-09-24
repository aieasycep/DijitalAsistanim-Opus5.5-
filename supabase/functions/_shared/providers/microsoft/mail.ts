/**
 * Outlook mail `MailProvider` over Graph (INTEGRATION_PLAN §5.4, §3.12; API_CONTRACTS JOB-01/03,
 * API-MAIL-01; T-4.08):
 * - per-folder message delta (inbox, sentitems) with the header-subset `$select` and
 *   `$filter=receivedDateTime ge …`; `@odata.nextLink` pages, `@odata.deltaLink` stored as the cursor;
 *   410 / `syncStateNotFound` → `cursor_invalid`; `@removed` → deleted;
 * - `bodyPreview` cut to the 200-character snippet; triage headers only for candidates
 *   (`internetMessageHeaders` via JSON batches of 20);
 * - bodies only transiently (`Prefer: outlook.body-content-type`), attachments by id;
 * - subscriptions on `me/mailFolders('inbox'|'sentitems')/messages`;
 * - replies via `POST /me/messages/{id}/reply` (`comment` + message recipients and the
 *   `da_approval_id` extended property; never `createReply`, which needs Mail.ReadWrite), probed in
 *   Sent Items by the extended property, falling back to conversation + time + body preview.
 */
import {
  type DeterministicHeaders,
  type IdempotencyMarker,
  type MailAddress,
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
  type TransientMailBody,
  type WatchHandle,
  type WriteOutcome,
} from '@da/domain';
import { fromBase64 } from '../../crypto/encoding.ts';
import { excerpt, htmlToText, isoOrNull } from '../common.ts';
import { DA_APPROVAL_PROPERTY_ID, GRAPH_MESSAGE_SELECT } from './config.ts';
import type { GraphClient } from './graph.ts';
import type { GraphSubscriptions } from './subscriptions.ts';

type Folder = 'inbox' | 'sentitems';

interface GraphRecipient {
  readonly emailAddress?: { readonly address?: string; readonly name?: string };
}

export interface GraphMessage {
  readonly id: string;
  readonly '@removed'?: { reason?: string };
  readonly conversationId?: string;
  readonly internetMessageId?: string;
  readonly subject?: string;
  readonly from?: GraphRecipient;
  readonly sender?: GraphRecipient;
  readonly replyTo?: readonly GraphRecipient[];
  readonly toRecipients?: readonly GraphRecipient[];
  readonly ccRecipients?: readonly GraphRecipient[];
  readonly receivedDateTime?: string;
  readonly sentDateTime?: string;
  readonly isRead?: boolean;
  readonly importance?: string;
  readonly flag?: { flagStatus?: string };
  readonly categories?: readonly string[];
  readonly hasAttachments?: boolean;
  readonly bodyPreview?: string;
  readonly inferenceClassification?: string;
  readonly webLink?: string;
  readonly internetMessageHeaders?: readonly { name: string; value: string }[];
}

function address(r: GraphRecipient | undefined): MailAddress | null {
  const a = r?.emailAddress?.address;
  return a === undefined || a === ''
    ? null
    : { address: a.toLowerCase(), name: r?.emailAddress?.name ?? null };
}

function addresses(list: readonly GraphRecipient[] | undefined, cap = 50): MailAddress[] {
  return (list ?? [])
    .map(address)
    .filter((a): a is MailAddress => a !== null)
    .slice(0, cap);
}

function deterministicHeaders(
  headers: GraphMessage['internetMessageHeaders'],
  importance: string | undefined,
): DeterministicHeaders {
  const map = new Map<string, string>();
  for (const h of headers ?? [])
    if (!map.has(h.name.toLowerCase())) map.set(h.name.toLowerCase(), h.value);
  const auth = map.get('authentication-results');
  const result = (method: string) => {
    const m = new RegExp(`\\b${method}=(pass|fail|none|softfail|neutral)`, 'i')
      .exec(auth ?? '')?.[1]
      ?.toLowerCase();
    return m === undefined ? null : m === 'pass' ? 'pass' : m === 'none' ? 'none' : 'fail';
  };
  const auto = map.get('auto-submitted')?.trim().toLowerCase() ?? null;
  const imp = importance?.toLowerCase();
  return {
    listUnsubscribe: map.has('list-unsubscribe'),
    listId: map.get('list-id') ?? null,
    precedence: map.get('precedence')?.trim().toLowerCase() ?? null,
    autoSubmitted: auto === null || auto === 'no' ? null : auto,
    authentication:
      auth === undefined
        ? null
        : {
            dkim: result('dkim'),
            spf: result('spf'),
            dmarc: result('dmarc'),
            dkimDomain: /header\.d=([a-z0-9.-]+)/i.exec(auth)?.[1]?.toLowerCase() ?? null,
          },
    priority: imp === 'high' || imp === 'low' || imp === 'normal' ? imp : null,
  };
}

/** Graph message → the stored header subset; `folder` is the delta folder it came from. */
export function normalizeGraphMessage(
  m: GraphMessage,
  folder: Folder,
  now: Date,
): NormalizedMailMessage {
  const imp = m.importance?.toLowerCase();
  const headerMap = new Map(
    (m.internetMessageHeaders ?? []).map((h) => [h.name.toLowerCase(), h.value] as const),
  );
  const categories = (m.categories ?? []).map((c) => c.toUpperCase());
  return {
    providerMessageId: m.id,
    providerThreadId: m.conversationId ?? m.id,
    rfc822MessageId: m.internetMessageId ?? null,
    inReplyTo: headerMap.get('in-reply-to') ?? null,
    references:
      headerMap
        .get('references')
        ?.match(/<[^<>\s]+>/g)
        ?.slice(-20) ?? [],
    folder: folder === 'sentitems' ? 'sent' : 'inbox',
    labels: [folder === 'sentitems' ? 'SENT' : 'INBOX', ...categories],
    providerCategory:
      m.inferenceClassification === 'focused'
        ? 'focused'
        : m.inferenceClassification === 'other'
          ? 'other'
          : null,
    from: address(m.from) ?? address(m.sender),
    replyTo: addresses(m.replyTo),
    to: addresses(m.toRecipients),
    cc: addresses(m.ccRecipients),
    subject: [...(m.subject ?? '').replace(/\s+/g, ' ').trim()].slice(0, 500).join(''),
    snippet: excerpt(m.bodyPreview ?? '', 200),
    sentAt: isoOrNull(m.sentDateTime ?? null),
    receivedAt: isoOrNull(m.receivedDateTime ?? null) ?? now.toISOString(),
    isRead: m.isRead === true,
    isFlagged: m.flag?.flagStatus === 'flagged',
    providerImportance: imp === 'high' || imp === 'low' || imp === 'normal' ? imp : null,
    hasAttachments: m.hasAttachments ?? null,
    sizeBytes: null,
    headers: deterministicHeaders(m.internetMessageHeaders, m.importance),
    webLink: m.webLink ?? null,
    deleted: m['@removed'] !== undefined,
  };
}

function folderOf(cursor: MailCursor): Folder {
  return cursor.folder === 'sentitems' ? 'sentitems' : 'inbox';
}

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export class OutlookMailAdapter implements MailProvider {
  readonly provider = 'microsoft' as const;
  constructor(
    private readonly graph: GraphClient,
    private readonly subscriptions: GraphSubscriptions,
  ) {}

  async getProfile(
    ctx: ProviderContext,
  ): Promise<ProviderIdentity & { mailboxCursorHint: string | null }> {
    const me = await this.graph.json<{
      id?: string;
      mail?: string | null;
      userPrincipalName?: string;
      displayName?: string;
    }>(ctx, '/me?$select=id,mail,userPrincipalName,displayName');
    return {
      providerAccountId: ctx.account.providerAccountId,
      email: (me.mail ?? me.userPrincipalName ?? ctx.account.email ?? null)?.toLowerCase() ?? null,
      displayName: me.displayName ?? null,
      tenantId: ctx.account.tenantId,
      tenantType: ctx.account.tenantType,
      mailboxCursorHint: null,
    };
  }

  private windowFilter(q: MailWindowQuery): string {
    const parts = [`receivedDateTime ge ${q.receivedAfter}`];
    if (q.receivedBefore !== undefined) parts.push(`receivedDateTime lt ${q.receivedBefore}`);
    return parts.join(' and ');
  }

  private folderPath(q: MailWindowQuery): string {
    return q.folder === 'sent' ? 'sentitems' : 'inbox';
  }

  async countMessages(ctx: ProviderContext, q: MailWindowQuery): Promise<number> {
    const res = await this.graph.json<{ '@odata.count'?: number }>(
      ctx,
      `/me/mailFolders/${this.folderPath(q)}/messages?$filter=${encodeURIComponent(this.windowFilter(q))}&$count=true&$top=1&$select=id`,
      { headers: { ConsistencyLevel: 'eventual' } },
    );
    return res['@odata.count'] ?? 0;
  }

  async listMessageIds(
    ctx: ProviderContext,
    q: MailWindowQuery,
    pageToken?: string | null,
  ): Promise<ProviderPage<{ id: string; threadId: string }>> {
    const url =
      pageToken ??
      `/me/mailFolders/${this.folderPath(q)}/messages?$filter=${encodeURIComponent(this.windowFilter(q))}` +
        `&$orderby=receivedDateTime desc&$top=50&$select=id,conversationId`;
    const res = await this.graph.json<{ value?: GraphMessage[]; '@odata.nextLink'?: string }>(
      ctx,
      url,
    );
    return {
      items: (res.value ?? []).map((m) => ({ id: m.id, threadId: m.conversationId ?? m.id })),
      nextPageToken: res['@odata.nextLink'] ?? null,
    };
  }

  async getMessagesMetadata(
    ctx: ProviderContext,
    ids: string[],
  ): Promise<(NormalizedMailMessage | { providerMessageId: string; notFound: true })[]> {
    const select = `${GRAPH_MESSAGE_SELECT},internetMessageHeaders,parentFolderId`;
    const responses = await this.graph.batchGet<GraphMessage & { parentFolderId?: string }>(
      ctx,
      ids.map((id, index) => ({
        id: String(index),
        url: `/me/messages/${encodeURIComponent(id)}?$select=${select}`,
      })),
    );
    return ids.map((id, index) => {
      const res = responses.get(String(index));
      if (res === undefined || res.body === null)
        return { providerMessageId: id, notFound: true as const };
      return normalizeGraphMessage(res.body, 'inbox', ctx.clock.now());
    });
  }

  async getMessageBody(
    ctx: ProviderContext,
    providerMessageId: string,
    opts: { maxBytes: number },
  ): Promise<TransientMailBody> {
    const res = await this.graph.json<{
      body?: { contentType?: string; content?: string };
      attachments?: {
        id: string;
        name?: string;
        contentType?: string;
        size?: number;
        isInline?: boolean;
      }[];
    }>(
      ctx,
      `/me/messages/${encodeURIComponent(providerMessageId)}?$select=body,hasAttachments&$expand=attachments($select=id,name,contentType,size,isInline)`,
      { prefer: ['outlook.body-content-type="html"'], priority: 'interactive' },
    );
    const content = res.body?.content ?? '';
    const isHtml = (res.body?.contentType ?? 'html').toLowerCase() === 'html';
    const bytes = new TextEncoder().encode(content);
    const truncated = bytes.byteLength > opts.maxBytes;
    const capped = truncated ? new TextDecoder().decode(bytes.slice(0, opts.maxBytes)) : content;
    return {
      text: isHtml ? htmlToText(capped) : capped,
      html: isHtml ? capped : null,
      truncated,
      attachments: (res.attachments ?? []).slice(0, 50).map((a) => ({
        providerAttachmentId: a.id,
        filename: (a.name ?? '').slice(0, 255),
        mimeType: a.contentType ?? 'application/octet-stream',
        sizeBytes: a.size ?? 0,
        inline: a.isInline === true,
      })),
    };
  }

  async getAttachment(
    ctx: ProviderContext,
    providerMessageId: string,
    providerAttachmentId: string,
    opts: { maxBytes: number },
  ): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const res = await this.graph.json<{
      contentBytes?: string;
      contentType?: string;
      size?: number;
    }>(
      ctx,
      `/me/messages/${encodeURIComponent(providerMessageId)}/attachments/${encodeURIComponent(providerAttachmentId)}`,
      { priority: 'interactive' },
    );
    if ((res.size ?? 0) > opts.maxBytes)
      throw new ProviderError('payload_invalid', 413, null, 'attachment_too_large');
    return {
      bytes: fromBase64(res.contentBytes ?? ''),
      mimeType: res.contentType ?? 'application/octet-stream',
    };
  }

  /** The initial delta URL of a folder (72 h filter); the first delta round is stage A (§3.15). */
  baseline(ctx: ProviderContext, folder: Folder): Promise<MailCursor> {
    const since = new Date(ctx.clock.now().getTime() - 72 * 3_600_000).toISOString();
    return Promise.resolve({
      kind: 'graph_delta',
      folder,
      value: this.graph.resolve(
        `/me/mailFolders/${folder}/messages/delta?$select=${GRAPH_MESSAGE_SELECT}` +
          `&$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}`,
      ),
    });
  }

  async changesSince(
    ctx: ProviderContext,
    cursor: MailCursor,
    pageToken?: string | null,
  ): Promise<MailChangeSet> {
    const folder = folderOf(cursor);
    let res: { value?: GraphMessage[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string };
    try {
      res = await this.graph.json(ctx, pageToken ?? cursor.value, {
        prefer: ['odata.maxpagesize=50'],
      });
    } catch (error) {
      if (
        error instanceof ProviderError &&
        (error.httpStatus === 410 ||
          error.code === 'cursor_invalid' ||
          /syncStateNotFound|resyncRequired/i.test(error.providerReason ?? ''))
      ) {
        throw new ProviderError('cursor_invalid', 410, null, 'delta_expired');
      }
      throw error;
    }
    const upserts: NormalizedMailMessage[] = [];
    const deleted: string[] = [];
    for (const m of res.value ?? []) {
      if (m['@removed'] !== undefined) deleted.push(m.id);
      else upserts.push(normalizeGraphMessage(m, folder, ctx.clock.now()));
    }
    return {
      upserts,
      needsMetadata: [],
      labelChanges: [],
      deleted,
      nextCursor: { kind: 'graph_delta', folder, value: res['@odata.deltaLink'] ?? cursor.value },
      pageToken: res['@odata.nextLink'] ?? null,
    };
  }

  async watch(ctx: ProviderContext, resourceKey: string): Promise<WatchHandle> {
    const folder: Folder = resourceKey === 'sentitems' ? 'sentitems' : 'inbox';
    return await this.subscriptions.create(ctx, {
      resource: `me/mailFolders('${folder}')/messages`,
      handleResource: folder === 'sentitems' ? 'graph_mail_sentitems' : 'graph_mail_inbox',
      resourceKey: '',
    });
  }

  async renewWatch(ctx: ProviderContext, handle: WatchHandle): Promise<WatchHandle> {
    return await this.subscriptions.renew(ctx, handle);
  }

  async reauthorizeWatch(ctx: ProviderContext, handle: WatchHandle): Promise<void> {
    await this.subscriptions.reauthorize(ctx, handle);
  }

  async stopWatch(ctx: ProviderContext, handle: WatchHandle): Promise<void> {
    await this.subscriptions.remove(ctx, handle);
  }

  async sendReply(ctx: ProviderContext, reply: OutboundReply): Promise<WriteOutcome> {
    const recipients = (list: readonly MailAddress[]) =>
      list.map((a) => ({
        emailAddress: { address: a.address, ...(a.name ? { name: a.name } : {}) },
      }));
    await this.graph.json(
      ctx,
      `/me/messages/${encodeURIComponent(reply.inReplyToProviderMessageId)}/reply`,
      {
        method: 'POST',
        priority: 'interactive',
        idempotent: false,
        body: {
          message: {
            toRecipients: recipients(reply.to),
            ccRecipients: recipients(reply.cc),
            singleValueExtendedProperties: [
              { id: DA_APPROVAL_PROPERTY_ID, value: reply.marker.approvalId },
            ],
          },
          comment: reply.bodyText,
        },
      },
    );
    // `reply` answers 202 without a body; the sent item's id arrives with the next Sent Items sync.
    return {
      kind: 'created',
      providerId: reply.marker.rfc822MessageId,
      providerThreadId: reply.providerThreadId,
      webLink: null,
    };
  }

  async findSentByMarker(
    ctx: ProviderContext,
    marker: IdempotencyMarker,
    reply: OutboundReply,
    sentAfter: string,
  ): Promise<WriteOutcome | null> {
    const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${DA_APPROVAL_PROPERTY_ID}' and ep/value eq '${marker.approvalId}')`;
    try {
      const res = await this.graph.json<{ value?: { id: string; webLink?: string }[] }>(
        ctx,
        `/me/mailFolders('sentitems')/messages?$filter=${encodeURIComponent(filter)}&$select=id,conversationId,webLink&$top=1`,
        { priority: 'interactive' },
      );
      const hit = res.value?.[0];
      if (hit !== undefined)
        return { kind: 'already_exists', providerId: hit.id, webLink: hit.webLink ?? null };
      return null;
    } catch (error) {
      if (!(error instanceof ProviderError) || error.code !== 'payload_invalid') throw error;
    }
    // The extended-property filter is [verify]: fall back to conversation + time + body preview.
    const since = new Date(Date.parse(sentAfter) - 60_000).toISOString();
    const fallback = `conversationId eq '${reply.providerThreadId.replace(/'/g, "''")}' and sentDateTime ge ${since}`;
    const res = await this.graph.json<{
      value?: { id: string; bodyPreview?: string; webLink?: string }[];
    }>(
      ctx,
      `/me/mailFolders('sentitems')/messages?$filter=${encodeURIComponent(fallback)}&$select=id,bodyPreview,webLink&$top=10`,
      { priority: 'interactive' },
    );
    const wanted = normalizeForCompare(reply.bodyText).slice(0, 120);
    const hit = (res.value ?? []).find(
      (m) => wanted !== '' && normalizeForCompare(m.bodyPreview ?? '').startsWith(wanted),
    );
    return hit === undefined
      ? null
      : { kind: 'already_exists', providerId: hit.id, webLink: hit.webLink ?? null };
  }

  webLinkFor(
    _ctx: ProviderContext,
    msg: Pick<NormalizedMailMessage, 'providerMessageId' | 'providerThreadId' | 'webLink'>,
  ): string | null {
    return msg.webLink;
  }
}
