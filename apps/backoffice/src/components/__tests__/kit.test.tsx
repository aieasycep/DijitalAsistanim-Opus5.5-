/** @vitest-environment jsdom */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChartCard } from '@/components/charts/chart-card';
import { resolveChartColors } from '@/components/charts/use-chart-colors';
import { PageHeader } from '@/components/page-header';
import { NavList } from '@/components/sidebar';
import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { ForbiddenState } from '@/components/states/forbidden-state';
import { LoadingState } from '@/components/states/loading-state';
import { visibleNavigation } from '@/lib/navigation';
import { axeViolations, renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard',
}));

const POINTS = [
  { t: '2026-09-17T00:00:00Z', value: 1200 },
  { t: '2026-09-18T00:00:00Z', value: 1850 },
  { t: '2026-09-19T00:00:00Z', value: 1400 },
];

describe('state components (BACKOFFICE_PLAN §5.6)', () => {
  it('error: copy, code, correlation id with copy button, retry', async () => {
    const onRetry = vi.fn();
    const { container } = renderWithProviders(
      <ErrorState code="SERVICE_UNAVAILABLE" correlationId="corr-7" onRetry={onRetry} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Veriler yüklenemedi.');
    expect(screen.getByText('SERVICE_UNAVAILABLE')).toBeInTheDocument();
    expect(screen.getByText('Hata kimliği: corr-7')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Hata kimliğini kopyala' })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('empty, forbidden, aggregates-only and loading', async () => {
    const { container } = renderWithProviders(
      <>
        <EmptyState title="Henüz kullanıcı yok." />
        <ForbiddenState />
        <ForbiddenState aggregatesOnly />
        <LoadingState rows={3} />
      </>,
    );
    expect(screen.getByText('Henüz kullanıcı yok.')).toBeInTheDocument();
    expect(screen.getByText('Bu bölümü görüntüleme yetkin yok.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Bu tablo için satır düzeyinde erişim yetkin yok; yalnızca özet metrikleri görebilirsin.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Yükleniyor')).toHaveClass('sr-only');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('page header renders the title as the page heading', () => {
    renderWithProviders(<PageHeader title="Pano" description="Özet" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Pano' })).toBeInTheDocument();
  });
});

describe('charts (BACKOFFICE_PLAN §5.7)', () => {
  it('summarises the series for assistive tech and toggles a table fallback', async () => {
    const { container } = renderWithProviders(
      <ChartCard title="Kullanıcı büyümesi" points={POINTS} kind="info" />,
    );
    expect(screen.getByText('Toplam 4.450; en yüksek değer 1.850 (18 Eyl).')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tablo olarak göster' }));
    const table = screen.getByRole('table', { name: 'Kullanıcı büyümesi' });
    expect(table).toHaveTextContent('1.850');
    expect(screen.getByRole('button', { name: 'Grafik olarak göster' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows the empty copy for an empty range', () => {
    renderWithProviders(<ChartCard title="AI maliyeti" points={[]} kind="ai" format="usd" />);
    expect(screen.getByText('Bu aralıkta veri yok.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tablo olarak göster' })).not.toBeInTheDocument();
  });

  it('resolves series colours from theme tokens', () => {
    const colors = resolveChartColors((token) =>
      token === '--da-brand-primary' ? ' indigo ' : '',
    );
    expect(colors.ai).toBe('indigo');
    expect(colors.failure).toBe('var(--da-tone-critical-solid)');
  });
});

describe('sidebar', () => {
  it('marks the active item and filters by permission', async () => {
    const groups = visibleNavigation(['dashboard.read']);
    const { container } = renderWithProviders(
      <nav aria-label="Ana menü">
        <NavList groups={groups} />
      </nav>,
    );
    expect(screen.getByRole('link', { name: 'Pano' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Genel Bakış' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Kullanıcılar' })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});
