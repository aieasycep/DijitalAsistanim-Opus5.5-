/**
 * Demo adapter set (INTEGRATION_PLAN §13.2; T-4.10). Registered in the provider registry only while
 * demo mode is allowed (`createProviderRegistry` enforces `isDemoEnabled`).
 */
import type { ServerProviderAdapters } from '@da/domain';
import { DemoOAuth, type DemoOAuthConfig } from './auth.ts';
import { DemoCalendarAdapter } from './calendar.ts';
import { DemoMailAdapter } from './mail.ts';
import { DemoTaskAdapter } from './tasks.ts';
import type { DemoAdapterDeps } from './writes.ts';

export {
  DemoOAuth,
  type DemoOAuthConfig,
  demoCapabilitiesFromScope,
  demoFlavorFromScopes,
  demoFlavorScope,
} from './auth.ts';
export { DemoCalendarAdapter } from './calendar.ts';
export { DemoMailAdapter } from './mail.ts';
export { DemoTaskAdapter } from './tasks.ts';
export type { DemoAdapterDeps, DemoStorePort } from './writes.ts';
export { DEMO_SELF, type DemoFlavor, demoDataset } from './fixtures/index.ts';

export function demoAdapters(
  deps: DemoAdapterDeps,
  oauth: DemoOAuthConfig,
): ServerProviderAdapters & { oauth: DemoOAuth } {
  return {
    oauth: new DemoOAuth(oauth),
    mail: new DemoMailAdapter(deps),
    calendar: new DemoCalendarAdapter(deps),
    tasks: new DemoTaskAdapter(deps),
  };
}
