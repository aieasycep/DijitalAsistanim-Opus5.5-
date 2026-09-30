/**
 * Reply draft reads for M-REPLY-01: an existing draft (`draftId`, "Taslağa Devam Et") and the
 * pending `email_send` approval being edited (`approvalId`, Approval Center / sheet "Düzenle").
 * Rows are mapped to the `ReplyDraft` API shape so the screen handles generated and stored drafts
 * the same way.
 */
import type { ReplyDraft } from '@da/validation/api/common';
import { z } from 'zod';

import { getSupabase } from '../../lib/auth/supabase';
import { unwrap } from '../../lib/data/rpc';

const Attachment = z.looseObject({
  storage_path: z.string(),
  name: z.string(),
  mime: z.string(),
  size_bytes: z.number(),
});

function recipients(emails: readonly string[]): { email: string }[] {
  return emails.map((email) => ({ email }));
}

export async function fetchDraft(id: string): Promise<ReplyDraft> {
  const row = unwrap(
    await getSupabase()
      .from('reply_drafts')
      .select(
        'id,kind,message_id,thread_id,connected_account_id,tone,status,body,to_emails,cc_emails,subject,version,attachments,approval_action_id,language,warnings,created_at,updated_at',
      )
      .eq('id', id)
      .single(),
  );
  const attachments = z.array(Attachment).safeParse(row.attachments);
  return {
    id: row.id,
    kind: row.kind === 'follow_up' ? 'follow_up' : 'reply',
    email_message_id: row.message_id ?? '',
    email_thread_id: row.thread_id,
    connected_account_id: row.connected_account_id,
    tone:
      row.tone === 'short' || row.tone === 'friendly' || row.tone === 'detailed'
        ? row.tone
        : 'professional',
    subject: row.subject ?? '',
    to: recipients(row.to_emails),
    cc: recipients(row.cc_emails),
    body_text: row.body,
    language: row.language === 'en' ? 'en' : 'tr',
    version: row.version,
    status:
      row.status === 'submitted' ||
      row.status === 'sent' ||
      row.status === 'discarded' ||
      row.status === 'failed'
        ? row.status
        : 'draft',
    attachments: attachments.success ? attachments.data : [],
    grounding: { facts_used: [] },
    warnings: [],
    approval_id: row.approval_action_id,
    web_link: null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface EditedApproval {
  readonly id: string;
  readonly status: string;
  readonly payloadVersion: number;
  readonly idempotencyKey: string;
  readonly draftId: string | null;
}

export async function fetchApprovalForEdit(id: string): Promise<EditedApproval> {
  const row = unwrap(
    await getSupabase()
      .from('approval_actions')
      .select('id,status,payload,payload_version,idempotency_key,action_type')
      .eq('id', id)
      .single(),
  );
  const payload = z.looseObject({ reply_draft_id: z.string().optional() }).safeParse(row.payload);
  return {
    id: row.id,
    status: row.status,
    payloadVersion: row.payload_version,
    idempotencyKey: row.idempotency_key,
    draftId: payload.success ? (payload.data.reply_draft_id ?? null) : null,
  };
}
