import { z } from 'zod';
import { ApprovalView } from './approvals.ts';
import {
  IsoDateTime,
  Language,
  Recipient,
  RecipientInput,
  ReplyDraft,
  Sha256Hex,
  SignedUpload,
  SourceRef,
  Tone,
  Uuid,
} from './common.ts';
import { Success } from './envelope.ts';

export const MessageIdParams = z.strictObject({ messageId: Uuid });
export const DraftIdParams = z.strictObject({ id: Uuid });
export const ThreadIdParams = z.strictObject({ threadId: Uuid });

// API-MAIL-01 · GET /mail/:messageId/original
export const MailOriginalQuery = z.strictObject({
  remote_images: z.enum(['blocked', 'allowed']).default('blocked'),
});
export const MailOriginalData = z.object({
  message_id: Uuid,
  subject: z.string(),
  from: Recipient,
  to: z.array(Recipient),
  cc: z.array(Recipient),
  date: IsoDateTime,
  body: z.object({
    format: z.enum(['html_sanitized', 'text']),
    content: z.string().max(524288),
    truncated: z.boolean(),
    remote_images_blocked: z.boolean(),
  }),
  attachments: z
    .array(
      z.object({
        attachment_ref: z.string().max(200),
        name: z.string().max(255),
        mime: z.string(),
        size_bytes: z.int(),
      }),
    )
    .max(50),
  web_link: z.url().nullable(),
  fetched_at: IsoDateTime,
});
export const MailOriginalResponse = Success(MailOriginalData);

// API-MAIL-02 · POST /mail/:messageId/reply-drafts
export const ReplyDraftCreateBody = z.strictObject({
  tone: Tone,
  language: Language.optional(),
  instructions: z.string().max(500).optional(),
});
export const ReplyDraftResponse = Success(ReplyDraft);

// API-MAIL-03 · POST /reply-drafts/:id/regenerate
export const ReplyDraftRegenerateBody = z.strictObject({
  tone: Tone.optional(),
  instructions: z.string().max(500).optional(),
  expected_version: z.int().min(1),
});

// API-MAIL-04 · PATCH /reply-drafts/:id
export const ReplyDraftPatch = z
  .strictObject({
    body_text: z.string().min(1).max(20000).optional(),
    subject: z.string().min(1).max(998).optional(),
    to: z.array(RecipientInput).min(1).max(50).optional(),
    cc: z.array(RecipientInput).max(50).optional(),
    expected_version: z.int().min(1),
  })
  .refine(
    (patch) =>
      patch.body_text !== undefined ||
      patch.subject !== undefined ||
      patch.to !== undefined ||
      patch.cc !== undefined,
    'no_changes',
  );

// API-MAIL-05 · POST /reply-drafts/:id/submit
export const ReplyDraftSubmitBody = z.strictObject({ expected_version: z.int().min(1) });
export const ReplyDraftSubmitResponse = Success(
  z.object({ draft: ReplyDraft, approval: ApprovalView }),
);

// API-MAIL-06 · POST /followups/:threadId/draft
export const FollowupDraftBody = z.strictObject({
  tone: Tone.default('short'),
  language: Language.optional(),
  instructions: z.string().max(500).optional(),
});

// API-MAIL-07 · POST /mail/threads/:threadId/summary
export const ThreadSummaryBody = z.strictObject({ refresh: z.boolean().default(false) });
export const ThreadSummaryData = z.object({
  thread_id: Uuid,
  summary: z.string().max(600),
  key_points: z.array(z.object({ text: z.string().max(200), source: SourceRef })).max(5),
  open_questions: z
    .array(z.object({ text: z.string().max(200), owner: z.enum(['user', 'other', 'unclear']) }))
    .max(5),
  generated_at: IsoDateTime,
  cached: z.boolean(),
});
export const ThreadSummaryResponse = Success(ThreadSummaryData);

// API-MAIL-08 · POST /reply-drafts/:id/attachments/upload-url
export const REPLY_ATTACHMENT_MIME_EXTENSIONS = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/heic': ['heic'],
  'image/webp': ['webp'],
  'text/plain': ['txt'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
} as const;
export const ReplyAttachmentMime = z.enum([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/** `true` when the file name's extension is allowed for the MIME type. */
export function extensionMatchesMime(
  fileName: string,
  allowed: Readonly<Record<string, readonly string[]>>,
  mime: string,
): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return allowed[mime]?.includes(ext) ?? false;
}

export const ReplyAttachmentUploadBody = z
  .strictObject({
    client_attachment_id: Uuid,
    file_name: z.string().min(1).max(255),
    mime: ReplyAttachmentMime,
    size_bytes: z.int().min(1).max(3145728),
    sha256: Sha256Hex,
  })
  .refine(
    (body) => extensionMatchesMime(body.file_name, REPLY_ATTACHMENT_MIME_EXTENSIONS, body.mime),
    { message: 'extension_mime_mismatch', path: ['file_name'] },
  );
export const ReplyAttachmentUploadResponse = Success(
  z.object({ upload: SignedUpload, draft: ReplyDraft }),
);
