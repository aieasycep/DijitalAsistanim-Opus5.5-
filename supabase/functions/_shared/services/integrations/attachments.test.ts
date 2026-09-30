/**
 * Mail attachment metadata (API-MAIL-09, API-CAP-02 v2 refs, DEV-41 meeting prep files, M-CAP-03):
 * metadata only is stored, refs are signed and bound to one message and index, the Data Source
 * Control and the account toggle gate every use, and a download goes through the account's
 * provider with the capture size cap (Gmail's changing attachment ids are re-listed once).
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { type MailAttachmentMeta, ProviderError } from '@da/domain';
import { AppError } from '../../errors.ts';
import { createLogger } from '../../logging/logger.ts';
import {
  activeDemoAccount,
  type IntegrationHarness,
  integrationHarness,
} from '../../testing/integrations.ts';
import {
  capturability,
  downloadStoredAttachment,
  effectiveMime,
  listMessageAttachments,
  parseStoredAttachments,
  relevantFiles,
  signStoredAttachmentRef,
  type StoredAttachment,
  toStoredAttachments,
  verifyStoredAttachmentRef,
} from './attachments.ts';
import type { IntegrationRuntime } from './runtime.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SECRET = 'attachment-ref-secret';
const NOW = new Date('2026-09-24T07:30:00.000Z');
const log = createLogger({ fn: 'api', sink: () => {} });
const PDF = new TextEncoder().encode('%PDF-1.7\n');

const meta = (overrides: Partial<MailAttachmentMeta> = {}): MailAttachmentMeta => ({
  providerAttachmentId: 'att-1',
  filename: 'Hizmet_Sozlesmesi_v3.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 48211,
  inline: false,
  ...overrides,
});

Deno.test('attachments: only metadata is stored; inline parts dropped, at most 20', () => {
  const stored = toStoredAttachments([
    meta(),
    meta({ providerAttachmentId: 'logo', filename: 'logo.png', inline: true }),
    meta({
      providerAttachmentId: 'x',
      filename: ' teklif.pdf ',
      mimeType: 'Application/PDF; name=x',
    }),
    meta({ providerAttachmentId: 'nameless', filename: '  ' }),
    ...Array.from({ length: 30 }, (_, i) => meta({ providerAttachmentId: `n${i}` })),
  ]);
  assertEquals(stored.length, 20);
  assertEquals(stored[0], {
    name: 'Hizmet_Sozlesmesi_v3.pdf',
    mime: 'application/pdf',
    size: 48211,
    provider_attachment_id: 'att-1',
    kind: 'file',
  });
  assertEquals([stored[1]?.name, stored[1]?.mime], ['teklif.pdf', 'application/pdf']);
  assert(!stored.some((a) => a.provider_attachment_id === 'nameless'));
  assert(!JSON.stringify(stored).includes('data'));
  assertEquals(parseStoredAttachments('nope'), []);
  assertEquals(
    parseStoredAttachments([
      { name: 'a.pdf', provider_attachment_id: 'p', kind: 'weird' },
      3,
      null,
    ]),
    [
      {
        name: 'a.pdf',
        mime: 'application/octet-stream',
        size: 0,
        provider_attachment_id: 'p',
        kind: 'file',
      },
    ],
  );
});

Deno.test('attachments: capturability follows the capture MIME list and size caps', () => {
  const a = (o: Partial<StoredAttachment>): StoredAttachment => ({
    name: 'x.pdf',
    mime: 'application/pdf',
    size: 1000,
    provider_attachment_id: 'p',
    kind: 'file',
    ...o,
  });
  assertEquals(capturability(a({})), { capturable: true, blocked_reason: null });
  assertEquals(capturability(a({ kind: 'reference' })).blocked_reason, 'not_a_file');
  assertEquals(
    capturability(
      a({
        name: 'teklif.docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ).blocked_reason,
    'unsupported_type',
  );
  assertEquals(
    capturability(a({ name: 'bilet.pkpass', mime: 'application/vnd.apple.pkpass' })).blocked_reason,
    'unsupported_type',
  );
  assertEquals(capturability(a({ size: 21 * 1024 * 1024 })).blocked_reason, 'too_large');
  assertEquals(
    capturability(a({ name: 'foto.JPG', mime: 'image/jpeg', size: 16 * 1024 * 1024 }))
      .blocked_reason,
    'too_large',
  );
  assertEquals(
    effectiveMime({ name: 'sozlesme.PDF', mime: 'application/octet-stream' }),
    'application/pdf',
  );
  assertEquals(
    effectiveMime({ name: 'veri.bin', mime: 'application/octet-stream' }),
    'application/octet-stream',
  );
});

Deno.test(
  'attachments: v2 refs are signed, bound to message and index, and expire after an hour',
  async () => {
    const id = crypto.randomUUID();
    const ref = await signStoredAttachmentRef(SECRET, id, 3, NOW);
    assert(ref.startsWith(`v2.${id}.3.`));
    assertEquals(await verifyStoredAttachmentRef(SECRET, ref, NOW), { messageId: id, index: 3 });
    assertEquals(await verifyStoredAttachmentRef('other-secret', ref, NOW), null);
    assertEquals(await verifyStoredAttachmentRef(SECRET, ref.replace('.3.', '.4.'), NOW), null);
    assertEquals(await verifyStoredAttachmentRef(SECRET, ref.replace(/^v2/, 'v1'), NOW), null);
    assertEquals(
      await verifyStoredAttachmentRef(SECRET, ref, new Date(NOW.getTime() + 3_601_000)),
      null,
    );
  },
);

// ── Store-backed flows ──────────────────────────────────────────────────────────────────────

interface Fixture {
  readonly h: IntegrationHarness;
  readonly accountId: string;
  readonly messageId: string;
}

async function fixture(
  input: {
    toggles?: Record<string, boolean>;
    status?: 'healthy' | 'needs_reauth';
    stored?: MailAttachmentMeta[];
  } = {},
): Promise<Fixture> {
  const h = await integrationHarness({ now: NOW });
  const account = await activeDemoAccount(h, {
    userId: USER,
    status: input.status ?? 'healthy',
    toggles: input.toggles ?? {},
  });
  const [row] = await h.store.upsertMail(account.id, [
    {
      provider_message_id: 'pm-1',
      provider_thread_id: 'pt-1',
      internet_message_id: null,
      in_reply_to: null,
      references_ids: [],
      direction: 'inbound',
      from_email: 'mehmet@yilmazendustri.com',
      from_name: 'Mehmet',
      to_emails: ['yunus@gmail.com'],
      cc_emails: [],
      subject: 'Sözleşme',
      snippet: 'Ekte',
      sent_at: null,
      received_at: '2026-09-23T10:00:00.000Z',
      is_read: false,
      importance: null,
      labels: [],
      has_attachments: true,
      list_unsubscribe: false,
      auto_submitted: false,
      precedence_bulk: false,
      dkim_pass: null,
      spf_pass: null,
      content_hash: 'a'.repeat(64),
      web_link: null,
      thread_web_link: null,
      deleted: false,
    },
  ]);
  assert(row !== undefined);
  if (input.stored !== undefined)
    await h.store.setAttachmentMeta(row.id, toStoredAttachments(input.stored));
  return { h, accountId: account.id, messageId: row.id };
}

function withMail(h: IntegrationHarness, mail: Record<string, unknown>): IntegrationRuntime {
  return {
    ...h.runtime,
    providers: {
      available: () => ['demo'],
      resolve: () => ({ oauth: {}, mail }) as never,
    },
  };
}

const access = (messageId: string, over: Record<string, unknown> = {}) => ({
  userId: USER,
  messageId,
  attachmentsAllowed: true,
  correlationId: 'c',
  log,
  ...over,
});

Deno.test(
  'attachments (API-MAIL-09): stored metadata with fresh refs; no provider call',
  async () => {
    const f = await fixture({
      stored: [
        meta(),
        meta({ providerAttachmentId: 'a2', filename: 'davet.ics', mimeType: 'text/calendar' }),
      ],
    });
    const rt = withMail(f.h, {
      listAttachments: () => Promise.reject(new Error('must not be called')),
    });
    const out = await listMessageAttachments(rt, access(f.messageId));
    assertEquals(out.source, 'stored');
    assertEquals(
      out.attachments.map((a) => [a.name, a.mime, a.capturable, a.blocked_reason]),
      [
        ['Hizmet_Sozlesmesi_v3.pdf', 'application/pdf', true, null],
        ['davet.ics', 'text/calendar', false, 'unsupported_type'],
      ],
    );
    const ref = await verifyStoredAttachmentRef(
      f.h.runtime.config.pepper,
      out.attachments[1]?.attachment_ref ?? '',
      NOW,
    );
    assertEquals(ref, { messageId: f.messageId, index: 1 });
    assertEquals(out.refs_expire_at, new Date(NOW.getTime() + 3_600_000).toISOString());
    assert(!JSON.stringify(out).includes('provider_attachment_id'));
  },
);

Deno.test(
  'attachments (API-MAIL-09): a message synced without metadata is listed once and stored',
  async () => {
    const f = await fixture();
    let calls = 0;
    const rt = withMail(f.h, {
      listAttachments: () => {
        calls++;
        return Promise.resolve([meta({ providerAttachmentId: 'g-1' })]);
      },
    });
    const first = await listMessageAttachments(rt, access(f.messageId));
    assertEquals([first.source, first.attachments.length, calls], ['provider', 1, 1]);
    const second = await listMessageAttachments(rt, access(f.messageId));
    assertEquals([second.source, calls], ['stored', 1]);
    // Without listAttachments the body's attachment list is used.
    const g = await fixture();
    const viaBody = await listMessageAttachments(
      withMail(g.h, {
        getMessageBody: () =>
          Promise.resolve({ text: '', html: null, truncated: false, attachments: [meta()] }),
      }),
      access(g.messageId),
    );
    assertEquals(viaBody.attachments.length, 1);
  },
);

Deno.test(
  'attachments (API-MAIL-09): data source controls, ownership and provider failures',
  async () => {
    const f = await fixture({ stored: [meta()] });
    const code = async (fn: () => Promise<unknown>) => (await assertRejects(fn, AppError)).code;
    assertEquals(
      await code(() =>
        listMessageAttachments(f.h.runtime, access(f.messageId, { attachmentsAllowed: false })),
      ),
      'DATA_SOURCE_DISABLED',
    );
    assertEquals(
      await code(() => listMessageAttachments(f.h.runtime, access(f.messageId, { userId: OTHER }))),
      'NOT_FOUND',
    );
    assertEquals(
      await code(() => listMessageAttachments(f.h.runtime, access(crypto.randomUUID()))),
      'NOT_FOUND',
    );
    const off = await fixture({ stored: [meta()], toggles: { attachments_analyze: false } });
    const e = await assertRejects(
      () => listMessageAttachments(off.h.runtime, access(off.messageId)),
      AppError,
    );
    assertEquals(
      [e.code, (e.details as { toggle?: string }).toggle],
      ['DATA_SOURCE_DISABLED', 'attachments_analyze'],
    );
    const reauth = await fixture({ status: 'needs_reauth' });
    assertEquals(
      await code(() => listMessageAttachments(reauth.h.runtime, access(reauth.messageId))),
      'PROVIDER_REAUTH_REQUIRED',
    );
    const gone = await fixture();
    assertEquals(
      await code(() =>
        listMessageAttachments(
          withMail(gone.h, {
            listAttachments: () => Promise.reject(new ProviderError('not_found', 404)),
          }),
          access(gone.messageId),
        ),
      ),
      'SOURCE_GONE',
    );
  },
);

Deno.test(
  'attachments (API-CAP-02 v2): download through the provider with the cap and re-list on a stale id',
  async () => {
    const f = await fixture({ stored: [meta({ providerAttachmentId: 'old-id' })] });
    const asked: string[] = [];
    const rt = withMail(f.h, {
      getAttachment: (_ctx: unknown, _m: string, id: string, opts: { maxBytes: number }) => {
        asked.push(`${id}:${opts.maxBytes}`);
        return id === 'old-id'
          ? Promise.reject(new ProviderError('not_found', 404))
          : Promise.resolve({ bytes: PDF, mimeType: 'application/octet-stream' });
      },
      listAttachments: () => Promise.resolve([meta({ providerAttachmentId: 'new-id' })]),
    });
    const file = await downloadStoredAttachment(rt, { ...access(f.messageId), index: 0 });
    assertEquals(
      [file.mime, file.name, file.bytes.byteLength],
      ['application/pdf', 'Hizmet_Sozlesmesi_v3.pdf', PDF.byteLength],
    );
    assertEquals(asked, [`old-id:${20 * 1024 * 1024}`, `new-id:${20 * 1024 * 1024}`]);
    const refreshed = await f.h.store.getMessage(f.messageId);
    assertEquals(
      parseStoredAttachments(refreshed?.attachment_meta)[0]?.provider_attachment_id,
      'new-id',
    );
  },
);

Deno.test(
  'attachments (API-CAP-02 v2): refusals — index, type, size, other file, oversized bytes',
  async () => {
    const f = await fixture({
      stored: [
        meta(),
        meta({ providerAttachmentId: 'doc', filename: 'a.docx', mimeType: 'application/msword' }),
        meta({ providerAttachmentId: 'big', sizeBytes: 30 * 1024 * 1024 }),
      ],
    });
    const code = async (rt: IntegrationRuntime, index: number) =>
      (
        await assertRejects(
          () => downloadStoredAttachment(rt, { ...access(f.messageId), index }),
          AppError,
        )
      ).code;
    const rt = withMail(f.h, {
      getAttachment: () =>
        Promise.resolve({ bytes: new Uint8Array(21 * 1024 * 1024), mimeType: 'x' }),
      listAttachments: () => Promise.resolve([]),
    });
    assertEquals(await code(rt, 9), 'SOURCE_GONE');
    assertEquals(await code(rt, 1), 'UNSUPPORTED_MEDIA_TYPE');
    assertEquals(await code(rt, 2), 'PAYLOAD_TOO_LARGE');
    assertEquals(await code(rt, 0), 'PAYLOAD_TOO_LARGE');
    const vanished = withMail(f.h, {
      getAttachment: () => Promise.reject(new ProviderError('not_found', 404)),
      listAttachments: () => Promise.resolve([meta({ filename: 'baska.pdf' })]),
    });
    assertEquals(await code(vanished, 0), 'SOURCE_GONE');
  },
);

Deno.test(
  'attachments (DEV-41): meeting files are signed per mail, deduped by name and size, ≤ 5',
  async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const files = await relevantFiles(
      SECRET,
      [
        {
          id: a,
          attachment_meta: toStoredAttachments([
            meta(),
            meta({ providerAttachmentId: 'i', filename: 'x', kind: 'item' }),
          ]),
        },
        {
          id: b,
          attachment_meta: toStoredAttachments([
            meta({ providerAttachmentId: 'dup' }),
            ...Array.from({ length: 8 }, (_, i) =>
              meta({ providerAttachmentId: `f${i}`, filename: `ek-${i}.pdf` }),
            ),
          ]),
        },
      ],
      NOW,
    );
    assertEquals(files.length, 5);
    assertEquals(files[0]?.email_message_id, a);
    assertEquals(files[1]?.name, 'ek-0.pdf');
    assertEquals(await verifyStoredAttachmentRef(SECRET, files[1]?.attachment_ref ?? '', NOW), {
      messageId: b,
      index: 1,
    });
  },
);
