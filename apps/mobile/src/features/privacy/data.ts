/**
 * Privacy Center data (T-8.20): the latest export and deletion requests (own rows under RLS,
 * polled while a job runs — R-19 polling, no Realtime) and the `history_deletion_preview` counts
 * (RPC-19) behind the delete-history and retention-shorten sheets.
 */
import { qk } from '@da/api-client';
import type { DeletionStatus, ExportStatus } from '@da/domain';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { getSupabase } from '../../lib/auth/supabase';
import { rpc, toDataError } from '../../lib/postgrest';

export interface ExportRequestRow {
  readonly id: string;
  readonly status: ExportStatus;
  readonly created_at: string;
  readonly ready_at: string | null;
  readonly expires_at: string | null;
  readonly file_size_bytes: number | null;
  readonly downloaded_at: string | null;
}

export interface DeletionRequestRow {
  readonly id: string;
  readonly kind: 'history' | 'account';
  readonly status: DeletionStatus;
  readonly created_at: string;
  readonly completed_at: string | null;
}

export interface HistoryPreview {
  readonly summaries: number;
  readonly priority_decisions: number;
  readonly memory_entries: number;
  readonly learned_preferences: number;
  readonly assistant_conversations: number;
  readonly captures: number;
}

export const EXPORT_POLL_MS = 5_000;
export const DELETION_POLL_MS = 3_000;
const ACTIVE_EXPORT: readonly ExportStatus[] = ['requested', 'processing'];
const ACTIVE_DELETION: readonly DeletionStatus[] = [
  'requested',
  'verified',
  'queued',
  'processing',
];

export function isExportActive(row: ExportRequestRow | null | undefined): boolean {
  return row !== null && row !== undefined && ACTIVE_EXPORT.includes(row.status);
}

export function isDeletionActive(row: DeletionRequestRow | null | undefined): boolean {
  return row !== null && row !== undefined && ACTIVE_DELETION.includes(row.status);
}

interface One<T> {
  readonly data: T | null;
  readonly error: { readonly message?: string; readonly code?: string } | null;
}

async function latestExport(): Promise<ExportRequestRow | null> {
  const { data, error } = (await getSupabase()
    .from('data_export_requests')
    .select('id, status, created_at, ready_at, expires_at, file_size_bytes, downloaded_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as unknown as One<ExportRequestRow>;
  if (error !== null) throw toDataError(error);
  return data;
}

async function latestDeletion(kind: 'history' | 'account'): Promise<DeletionRequestRow | null> {
  const { data, error } = (await getSupabase()
    .from('data_deletion_requests')
    .select('id, kind, status, created_at, completed_at')
    .eq('kind', kind)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as unknown as One<DeletionRequestRow>;
  if (error !== null) throw toDataError(error);
  return data;
}

export function latestExportQueryOptions() {
  return queryOptions({
    queryKey: qk.privacy.exportLatest(),
    queryFn: latestExport,
    meta: { persist: true },
    refetchInterval: (query) => (isExportActive(query.state.data) ? EXPORT_POLL_MS : false),
  });
}

export function latestHistoryDeletionQueryOptions() {
  return queryOptions({
    queryKey: qk.privacy.historyLatest(),
    queryFn: () => latestDeletion('history'),
    meta: { persist: true },
    refetchInterval: (query) => (isDeletionActive(query.state.data) ? DELETION_POLL_MS : false),
  });
}

export function useLatestExport() {
  return useQuery(latestExportQueryOptions());
}

export function useLatestHistoryDeletion() {
  return useQuery(latestHistoryDeletionQueryOptions());
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function fetchHistoryPreview(olderThan: string | null): Promise<HistoryPreview> {
  const raw = (await rpc(
    'history_deletion_preview',
    olderThan === null ? {} : { p_older_than: olderThan },
  )) as Readonly<Record<string, unknown>> | null;
  return {
    summaries: count(raw?.summaries),
    priority_decisions: count(raw?.priority_decisions),
    memory_entries: count(raw?.memory_entries),
    learned_preferences: count(raw?.learned_preferences),
    assistant_conversations: count(raw?.assistant_conversations),
    captures: count(raw?.captures),
  };
}

export function historyPreviewQueryOptions(olderThan: string | null) {
  return queryOptions({
    queryKey: qk.privacy.historyPreview(olderThan),
    queryFn: () => fetchHistoryPreview(olderThan),
    staleTime: 30_000,
  });
}

export function totalOf(preview: HistoryPreview): number {
  return (
    preview.summaries +
    preview.priority_decisions +
    preview.memory_entries +
    preview.learned_preferences +
    preview.assistant_conversations +
    preview.captures
  );
}
