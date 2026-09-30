import { z } from 'zod';

/*
 * WH-03 · POST /webhooks-microsoft/notifications and WH-04 · POST /webhooks-microsoft/lifecycle
 * (docs/API_CONTRACTS.md §10). A request carrying `?validationToken=` is the subscription handshake:
 * the function answers 200 `text/plain` with the URL-decoded token and does nothing else. Otherwise
 * every item's `clientState` is hashed and compared (constant time) with the stored hash.
 */

/** Query of the validation handshake (both endpoints). */
export const GraphValidationQuery = z.object({ validationToken: z.string().min(1).max(1024) });

export const GraphChangeNotification = z.object({
  subscriptionId: z.string().max(128),
  subscriptionExpirationDateTime: z.string(),
  changeType: z.enum(['created', 'updated', 'deleted']),
  resource: z.string().max(1024),
  clientState: z.string().max(128).optional(),
  tenantId: z.string().optional(),
  resourceData: z.looseObject({ id: z.string().max(512).optional() }).optional(),
});
export type GraphChangeNotification = z.infer<typeof GraphChangeNotification>;

export const GraphNotificationBody = z.object({
  value: z.array(GraphChangeNotification).max(1000),
});
export type GraphNotificationBody = z.infer<typeof GraphNotificationBody>;

export const GraphLifecycleEvent = z.enum([
  'reauthorizationRequired',
  'subscriptionRemoved',
  'missed',
]);
export const GraphLifecycleNotification = z.object({
  lifecycleEvent: GraphLifecycleEvent,
  subscriptionId: z.string().max(128),
  clientState: z.string().max(128).optional(),
  subscriptionExpirationDateTime: z.string(),
  tenantId: z.string().optional(),
  resource: z.string().max(1024).optional(),
});
export type GraphLifecycleNotification = z.infer<typeof GraphLifecycleNotification>;

export const GraphLifecycleBody = z.object({
  value: z.array(GraphLifecycleNotification).max(1000),
});
export type GraphLifecycleBody = z.infer<typeof GraphLifecycleBody>;

/** The resource family a change notification refers to (mail folder or calendar). */
export type GraphResourceKind = 'inbox' | 'sentitems' | 'events' | 'other';

/** Classifies a Graph `resource` path, e.g. `me/mailFolders('inbox')/messages` → `inbox`. */
export function graphResourceKind(resource: string): GraphResourceKind {
  const lower = resource.toLowerCase();
  if (/mailfolders\('?inbox'?\)/.test(lower)) return 'inbox';
  if (/mailfolders\('?sentitems'?\)/.test(lower)) return 'sentitems';
  if (/\/events\b|calendarview/.test(lower)) return 'events';
  return 'other';
}

/** Jobs a lifecycle event maps to (WH-04). */
export const GRAPH_LIFECYCLE_ACTIONS: Readonly<
  Record<
    z.infer<typeof GraphLifecycleEvent>,
    readonly { job: 'watch_renewal' | 'reconciliation'; mode: string }[]
  >
> = {
  reauthorizationRequired: [{ job: 'watch_renewal', mode: 'reauthorize' }],
  subscriptionRemoved: [
    { job: 'watch_renewal', mode: 'recreate' },
    { job: 'reconciliation', mode: 'subscription_removed' },
  ],
  missed: [{ job: 'reconciliation', mode: 'missed' }],
};
