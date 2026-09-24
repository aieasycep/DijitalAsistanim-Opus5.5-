import { RETENTION_POLICY_VALUES, type RetentionPolicy } from '@da/domain/enums';

/**
 * `RETENTION_SCHEDULE` (SCREEN_AND_FLOW_MAP Part 5 registry R-10; SECURITY_AND_PRIVACY_PLAN §4.5):
 * the retention facts the privacy policy states. The user-selectable window is the canonical
 * `retention_policy` enum (30 / 90 / 365 days / until deleted, default 90 — ADR-05, M§41).
 *
 * This constant lives in apps/web because packages/domain does not export it yet; the
 * `retention` job must use the same values (a unit test pins this table to the rendered policy).
 */

export const RETENTION_USER_OPTIONS: readonly RetentionPolicy[] = RETENTION_POLICY_VALUES;
export const RETENTION_DEFAULT: RetentionPolicy = 'd90';

export type RetentionPeriod =
  | { readonly kind: 'userChoice' }
  | { readonly kind: 'notStored' }
  | { readonly kind: 'afterAnalysisHours'; readonly hours: number }
  | { readonly kind: 'exportHours'; readonly hours: number }
  | { readonly kind: 'untilDisconnect' }
  | { readonly kind: 'untilSignOut' }
  | { readonly kind: 'analyticsDays'; readonly days: number }
  | { readonly kind: 'days'; readonly days: number }
  | { readonly kind: 'upToDays'; readonly days: number }
  | { readonly kind: 'yearsAfterClosure'; readonly years: number }
  | { readonly kind: 'auditYears'; readonly years: number }
  | { readonly kind: 'deletionYears'; readonly years: number }
  | { readonly kind: 'backup' }
  | { readonly kind: 'aiProviders' };

export interface RetentionRow {
  readonly id: string;
  readonly period: RetentionPeriod;
}

export const RETENTION_SCHEDULE = [
  { id: 'analysis', period: { kind: 'userChoice' } },
  { id: 'mailBodies', period: { kind: 'notStored' } },
  { id: 'captureFiles', period: { kind: 'afterAnalysisHours', hours: 24 } },
  { id: 'exportFiles', period: { kind: 'exportHours', hours: 24 } },
  { id: 'accessKeys', period: { kind: 'untilDisconnect' } },
  { id: 'pushTokens', period: { kind: 'untilSignOut' } },
  { id: 'productAnalytics', period: { kind: 'analyticsDays', days: 400 } },
  { id: 'errorLogs', period: { kind: 'days', days: 90 } },
  { id: 'serverLogs', period: { kind: 'upToDays', days: 30 } },
  { id: 'supportTickets', period: { kind: 'yearsAfterClosure', years: 2 } },
  { id: 'auditLogs', period: { kind: 'auditYears', years: 2 } },
  { id: 'deletionRecords', period: { kind: 'deletionYears', years: 3 } },
  { id: 'referralSignals', period: { kind: 'days', days: 400 } },
  { id: 'backups', period: { kind: 'backup' } },
  { id: 'aiProviders', period: { kind: 'aiProviders' } },
] as const satisfies readonly RetentionRow[];

export type RetentionRowId = (typeof RETENTION_SCHEDULE)[number]['id'];
