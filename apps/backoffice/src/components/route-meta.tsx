'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type {
  ModuleMutationKey,
  RouteConfirmation,
  RouteConfirmations,
} from '@/server/admin-contracts';

/*
 * The confirmation metadata of every module mutation (reason required, `confirm: true`, step-up),
 * derived from the `@da/validation` registry on the server by the admin layout and read here by the
 * dialogs. The registry itself never ships to the browser; the server enforces all of it again.
 */

const MetaCtx = createContext<RouteConfirmations | null>(null);

export function RouteMetaProvider({
  value,
  children,
}: {
  value: RouteConfirmations;
  children: ReactNode;
}) {
  return <MetaCtx.Provider value={value}>{children}</MetaCtx.Provider>;
}

const STRICTEST: RouteConfirmation = {
  requiresReason: true,
  requiresConfirm: true,
  requiresStepUp: false,
};

/** The route's confirmation needs; without a provider it asks for a reason (the safe default). */
export function useRouteMeta(route: ModuleMutationKey): RouteConfirmation {
  const meta = useContext(MetaCtx);
  return meta?.[route] ?? STRICTEST;
}
