/**
 * JOB-27 `capture_analysis` (IMPLEMENTATION_PLAN T-5.13; API_CONTRACTS §11; M§27, M§84, M§85).
 *
 * 1. Re-check the capture is `analyzing` (a discarded capture is skipped; the status is checked
 *    again before persisting, so a discard during analysis wins).
 * 2. Files: the Storage object must exist, match its declared size and sha256, and its magic bytes
 *    must match the MIME (PNG renamed `.pdf` → `UPLOAD_INVALID`); PDFs ≤ 50 pages, text via `unpdf`;
 *    a scanned PDF needs the large-model escalation flag.
 * 3. Links: the SSRF-safe fetcher reads the page once (`SSRF_BLOCKED` / `FETCH_FAILED` are terminal).
 * 4. Text as is. Sensitive patterns are redacted before the model.
 * 5. `CaptureExtractV1` with grounding; `extracted`, types, `analyzed_at`, then the file is deleted
 *    right away (`file_deleted_at`), keeping "içerik saklanmaz" true.
 * Retryable AI failures retry; the last one marks the capture `failed` with `AI_UNAVAILABLE`.
 */
import { Uuid } from '@da/validation';
import { z } from 'zod';
import { toBase64 } from '../../_shared/crypto/encoding.ts';
import { sha256Hex } from '../../_shared/crypto/hmac.ts';
import { defineJob } from '../../_shared/jobs/registry.ts';
import { type JobContext, JobError } from '../../_shared/jobs/types.ts';
import { validateUpload, sniffMime } from '../../_shared/security/upload-validate.ts';
import type { CaptureRow } from '../../_shared/services/assist/store.ts';
import { type CaptureInput, extractCapture } from '../../_shared/services/capture/extract.ts';
import { PAGE_MIN_TEXT, readPage, SsrfError } from '../../_shared/services/capture/link.ts';
import { readPdf } from '../../_shared/services/capture/pdf.ts';
import { isOn } from '../../_shared/services/flags.ts';
import type { AiUser } from '../../_shared/services/ai/runtime.ts';
import { type AssistJobDeps, assistPipeline } from './assist.ts';

export const CaptureAnalysisPayload = z.object({ capture_id: Uuid, user_id: Uuid.optional() });
export type CaptureAnalysisPayload = z.infer<typeof CaptureAnalysisPayload>;

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const FILE_TTL_MS = 24 * 3_600_000;

class Terminal extends Error {
  constructor(
    readonly code: 'UPLOAD_INVALID' | 'SSRF_BLOCKED' | 'FETCH_FAILED',
    readonly reason: string,
  ) {
    super(code);
  }
}

async function fileInput(
  deps: AssistJobDeps,
  capture: CaptureRow,
  user: AiUser,
): Promise<CaptureInput> {
  if (capture.storage_path === null || capture.mime_type === null)
    throw new Terminal('UPLOAD_INVALID', 'no_file');
  const bytes = await deps.storage.download('captures', capture.storage_path, MAX_FILE_BYTES);
  if (bytes === null) throw new Terminal('UPLOAD_INVALID', 'missing_object');
  if (capture.size_bytes !== null && bytes.byteLength !== capture.size_bytes)
    throw new Terminal('UPLOAD_INVALID', 'size_mismatch');
  if (capture.sha256 !== null && (await sha256Hex(bytes)) !== capture.sha256)
    throw new Terminal('UPLOAD_INVALID', 'sha256_mismatch');
  const name =
    capture.original_filename ??
    `upload.${capture.mime_type === 'application/pdf' ? 'pdf' : capture.mime_type.split('/')[1]}`;
  const check = validateUpload({
    declaredMime: capture.mime_type,
    fileName: name,
    sizeBytes: bytes.byteLength,
    head: bytes.subarray(0, 64),
  });
  if (
    !check.ok &&
    !(
      check.reason === 'extension_mismatch' &&
      sniffMime(bytes.subarray(0, 64)) === capture.mime_type
    )
  ) {
    throw new Terminal('UPLOAD_INVALID', check.reason);
  }
  if (capture.mime_type === 'application/pdf') return await pdfInput(bytes, user);
  if (
    capture.mime_type === 'image/jpeg' ||
    capture.mime_type === 'image/png' ||
    capture.mime_type === 'image/webp'
  ) {
    return { kind: 'image', mime: capture.mime_type, b64: toBase64(bytes) };
  }
  // HEIC/HEIF are re-encoded to JPEG on the device (AI_PIPELINE_PLAN §13.4); vision takes no HEIC.
  throw new Terminal('UPLOAD_INVALID', 'image_format_unsupported');
}

async function pdfInput(bytes: Uint8Array, user: AiUser): Promise<CaptureInput> {
  const pdf = await readPdf(bytes);
  if (pdf.kind === 'invalid') throw new Terminal('UPLOAD_INVALID', pdf.reason);
  if (pdf.kind === 'text') return { kind: 'pdf_text', pages: pdf.pages };
  // Scanned PDFs go to the escalation (T3) route only behind its flag.
  if (!isOn(user.flags, 'ai.model.opus_escalation'))
    throw new Terminal('UPLOAD_INVALID', 'scanned_pdf');
  return { kind: 'pdf_scanned', b64: toBase64(bytes), pageCount: pdf.pageCount };
}

async function inputFor(
  deps: AssistJobDeps,
  ctx: JobContext<unknown>,
  capture: CaptureRow,
  user: AiUser,
): Promise<{ input: CaptureInput; finalUrl?: string; pages?: number }> {
  switch (capture.kind) {
    case 'text':
      return { input: { kind: 'text', text: capture.text_content ?? '' } };
    case 'link':
    case 'share': {
      if (capture.source_url === null)
        return { input: { kind: 'text', text: capture.text_content ?? '' } };
      try {
        const page = await readPage(capture.source_url, {
          ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
          ...(deps.resolver === undefined ? {} : { resolver: deps.resolver }),
          signal: ctx.signal,
        });
        if (page.pdf !== null)
          return { input: await pdfInput(page.pdf, user), finalUrl: page.finalUrl };
        const text = [capture.text_content ?? '', page.text]
          .filter((t) => t.trim() !== '')
          .join('\n\n');
        if (text.trim().length < PAGE_MIN_TEXT)
          throw new Terminal('FETCH_FAILED', 'page_unreadable');
        return { input: { kind: 'page', text, title: page.title }, finalUrl: page.finalUrl };
      } catch (error) {
        if (error instanceof SsrfError) throw new Terminal(error.apiCode, error.code);
        throw error;
      }
    }
    default:
      return { input: await fileInput(deps, capture, user) };
  }
}

export async function runCaptureAnalysis(
  deps: AssistJobDeps,
  ctx: JobContext<CaptureAnalysisPayload>,
): Promise<Record<string, string | number>> {
  const userId = ctx.payload.user_id ?? ctx.job.user_id;
  if (userId === null) return { skipped: 'user_missing' };
  const capture = await deps.store.capture(userId, ctx.payload.capture_id);
  if (capture === null || capture.status !== 'analyzing') return { skipped: 'not_analyzing' };
  const user = await deps.intel.ai.users.load(userId);
  const now = ctx.now();
  const final = ctx.job.attempts >= ctx.job.max_attempts;
  const progress = (step: string) =>
    deps.store.updateCapture(userId, capture.id, {
      progress: { ...capture.progress, step, step_at: new Date().toISOString() },
    });
  try {
    await progress('reading');
    const { input, finalUrl } = await inputFor(deps, ctx, capture, user);
    await progress('extracting');
    const outcome = await extractCapture(assistPipeline(deps, user, ctx), input, {
      captureId: capture.id,
      capturedAt: capture.created_at,
      shareOrigin: capture.share_origin,
      hint: typeof capture.progress.hint_type === 'string' ? capture.progress.hint_type : null,
      now,
    });
    if (outcome.kind !== 'ok') {
      if (!final && outcome.reason === 'ai_unavailable') throw new JobError('AI_UNAVAILABLE', true);
      await deps.store.updateCapture(userId, capture.id, {
        status: 'failed',
        error_code: outcome.reason === 'ai_budget_exhausted' ? 'QUOTA_EXCEEDED' : 'AI_UNAVAILABLE',
      });
      return { status: 'failed', reason: outcome.reason };
    }
    // A discard during the analysis wins: re-check before persisting.
    const current = await deps.store.capture(userId, capture.id);
    if (current === null || current.status !== 'analyzing') return { skipped: 'discarded' };
    const types = [...new Set(outcome.items.map((i) => i.type))];
    await deps.store.updateCapture(userId, capture.id, {
      status: 'extracted',
      extracted: outcome.items as unknown as Record<string, unknown>[],
      extracted_types: types,
      primary_type: outcome.items[0]?.type ?? null,
      analyzed_at: now.toISOString(),
      error_code: null,
      ai_request_id: outcome.aiRequestId,
      progress: {
        ...capture.progress,
        step: 'done',
        title: outcome.title.slice(0, 120),
        summary: outcome.summary?.slice(0, 300) ?? null,
        injection_suspected: outcome.injectionSuspected,
      },
      ...(finalUrl === undefined ? {} : { final_url: finalUrl }),
    });
    if (capture.storage_path !== null && capture.file_deleted_at === null) {
      await deps.storage.remove('captures', [capture.storage_path]);
      await deps.store.updateCapture(userId, capture.id, {
        file_deleted_at: new Date().toISOString(),
      });
    }
    await cleanupStaleFiles(deps, userId, now);
    return { status: 'extracted', items: outcome.items.length };
  } catch (error) {
    if (error instanceof Terminal) {
      await deps.store.updateCapture(userId, capture.id, {
        status: 'failed',
        error_code: error.code,
        progress: { ...capture.progress, step: 'failed', reason: error.reason },
      });
      return { status: 'failed', error_code: error.code };
    }
    if (final) {
      await deps.store.updateCapture(userId, capture.id, {
        status: 'failed',
        error_code: 'AI_UNAVAILABLE',
      });
    }
    if (error instanceof JobError) throw error;
    throw new JobError(
      'CAPTURE_ANALYSIS_FAILED',
      !final,
      null,
      error instanceof Error ? error.name : undefined,
    );
  }
}

/** Files of analysed captures are never kept longer than 24 h (T-5.13). */
async function cleanupStaleFiles(deps: AssistJobDeps, userId: string, now: Date): Promise<void> {
  const stale = await deps.store.capturesWithStaleFiles(
    userId,
    new Date(now.getTime() - FILE_TTL_MS),
  );
  const paths = stale.flatMap((c) => (c.storage_path === null ? [] : [c.storage_path]));
  if (paths.length === 0) return;
  await deps.storage.remove('captures', paths);
  for (const c of stale)
    await deps.store.updateCapture(userId, c.id, { file_deleted_at: now.toISOString() });
}

export function captureAnalysisJob(deps: AssistJobDeps) {
  return defineJob({
    type: 'capture_analysis',
    payload: CaptureAnalysisPayload,
    handler: async (ctx) => ({ ...(await runCaptureAnalysis(deps, ctx)) }),
    timeoutMs: 90_000,
  });
}
