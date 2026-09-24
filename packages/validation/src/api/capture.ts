import { z } from 'zod';
import { ApprovalView } from './approvals.ts';
import {
  Capture,
  ExtractedEntityType,
  HttpsUrl,
  IsoDateTime,
  JobRef,
  Sha256Hex,
  Uuid,
} from './common.ts';
import { Success } from './envelope.ts';
import { extensionMatchesMime } from './mail.ts';

export const CaptureIdParams = z.strictObject({ id: Uuid });
export const ShareOrigin = z.enum(['in_app', 'ios_share', 'android_send', 'assistant', 'today']);

/** Size ceilings (§2.10): images 15 MiB, PDF 20 MiB and 50 pages. */
export const CAPTURE_LIMITS = {
  image_bytes: 15 * 1024 * 1024,
  pdf_bytes: 20 * 1024 * 1024,
  pdf_pages: 50,
  text_chars: 20000,
  link_chars: 2048,
} as const;

export const CAPTURE_MIME_EXTENSIONS = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/heic': ['heic'],
  'image/heif': ['heif'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
} as const;
export const CaptureMime = z.enum([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'application/pdf',
]);

// API-CAP-01 · POST /captures/upload-url
export const UploadUrlBody = z
  .strictObject({
    client_capture_id: Uuid,
    kind: z.enum(['photo', 'screenshot', 'pdf', 'file']),
    mime: CaptureMime,
    size_bytes: z.int().min(1),
    file_name: z.string().max(255).optional(),
    sha256: Sha256Hex,
    share_origin: ShareOrigin,
  })
  .superRefine((body, ctx) => {
    const isPdf = body.mime === 'application/pdf';
    const limit = isPdf ? CAPTURE_LIMITS.pdf_bytes : CAPTURE_LIMITS.image_bytes;
    if (body.size_bytes > limit) {
      ctx.addIssue({ code: 'custom', path: ['size_bytes'], message: 'too_large' });
    }
    if ((body.kind === 'pdf') !== isPdf) {
      ctx.addIssue({ code: 'custom', path: ['kind'], message: 'kind_mime_mismatch' });
    }
    if (
      body.file_name !== undefined &&
      !extensionMatchesMime(body.file_name, CAPTURE_MIME_EXTENSIONS, body.mime)
    ) {
      ctx.addIssue({ code: 'custom', path: ['file_name'], message: 'extension_mime_mismatch' });
    }
  });
export const UploadUrlResponse = Success(
  z.object({
    capture_id: Uuid,
    upload: z.object({
      signed_url: z.url(),
      token: z.string(),
      path: z.string(),
      expires_at: IsoDateTime,
      headers: z.record(z.string(), z.string()),
    }),
  }),
);

// API-CAP-02 · POST /captures
const CaptureLink = HttpsUrl.max(CAPTURE_LIMITS.link_chars);
export const CaptureSource = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('text'),
    text: z.string().trim().min(1).max(CAPTURE_LIMITS.text_chars),
  }),
  z.strictObject({ kind: z.literal('link'), url: CaptureLink, preview: z.boolean().default(true) }),
  z
    .strictObject({
      kind: z.literal('share'),
      text: z.string().max(CAPTURE_LIMITS.text_chars).optional(),
      url: CaptureLink.optional(),
      file_capture_ids: z.array(Uuid).max(10).optional(),
    })
    .refine(
      (s) => s.text !== undefined || s.url !== undefined || (s.file_capture_ids?.length ?? 0) > 0,
      'share_empty',
    ),
  z.strictObject({
    kind: z.literal('file'),
    from_email_attachment: z.strictObject({
      email_message_id: Uuid,
      attachment_ref: z.string().max(400),
    }),
  }),
]);
export const CaptureCreateBody = z.strictObject({
  client_capture_id: Uuid,
  share_origin: ShareOrigin,
  source: CaptureSource,
});
export const CaptureResponse = Success(Capture);

// API-CAP-03 · POST /captures/:id/analyze
export const CaptureAnalyzeBody = z.strictObject({ hint_type: ExtractedEntityType.optional() });
export const CaptureAnalyzeResponse = Success(z.object({ capture: Capture, job: JobRef }));

// API-CAP-04 · POST /captures/:id/actions
export const CaptureActionsBody = z
  .strictObject({
    items: z
      .array(
        z.strictObject({
          item_id: z.string().max(40),
          action_type: z.enum([
            'calendar_create',
            'task_create',
            'reminder_create',
            'commitment_create',
          ]),
          overrides: z.record(z.string(), z.unknown()).optional(),
          destination: z.unknown(),
        }),
      )
      .min(0)
      .max(10),
    save_to_memory: z.boolean().default(false),
  })
  .refine((b) => b.items.length > 0 || b.save_to_memory, 'nothing_to_do')
  .refine(
    (b) => new Set(b.items.map((i) => `${i.item_id}:${i.action_type}`)).size === b.items.length,
    'duplicate_item_action',
  );
export const CaptureActionsResponse = Success(
  z.object({ approvals: z.array(ApprovalView), batch_id: Uuid, memory_saved: z.boolean() }),
);

// API-CAP-05 · POST /captures/:id/discard
export const CaptureDiscardBody = z.strictObject({});
