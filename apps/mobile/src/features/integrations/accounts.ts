/**
 * `['integrations','accounts']` (SCREEN_AND_FLOW_MAP §0.4, M-SET-10/12): the user's
 * `connected_accounts`, their `calendars` and `sync_states`, read through PostgREST as the user
 * (RLS, explicit column lists). Persisted, 30 s fresh; polled every 5 s while any account is
 * connecting or syncing (R-19, no Realtime).
 */
import { qk } from '@da/api-client';
import type { AccountStatus, Capability, Provider } from '@da/domain/enums';
import type { DataSourceToggles } from '@da/validation/api/common';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { getSupabase } from '../../lib/auth/supabase';
import { toDataError } from '../../lib/postgrest';
import { isSettling } from './status';

export interface AccountRow {
  readonly id: string;
  readonly provider: Provider;
  readonly account_email: string | null;
  readonly display_label: string | null;
  readonly status: AccountStatus;
  readonly status_reason: string | null;
  readonly capabilities_granted: readonly Capability[];
  readonly granted_scopes: readonly string[];
  readonly data_source_toggles: DataSourceToggles;
  readonly last_sync_at: string | null;
  readonly last_error_code: string | null;
  readonly updated_at: string;
}

export interface CalendarRow {
  readonly id: string;
  readonly connected_account_id: string;
  readonly name: string;
  readonly color: string | null;
  readonly is_primary: boolean;
  readonly selected: boolean;
  readonly can_write: boolean;
  readonly access_role: string;
}

export interface SyncStateRow {
  readonly connected_account_id: string;
  readonly resource: string;
  readonly last_success_at: string | null;
  readonly last_error_code: string | null;
}

export interface AccountsData {
  readonly accounts: readonly AccountRow[];
  readonly calendars: readonly CalendarRow[];
  readonly syncStates: readonly SyncStateRow[];
}

const ACCOUNT_COLUMNS =
  'id, provider, account_email, display_label, status, status_reason, capabilities_granted, granted_scopes, data_source_toggles, last_sync_at, last_error_code, updated_at';
const CALENDAR_COLUMNS =
  'id, connected_account_id, name, color, is_primary, selected, can_write, access_role';
const SYNC_COLUMNS = 'connected_account_id, resource, last_success_at, last_error_code';

export const ACCOUNTS_POLL_MS = 5_000;

interface Rows<T> {
  data: T[] | null;
  error: { message?: string; code?: string } | null;
}

export async function fetchAccounts(): Promise<AccountsData> {
  const supabase = getSupabase();
  const [accounts, calendars, syncStates] = (await Promise.all([
    supabase
      .from('connected_accounts')
      .select(ACCOUNT_COLUMNS)
      .neq('status', 'disconnected')
      .order('created_at'),
    supabase.from('calendars').select(CALENDAR_COLUMNS).order('name'),
    supabase.from('sync_states').select(SYNC_COLUMNS),
  ])) as unknown as [Rows<AccountRow>, Rows<CalendarRow>, Rows<SyncStateRow>];
  for (const result of [accounts, calendars, syncStates]) {
    if (result.error !== null) throw toDataError(result.error);
  }
  return {
    accounts: accounts.data ?? [],
    calendars: calendars.data ?? [],
    syncStates: syncStates.data ?? [],
  };
}

export function accountsQueryOptions() {
  return queryOptions({
    queryKey: qk.integrations.accounts(),
    queryFn: fetchAccounts,
    staleTime: 30_000,
    meta: { persist: true },
    refetchInterval: (query) =>
      (query.state.data?.accounts ?? []).some((a) => isSettling(a.status))
        ? ACCOUNTS_POLL_MS
        : false,
  });
}

export function useAccounts(options: { readonly enabled?: boolean } = {}) {
  return useQuery({ ...accountsQueryOptions(), enabled: options.enabled ?? true });
}

export function hasGranted(account: AccountRow, capability: Capability): boolean {
  return account.capabilities_granted.includes(capability);
}

/** Mail-capable accounts (the Free limit `max_mail_accounts` = 1, D-30). */
export function mailAccounts(data: AccountsData | undefined): readonly AccountRow[] {
  return (data?.accounts ?? []).filter((a) => hasGranted(a, 'mail_read'));
}

/** Calendar-capable accounts, device calendars included. */
export function calendarAccounts(data: AccountsData | undefined): readonly AccountRow[] {
  return (data?.accounts ?? []).filter(
    (a) =>
      hasGranted(a, 'calendar_read') ||
      a.provider === 'apple_device' ||
      a.provider === 'android_device',
  );
}

export function calendarsOf(
  data: AccountsData | undefined,
  accountId: string,
): readonly CalendarRow[] {
  return (data?.calendars ?? []).filter((c) => c.connected_account_id === accountId);
}
