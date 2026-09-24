/**
 * Worker job definitions of the integration engine (API_CONTRACTS JOB-01…JOB-09, JOB-29;
 * IMPLEMENTATION_PLAN T-4.03…T-4.13). Payload schemas accept both the documented shapes and the
 * `scheduler_tick` shapes (`{sync_state_id}` renewals, `{sync_state_id, mode:'rebaseline'}`,
 * `{account_id, trigger:'poll'}` task polls, `{account_id}` reconciliation,
 * `{account_id, reason:'binding_expired'}` purges). A parse failure is a poison payload.
 */
import { z } from 'zod';
import { defineJob } from '../../jobs/registry.ts';
import type { JobDefinition } from '../../jobs/types.ts';
import type { WebhookLedger } from '../../webhooks/ledger.ts';
import { runDeviceIngest } from './device.ts';
import { runIntegrationPurge } from './disconnect.ts';
import type { InitialSyncPayload } from './enqueue.ts';
import type { IntegrationRuntime } from './runtime.ts';
import { runCalendarSync, runInitialCalendar } from './sync-calendar.ts';
import { syncRunOf } from './sync-common.ts';
import { runInitialMail, runMailSync } from './sync-mail.ts';
import { runInitialTasks, runTasksSync } from './sync-tasks.ts';
import { runProviderWebhook, runReconciliation, runWatchRenewal } from './watches.ts';

const Uuid = z.uuid();
const Iso = z.iso.datetime({ offset: true });

export const InitialSyncPayloadSchema = z.object({
  connected_account_id: Uuid,
  resource: z.enum(['mail', 'calendar', 'tasks']),
  phase: z.enum(['first_pass', 'backfill', 'resync']),
  window_start: Iso,
  page_token: z.string().max(2048).nullable(),
  folder: z.enum(['inbox', 'sentitems']).optional(),
  origin: z.string().max(200).optional(),
});

export const GmailSyncPayloadSchema = z.object({
  connected_account_id: Uuid,
  trigger: z.enum(['push', 'poll', 'manual', 'reconcile']),
  target_history_id: z.string().max(32).nullable().optional(),
});

export const OutlookSyncPayloadSchema = z.object({
  connected_account_id: Uuid,
  folder: z.enum(['inbox', 'sentitems', 'both']),
  trigger: z.enum(['push', 'poll', 'manual', 'reconcile']),
});

export const CalendarSyncPayloadSchema = z.union([
  z.object({
    connected_account_id: Uuid,
    calendar_id: Uuid.nullable(),
    trigger: z.enum(['push', 'poll', 'manual', 'reconcile', 'post_write']),
  }),
  z.object({ sync_state_id: Uuid, mode: z.literal('rebaseline') }),
]);

export const TasksSyncPayloadSchema = z
  .object({
    connected_account_id: Uuid.optional(),
    account_id: Uuid.optional(),
    trigger: z.enum(['poll', 'manual', 'post_write']),
  })
  .refine((p) => p.connected_account_id !== undefined || p.account_id !== undefined, {
    message: 'account_required',
  });

export const DeviceIngestPayloadSchema = z.object({
  connected_account_id: Uuid,
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  snapshot_id: Uuid.optional(),
});

export const WatchRenewalPayloadSchema = z.union([
  z.object({
    connected_account_id: Uuid,
    resource: z.enum([
      'gmail',
      'gcal_channel',
      'graph_mail_inbox',
      'graph_mail_sent',
      'graph_calendar',
    ]),
    calendar_id: Uuid.nullable(),
    mode: z.enum(['create', 'renew', 'reauthorize', 'recreate', 'stop']),
    sync_state_id: Uuid.optional(),
  }),
  z.object({
    sync_state_id: Uuid,
    mode: z.enum(['create', 'renew', 'reauthorize', 'recreate', 'stop']).optional(),
  }),
]);

export const ReconciliationPayloadSchema = z
  .object({
    connected_account_id: Uuid.optional(),
    account_id: Uuid.optional(),
    reason: z
      .enum(['daily', 'missed', 'subscription_removed', 'resync_404', 'manual', 'admin'])
      .optional(),
  })
  .refine((p) => p.connected_account_id !== undefined || p.account_id !== undefined, {
    message: 'account_required',
  });

export const ProviderWebhookPayloadSchema = z.object({
  webhook_event_id: z.string().max(40),
  source: z.enum(['gmail_pubsub', 'gcal_channel', 'graph_notification', 'graph_lifecycle']),
  connected_account_id: Uuid,
  data: z.object({
    history_id: z.string().max(32).optional(),
    calendar_id: Uuid.optional(),
    folder: z.string().max(20).optional(),
    lifecycle_event: z
      .enum(['reauthorizationRequired', 'subscriptionRemoved', 'missed'])
      .optional(),
    sync_state_id: Uuid.optional(),
  }),
});

export const IntegrationPurgePayloadSchema = z
  .object({
    connected_account_id: Uuid.optional(),
    account_id: Uuid.optional(),
    user_id: Uuid.optional(),
    purge_content: z.boolean().optional(),
    disconnected_at: Iso.optional(),
    reason: z.enum(['binding_expired', 'disconnect']).optional(),
  })
  .refine((p) => p.connected_account_id !== undefined || p.account_id !== undefined, {
    message: 'account_required',
  });

export interface IntegrationJobDeps {
  readonly runtime: IntegrationRuntime;
  readonly webhooks: WebhookLedger;
}

export function integrationJobDefinitions(deps: IntegrationJobDeps): JobDefinition<never>[] {
  const rt = deps.runtime;
  const defs = [
    defineJob({
      type: 'initial_sync',
      payload: InitialSyncPayloadSchema,
      handler: async (ctx) => {
        const run = syncRunOf(rt, ctx);
        const payload = ctx.payload as InitialSyncPayload;
        if (payload.resource === 'mail') return await runInitialMail(run, payload);
        if (payload.resource === 'calendar') return await runInitialCalendar(run, payload);
        return await runInitialTasks(run, payload);
      },
    }),
    defineJob({
      type: 'gmail_sync',
      payload: GmailSyncPayloadSchema,
      timeoutMs: 120_000,
      handler: async (ctx) => await runMailSync(syncRunOf(rt, ctx, 75_000), ctx.payload),
    }),
    defineJob({
      type: 'outlook_sync',
      payload: OutlookSyncPayloadSchema,
      timeoutMs: 120_000,
      handler: async (ctx) => await runMailSync(syncRunOf(rt, ctx, 75_000), ctx.payload),
    }),
    defineJob({
      type: 'calendar_sync',
      payload: CalendarSyncPayloadSchema,
      timeoutMs: 120_000,
      handler: async (ctx) => await runCalendarSync(syncRunOf(rt, ctx, 75_000), ctx.payload),
    }),
    defineJob({
      type: 'tasks_sync',
      payload: TasksSyncPayloadSchema,
      timeoutMs: 90_000,
      handler: async (ctx) => await runTasksSync(syncRunOf(rt, ctx, 50_000), ctx.payload),
    }),
    defineJob({
      type: 'device_calendar_ingest',
      payload: DeviceIngestPayloadSchema,
      handler: async (ctx) =>
        await runDeviceIngest({ ...rt, enqueue: (input) => ctx.enqueue(input) }, ctx.payload),
    }),
    defineJob({
      type: 'watch_renewal',
      payload: WatchRenewalPayloadSchema,
      timeoutMs: 45_000,
      handler: async (ctx) => await runWatchRenewal(syncRunOf(rt, ctx, 30_000), ctx.payload),
    }),
    defineJob({
      type: 'reconciliation',
      payload: ReconciliationPayloadSchema,
      timeoutMs: 150_000,
      handler: async (ctx) => await runReconciliation(syncRunOf(rt, ctx, 100_000), ctx.payload),
    }),
    defineJob({
      type: 'provider_webhook',
      payload: ProviderWebhookPayloadSchema,
      timeoutMs: 20_000,
      handler: async (ctx) =>
        await runProviderWebhook(syncRunOf(rt, ctx, 10_000), ctx.payload, (id, status, jobId) =>
          deps.webhooks.mark(id, status, jobId),
        ),
    }),
    defineJob({
      type: 'integration_purge',
      payload: IntegrationPurgePayloadSchema,
      timeoutMs: 240_000,
      handler: async (ctx) =>
        await runIntegrationPurge(rt, ctx.payload, {
          id: ctx.job.id,
          idempotencyKey: ctx.job.idempotency_key,
          correlationId: ctx.correlationId,
          log: ctx.log,
          enqueue: (input) => ctx.enqueue(input),
        }),
    }),
  ];
  return defs as unknown as JobDefinition<never>[];
}
