/**
 * `ACCOUNT_DELETION_SCOPE` / `HISTORY_DELETION_SCOPE` as rendered on `/data-deletion`
 * (SCREEN_AND_FLOW_MAP Part 5 §6.3, registry R-11; SECURITY_AND_PRIVACY_PLAN §4.7–4.8). Each row
 * states what happens to one kind of data for an account deletion (web or app) and for a
 * history-only deletion (app only). The `account_deletion` and `history_deletion` jobs purge
 * exactly this scope; a unit test pins the rows.
 */

export const DELETION_OUTCOMES = [
  'deleted',
  'kept',
  'deletedRevoked',
  'deletedPendingCancelled',
  'deletedCancelStore',
  'referralUnlinked',
  'supportUnlinked',
  'analyticsUnlinked',
  'unaffected',
  'staysInYourAccount',
] as const;
export type DeletionOutcome = (typeof DELETION_OUTCOMES)[number];

export interface DeletionScopeRow {
  readonly id: string;
  readonly account: DeletionOutcome;
  readonly history: DeletionOutcome;
}

export const DELETION_SCOPE = [
  { id: 'profile', account: 'deleted', history: 'kept' },
  { id: 'connections', account: 'deletedRevoked', history: 'kept' },
  { id: 'derived', account: 'deleted', history: 'deleted' },
  { id: 'briefings', account: 'deleted', history: 'deleted' },
  { id: 'decisions', account: 'deleted', history: 'deleted' },
  { id: 'rules', account: 'deleted', history: 'kept' },
  { id: 'assistant', account: 'deleted', history: 'deleted' },
  { id: 'commitments', account: 'deleted', history: 'deleted' },
  { id: 'captures', account: 'deleted', history: 'deleted' },
  { id: 'approvals', account: 'deleted', history: 'deletedPendingCancelled' },
  { id: 'reminders', account: 'deleted', history: 'kept' },
  { id: 'settings', account: 'deleted', history: 'kept' },
  { id: 'subscription', account: 'deletedCancelStore', history: 'kept' },
  { id: 'referrals', account: 'referralUnlinked', history: 'kept' },
  { id: 'support', account: 'supportUnlinked', history: 'kept' },
  { id: 'pushTokens', account: 'deleted', history: 'kept' },
  { id: 'exports', account: 'deleted', history: 'deleted' },
  { id: 'analytics', account: 'analyticsUnlinked', history: 'kept' },
  { id: 'mailbox', account: 'unaffected', history: 'unaffected' },
  { id: 'sentItems', account: 'staysInYourAccount', history: 'staysInYourAccount' },
] as const satisfies readonly DeletionScopeRow[];

/** Rows whose data an account deletion removes, for the summary shown before confirming. */
export const ACCOUNT_DELETION_SUMMARY_ROWS = DELETION_SCOPE.filter(
  (row) => !['unaffected', 'staysInYourAccount', 'kept'].includes(row.account),
).map((row) => row.id);
