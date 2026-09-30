/**
 * Demo `MailProvider` (INTEGRATION_PLAN §13.2; TEST_PLAN EF-DEMO-01): the fixture mailbox of the local
 * day plus the replies sent through approvals. `changesSince` is the `demo_clock` cursor: messages
 * whose arrival time lies after the cursor and not after "now" (time-released mail becomes visible
 * as the day advances). Demo accounts have no push; the engine polls them every 5 minutes.
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
  type TransientMailBody,
  type WatchHandle,
  type WriteOutcome,
} from '@da/domain';
import { DEMO_SELF, demoDataset } from './fixtures/index.ts';
import {
  type DemoAdapterDeps,
  type DemoReplyWrite,
  demoWrites,
  flavorOf,
  recordDemoWrite,
} from './writes.ts';

const PAGE = 100;
const OVERLAP_MS = 60_000;

interface VisibleMail {
  readonly message: NormalizedMailMessage;
  readonly body: string;
  readonly at: number;
}

function replyMessage(
  write: DemoReplyWrite,
  from: { address: string; name: string | null },
): NormalizedMailMessage {
  return {
    providerMessageId: write.id,
    providerThreadId: write.threadId,
    rfc822MessageId: null,
    inReplyTo: write.inReplyTo,
    references: write.inReplyTo === null ? [] : [write.inReplyTo],
    folder: 'sent',
    labels: ['SENT'],
    providerCategory: null,
    from,
    replyTo: [],
    to: [...write.to],
    cc: [...write.cc],
    subject: write.subject,
    snippet: write.snippet,
    sentAt: write.sentAt,
    receivedAt: write.sentAt,
    isRead: true,
    isFlagged: false,
    providerImportance: null,
    hasAttachments: false,
    sizeBytes: null,
    headers: {
      listUnsubscribe: false,
      listId: null,
      precedence: null,
      autoSubmitted: null,
      authentication: null,
      priority: null,
    },
    webLink: null,
    deleted: false,
  };
}

export class DemoMailAdapter implements MailProvider {
  readonly provider = 'demo' as const;
  constructor(private readonly deps: DemoAdapterDeps) {}

  private async visible(ctx: ProviderContext): Promise<VisibleMail[]> {
    const flavor = flavorOf(ctx);
    const now = ctx.clock.now();
    const dataset = demoDataset({
      flavor,
      timeZone: await this.deps.timeZone(ctx.account.userId),
      now,
    });
    const out: VisibleMail[] = dataset.mails
      .filter((m) => Date.parse(m.arriveAt) <= now.getTime())
      .map((m) => ({ message: m.message, body: m.body, at: Date.parse(m.arriveAt) }));
    const self = DEMO_SELF[flavor];
    for (const write of Object.values(await demoWrites(this.deps, ctx, 'mail'))) {
      if (write.kind !== 'reply' || Date.parse(write.sentAt) > now.getTime()) continue;
      out.push({
        message: replyMessage(write, { address: self.email, name: self.name }),
        body: write.snippet,
        at: Date.parse(write.sentAt),
      });
    }
    return out.sort(
      (a, b) =>
        a.at - b.at || a.message.providerMessageId.localeCompare(b.message.providerMessageId),
    );
  }

  getProfile(
    ctx: ProviderContext,
  ): Promise<ProviderIdentity & { mailboxCursorHint: string | null }> {
    const self = DEMO_SELF[flavorOf(ctx)];
    return Promise.resolve({
      providerAccountId: ctx.account.providerAccountId,
      email: self.email,
      displayName: self.name,
      tenantId: null,
      tenantType: null,
      mailboxCursorHint: ctx.clock.now().toISOString(),
    });
  }

  private matches(m: VisibleMail, q: MailWindowQuery): boolean {
    if ((q.folder === 'sent') !== (m.message.folder === 'sent')) return false;
    if (m.at < Date.parse(q.receivedAfter)) return false;
    if (q.receivedBefore !== undefined && m.at >= Date.parse(q.receivedBefore)) return false;
    const category = m.message.providerCategory;
    if (
      q.excludeBulkCategories &&
      (category === 'promotions' || category === 'social' || category === 'forums')
    )
      return false;
    if (q.fromAnyOf !== undefined && q.fromAnyOf.length > 0) {
      return q.fromAnyOf.map((a) => a.toLowerCase()).includes(m.message.from?.address ?? '');
    }
    return true;
  }

  async countMessages(ctx: ProviderContext, q: MailWindowQuery): Promise<number> {
    return (await this.visible(ctx)).filter((m) => this.matches(m, q)).length;
  }

  async listMessageIds(
    ctx: ProviderContext,
    q: MailWindowQuery,
    pageToken?: string | null,
  ): Promise<ProviderPage<{ id: string; threadId: string }>> {
    const all = (await this.visible(ctx)).filter((m) => this.matches(m, q)).reverse();
    const offset = Number(pageToken ?? '0') || 0;
    const page = all.slice(offset, offset + PAGE);
    return {
      items: page.map((m) => ({
        id: m.message.providerMessageId,
        threadId: m.message.providerThreadId,
      })),
      nextPageToken: offset + PAGE < all.length ? String(offset + PAGE) : null,
    };
  }

  async getMessagesMetadata(
    ctx: ProviderContext,
    ids: string[],
  ): Promise<(NormalizedMailMessage | { providerMessageId: string; notFound: true })[]> {
    const byId = new Map(
      (await this.visible(ctx)).map((m) => [m.message.providerMessageId, m.message] as const),
    );
    return ids.map((id) => byId.get(id) ?? { providerMessageId: id, notFound: true as const });
  }

  async getMessageBody(
    ctx: ProviderContext,
    providerMessageId: string,
    opts: { maxBytes: number },
  ): Promise<TransientMailBody> {
    const hit = (await this.visible(ctx)).find(
      (m) => m.message.providerMessageId === providerMessageId,
    );
    if (hit === undefined) throw new ProviderError('not_found', 404, null, 'demo_message_missing');
    const text = hit.body.slice(0, opts.maxBytes);
    const html = `<div>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>`;
    return { text, html, truncated: hit.body.length > opts.maxBytes, attachments: [] };
  }

  getAttachment(): Promise<{ bytes: Uint8Array; mimeType: string }> {
    return Promise.reject(new ProviderError('not_found', 404, null, 'demo_attachment_missing'));
  }

  baseline(ctx: ProviderContext, folder: 'inbox' | 'sentitems'): Promise<MailCursor> {
    // One minute before the 72-hour window, so the first delta round covers it completely (§3.15).
    const start = new Date(ctx.clock.now().getTime() - (72 * 60 + 1) * 60_000).toISOString();
    return Promise.resolve({ kind: 'demo_clock', value: start, folder });
  }

  async changesSince(
    ctx: ProviderContext,
    cursor: MailCursor,
    pageToken?: string | null,
  ): Promise<MailChangeSet> {
    const now = ctx.clock.now();
    // A minute of overlap: items stamped in the same instant as the previous round are not lost, and
    // re-listed ones are idempotent upserts.
    const since = Date.parse(cursor.value) - OVERLAP_MS;
    const folderFilter = cursor.folder;
    const fresh = (await this.visible(ctx)).filter(
      (m) =>
        m.at > since &&
        (folderFilter === undefined ||
          (folderFilter === 'sentitems') === (m.message.folder === 'sent')),
    );
    const offset = Number(pageToken ?? '0') || 0;
    const page = fresh.slice(offset, offset + PAGE);
    const more = offset + PAGE < fresh.length;
    if (!more)
      await this.deps.store.demoSetClock(ctx.account.connectedAccountId, 'mail', now.toISOString());
    return {
      upserts: page.map((m) => m.message),
      needsMetadata: [],
      labelChanges: [],
      deleted: [],
      nextCursor: {
        kind: 'demo_clock',
        value: now.toISOString(),
        ...(folderFilter === undefined ? {} : { folder: folderFilter }),
      },
      pageToken: more ? String(offset + PAGE) : null,
    };
  }

  watch(): Promise<WatchHandle> {
    return Promise.reject(
      new ProviderError('external_credential_required', null, null, 'demo_polls'),
    );
  }

  renewWatch(): Promise<WatchHandle> {
    return this.watch();
  }

  stopWatch(): Promise<void> {
    return Promise.resolve();
  }

  async sendReply(ctx: ProviderContext, reply: OutboundReply): Promise<WriteOutcome> {
    const write: DemoReplyWrite = {
      kind: 'reply',
      id: `demo:reply:${reply.marker.approvalId}`,
      threadId: reply.providerThreadId,
      subject: reply.subject.slice(0, 500),
      snippet: reply.bodyText.replace(/\s+/g, ' ').trim().slice(0, 200),
      to: reply.to.map((a) => ({ address: a.address.toLowerCase(), name: a.name })),
      cc: reply.cc.map((a) => ({ address: a.address.toLowerCase(), name: a.name })),
      inReplyTo: reply.originalRfc822MessageId,
      sentAt: ctx.clock.now().toISOString(),
    };
    const out = await recordDemoWrite(this.deps, ctx, 'mail', reply.marker.approvalId, write);
    return out.created
      ? {
          kind: 'created',
          providerId: out.item.id,
          providerThreadId: out.item.threadId,
          webLink: null,
        }
      : { kind: 'already_exists', providerId: out.item.id, webLink: null };
  }

  async findSentByMarker(
    ctx: ProviderContext,
    marker: IdempotencyMarker,
  ): Promise<WriteOutcome | null> {
    const write = (await demoWrites(this.deps, ctx, 'mail'))[marker.approvalId];
    return write?.kind === 'reply'
      ? { kind: 'already_exists', providerId: write.id, webLink: null }
      : null;
  }

  webLinkFor(): string | null {
    return null;
  }
}
