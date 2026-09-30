import { admin } from '@da/validation';
import { describe, expect, it } from 'vitest';

import {
  hasActiveFilters,
  loadTableState,
  serializeTableState,
  toAdminListQuery,
} from '../url-state';

const FILTERS = ['plan', 'state'];

describe('DataTable URL state (BACKOFFICE_PLAN §5.3)', () => {
  it('round-trips page, size, sort, order, q and f.<filter>', () => {
    const url = serializeTableState(
      {
        page: 3,
        size: 50,
        sort: 'created_at',
        order: 'asc',
        q: 'yusuf@gmail.com',
        'f.plan': ['pro', 'trial'],
      },
      FILTERS,
    );
    expect(url).toContain('f.plan=pro,trial');
    const state = loadTableState(Object.fromEntries(new URLSearchParams(url.slice(1))), FILTERS);
    expect(state).toMatchObject({
      page: 3,
      size: 50,
      sort: 'created_at',
      order: 'asc',
      q: 'yusuf@gmail.com',
    });
    expect(state['f.plan']).toEqual(['pro', 'trial']);
    expect(state['f.state']).toBeNull();
  });

  it('falls back to the defaults', () => {
    const state = loadTableState({}, FILTERS);
    expect(state).toMatchObject({ page: 1, size: 25, sort: null, order: 'desc', q: null });
    expect(hasActiveFilters(state, FILTERS)).toBe(false);
  });

  it('builds an admin-api list query the route contract accepts, dropping non-allow-listed sorts', () => {
    const state = loadTableState(
      { page: '2', size: '100', sort: 'email', order: 'asc', 'f.plan': 'pro' },
      FILTERS,
    );
    const query = toAdminListQuery(state, {
      sortable: ['created_at', 'last_active_at', 'last_sync_at'],
      filterKeys: FILTERS,
    });
    expect(query).toEqual({ page: 2, page_size: 100, order: 'asc', 'filter[plan]': 'pro' });
    expect(admin.UsersListQuery.safeParse(query).success).toBe(true);
    const sorted = toAdminListQuery(loadTableState({ sort: 'created_at', size: '7' }, FILTERS), {
      sortable: ['created_at'],
      filterKeys: FILTERS,
    });
    expect(sorted).toEqual({ page: 1, page_size: 25, order: 'desc', sort: 'created_at' });
    expect(admin.UsersListQuery.safeParse(sorted).success).toBe(true);
    expect(hasActiveFilters(state, FILTERS)).toBe(true);
  });
});
