import { loadNamespaces } from '@da/i18n';
import { render, type RenderResult } from '@testing-library/react';
import axe from 'axe-core';
import { NextIntlClientProvider } from 'next-intl';
import { NuqsTestingAdapter, type OnUrlUpdateFunction } from 'nuqs/adapters/testing';
import type { ReactElement, ReactNode } from 'react';

import { AdminProvider } from '@/components/admin-provider';
import { ToastProvider } from '@/components/ui/toast';
import type { AdminContext } from '@/lib/admin-context';

export const TR_MESSAGES = loadNamespaces('tr', ['backoffice']);

export function adminContext(overrides: Partial<AdminContext> = {}): AdminContext {
  return {
    admin: {
      id: '0190f5e0-0000-7000-8000-000000000001',
      email: 'ops@dijitalasistan.app',
      displayName: 'Ayşe Operasyon',
      role: 'operations',
      mfaFactorCount: 1,
      recoveryCodesRemaining: 10,
    },
    permissions: ['dashboard.read', 'users.read', 'search.global'],
    session: {
      idleExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 12 * 3_600_000).toISOString(),
      stepUpValidUntil: null,
      serverTime: new Date().toISOString(),
    },
    preferences: {
      theme: 'light',
      locale: 'tr',
      timezone: 'Europe/Istanbul',
      density: 'comfortable',
      table_prefs: {},
      dashboard_range: '7d',
      recent_items: [],
      sidebar_collapsed: false,
    },
    ...overrides,
  };
}

export function renderWithProviders(
  ui: ReactElement,
  options: {
    admin?: AdminContext | null;
    searchParams?: string;
    onUrlUpdate?: OnUrlUpdateFunction;
  } = {},
): RenderResult {
  const admin = options.admin === undefined ? adminContext() : options.admin;
  function Wrapper({ children }: { children: ReactNode }) {
    const inner = (
      <NextIntlClientProvider locale="tr" messages={TR_MESSAGES} timeZone="Europe/Istanbul">
        <NuqsTestingAdapter
          hasMemory
          rateLimitFactor={0}
          searchParams={options.searchParams ?? ''}
          {...(options.onUrlUpdate === undefined ? {} : { onUrlUpdate: options.onUrlUpdate })}
        >
          <ToastProvider label="Bildirimler">{children}</ToastProvider>
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    );
    return admin === null ? inner : <AdminProvider value={admin}>{inner}</AdminProvider>;
  }
  return render(ui, { wrapper: Wrapper });
}

/** Runs axe-core on a container and returns the violations (rule id + first target). */
export async function axeViolations(container: Element): Promise<string[]> {
  const results = await axe.run(container, {
    rules: {
      // jsdom has no layout or computed colours; contrast is covered by the token contrast tests.
      'color-contrast': { enabled: false },
      region: { enabled: false },
    },
  });
  return results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ') ?? ''}`);
}
