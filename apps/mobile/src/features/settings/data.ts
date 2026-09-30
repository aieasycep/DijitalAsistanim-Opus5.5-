/**
 * Live values of the settings hub (M-SET-01 "Sağdaki değer sütunu mevcut durumu özetler"): the
 * exact counts of enabled, non-deleted priority rules, VIP people and enabled learned preferences,
 * read under RLS (own rows only) and persisted for the offline hub.
 */
import { qk } from '@da/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { getSupabase } from '../../lib/auth/supabase';
import { toDataError } from '../../lib/postgrest';

export interface SettingsCounts {
  readonly rules: number;
  readonly vip: number;
  readonly learned: number;
}

interface Rows {
  readonly data: readonly unknown[] | null;
  readonly error: { readonly message?: string; readonly code?: string } | null;
}

export async function fetchSettingsCounts(): Promise<SettingsCounts> {
  const supabase = getSupabase();
  const [rules, vip, learned] = (await Promise.all([
    supabase.from('priority_rules').select('id').is('deleted_at', null).eq('enabled', true),
    supabase.from('vip_people').select('id'),
    supabase.from('learned_preferences').select('id').is('deleted_at', null).eq('enabled', true),
  ])) as unknown as [Rows, Rows, Rows];
  for (const result of [rules, vip, learned]) {
    if (result.error !== null) throw toDataError(result.error);
  }
  return {
    rules: rules.data?.length ?? 0,
    vip: vip.data?.length ?? 0,
    learned: learned.data?.length ?? 0,
  };
}

export function settingsCountsQueryOptions() {
  return queryOptions({
    queryKey: qk.settings.counts(),
    queryFn: fetchSettingsCounts,
    staleTime: 60_000,
    meta: { persist: true },
  });
}

export function useSettingsCounts() {
  return useQuery(settingsCountsQueryOptions());
}
