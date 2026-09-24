/**
 * Dependencies and shared helpers of the AI pipeline part-2 routes (IMPLEMENTATION_PLAN
 * T-5.09…T-5.15): reply drafts, follow-ups, meetings, the assistant and voice, captures, planning,
 * First Analysis and briefing audio. They reuse the part-1 `intel` services (AI runtime, stores,
 * the transient body source) and add the part-2 store, private Storage and the SSRF fetcher's
 * transport. System reads and writes are always filtered by the verified user id.
 */
import type { ReplyDraft } from '@da/validation';
import type { UserAuth } from '../../_shared/http/context.ts';
import type { DbClient } from '../../_shared/db/clients.ts';
import { AppError } from '../../_shared/errors.ts';
import type { DnsResolver } from '../../_shared/security/ssrf-fetch.ts';
import type { AssistStore, ReplyDraftRow } from '../../_shared/services/assist/store.ts';
import { supabaseAssistStore } from '../../_shared/services/assist/supabase-store.ts';
import { checkPlanLimit, type PlanLimitState } from '../../_shared/services/entitlements/gate.ts';
import type { InsightStore } from '../../_shared/services/intel/store.ts';
import { supabaseInsightStore } from '../../_shared/services/intel/supabase-store.ts';
import { type ObjectStorage, supabaseStorage } from '../../_shared/services/storage.ts';
import type { RouteKit } from '../deps.ts';
import type { IntelApi } from './intel-api.ts';
import type { PlanDailyQuotaKey } from '@da/domain';

export interface AssistApi {
  readonly store: AssistStore;
  readonly storage: ObjectStorage;
  readonly insights: InsightStore;
  /** Transport of the SSRF-safe fetcher (link previews); tests stub it. */
  readonly fetch?: typeof fetch;
  readonly resolver?: DnsResolver;
}

export function supabaseAssistApi(system: DbClient): AssistApi {
  return {
    store: supabaseAssistStore(system),
    storage: supabaseStorage(system),
    insights: supabaseInsightStore(system),
  };
}

export function assistOf(kit: RouteKit): { assist: AssistApi; intel: IntelApi } {
  const assist = kit.deps.assist;
  const intel = kit.deps.intel;
  if (assist === undefined || intel === undefined) {
    throw new AppError('SERVICE_UNAVAILABLE', { details: { reason: 'assist_not_configured' } });
  }
  return { assist, intel };
}

/** Daily quota pre-check (`QUOTA_EXCEEDED` with `resets_at` when used up). */
export function requireQuota(
  kit: RouteKit,
  auth: UserAuth,
  key: PlanDailyQuotaKey,
  increment = 1,
): Promise<PlanLimitState> {
  return checkPlanLimit(kit.deps.business.gate(auth), auth.userId, key, {
    increment,
    now: kit.now(),
  });
}

/** The `ReplyDraft` view (API_CONTRACTS §3). */
export function replyDraftView(row: ReplyDraftRow, webLink: string | null): ReplyDraft {
  const facts = (row.facts_used ?? []) as ReplyDraft['grounding']['facts_used'];
  return {
    id: row.id,
    kind: row.kind,
    email_message_id: row.message_id ?? row.thread_id,
    email_thread_id: row.thread_id,
    connected_account_id: row.connected_account_id,
    tone: row.tone,
    subject: row.subject ?? '',
    to: row.to_emails.map((email) => ({ email })),
    cc: row.cc_emails.map((email) => ({ email })),
    body_text: row.body,
    language: row.language ?? 'tr',
    version: row.version,
    status: row.status,
    attachments: row.attachments.map((a) => ({
      storage_path: a.storage_path,
      name: a.name,
      mime: a.mime,
      size_bytes: a.size_bytes,
    })),
    grounding: { facts_used: facts.slice(0, 10) },
    warnings: (row.warnings ?? []).filter(
      (w): w is ReplyDraft['warnings'][number] =>
        w === 'contains_commitment' || w === 'recipients_changed' || w === 'low_confidence_context',
    ),
    approval_id: row.approval_action_id,
    web_link: webLink,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}
