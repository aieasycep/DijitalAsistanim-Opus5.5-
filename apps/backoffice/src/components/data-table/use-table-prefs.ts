'use client';

import { useCallback } from 'react';

import { saveTablePrefsAction } from '@/actions/preferences';
import { useAdmin } from '@/components/admin-provider';
import type { DataTablePrefs } from './data-table';

/**
 * Per-table column visibility and page size from `admin_preferences.table_prefs[tableId]` (§5.3),
 * with the persisting callback DataTable calls, and the admin's density preference.
 */
export function useTablePrefs(tableId: string): {
  prefs: DataTablePrefs;
  onPrefsChange: (tableId: string, prefs: DataTablePrefs) => void;
  density: 'comfortable' | 'compact';
} {
  const admin = useAdmin();
  const stored = admin?.preferences.table_prefs[tableId];
  const prefs: DataTablePrefs = typeof stored === 'object' && stored !== null ? stored : {};
  const onPrefsChange = useCallback((id: string, next: DataTablePrefs) => {
    void saveTablePrefsAction(id, {
      ...(next.hidden === undefined ? {} : { hidden: [...next.hidden] }),
      ...(next.pageSize === undefined ? {} : { pageSize: next.pageSize }),
    });
  }, []);
  return { prefs, onPrefsChange, density: admin?.preferences.density ?? 'comfortable' };
}
