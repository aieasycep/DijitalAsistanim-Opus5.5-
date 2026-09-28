import { adminRoutes } from '@da/validation';
import { NextIntlClientProvider } from 'next-intl';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import type { z } from 'zod';

import { AdminProvider } from '@/components/admin-provider';
import { RouteMetaProvider } from '@/components/route-meta';
import { SessionActionsProvider } from '@/components/session-actions';
import { ToastProvider } from '@/components/ui/toast';
import type { AdminContext } from '@/lib/admin-context';
import { moduleConfirmations } from '@/server/admin-contracts';
import { meta } from '../../e2e/fixtures';
import {
  accessDenied,
  handleModule,
  permissionsOf,
  resetData,
  type Ctx,
  type RouteKey,
} from '../../e2e/mock-admin';
import type { Role } from '../../e2e/mock-data';
import { TR_MESSAGES, adminContext } from './render';

/*
 * Module page harness (BACKOFFICE_PLAN §13.1): the admin-api client is replaced by the contract
 * mock the Playwright suite uses (`e2e/mock-admin.ts`: RBAC from the registry `access` blocks,
 * deterministic data, every body parsed with the route's `@da/validation` response schema), so a
 * page test exercises the real page code, permission gates and states without any network.
 */

export const NOW = Date.parse('2026-09-24T09:00:00Z');

interface Failure {
  readonly status: number;
  readonly code: string;
}

export const harness = {
  role: 'super_admin' as Role,
  /** Routes answered with an error instead of the mock (error-state tests). */
  failures: new Map<string, Failure>(),
  calls: [] as { key: string; input: unknown }[],
};

export function useRole(role: Role): void {
  harness.role = role;
  harness.failures.clear();
  harness.calls.length = 0;
  resetData(NOW, role);
}

export function contextFor(role: Role = harness.role): AdminContext {
  const base = adminContext();
  return adminContext({
    admin: { ...base.admin, role },
    permissions: permissionsOf(role) as AdminContext['permissions'],
    session: {
      idleExpiresAt: new Date(NOW + 30 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(NOW + 12 * 3_600_000).toISOString(),
      stepUpValidUntil: null,
      serverTime: new Date(NOW).toISOString(),
    },
  });
}

function parsePart(schema: z.ZodType | undefined, value: unknown): Record<string, unknown> {
  const raw = (value ?? {}) as Record<string, unknown>;
  if (schema === undefined) return raw;
  const parsed = schema.safeParse(raw);
  return parsed.success ? (parsed.data as Record<string, unknown>) : raw;
}

interface Input {
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
}

/** Drop-in for `adminApi()` answering from the contract mock. */
export async function fakeAdminApi(key: string, input: Input = {}): Promise<unknown> {
  harness.calls.push({ key, input });
  await Promise.resolve();
  const correlationId = `corr-${String(harness.calls.length).padStart(8, '0')}`;
  const failure = harness.failures.get(key);
  if (failure !== undefined) {
    return { ok: false, error: { ...failure, correlationId } };
  }
  const route = adminRoutes[key as RouteKey] as unknown as {
    request: { params?: z.ZodType; query?: z.ZodType; body?: z.ZodType };
    response: z.ZodType;
  };
  const ctx: Ctx = {
    key: key as RouteKey,
    params: parsePart(route.request.params, input.params) as Record<string, string>,
    query: parsePart(route.request.query, input.query),
    body: parsePart(route.request.body, input.body),
    now: NOW,
    permissions: permissionsOf(harness.role),
  };
  const denied = accessDenied(ctx);
  if (denied !== null) {
    return {
      ok: false,
      error: { code: 'FORBIDDEN', status: 403, correlationId, details: { permission: denied } },
    };
  }
  const outcome = handleModule(ctx);
  if (outcome === null)
    return { ok: false, error: { code: 'NOT_FOUND', status: 404, correlationId } };
  if (!outcome.ok) {
    return {
      ok: false,
      error: {
        code: outcome.code,
        status: outcome.status,
        correlationId,
        ...(outcome.details === undefined ? {} : { details: outcome.details }),
      },
    };
  }
  const body = route.response.safeParse({
    data: outcome.data,
    meta: { ...meta(NOW), correlation_id: correlationId, ...outcome.page },
  });
  if (!body.success) throw new Error(`contract drift on ${key}: ${body.error.message}`);
  const parsed = body.data as { data: unknown; meta: unknown };
  return {
    ok: true,
    status: outcome.status ?? 200,
    data: parsed.data,
    meta: parsed.meta,
    correlationId,
  };
}

/** The providers of the admin layout, around any tree. */
export function AdminShell({
  children,
  context = contextFor(),
}: {
  children: ReactNode;
  context?: AdminContext;
}) {
  return (
    <NextIntlClientProvider locale="tr" messages={TR_MESSAGES} timeZone="Europe/Istanbul">
      <NuqsTestingAdapter>
        <AdminProvider value={context}>
          <RouteMetaProvider value={moduleConfirmations()}>
            <ToastProvider label="Bildirimler">
              <SessionActionsProvider>{children}</SessionActionsProvider>
            </ToastProvider>
          </RouteMetaProvider>
        </AdminProvider>
      </NuqsTestingAdapter>
    </NextIntlClientProvider>
  );
}

/**
 * Renders a server page (async components included) to static HTML the way Next prerenders it and
 * mounts the markup in the jsdom document for DOM / Testing Library queries.
 */
export async function renderPage(node: ReactNode, context?: AdminContext): Promise<HTMLElement> {
  const { prelude } = await prerender(
    context === undefined ? (
      <AdminShell>{node}</AdminShell>
    ) : (
      <AdminShell context={context}>{node}</AdminShell>
    ),
  );
  const html = await new Response(prelude).text();
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.replaceChildren(container);
  return container;
}

export function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** `searchParams` / `params` props as Next passes them. */
export function props(
  searchParams: Record<string, string> = {},
  params: Record<string, string> = {},
): {
  searchParams: Promise<Record<string, string>>;
  params: Promise<Record<string, string>>;
} {
  return { searchParams: Promise.resolve(searchParams), params: Promise.resolve(params) };
}
