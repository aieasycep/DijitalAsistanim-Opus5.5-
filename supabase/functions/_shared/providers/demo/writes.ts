/**
 * Demo writes (INTEGRATION_PLAN §13.2; M§100 "no success without the change"). Every approved demo
 * write is recorded exactly once in `private.demo_fixture_state.state.writes[approvalId]` (a retried
 * write gets the stored item back) and is merged into the demo adapters' listings, so a sent reply
 * appears in its thread and a created event in its calendar on the next sync.
 */
import type { EventTime, ProviderContext } from '@da/domain';
import type { DemoResourceState, IntegrationStore } from '../../services/integrations/types.ts';
import type { DemoFlavor } from './fixtures/index.ts';

export type DemoStorePort = Pick<
  IntegrationStore,
  'demoState' | 'demoRecordWrite' | 'demoSetClock'
>;

export interface DemoAdapterDeps {
  readonly store: DemoStorePort;
  /** The demo user's IANA zone (fixtures are relative to the local day). */
  readonly timeZone: (userId: string) => Promise<string>;
}

export interface DemoReplyWrite {
  readonly kind: 'reply';
  readonly id: string;
  readonly threadId: string;
  readonly subject: string;
  readonly snippet: string;
  readonly to: readonly { address: string; name: string | null }[];
  readonly cc: readonly { address: string; name: string | null }[];
  readonly inReplyTo: string | null;
  readonly sentAt: string;
}

export interface DemoEventWrite {
  readonly kind: 'event_create';
  readonly id: string;
  readonly approvalId: string;
  readonly calendarId: string;
  readonly title: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly start: EventTime;
  readonly end: EventTime;
  readonly attendees: readonly { address: string; name: string | null }[];
  readonly createdAt: string;
}

export interface DemoEventUpdate {
  readonly kind: 'event_update';
  readonly approvalId: string;
  readonly eventId: string;
  readonly start?: EventTime;
  readonly end?: EventTime;
  readonly title?: string;
  readonly location?: string | null;
  readonly updatedAt: string;
}

export interface DemoTaskWrite {
  readonly kind: 'task_create';
  readonly id: string;
  readonly approvalId: string;
  readonly listId: string;
  readonly title: string;
  readonly notes: string | null;
  readonly due: { date: string } | { dateTime: string; timeZone: string } | null;
  readonly importance: 'low' | 'normal' | 'high';
  readonly marker: string;
  readonly createdAt: string;
}

export type DemoWrite = DemoReplyWrite | DemoEventWrite | DemoEventUpdate | DemoTaskWrite;

export function flavorOf(ctx: ProviderContext): DemoFlavor {
  return ctx.account.providerAccountId.startsWith('demo-microsoft') ? 'microsoft' : 'google';
}

export async function demoWrites(
  deps: DemoAdapterDeps,
  ctx: ProviderContext,
  resource: 'mail' | 'calendar' | 'tasks',
): Promise<Record<string, DemoWrite>> {
  const all: Readonly<Record<string, DemoResourceState>> = await deps.store.demoState(
    ctx.account.connectedAccountId,
  );
  return (all[resource]?.state.writes ?? {}) as unknown as Record<string, DemoWrite>;
}

/** Records a write once; `created=false` when the approval already wrote (idempotent retry). */
export async function recordDemoWrite<T extends DemoWrite>(
  deps: DemoAdapterDeps,
  ctx: ProviderContext,
  resource: 'mail' | 'calendar' | 'tasks',
  key: string,
  item: T,
): Promise<{ created: boolean; item: T }> {
  const out = await deps.store.demoRecordWrite(
    ctx.account.connectedAccountId,
    resource,
    key,
    item as unknown as Record<string, unknown>,
  );
  return { created: out.created, item: out.item as unknown as T };
}
