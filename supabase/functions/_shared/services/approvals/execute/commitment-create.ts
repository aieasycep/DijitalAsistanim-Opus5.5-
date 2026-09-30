/**
 * `commitment_create` execution (IMPLEMENTATION_PLAN T-6.04; M§18): a `commitments` row with the
 * approved text, direction, counterparty and due date, its provenance and the verified evidence
 * quote, dedupe key `approval:{id}` (a retry returns the existing row).
 */
import type { Json } from '../../../jobs/types.ts';
import type { ApprovalOriginValue } from '../model.ts';
import { insightRefresh } from './common.ts';
import { type ExecEnv, ExecutionFailure, type ExecOutcome } from './model.ts';

const COMMITMENT_ORIGIN: Readonly<Partial<Record<ApprovalOriginValue, string>>> = {
  email_detail: 'email_analysis',
  commitment_detection: 'email_analysis',
  follow_up: 'email_analysis',
  post_meeting: 'post_meeting',
  capture: 'capture',
  assistant: 'assistant',
  voice: 'assistant',
};

export async function executeCommitmentCreate(env: ExecEnv): Promise<ExecOutcome> {
  const approval = env.approval;
  const payload = approval.payload;
  if (payload.action_type !== 'commitment_create') {
    throw new ExecutionFailure('PROVIDER_REJECTED', false, null, 'wrong_type');
  }
  if (Array.from(payload.text.trim()).length < 3) {
    throw new ExecutionFailure('PROVIDER_REJECTED', false, null, 'text_too_short');
  }
  const source = payload.source;
  const origin =
    source.source_type === 'user_input' ? 'user' : (COMMITMENT_ORIGIN[approval.origin] ?? 'user');
  const row: Record<string, Json> = {
    user_id: approval.user_id,
    contact_id: payload.counterparty.contact_id ?? null,
    counterparty_name:
      (payload.counterparty.name ?? payload.counterparty.email ?? null)?.slice(0, 120) ?? null,
    direction: payload.direction,
    text: payload.text.trim().slice(0, 500),
    due_at: payload.due_at === null ? null : new Date(payload.due_at).toISOString(),
    due_is_date_only: payload.due_precision === 'date',
    status: 'open',
    dedupe_key: `approval:${approval.id}`,
    origin,
    approval_action_id: approval.id,
    source_type: source.source_type,
    source_id: source.source_id ?? approval.id,
    source_provider: source.source_provider === 'in_app' ? null : source.source_provider,
    source_timestamp: new Date(source.source_timestamp).toISOString(),
    confidence: Math.round(payload.confidence * 1000) / 1000,
    evidence: [{ quote: payload.evidence.quote.slice(0, 300), field: 'text' }],
  };
  const commitment = await env.repo.insertCommitment(row);
  return {
    providerRef: `commitment:${commitment.id}`,
    result: {
      target: 'in_app',
      commitment_id: commitment.id,
      already_existed: !commitment.created,
    },
    followUps: [insightRefresh(approval.user_id, 'all')],
  };
}
