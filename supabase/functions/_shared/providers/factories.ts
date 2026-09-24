/**
 * Adapter factories per server provider, consumed by `createProviderRegistry(factories, env)` in the
 * `api` and `worker` wiring (approval execution, the `calendar_update` precondition read). The
 * Google, Microsoft and demo adapters (IMPLEMENTATION_PLAN T-4.02…T-4.10) add their factory here; a
 * provider without one resolves to `FEATURE_DISABLED {reason:'provider_not_registered'}`, so an
 * approval to it fails honestly instead of pretending to succeed.
 */
import type { ServerProvider } from '@da/domain';
import type { AdapterFactory } from './registry.ts';

export const SERVER_ADAPTER_FACTORIES: Partial<Readonly<Record<ServerProvider, AdapterFactory>>> =
  {};
