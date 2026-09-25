/**
 * Reply drafts (IMPLEMENTATION_PLAN T-5.12; API_CONTRACTS API-MAIL-02 `POST /mail/:messageId/
 * reply-drafts`, API-MAIL-03 `POST /reply-drafts/:id/regenerate`, API-MAIL-04 `PATCH
 * /reply-drafts/:id`, API-MAIL-05 `POST /reply-drafts/:id/submit`, API-MAIL-08 `POST
 * /reply-drafts/:id/attachments/upload-url`). Generate → edit → approval → send: nothing is sent
 * without the `email_send` approval, which is built through B's `proposeApproval` with
 * `allowEmailSend` and the exact change. Recipients, subject and threading come from the stored
 * headers only. Thread bodies are fetched transiently and never stored or logged.
 */
import {
  ReplyAttachmentUploadBody,
  ReplyDraftCreateBody,
  ReplyDraftPatch as ReplyDraftPatchBody,
  ReplyDraftRegenerateBody,
  ReplyDraftSubmitBody,
  draftViolations,
  routes,
} from '@da/validation';
import type { ApprovalPayload, ApprovalView } from '@da/validation';

type EmailSendPayload = Extract<ApprovalPayload, { action_type: 'email_send' }>;
import type { MiddlewareHandler } from 'hono';
import { currentUser } from '../../_shared/auth/user.ts';
import type { UserAuth } from '../../_shared/http/context.ts';
import { AppError } from '../../_shared/errors.ts';
import type { AppContext, AppEnv } from '../../_shared/http/context.ts';
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
import { sniffMime, validateUpload } from '../../_shared/security/upload-validate.ts';
import {
  contentKey,
  detectLanguage,
  interactiveAiError,
  sourceRef,
} from '../../_shared/services/assist/common.ts';
import type { ReplyAttachment, ReplyDraftRow, Tone } from '../../_shared/services/assist/store.ts';
import { visibleText } from '../../_shared/services/ai/hygiene.ts';
import { proposeApproval } from '../../_shared/services/approvals/propose.ts';
import { toApprovalView } from '../../_shared/services/approvals/view.ts';
import { isOn } from '../../_shared/services/flags.ts';
import type {
  AccountRow,
  MailMessageRow,
  MailThreadRow,
} from '../../_shared/services/intel/types.ts';
import {
  expectedTones,
  generateFollowUp,
  generateReplyDrafts,
  REPLY_CONTEXT_MESSAGES,
} from '../../_shared/services/replies/generate.ts';
import {
  recipientFirstName,
  recipientsChanged,
  replyHeaders,
  threadParticipants,
} from '../../_shared/services/replies/recipients.ts';
import { SIGNED_UPLOAD_TTL_S } from '../../_shared/services/storage.ts';
import type { RequestRepos, RouteKit, RouteRegistrar } from '../deps.ts';
import { serviceDeps } from './approvals.ts';
import { assistOf, replyDraftView, requireQuota } from './assist-api.ts';

const REUSE_WINDOW_MS = 10 * 60_000;
const DRAFT_TTL_MS = 7 * 86_400_000;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_TOTAL = 3 * 1024 * 1024;
const WRITABLE_STATUSES = new Set(['healthy', 'syncing', 'partial']);
const OFFICE_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

interface ThreadContext {
  readonly message: MailMessageRow;
  readonly thread: MailThreadRow;
  readonly account: AccountRow;
  readonly messages: MailMessageRow[];
}

async function loadThreadContext(
  kit: RouteKit,
  userId: string,
  messageId: string,
): Promise<ThreadContext> {
  const { intel } = assistOf(kit);
  const [message] = await intel.mail.messages([messageId]);
  if (message === undefined || message.user_id !== userId) {
    throw new AppError('NOT_FOUND', { details: { resource: 'email_message' } });
  }
  const [thread] = await intel.mail.threads([message.thread_id]);
  const account = await intel.mail.account(message.connected_account_id);
  if (thread === undefined || account === null || account.user_id !== userId) {
    throw new AppError('NOT_FOUND', { details: { resource: 'email_message' } });
  }
  const messages = await intel.mail.threadMessages(thread.id, 5);
  return { message, thread, account, messages };
}

/** `mail_read`, `draft_replies` and `ai_data_access.mail_body` gate every draft (API-MAIL-02). */
function assertDraftSources(account: AccountRow, mailBody: boolean): void {
  if (account.data_source_toggles.mail_read === false) {
    throw new AppError('DATA_SOURCE_DISABLED', { details: { toggle: 'mail_read' } });
  }
  if (account.data_source_toggles.draft_replies === false) {
    throw new AppError('DATA_SOURCE_DISABLED', { details: { toggle: 'draft_replies' } });
  }
  if (!mailBody) {
    throw new AppError('DATA_SOURCE_DISABLED', { details: { toggle: 'ai_data_access.mail_body' } });
  }
}

/** Transient bodies of the newest messages plus their real attachment names (never stored). */
async function threadBodies(
  kit: RouteKit,
  userId: string,
  messages: readonly MailMessageRow[],
  correlationId: string,
): Promise<{ bodies: Map<string, string>; attachmentNames: string[] }> {
  const { intel } = assistOf(kit);
  const bodies = new Map<string, string>();
  const names = new Set<string>();
  if (intel.bodies === null) return { bodies, attachmentNames: [] };
  const recent = [...messages]
    .sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at))
    .slice(-REPLY_CONTEXT_MESSAGES);
  for (const m of recent) {
    try {
      const body = await intel.bodies.fetch({
        userId,
        accountId: m.connected_account_id,
        provider: m.provider,
        providerMessageId: m.provider_message_id,
        maxBytes: 200_000,
        correlationId,
      });
      if (body === null) continue;
      bodies.set(m.id, visibleText({ text: body.text, html: body.html }, 1_200));
      for (const a of body.attachments) if (!a.inline) names.add(a.filename);
    } catch {
      // A failed transient fetch degrades to the stored snippet.
    }
  }
  return { bodies, attachmentNames: [...names].slice(0, 20) };
}

function aiUser(kit: RouteKit, userId: string) {
  return assistOf(kit).intel.ai.users.load(userId);
}

function pipelineOf(
  kit: RouteKit,
  user: Awaited<ReturnType<typeof aiUser>>,
  correlationId: string,
) {
  const { intel } = assistOf(kit);
  return {
    runtime: intel.ai.runtime,
    user,
    correlationId,
    canary: intel.ai.canary,
  };
}

function factsUsed(messages: readonly MailMessageRow[]) {
  return [...messages]
    .sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at))
    .slice(0, REPLY_CONTEXT_MESSAGES)
    .map((m) =>
      sourceRef({
        source_type: 'email_message',
        source_id: m.id,
        source_provider: m.provider,
        source_timestamp: m.received_at,
      }),
    );
}

export interface DraftRequest {
  readonly messageId: string;
  readonly tone: Tone;
  readonly language?: 'tr' | 'en' | undefined;
  readonly instructions?: string | undefined;
  readonly correlationId: string;
}

/** API-MAIL-02 core (also used by API-PLAN-04 and the assistant's `draft_reply`). */
export async function createReplyDraft(
  kit: RouteKit,
  auth: UserAuth,
  input: DraftRequest,
): Promise<{ row: ReplyDraftRow; webLink: string | null; reused: boolean }> {
  const { assist } = assistOf(kit);
  const user = await aiUser(kit, auth.userId);
  if (!isOn(user.flags, 'ai.feature.reply_draft')) {
    throw new AppError('FEATURE_DISABLED', { details: { feature: 'reply_draft' } });
  }
  const ctx = await loadThreadContext(kit, auth.userId, input.messageId);
  assertDraftSources(ctx.account, user.dataAccess.mailBody);
  const last =
    [...ctx.messages].sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at))[0] ??
    ctx.message;
  const language =
    input.language ?? detectLanguage(`${last.subject ?? ''} ${last.snippet ?? ''}`, user.locale);
  const key = await contentKey([
    ctx.message.id,
    input.tone,
    language,
    input.instructions ?? '',
    last.id,
  ]);
  const now = kit.now();
  const reused = await assist.store.reusableDraft(
    auth.userId,
    key,
    new Date(now.getTime() - REUSE_WINDOW_MS),
  );
  const webLink = await assist.store.messageWebLink(auth.userId, ctx.message.id);
  if (reused !== null) return { row: reused, webLink, reused: true };

  await requireQuota(kit, auth, 'reply_drafts_daily');
  const { bodies, attachmentNames } = await threadBodies(
    kit,
    auth.userId,
    ctx.messages,
    input.correlationId,
  );
  const expect = expectedTones(user.profile, input.tone);
  const outcome = await generateReplyDrafts(pipelineOf(kit, user, input.correlationId), {
    threadId: ctx.thread.id,
    lastMessageId: last.id,
    messages: ctx.messages,
    bodies,
    expect,
    recipientName: recipientFirstName(ctx.message.direction === 'inbound' ? ctx.message : last),
    language,
    instructions: input.instructions ?? null,
    attachmentNames,
    now,
  });
  if (outcome.kind !== 'ai') throw interactiveAiError(outcome.reason);
  const body = outcome.data.drafts.find((d) => d.tone === input.tone)?.body_tr;
  if (body === undefined) throw new AppError('AI_OUTPUT_INVALID');
  const own = await assistOf(kit).intel.mail.ownAddresses(auth.userId);
  const headers = replyHeaders(ctx.message, [...own, ctx.account.account_email]);
  if (headers.to.length === 0)
    throw new AppError('STATE_CONFLICT', { details: { reason: 'no_recipient' } });
  const row = await assist.store.insertReplyDraft({
    user_id: auth.userId,
    thread_id: ctx.thread.id,
    message_id: ctx.message.id,
    connected_account_id: ctx.account.id,
    kind: 'reply',
    tone: input.tone,
    to_emails: headers.to,
    cc_emails: headers.cc,
    subject: headers.subject,
    body,
    generated_by: 'ai',
    ai_request_id: outcome.aiRequestId,
    prompt_version_id: outcome.promptVersionId,
    attachments: [],
    source_type: 'email_thread',
    source_id: ctx.thread.id,
    source_provider: ctx.thread.provider,
    source_timestamp: last.received_at,
    confidence: outcome.injectionSuspected ? 0.5 : 0.8,
    language,
    warnings: [
      ...(outcome.data.commitments_in_draft.length > 0 ? ['contains_commitment'] : []),
      ...(outcome.injectionSuspected ? ['low_confidence_context'] : []),
    ],
    facts_used: factsUsed(ctx.messages),
    content_key: key,
    expires_at: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(),
  });
  return { row, webLink, reused: false };
}

export interface FollowUpDraftRequest {
  readonly threadId: string;
  readonly tone: Tone;
  readonly language?: 'tr' | 'en' | undefined;
  readonly instructions?: string | undefined;
  readonly correlationId: string;
}

/** API-MAIL-06 core: a follow-up on the user's last sent message of a thread awaiting a reply. */
export async function createFollowUpDraft(
  kit: RouteKit,
  auth: UserAuth,
  input: FollowUpDraftRequest,
): Promise<{ row: ReplyDraftRow; webLink: string | null; reused: boolean }> {
  const { assist, intel } = assistOf(kit);
  const user = await aiUser(kit, auth.userId);
  if (!isOn(user.flags, 'ai.feature.follow_up_draft')) {
    throw new AppError('FEATURE_DISABLED', { details: { feature: 'follow_up_draft' } });
  }
  const [thread] = await intel.mail.threads([input.threadId]);
  if (thread === undefined || thread.user_id !== auth.userId) {
    throw new AppError('NOT_FOUND', { details: { resource: 'email_thread' } });
  }
  const messages = await intel.mail.threadMessages(thread.id, 5);
  const last = [...messages].sort(
    (a, b) => Date.parse(b.received_at) - Date.parse(a.received_at),
  )[0];
  if (
    last === undefined ||
    last.direction !== 'outbound' ||
    thread.reply_state !== 'awaiting_their_reply'
  ) {
    throw new AppError('STATE_CONFLICT', { details: { reason: 'not_awaiting_reply' } });
  }
  const account = await intel.mail.account(thread.connected_account_id);
  if (account === null) throw new AppError('NOT_FOUND', { details: { resource: 'email_thread' } });
  assertDraftSources(account, user.dataAccess.mailBody);
  const language =
    input.language ?? detectLanguage(`${last.subject ?? ''} ${last.snippet ?? ''}`, user.locale);
  const key = await contentKey([
    'follow_up',
    last.id,
    input.tone,
    language,
    input.instructions ?? '',
  ]);
  const now = kit.now();
  const webLink = await assist.store.messageWebLink(auth.userId, last.id);
  const reused = await assist.store.reusableDraft(
    auth.userId,
    key,
    new Date(now.getTime() - REUSE_WINDOW_MS),
  );
  if (reused !== null) return { row: reused, webLink, reused: true };
  await requireQuota(kit, auth, 'reply_drafts_daily');
  const { bodies } = await threadBodies(kit, auth.userId, [last], input.correlationId);
  const since = Date.parse(thread.awaiting_since ?? last.received_at);
  const outcome = await generateFollowUp(pipelineOf(kit, user, input.correlationId), {
    threadId: thread.id,
    sent: last,
    body: bodies.get(last.id) ?? null,
    recipientName:
      thread.participants
        .find((p) => last.to_emails.includes(p.email.toLowerCase()))
        ?.name?.split(/\s+/)[0] ?? null,
    daysWaiting: Math.max(0, Math.floor((now.getTime() - since) / 86_400_000)),
    tone: input.tone,
    language,
    instructions: input.instructions ?? null,
    now,
  });
  if (outcome.kind !== 'ai') throw interactiveAiError(outcome.reason);
  const own = await intel.mail.ownAddresses(auth.userId);
  const headers = replyHeaders(last, [...own, account.account_email]);
  if (headers.to.length === 0)
    throw new AppError('STATE_CONFLICT', { details: { reason: 'no_recipient' } });
  const row = await assist.store.insertReplyDraft({
    user_id: auth.userId,
    thread_id: thread.id,
    message_id: last.id,
    connected_account_id: account.id,
    kind: 'follow_up',
    tone: input.tone,
    to_emails: headers.to,
    cc_emails: headers.cc,
    subject: headers.subject,
    body: outcome.data.body_tr,
    generated_by: 'ai',
    ai_request_id: outcome.aiRequestId,
    prompt_version_id: outcome.promptVersionId,
    attachments: [],
    source_type: 'email_thread',
    source_id: thread.id,
    source_provider: thread.provider,
    source_timestamp: last.received_at,
    confidence: outcome.injectionSuspected ? 0.5 : 0.8,
    language,
    warnings: outcome.injectionSuspected ? ['low_confidence_context'] : [],
    facts_used: factsUsed([last]),
    content_key: key,
    expires_at: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(),
  });
  return { row, webLink, reused: false };
}

async function ownedDraft(kit: RouteKit, userId: string, id: string): Promise<ReplyDraftRow> {
  const draft = await assistOf(kit).assist.store.replyDraft(userId, id);
  if (draft === null) throw new AppError('NOT_FOUND', { details: { resource: 'reply_draft' } });
  return draft;
}

function assertEditable(draft: ReplyDraftRow, expectedVersion: number | null): void {
  if (draft.status !== 'draft') {
    throw new AppError('APPROVAL_STATE_CONFLICT', {
      details: { reason: 'draft_not_editable', status: draft.status },
    });
  }
  if (expectedVersion !== null && draft.version !== expectedVersion) {
    throw new AppError('STATE_CONFLICT', {
      details: { reason: 'version_mismatch', current_version: draft.version },
    });
  }
}

function versionConflict(): AppError {
  return new AppError('STATE_CONFLICT', { details: { reason: 'version_mismatch' } });
}

/** API-MAIL-03: another tone or new instructions; `version+1`, previous text not retained. */
async function regenerate(
  kit: RouteKit,
  auth: UserAuth,
  id: string,
  body: { tone?: Tone | undefined; instructions?: string | undefined; expected_version: number },
  correlationId: string,
): Promise<ReplyDraftRow> {
  const { assist } = assistOf(kit);
  const draft = await ownedDraft(kit, auth.userId, id);
  assertEditable(draft, body.expected_version);
  const user = await aiUser(kit, auth.userId);
  const feature = draft.kind === 'follow_up' ? 'follow_up_draft' : 'reply_draft';
  if (!isOn(user.flags, `ai.feature.${feature}`)) {
    throw new AppError('FEATURE_DISABLED', { details: { feature } });
  }
  const messageId = draft.message_id;
  if (messageId === null)
    throw new AppError('SOURCE_GONE', { details: { resource: 'email_message' } });
  const ctx = await loadThreadContext(kit, auth.userId, messageId);
  assertDraftSources(ctx.account, user.dataAccess.mailBody);
  const tone = body.tone ?? draft.tone;
  const instructions = body.instructions ?? null;
  const language = draft.language ?? 'tr';
  const now = kit.now();
  await requireQuota(kit, auth, 'reply_drafts_daily');
  const { bodies, attachmentNames } = await threadBodies(
    kit,
    auth.userId,
    ctx.messages,
    correlationId,
  );
  const last =
    [...ctx.messages].sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at))[0] ??
    ctx.message;
  let text: string;
  let meta: { aiRequestId: string | null; promptVersionId: string; commitments: boolean };
  if (draft.kind === 'follow_up') {
    const out = await generateFollowUp(pipelineOf(kit, user, correlationId), {
      threadId: ctx.thread.id,
      sent: ctx.message,
      body: bodies.get(ctx.message.id) ?? null,
      recipientName: null,
      daysWaiting: 0,
      tone,
      language,
      instructions,
      now,
    });
    if (out.kind !== 'ai') throw interactiveAiError(out.reason);
    text = out.data.body_tr;
    meta = {
      aiRequestId: out.aiRequestId,
      promptVersionId: out.promptVersionId,
      commitments: false,
    };
  } else {
    // Without new instructions the balanced all-tone result is served from the result cache.
    const expect = instructions === null ? expectedTones(user.profile, tone) : tone;
    const out = await generateReplyDrafts(pipelineOf(kit, user, correlationId), {
      threadId: ctx.thread.id,
      lastMessageId: last.id,
      messages: ctx.messages,
      bodies,
      expect,
      recipientName: recipientFirstName(ctx.message.direction === 'inbound' ? ctx.message : last),
      language,
      instructions,
      attachmentNames,
      now,
    });
    if (out.kind !== 'ai') throw interactiveAiError(out.reason);
    const found = out.data.drafts.find((d) => d.tone === tone)?.body_tr;
    if (found === undefined) throw new AppError('AI_OUTPUT_INVALID');
    text = found;
    meta = {
      aiRequestId: out.aiRequestId,
      promptVersionId: out.promptVersionId,
      commitments: out.data.commitments_in_draft.length > 0,
    };
  }
  const warnings = (draft.warnings ?? []).filter((w) => w !== 'contains_commitment');
  const updated = await assist.store.updateReplyDraft(auth.userId, draft.id, draft.version, {
    tone,
    body: text,
    generated_by: 'ai',
    ai_request_id: meta.aiRequestId,
    prompt_version_id: meta.promptVersionId,
    warnings: meta.commitments ? [...warnings, 'contains_commitment'] : warnings,
  });
  if (updated === null) throw versionConflict();
  return updated;
}

/** API-MAIL-04: user edit; a recipient outside the thread adds `recipients_changed`. */
async function patchDraft(
  kit: RouteKit,
  auth: UserAuth,
  id: string,
  body: {
    body_text?: string | undefined;
    subject?: string | undefined;
    to?: { email: string }[] | undefined;
    cc?: { email: string }[] | undefined;
    status?: 'discarded' | undefined;
    expected_version: number;
  },
): Promise<ReplyDraftRow> {
  const { assist, intel } = assistOf(kit);
  const draft = await ownedDraft(kit, auth.userId, id);
  if (body.status === 'discarded') {
    // "Taslağı sil" (M-REPLY-01 / M-REPLY-05): only a `draft` can be discarded; a submitted, sent,
    // failed or already discarded draft → 409. Stored attachments go with the retention job.
    if (draft.status !== 'draft') {
      throw new AppError('STATE_CONFLICT', {
        details: { reason: 'draft_not_discardable', status: draft.status },
      });
    }
    assertEditable(draft, body.expected_version);
    const discarded = await assist.store.updateReplyDraft(auth.userId, draft.id, draft.version, {
      status: 'discarded',
    });
    if (discarded === null) throw versionConflict();
    return discarded;
  }
  assertEditable(draft, body.expected_version);
  const to = body.to?.map((r) => r.email.toLowerCase()) ?? [...draft.to_emails];
  const cc = body.cc?.map((r) => r.email.toLowerCase()) ?? [...draft.cc_emails];
  let warnings = [...(draft.warnings ?? [])];
  if (body.to !== undefined || body.cc !== undefined) {
    const [thread] = await intel.mail.threads([draft.thread_id]);
    const messages = await intel.mail.threadMessages(draft.thread_id, 50);
    const changed = recipientsChanged([...to, ...cc], threadParticipants(thread ?? null, messages));
    warnings = warnings.filter((w) => w !== 'recipients_changed');
    if (changed) warnings.push('recipients_changed');
  }
  const updated = await assist.store.updateReplyDraft(auth.userId, draft.id, draft.version, {
    ...(body.body_text === undefined ? {} : { body: body.body_text }),
    ...(body.subject === undefined ? {} : { subject: body.subject }),
    to_emails: to,
    cc_emails: cc,
    warnings,
    generated_by: 'user_edit',
  });
  if (updated === null) throw versionConflict();
  return updated;
}

/** Magic bytes of each stored attachment still match its declared type (API-MAIL-05). */
async function verifyAttachments(
  kit: RouteKit,
  attachments: readonly ReplyAttachment[],
): Promise<void> {
  const { assist } = assistOf(kit);
  for (const a of attachments) {
    const bytes = await assist.storage.download('captures', a.storage_path, MAX_ATTACHMENT_TOTAL);
    if (bytes === null) {
      throw new AppError('UPLOAD_INVALID', { details: { reason: 'missing', name: a.name } });
    }
    const head = bytes.subarray(0, 64);
    const ok = OFFICE_MIME.has(a.mime)
      ? sniffMime(head) === 'application/zip'
      : validateUpload({
          declaredMime: a.mime,
          fileName: a.name,
          sizeBytes: bytes.byteLength,
          head,
        }).ok;
    if (!ok)
      throw new AppError('UPLOAD_INVALID', { details: { reason: 'magic_mismatch', name: a.name } });
  }
}

/** API-MAIL-05: the draft becomes a pending `email_send` approval with its exact change. */
export async function submitDraft(
  kit: RouteKit,
  c: AppContext,
  repos: RequestRepos,
  auth: UserAuth,
  input: { draftId: string; expectedVersion: number | null; origin?: 'assistant' },
): Promise<{ draft: ReplyDraftRow; approval: ApprovalView }> {
  const { assist, intel } = assistOf(kit);
  const draft = await ownedDraft(kit, auth.userId, input.draftId);
  const deps = serviceDeps(c, kit, repos);
  if (draft.status === 'submitted' && draft.approval_action_id !== null) {
    const existing = await repos.approvals.get(auth.userId, draft.approval_action_id);
    if (existing !== null) {
      return { draft, approval: toApprovalView(existing, { locale: deps.locale }) };
    }
  }
  assertEditable(draft, input.expectedVersion);
  const account = await intel.mail.account(draft.connected_account_id);
  if (account === null) throw new AppError('NOT_FOUND', { details: { resource: 'account' } });
  if (!WRITABLE_STATUSES.has(account.status)) {
    throw new AppError('PROVIDER_REAUTH_REQUIRED', {
      details: { account_id: account.id, provider: account.provider },
    });
  }
  if (draft.message_id === null)
    throw new AppError('SOURCE_GONE', { details: { resource: 'email_message' } });
  // Output validators again: AI text must not carry facts the thread lacks; a user edit may
  // add its own links, but a leftover bracketed fill-in is refused.
  const messages = await intel.mail.threadMessages(draft.thread_id, 10);
  const threadText = messages
    .map((m) => `${m.subject ?? ''}\n${m.snippet ?? ''}\n${m.ai_summary ?? ''}`)
    .join('\n');
  const violations = draftViolations(draft.body, threadText).filter(
    (v) => draft.generated_by === 'ai' || v === 'bracketed_fill_in',
  );
  if (violations.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      details: { reason: 'draft_output_invalid', violations },
      fieldErrors: [
        { path: 'body_text', code: 'draft_output_invalid', message_key: 'validation.custom' },
      ],
    });
  }
  await verifyAttachments(kit, draft.attachments);
  const provider: EmailSendPayload['provider'] =
    account.provider === 'microsoft' ? 'microsoft' : 'google';
  const payload: EmailSendPayload = {
    action_type: 'email_send',
    connected_account_id: account.id,
    provider,
    mode: draft.kind,
    reply_draft_id: draft.id,
    thread: { email_thread_id: draft.thread_id, reply_to_message_id: draft.message_id },
    to: draft.to_emails.map((email) => ({ email })),
    cc: draft.cc_emails.map((email) => ({ email })),
    subject: (draft.subject ?? 'Re:').slice(0, 998),
    body_text: draft.body,
    language: draft.language ?? 'tr',
    attachments: draft.attachments.map((a) => ({
      storage_path: a.storage_path,
      name: a.name,
      mime: a.mime,
      size_bytes: a.size_bytes,
    })),
  };
  const out = await proposeApproval(deps, {
    userId: auth.userId,
    payload,
    origin: input.origin ?? (draft.kind === 'follow_up' ? 'follow_up' : 'reply_draft'),
    originRefId: draft.id,
    source: {
      source_type: 'email_thread',
      source_id: draft.thread_id,
      source_provider: draft.source_provider ?? 'in_app',
      source_timestamp: draft.source_timestamp,
    },
    actor: 'user',
    allowEmailSend: true,
  });
  const updated = await assist.store.updateReplyDraft(auth.userId, draft.id, draft.version, {
    status: 'submitted',
    approval_action_id: out.approval.id,
  });
  return { draft: updated ?? draft, approval: out.view };
}

/** Pre-validation size check: an oversized file is `PAYLOAD_TOO_LARGE` (413), not a 422. */
function maxDeclaredSize(limit: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const raw = rawBody(c) as { size_bytes?: unknown } | undefined;
    if (typeof raw?.size_bytes === 'number' && raw.size_bytes > limit) {
      throw new AppError('PAYLOAD_TOO_LARGE', { details: { limit_bytes: limit } });
    }
    await next();
  };
}

function safeFileName(name: string): string {
  const cleaned = [...name]
    .map((ch) => (ch === '/' || ch === '\\' || ch.charCodeAt(0) < 32 ? '_' : ch))
    .join('')
    .trim();
  return (cleaned === '' ? 'file' : cleaned).slice(0, 80);
}

export const registerMailRoutes: RouteRegistrar = (app, kit) => {
  const idem = { repo: kit.deps.idempotency, now: () => kit.now().getTime() };
  const view = async (userId: string, id: string) => {
    const row = await ownedDraft(kit, userId, id);
    const link =
      row.message_id === null
        ? null
        : await assistOf(kit).assist.store.messageWebLink(userId, row.message_id);
    return replyDraftView(row, link);
  };

  const create = routes['POST /mail/:messageId/reply-drafts'];
  mountRoute(
    app,
    create,
    ...kit.chain({ gate: true, rateLimit: 'reply_draft' }),
    parseJsonBody(create),
    validateRequest(create),
    (c) => {
      const auth = currentUser(c);
      const params = validParams(c, create.request.params);
      const body = validBody(c, ReplyDraftCreateBody);
      return withIdempotency(c, idem, {
        status: 201,
        async execute() {
          const out = await createReplyDraft(kit, auth, {
            messageId: params.messageId,
            tone: body.tone,
            language: body.language,
            instructions: body.instructions,
            correlationId: c.get('correlationId'),
          });
          return {
            data: replyDraftView(out.row, out.webLink),
            ref: { type: 'reply_draft', id: out.row.id },
          };
        },
        replay: (ref) => view(auth.userId, ref.id ?? ''),
      });
    },
  );

  const regen = routes['POST /reply-drafts/:id/regenerate'];
  mountRoute(
    app,
    regen,
    ...kit.chain({ gate: true, rateLimit: 'reply_draft' }),
    parseJsonBody(regen),
    validateRequest(regen),
    (c) => {
      const auth = currentUser(c);
      const params = validParams(c, regen.request.params);
      const body = validBody(c, ReplyDraftRegenerateBody);
      return withIdempotency(c, idem, {
        status: 200,
        async execute() {
          const row = await regenerate(kit, auth, params.id, body, c.get('correlationId'));
          return {
            data: await view(auth.userId, row.id),
            ref: { type: 'reply_draft', id: row.id },
          };
        },
        replay: (ref) => view(auth.userId, ref.id ?? ''),
      });
    },
  );

  const patch = routes['PATCH /reply-drafts/:id'];
  mountRoute(
    app,
    patch,
    ...kit.chain({ gate: true, rateLimit: 'api_default' }),
    parseJsonBody(patch),
    validateRequest(patch),
    (c) => {
      const auth = currentUser(c);
      const params = validParams(c, patch.request.params);
      const body = validBody(c, ReplyDraftPatchBody);
      return withIdempotency(c, idem, {
        status: 200,
        async execute() {
          const row = await patchDraft(kit, auth, params.id, body);
          return {
            data: await view(auth.userId, row.id),
            ref: { type: 'reply_draft', id: row.id },
          };
        },
        replay: (ref) => view(auth.userId, ref.id ?? ''),
      });
    },
  );

  const submit = routes['POST /reply-drafts/:id/submit'];
  mountRoute(
    app,
    submit,
    ...kit.chain({ gate: true, rateLimit: 'approvals_mutate' }),
    parseJsonBody(submit),
    validateRequest(submit),
    (c) => {
      const auth = currentUser(c);
      const params = validParams(c, submit.request.params);
      const body = validBody(c, ReplyDraftSubmitBody);
      const repos = kit.deps.repos(auth);
      return withIdempotency(c, idem, {
        status: 201,
        async execute() {
          const out = await submitDraft(kit, c, repos, auth, {
            draftId: params.id,
            expectedVersion: body.expected_version,
          });
          return {
            data: { draft: await view(auth.userId, out.draft.id), approval: out.approval },
            ref: { type: 'reply_draft', id: out.draft.id },
          };
        },
        replay: async (ref) => {
          const out = await submitDraft(kit, c, repos, auth, {
            draftId: ref.id ?? '',
            expectedVersion: null,
          });
          return { draft: await view(auth.userId, out.draft.id), approval: out.approval };
        },
      });
    },
  );

  const upload = routes['POST /reply-drafts/:id/attachments/upload-url'];
  mountRoute(
    app,
    upload,
    ...kit.chain({ gate: true, rateLimit: 'reply_attachment' }),
    parseJsonBody(upload),
    maxDeclaredSize(MAX_ATTACHMENT_TOTAL),
    validateRequest(upload),
    async (c) => {
      const auth = currentUser(c);
      const params = validParams(c, upload.request.params);
      const body = validBody(c, ReplyAttachmentUploadBody);
      const { assist } = assistOf(kit);
      const draft = await ownedDraft(kit, auth.userId, params.id);
      assertEditable(draft, null);
      const path = `${auth.userId}/replies/${draft.id}/${body.client_attachment_id}-${safeFileName(body.file_name)}`;
      const existing = draft.attachments.find(
        (a) => a.client_attachment_id === body.client_attachment_id,
      );
      let row = draft;
      if (existing === undefined) {
        if (draft.attachments.length >= MAX_ATTACHMENTS) {
          throw new AppError('STATE_CONFLICT', {
            details: { reason: 'too_many_attachments', limit: MAX_ATTACHMENTS },
          });
        }
        const total = draft.attachments.reduce((s, a) => s + a.size_bytes, 0) + body.size_bytes;
        if (total > MAX_ATTACHMENT_TOTAL) {
          throw new AppError('PAYLOAD_TOO_LARGE', {
            details: { limit_bytes: MAX_ATTACHMENT_TOTAL },
          });
        }
        const updated = await assist.store.updateReplyDraft(auth.userId, draft.id, draft.version, {
          attachments: [
            ...draft.attachments,
            {
              storage_path: path,
              name: body.file_name,
              mime: body.mime,
              size_bytes: body.size_bytes,
              client_attachment_id: body.client_attachment_id,
            },
          ],
        });
        if (updated === null) throw versionConflict();
        row = updated;
      }
      const signed = await assist.storage.signedUploadUrl(
        'captures',
        existing?.storage_path ?? path,
      );
      const link =
        row.message_id === null
          ? null
          : await assist.store.messageWebLink(auth.userId, row.message_id);
      return sendData(
        c,
        {
          upload: {
            signed_url: signed.signedUrl,
            token: signed.token,
            path: signed.path,
            expires_at: new Date(kit.now().getTime() + SIGNED_UPLOAD_TTL_S * 1000).toISOString(),
          },
          draft: replyDraftView(row, link),
        },
        201,
      );
    },
  );
};
