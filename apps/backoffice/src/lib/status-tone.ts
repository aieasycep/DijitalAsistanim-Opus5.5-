/*
 * Semantic badge tones (BACKOFFICE_PLAN §5.1): failures critical, in-between states warning, good
 * outcomes success, work in flight info, everything else neutral. Coral (critical) is reserved for
 * failures and destructive states.
 */

export type StatusTone = 'neutral' | 'critical' | 'warning' | 'success' | 'info';

const CRITICAL = new Set([
  'failed',
  'dead_letter',
  'down',
  'error',
  'needs_reauth',
  'failure',
  'denied',
  'revoke_failed',
  'billing_issue',
  'invalid_output',
  'timeout',
]);
const WARNING = new Set([
  'retrying',
  'degraded',
  'partial',
  'waiting_user',
  'flagged',
  'admin_consent_required',
  'grace_period',
  'deletion_pending',
  'disabled',
  'skipped',
  'warning',
  'suppressed',
  'deduplicated',
  'external_credential_required',
  'unknown',
  'pending',
  'invited',
  'refunded',
]);
const SUCCESS = new Set([
  'completed',
  'ok',
  'healthy',
  'executed',
  'resolved',
  'delivered',
  'sent',
  'active',
  'passed',
  'ready',
  'rewarded',
  'done',
  'success',
  'configured',
  'qualified',
  'live',
  'provider_revoked',
]);
const INFO = new Set([
  'running',
  'syncing',
  'in_progress',
  'scheduled',
  'queued',
  'processing',
  'generating',
  'connecting',
  'trial',
  'requested',
  'verified',
  'open',
  'new',
  'triaged',
  'planned',
]);

export function statusTone(value: string): StatusTone {
  if (CRITICAL.has(value)) return 'critical';
  if (WARNING.has(value)) return 'warning';
  if (SUCCESS.has(value)) return 'success';
  if (INFO.has(value)) return 'info';
  return 'neutral';
}
