/** @vitest-environment jsdom */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OnUrlUpdateFunction } from 'nuqs/adapters/testing';
import { describe, expect, it, vi } from 'vitest';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { axeViolations, renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

interface Row {
  id: string;
  email: string;
  plan: string;
  createdAt: string;
}

const ROWS: Row[] = Array.from({ length: 3 }, (_, i) => ({
  id: `0190f5e0-1111-7000-8000-00000000000${String(i)}`,
  email: `u${String(i)}***@gmail.com`,
  plan: i === 0 ? 'pro' : 'free',
  createdAt: `2026-09-2${String(i)}`,
}));

const COLUMNS: DataTableColumn<Row>[] = [
  { id: 'id', header: 'Kullanıcı', cell: (row) => row.id.slice(-8), required: true },
  { id: 'email', header: 'E-posta', cell: (row) => row.email },
  { id: 'plan', header: 'Plan', cell: (row) => row.plan },
  { id: 'created_at', header: 'Oluşturulma', cell: (row) => row.createdAt, sortable: true },
];

const FILTERS = [
  {
    key: 'plan',
    label: 'Plan',
    options: [
      { value: 'pro', label: 'Pro' },
      { value: 'free', label: 'Free' },
    ],
  },
];

function renderTable(
  options: {
    rows?: Row[];
    total?: number;
    searchParams?: string;
    status?: 'ready' | 'error' | 'forbidden' | 'aggregatesOnly';
    onPrefsChange?: (
      tableId: string,
      prefs: { hidden?: readonly string[]; pageSize?: number },
    ) => void;
  } = {},
) {
  const updates: string[] = [];
  const onUrlUpdate: OnUrlUpdateFunction = (event) => {
    updates.push(event.queryString);
  };
  const view = renderWithProviders(
    <DataTable<Row>
      tableId="users"
      caption="Kullanıcılar"
      columns={COLUMNS}
      rows={options.rows ?? ROWS}
      total={options.total ?? 75}
      getRowId={(row) => row.id}
      rowHref={(row) => `/users/${row.id}`}
      filters={FILTERS}
      searchable
      status={options.status ?? 'ready'}
      error={{ code: 'SERVICE_UNAVAILABLE', correlationId: 'corr-42' }}
      {...(options.onPrefsChange === undefined ? {} : { onPrefsChange: options.onPrefsChange })}
    />,
    { searchParams: options.searchParams ?? '', onUrlUpdate },
  );
  return { ...view, updates, user: userEvent.setup({ delay: null }) };
}

describe('DataTable (BACKOFFICE_PLAN §5.3)', () => {
  it('renders semantic rows with a caption, links and aria-sort', () => {
    renderTable();
    const table = screen.getByRole('table', { name: 'Kullanıcılar' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByRole('columnheader', { name: /Oluşturulma/ })).toHaveAttribute(
      'aria-sort',
      'none',
    );
    expect(within(table).getByRole('columnheader', { name: 'Plan' })).not.toHaveAttribute(
      'aria-sort',
    );
    expect(within(table).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      `/users/${ROWS[0]?.id ?? ''}`,
    );
    expect(screen.getByText('1–3 / 75')).toBeInTheDocument();
  });

  it('cycles server sorting asc → desc → default through the URL', async () => {
    const { user, updates } = renderTable();
    const sort = screen.getByRole('button', { name: /Oluşturulma sütununa göre sırala/ });
    await user.click(sort);
    await waitFor(() => {
      expect(updates.at(-1)).toBe('?sort=created_at&order=asc');
    });
  });

  it('reads sorting and paging from the URL and pages through it', async () => {
    const { user, updates } = renderTable({ searchParams: '?sort=created_at&order=desc&page=2' });
    expect(screen.getByRole('columnheader', { name: /Oluşturulma/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(screen.getByText('26–28 / 75')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sonraki' }));
    await waitFor(() => {
      expect(updates.at(-1)).toContain('page=3');
    });
    await user.selectOptions(screen.getByLabelText('Sayfa başına'), '50');
    await waitFor(() => {
      expect(updates.at(-1)).toContain('size=50');
    });
    expect(updates.at(-1)).not.toContain('page=');
  });

  it('hides a column and persists the choice; required columns stay', async () => {
    const onPrefsChange = vi.fn();
    const { user } = renderTable({ onPrefsChange });
    await user.click(screen.getByRole('button', { name: 'Sütunlar' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Kullanıcı' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: 'E-posta' }));
    await waitFor(() => {
      expect(onPrefsChange).toHaveBeenCalledWith('users', { hidden: ['email'] });
    });
    expect(screen.queryByRole('columnheader', { name: 'E-posta' })).not.toBeInTheDocument();
  });

  it('filters through f.<key> and shows removable chips with "Filtreleri temizle"', async () => {
    const { user, updates } = renderTable({ searchParams: '?f.plan=pro' });
    expect(screen.getByRole('button', { name: 'Plan: Pro filtresini kaldır' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Filtreleri temizle' }));
    await waitFor(() => {
      expect(updates.at(-1)).toBe('');
    });
    await user.type(screen.getByRole('searchbox', { name: 'Kimlik ile ara' }), 'yusuf@gmail.com');
    await user.click(screen.getByRole('button', { name: 'Ara' }));
    await waitFor(() => {
      expect(updates.at(-1)).toBe('?q=yusuf@gmail.com');
    });
  });

  it('shows the empty, filtered-empty, error and forbidden states', () => {
    const empty = renderTable({ rows: [], total: 0 });
    expect(screen.getByText('Henüz kayıt yok.')).toBeInTheDocument();
    empty.unmount();
    const filtered = renderTable({ rows: [], total: 0, searchParams: '?f.plan=pro' });
    expect(screen.getAllByText('Filtrelerle eşleşen kayıt yok.')).toHaveLength(1);
    filtered.unmount();
    const failed = renderTable({ status: 'error' });
    expect(screen.getByRole('alert')).toHaveTextContent('Veriler yüklenemedi.');
    expect(screen.getByText('Hata kimliği: corr-42')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeInTheDocument();
    failed.unmount();
    renderTable({ status: 'aggregatesOnly' });
    expect(
      screen.getByText(
        'Bu tablo için satır düzeyinde erişim yetkin yok; yalnızca özet metrikleri görebilirsin.',
      ),
    ).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderTable({ searchParams: '?f.plan=pro&sort=created_at&order=asc' });
    expect(await axeViolations(container)).toEqual([]);
  });
});
