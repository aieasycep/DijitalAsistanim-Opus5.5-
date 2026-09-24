/**
 * Universal Capture routes (IMPLEMENTATION_PLAN T-5.13; API_CONTRACTS API-CAP-01 `POST
 * /captures/upload-url`, API-CAP-02 `POST /captures`, API-CAP-03 `POST /captures/:id/analyze`,
 * API-CAP-04 `POST /captures/:id/actions`, API-CAP-05 `POST /captures/:id/discard`; M§27, M§84,
 * M§85). Pro (`capture`) is enforced by the route gate (discard stays open to owners) and the flag
 * `feature.capture` here. Files live in the private `captures` bucket under the caller's folder;
 * links are only fetched through the SSRF-safe fetcher; analysis runs in JOB-27 and the client
 * polls its `captures` row (R-19). Selected items become approvals in one batch.
 */
import {
  CaptureActionsBody,
  CaptureAnalyzeBody,
  CaptureCreateBody,
  CAPTURE_LIMITS,
  CAPTURE_MIME_EXTENSIONS,
  routes,
  UploadUrlBody,
} from '@da/validation';
import type { Capture } from '@da/validation';
import type { MiddlewareHandler } from 'hono';
import { currentUser } from '../../_shared/auth/user.ts';
import { sha256Hex } from '../../_shared/crypto/hmac.ts';
import { AppError } from '../../_shared/errors.ts';
import type { AppContext, AppEnv, UserAuth } from '../../_shared/http/context.ts';
import { sendData } from '../../_shared/http/respond.ts';
import {
  mountRoute,
  parseJsonBody,
  rawBody,
  validateRequest,
  validBody,
  validParams,
} from '../../_shared/http/validate.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import { sniffMime } from '../../_shared/security/upload-validate.ts';
import { POLL_AFTER_MS } from '../../_shared/services/assist/common.ts';
import type { CaptureRow } from '../../_shared/services/assist/store.ts';
import { proposeApproval } from '../../_shared/services/approvals/propose.ts';
import { toApprovalView } from '../../_shared/services/approvals/view.ts';
import { capturePayload } from '../../_shared/services/capture/actions.ts';
import type { CaptureItemView } from '../../_shared/services/capture/extract.ts';
import { assertLinkAllowed, linkPreview } from '../../_shared/services/capture/link.ts';
import { isOn } from '../../_shared/services/flags.ts';
import { providerContextFor } from '../../_shared/services/integrations/context.ts';
import { verifyAttachmentRef } from '../../_shared/services/integrations/mail-original.ts';
import { togglesOf } from '../../_shared/services/integrations/status.ts';
import { SIGNED_UPLOAD_TTL_S } from '../../_shared/services/storage.ts';
import type { RouteKit, RouteRegistrar } from '../deps.ts';
import { serviceDeps } from './approvals.ts';
import { assistOf, requireQuota } from './assist-api.ts';

const FILE_KINDS = new Set(['photo', 'screenshot', 'pdf', 'file']);
const TERMINAL = new Set(['discarded', 'actioned']);

export function captureView(row: CaptureRow): Capture {
  const items = (row.extracted as unknown as CaptureItemView[]).map((i) => ({
    item_id: i.item_id,
    type: i.type,
    title: i.title,
    fields: i.fields,
    evidence: i.evidence,
    confidence: i.confidence,
    proposed_action: i.proposed_action,
    selected: i.selected,
    unresolved: i.unresolved ?? [],
  }));
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    primary_type: row.primary_type,
    items,
    link_preview: row.link_preview,
    error_code: (row.error_code ?? null) as Capture['error_code'],
    created_at: new Date(row.created_at).toISOString(),
  };
}

async function requireCaptureFlag(kit: RouteKit, userId: string) {
  const user = await assistOf(kit).intel.ai.users.load(userId);
  if (!isOn(user.flags, 'feature.capture')) {
    throw new AppError('FEATURE_DISABLED', { details: { feature: 'capture' } });
  }
  return user;
}

async function ownedCapture(kit: RouteKit, userId: string, id: string): Promise<CaptureRow> {
  const row = await assistOf(kit).assist.store.capture(userId, id);
  if (row === null) throw new AppError('NOT_FOUND', { details: { resource: 'capture' } });
  return row;
}

/** 413 before schema validation for oversized declared files (images 15 MiB, PDF 20 MiB). */
const declaredSize: MiddlewareHandler<AppEnv> = async (c, next) => {
  const raw = rawBody(c) as { size_bytes?: unknown; mime?: unknown } | undefined;
  const limit =
    raw?.mime === 'application/pdf' ? CAPTURE_LIMITS.pdf_bytes : CAPTURE_LIMITS.image_bytes;
  if (typeof raw?.size_bytes === 'number' && raw.size_bytes > limit) {
    throw new AppError('PAYLOAD_TOO_LARGE', { details: { limit_bytes: limit } });
  }
  await next();
};

function extensionOf(mime: string): string {
  return (CAPTURE_MIME_EXTENSIONS as Record<string, readonly string[]>)[mime]?.[0] ?? 'bin';
}

async function signedUpload(kit: RouteKit, row: CaptureRow) {
  const path = row.storage_path ?? '';
  const signed = await assistOf(kit).assist.storage.signedUploadUrl('captures', path);
  return {
    capture_id: row.id,
    upload: {
      signed_url: signed.signedUrl,
      token: signed.token,
      path: signed.path,
      expires_at: new Date(kit.now().getTime() + SIGNED_UPLOAD_TTL_S * 1000).toISOString(),
      headers: { 'Content-Type': row.mime_type ?? 'application/octet-stream', 'x-upsert': 'false' },
    },
  };
}

/** API-CAP-02 `file` source: the mail attachment is downloaded into the caller's folder. */
async function importAttachment(
  kit: RouteKit,
  auth: UserAuth,
  source: { email_message_id: string; attachment_ref: string },
  captureId: string,
  correlationId: string,
  c: AppContext,
) {
  const rt = kit.deps.integrations;
  if (rt === undefined)
    throw new AppError('SERVICE_UNAVAILABLE', {
      details: { reason: 'integrations_not_configured' },
    });
  const ref = await verifyAttachmentRef(rt.config.pepper, source.attachment_ref, kit.now());
  if (ref === null || ref.messageId !== source.email_message_id) {
    throw new AppError('UPLOAD_INVALID', { details: { reason: 'attachment_ref_invalid' } });
  }
  const message = await rt.store.getMessage(ref.messageId);
  if (message === null || message.user_id !== auth.userId)
    throw new AppError('NOT_FOUND', { details: { resource: 'email_message' } });
  if (message.provider_deleted_at !== null)
    throw new AppError('SOURCE_GONE', { details: { resource: 'email_message' } });
  const account = await rt.store.getAccount(message.connected_account_id);
  if (account === null || account.user_id !== auth.userId)
    throw new AppError('NOT_FOUND', { details: { resource: 'email_message' } });
  if (!togglesOf(account).attachments_analyze) {
    throw new AppError('DATA_SOURCE_DISABLED', { details: { toggle: 'attachments_analyze' } });
  }
  if (account.status === 'needs_reauth') {
    throw new AppError('PROVIDER_REAUTH_REQUIRED', {
      details: { account_id: account.id, provider: account.provider },
    });
  }
  const adapters = rt.providers.resolve(account.provider as 'google' | 'microsoft' | 'demo');
  if (adapters.mail === undefined)
    throw new AppError('FEATURE_DISABLED', { details: { reason: 'mail_adapter_missing' } });
  const ctx = await providerContextFor(rt, account, {
    owner: `capture:${correlationId}`,
    correlationId,
    log: c.get('log'),
  });
  const body = await adapters.mail.getMessageBody(ctx, message.provider_message_id, {
    maxBytes: 64 * 1024,
  });
  const attachment = body.attachments[ref.index];
  if (attachment === undefined)
    throw new AppError('SOURCE_GONE', { details: { resource: 'attachment' } });
  const mime = attachment.mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!(mime in CAPTURE_MIME_EXTENSIONS))
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', { details: { mime } });
  const limit = mime === 'application/pdf' ? CAPTURE_LIMITS.pdf_bytes : CAPTURE_LIMITS.image_bytes;
  if (attachment.sizeBytes > limit)
    throw new AppError('PAYLOAD_TOO_LARGE', { details: { limit_bytes: limit } });
  const file = await adapters.mail.getAttachment(
    ctx,
    message.provider_message_id,
    attachment.providerAttachmentId,
    { maxBytes: limit },
  );
  if (
    sniffMime(file.bytes.subarray(0, 64)) !== mime &&
    !(mime === 'image/heif' && sniffMime(file.bytes.subarray(0, 64)) === 'image/heic')
  ) {
    throw new AppError('UPLOAD_INVALID', { details: { reason: 'magic_mismatch' } });
  }
  const path = `${auth.userId}/${captureId}/${crypto.randomUUID()}.${extensionOf(mime)}`;
  await assistOf(kit).assist.storage.upload('captures', path, file.bytes, mime);
  return {
    path,
    mime,
    size: file.bytes.byteLength,
    sha256: await sha256Hex(file.bytes),
    name: attachment.filename.slice(0, 200),
  };
}

export const registerCaptureRoutes: RouteRegistrar = (app, kit) => {
  const idem = { repo: kit.deps.idempotency, now: () => kit.now().getTime() };

  const upload = routes['POST /captures/upload-url'];
  mountRoute(
    app,
    upload,
    ...kit.chain({ gate: true, rateLimit: 'captures' }),
    parseJsonBody(upload),
    declaredSize,
    validateRequest(upload),
    async (c) => {
      const auth = currentUser(c);
      const body = validBody(c, UploadUrlBody);
      await requireCaptureFlag(kit, auth.userId);
      const { assist } = assistOf(kit);
      const existing = await assist.store.captureByClient(auth.userId, body.client_capture_id);
      if (existing !== null) {
        if (existing.status !== 'pending_upload') {
          throw new AppError('STATE_CONFLICT', {
            details: { reason: 'already_uploaded', status: existing.status },
          });
        }
        return sendData(c, await signedUpload(kit, existing), 201);
      }
      const id = crypto.randomUUID();
      const row = await assist.store.insertCapture({
        id,
        user_id: auth.userId,
        kind: body.kind,
        status: 'pending_upload',
        storage_path: `${auth.userId}/${id}/${crypto.randomUUID()}.${extensionOf(body.mime)}`,
        mime_type: body.mime,
        size_bytes: body.size_bytes,
        sha256: body.sha256,
        original_filename: body.file_name?.slice(0, 200) ?? null,
        source_url: null,
        text_content: null,
        share_origin: body.share_origin,
        idempotency_key: body.client_capture_id,
        link_preview: null,
      });
      return sendData(c, await signedUpload(kit, row), 201);
    },
  );

  const create = routes['POST /captures'];
  mountRoute(
    app,
    create,
    ...kit.chain({ gate: true, rateLimit: 'captures' }),
    parseJsonBody(create),
    validateRequest(create),
    async (c) => {
      const auth = currentUser(c);
      const body = validBody(c, CaptureCreateBody);
      await requireCaptureFlag(kit, auth.userId);
      const { assist } = assistOf(kit);
      const existing = await assist.store.captureByClient(auth.userId, body.client_capture_id);
      if (existing !== null) {
        c.header('Idempotency-Replayed', 'true');
        return sendData(c, captureView(existing), 201, { idempotency_replayed: true });
      }
      const id = crypto.randomUUID();
      const src = body.source;
      const fetchDeps = {
        ...(assist.fetch === undefined ? {} : { fetch: assist.fetch }),
        ...(assist.resolver === undefined ? {} : { resolver: assist.resolver }),
      };
      const base = {
        id,
        user_id: auth.userId,
        status: 'uploaded' as const,
        share_origin: body.share_origin,
        idempotency_key: body.client_capture_id,
        storage_path: null,
        mime_type: null,
        size_bytes: null,
        sha256: null,
        original_filename: null,
        source_url: null,
        text_content: null,
        link_preview: null,
      };
      let row: CaptureRow;
      switch (src.kind) {
        case 'text':
          row = await assist.store.insertCapture({ ...base, kind: 'text', text_content: src.text });
          break;
        case 'link': {
          assertLinkAllowed(src.url);
          const preview = src.preview ? await linkPreview(src.url, fetchDeps) : null;
          row = await assist.store.insertCapture({
            ...base,
            kind: 'link',
            source_url: src.url,
            link_preview: preview,
          });
          break;
        }
        case 'share': {
          if (src.url !== undefined) assertLinkAllowed(src.url);
          const preview = src.url === undefined ? null : await linkPreview(src.url, fetchDeps);
          row = await assist.store.insertCapture({
            ...base,
            kind: 'share',
            text_content: src.text ?? null,
            source_url: src.url ?? null,
            link_preview: preview,
          });
          break;
        }
        case 'file': {
          const file = await importAttachment(
            kit,
            auth,
            src.from_email_attachment,
            id,
            c.get('correlationId'),
            c,
          );
          row = await assist.store.insertCapture({
            ...base,
            kind: file.mime === 'application/pdf' ? 'pdf' : 'file',
            storage_path: file.path,
            mime_type: file.mime,
            size_bytes: file.size,
            sha256: file.sha256,
            original_filename: file.name,
          });
          break;
        }
      }
      return sendData(c, captureView(row), 201);
    },
  );

  const analyze = routes['POST /captures/:id/analyze'];
  mountRoute(
    app,
    analyze,
    ...kit.chain({ gate: true, rateLimit: 'captures' }),
    parseJsonBody(analyze),
    validateRequest(analyze),
    (c) => {
      const auth = currentUser(c);
      const params = validParams(c, analyze.request.params);
      const body = validBody(c, CaptureAnalyzeBody);
      return withIdempotency(c, idem, {
        status: 202,
        async execute() {
          const user = await requireCaptureFlag(kit, auth.userId);
          const { assist } = assistOf(kit);
          const row = await ownedCapture(kit, auth.userId, params.id);
          const generation = Number(row.progress.generation ?? 0);
          if (row.status === 'analyzing') {
            const job = await kit.deps
              .repos(auth)
              .jobs.byKey(`capture_analysis:${row.id}:${generation}`);
            return {
              data: {
                capture: captureView(row),
                job: {
                  job_id: job?.id ?? row.id,
                  status: job?.status ?? 'queued',
                  poll_after_ms: POLL_AFTER_MS,
                },
              },
              ref: { type: 'capture', id: row.id },
              meta: { poll_after_ms: POLL_AFTER_MS },
            };
          }
          if (!['uploaded', 'pending_upload', 'failed'].includes(row.status)) {
            throw new AppError('STATE_CONFLICT', {
              details: { reason: 'not_analyzable', status: row.status },
            });
          }
          if (FILE_KINDS.has(row.kind) || row.storage_path !== null) {
            if (!user.dataAccess.attachments) {
              throw new AppError('DATA_SOURCE_DISABLED', {
                details: { toggle: 'ai_data_access.attachments' },
              });
            }
            const stat =
              row.storage_path === null
                ? null
                : await assist.storage.stat('captures', row.storage_path);
            if (stat === null)
              throw new AppError('STATE_CONFLICT', { details: { reason: 'upload_missing' } });
            if (row.size_bytes !== null && stat.size > 0 && stat.size !== row.size_bytes) {
              throw new AppError('UPLOAD_INVALID', { details: { reason: 'size_mismatch' } });
            }
          }
          await requireQuota(kit, auth, 'captures_daily');
          const next = generation + 1;
          const updated = await assist.store.updateCapture(auth.userId, row.id, {
            status: 'analyzing',
            error_code: null,
            progress: {
              ...row.progress,
              generation: next,
              step: 'queued',
              ...(body.hint_type === undefined ? {} : { hint_type: body.hint_type }),
            },
          });
          const jobId = await kit.deps.repos(auth).jobs.enqueue({
            type: 'capture_analysis',
            idempotencyKey: `capture_analysis:${row.id}:${next}`,
            payload: { capture_id: row.id, user_id: auth.userId },
            userId: auth.userId,
            priority: 20,
            maxAttempts: 3,
            correlationId: c.get('correlationId'),
          });
          return {
            data: {
              capture: captureView(updated ?? row),
              job: { job_id: jobId, status: 'queued', poll_after_ms: POLL_AFTER_MS },
            },
            ref: { type: 'capture', id: row.id },
            meta: { poll_after_ms: POLL_AFTER_MS },
          };
        },
        async replay(ref) {
          const row = await ownedCapture(kit, auth.userId, ref.id ?? '');
          const job = await kit.deps
            .repos(auth)
            .jobs.byKey(`capture_analysis:${row.id}:${Number(row.progress.generation ?? 0)}`);
          return {
            capture: captureView(row),
            job: {
              job_id: job?.id ?? row.id,
              status: job?.status ?? 'queued',
              poll_after_ms: POLL_AFTER_MS,
            },
          };
        },
      });
    },
  );

  const actions = routes['POST /captures/:id/actions'];
  mountRoute(
    app,
    actions,
    ...kit.chain({ gate: true, rateLimit: 'captures' }),
    parseJsonBody(actions),
    validateRequest(actions),
    (c) => {
      const auth = currentUser(c);
      const params = validParams(c, actions.request.params);
      const body = validBody(c, CaptureActionsBody);
      const repos = kit.deps.repos(auth);
      return withIdempotency(c, idem, {
        status: 201,
        async execute() {
          const user = await requireCaptureFlag(kit, auth.userId);
          const { assist, intel } = assistOf(kit);
          const row = await ownedCapture(kit, auth.userId, params.id);
          if (row.status !== 'extracted' && row.status !== 'actioned') {
            throw new AppError('STATE_CONFLICT', {
              details: { reason: 'not_extracted', status: row.status },
            });
          }
          const items = (row.extracted as unknown as CaptureItemView[]).map((i) => ({ ...i }));
          const calendar = await assist.store.writableCalendar(auth.userId, null);
          const deps = serviceDeps(c, kit, repos);
          const approvals = [];
          for (const request of body.items) {
            const item = items.find((i) => i.item_id === request.item_id);
            if (item === undefined) {
              throw new AppError('VALIDATION_FAILED', {
                details: { reason: 'unknown_item', item_id: request.item_id },
              });
            }
            const existingId = item.approval_ids?.[request.action_type];
            const existing =
              existingId === undefined ? null : await repos.approvals.get(auth.userId, existingId);
            if (existing !== null && existing.status === 'pending') {
              approvals.push(toApprovalView(existing, { locale: deps.locale }));
              continue;
            }
            const payload = capturePayload(item, request, {
              now: kit.now(),
              timeZone: user.timeZone,
              calendar,
              captureId: row.id,
              capturedAt: row.created_at,
            });
            const out = await proposeApproval(deps, {
              userId: auth.userId,
              payload,
              origin: 'capture',
              originRefId: row.id,
              batchId: row.id,
              source: {
                source_type: 'capture',
                source_id: row.id,
                source_provider: 'in_app',
                source_timestamp: row.created_at,
              },
              actor: 'user',
            });
            item.selected = true;
            item.approval_ids = {
              ...(item.approval_ids ?? {}),
              [request.action_type]: out.approval.id,
            };
            approvals.push(out.view);
          }
          let memorySaved = false;
          if (body.save_to_memory && user.isPro) {
            const sources = await intel.memory.sources(auth.userId, [
              { kind: 'capture', id: row.id },
            ]);
            memorySaved = sources.length > 0;
            await repos.jobs.enqueue({
              type: 'embedding',
              idempotencyKey: `embedding:${auth.userId}:capture:${row.id}`,
              payload: { user_id: auth.userId, items: [{ kind: 'capture', id: row.id }] },
              userId: auth.userId,
              correlationId: c.get('correlationId'),
            });
          }
          await assist.store.updateCapture(auth.userId, row.id, {
            extracted: items as unknown as Record<string, unknown>[],
            progress: {
              ...row.progress,
              memory_saved: memorySaved || row.progress.memory_saved === true,
            },
          });
          return {
            data: { approvals, batch_id: row.id, memory_saved: memorySaved },
            ref: { type: 'capture', id: row.id, ack: { memory_saved: memorySaved } },
          };
        },
        async replay(ref) {
          const row = await ownedCapture(kit, auth.userId, ref.id ?? '');
          const ids = await assistOf(kit).assist.store.approvalIdsByBatch(auth.userId, row.id);
          const locale = serviceDeps(c, kit, repos).locale;
          const views = [];
          for (const id of ids) {
            const approval = await repos.approvals.get(auth.userId, id);
            if (approval !== null) views.push(toApprovalView(approval, { locale }));
          }
          return {
            approvals: views,
            batch_id: row.id,
            memory_saved: ref.ack?.memory_saved === true,
          };
        },
      });
    },
  );

  const discard = routes['POST /captures/:id/discard'];
  mountRoute(
    app,
    discard,
    ...kit.chain({ gate: true, rateLimit: 'captures' }),
    parseJsonBody(discard),
    validateRequest(discard),
    async (c) => {
      const auth = currentUser(c);
      const params = validParams(c, discard.request.params);
      const { assist } = assistOf(kit);
      const current = await ownedCapture(kit, auth.userId, params.id);
      if (TERMINAL.has(current.status)) return sendData(c, captureView(current));
      const out = await assist.store.discardCapture(auth.userId, params.id);
      if (out.storagePath !== null) await assist.storage.remove('captures', [out.storagePath]);
      return sendData(c, captureView(out.capture));
    },
  );
};
