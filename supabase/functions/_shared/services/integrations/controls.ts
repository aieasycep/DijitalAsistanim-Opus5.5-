/**
 * Data-source controls and manual sync (API_CONTRACTS API-INT-04, API-INT-05; M§40 Data Source
 * Controls, SREQ-68, M§44 calendar limit; T-4.12). Toggles are enforced server-side: every sync job
 * re-reads them and exits `completed{skipped:'paused'}` when its resource is off, so turning a toggle
 * off stops ingestion even for jobs already queued.
 */
import type { DataSourceToggles } from '@da/validation';
import { AppError, fieldError } from '../../errors.ts';
import {
  enqueueInitialSync,
  enqueueResourceSync,
  enqueueWatch,
  jobRef,
  type JobRefData,
  type SyncResourceKind,
} from './enqueue.ts';
import type { IntegrationRuntime } from './runtime.ts';
import { summaryOf, togglesOf } from './status.ts';
import { calendarResource, mailResource, tasksResource } from './sync-common.ts';
import type { AccountRecord, CalendarRecord } from './types.ts';
import type { AccountSummary } from '@da/validation';

export type Consequence =
  | 'ingestion_paused'
  | 'summaries_disabled'
  | 'drafts_disabled'
  | 'calendar_events_hidden'
  | 'sync_started';

export interface DataSourcesInput {
  readonly userId: string;
  readonly accountId: string;
  readonly dataSources?: Partial<DataSourceToggles>;
  readonly calendars?: readonly { calendar_id: string; selected: boolean }[];
  readonly defaultWriteCalendarId?: string | null;
  readonly expectedUpdatedAt: string;
  readonly correlationId: string;
}

export interface CalendarView {
  readonly id: string;
  readonly name: string;
  readonly selected: boolean;
  readonly can_write: boolean;
  readonly is_default_write: boolean;
  readonly color: string | null;
}

export interface DataSourcesResult {
  readonly account: AccountSummary;
  readonly calendars: CalendarView[];
  readonly consequences: Consequence[];
}

const READ_RESOURCE: Readonly<
  Record<'mail_read' | 'calendar_read' | 'tasks_read', SyncResourceKind>
> = {
  mail_read: 'mail',
  calendar_read: 'calendar',
  tasks_read: 'tasks',
};

async function ownedAccount(
  rt: IntegrationRuntime,
  userId: string,
  accountId: string,
): Promise<AccountRecord> {
  const account = await rt.store.getAccount(accountId);
  if (account === null || account.user_id !== userId || account.status === 'connecting') {
    throw new AppError('NOT_FOUND', { details: { resource: 'connected_account' } });
  }
  return account;
}

export async function calendarViews(
  rt: IntegrationRuntime,
  account: AccountRecord,
): Promise<CalendarView[]> {
  const defaultId = await rt.store.defaultWriteCalendar(account.user_id);
  return (await rt.store.listCalendars(account.id)).map((c) => ({
    id: c.id,
    name: c.name,
    selected: c.selected,
    can_write: c.can_write,
    is_default_write: c.id === defaultId,
    color: c.color,
  }));
}

async function setPausedStates(
  rt: IntegrationRuntime,
  account: AccountRecord,
  resource: SyncResourceKind,
  paused: boolean,
): Promise<void> {
  const names =
    resource === 'mail'
      ? [mailResource(account.provider, 'inbox'), mailResource(account.provider, 'sentitems')]
      : resource === 'calendar'
        ? [calendarResource(account.provider)]
        : [tasksResource(account.provider)];
  for (const state of await rt.store.listSyncStates(account.id)) {
    if (!names.includes(state.resource)) continue;
    if (paused && state.status !== 'paused')
      await rt.store.updateSyncState(state.id, { status: 'paused' });
    if (!paused && state.status === 'paused')
      await rt.store.updateSyncState(state.id, { status: 'idle' });
  }
}

/** API-INT-05. */
export async function updateDataSources(
  rt: IntegrationRuntime,
  input: DataSourcesInput,
): Promise<DataSourcesResult> {
  const account = await ownedAccount(rt, input.userId, input.accountId);
  if (account.status === 'disconnected')
    throw new AppError('STATE_CONFLICT', { details: { reason: 'account_disconnected' } });
  if (Date.parse(account.updated_at) !== Date.parse(input.expectedUpdatedAt)) {
    throw new AppError('STATE_CONFLICT', {
      details: { reason: 'stale', current_updated_at: account.updated_at },
    });
  }
  const before = togglesOf(account);
  const after: DataSourceToggles = { ...before, ...(input.dataSources ?? {}) };
  const changedKeys = (Object.keys(after) as (keyof DataSourceToggles)[]).filter(
    (k) => after[k] !== before[k],
  );
  const consequences = new Set<Consequence>();

  // Calendar selection: validate ownership and the plan allowance before changing anything.
  const calendars = new Map(
    (await rt.store.listCalendars(account.id)).map((c) => [c.id, c] as const),
  );
  const selecting: CalendarRecord[] = [];
  const deselecting: CalendarRecord[] = [];
  for (const change of input.calendars ?? []) {
    const calendar = calendars.get(change.calendar_id);
    if (calendar === undefined)
      throw new AppError('NOT_FOUND', { details: { resource: 'calendar' } });
    if (change.selected && !calendar.selected) selecting.push(calendar);
    if (!change.selected && calendar.selected) deselecting.push(calendar);
  }
  if (selecting.length > 0) {
    const limit = await rt.store.planLimit(input.userId, 'max_calendars');
    if (limit !== null) {
      const current = await rt.store.countSelectedCalendars(input.userId);
      if (current - deselecting.length + selecting.length > limit) {
        throw new AppError('ENTITLEMENT_REQUIRED', {
          details: { feature: 'calendars', limit, current },
        });
      }
    }
  }
  for (const calendar of deselecting) await rt.store.setCalendarSelected(calendar.id, false);
  for (const calendar of selecting) await rt.store.setCalendarSelected(calendar.id, true);

  if (input.defaultWriteCalendarId !== undefined) {
    if (input.defaultWriteCalendarId === null) {
      await rt.store.setDefaultWriteCalendar(input.userId, null);
    } else {
      const target = await rt.store.getCalendar(input.defaultWriteCalendarId);
      if (target === null || target.user_id !== input.userId)
        throw new AppError('NOT_FOUND', { details: { resource: 'calendar' } });
      if (!target.selected || !target.can_write)
        throw fieldError('default_write_calendar_id', 'calendar_not_writable');
      await rt.store.setDefaultWriteCalendar(input.userId, target.id);
    }
  }

  const updated =
    changedKeys.length > 0
      ? await rt.store.updateAccount(account.id, { data_source_toggles: after })
      : account;
  const origin = `toggle:${updated.updated_at}`;
  for (const key of ['mail_read', 'calendar_read', 'tasks_read'] as const) {
    if (!changedKeys.includes(key)) continue;
    const resource = READ_RESOURCE[key];
    if (!after[key]) {
      await setPausedStates(rt, updated, resource, true);
      if (key === 'mail_read') {
        consequences.add('ingestion_paused');
        consequences.add('summaries_disabled');
      }
      if (key === 'calendar_read') consequences.add('calendar_events_hidden');
      if (key === 'tasks_read') consequences.add('ingestion_paused');
    } else if (updated.capabilities_granted.includes(key)) {
      await setPausedStates(rt, updated, resource, false);
      const folders: ('inbox' | 'sentitems' | undefined)[] =
        resource === 'mail' && updated.provider === 'microsoft'
          ? ['inbox', 'sentitems']
          : [undefined];
      for (const folder of folders) {
        await enqueueInitialSync(rt, updated, {
          resource,
          phase: 'first_pass',
          origin,
          correlationId: input.correlationId,
          ...(folder === undefined ? {} : { folder }),
        });
      }
      consequences.add('sync_started');
    }
  }
  if (changedKeys.includes('draft_replies') && !after.draft_replies)
    consequences.add('drafts_disabled');

  // Channels follow the selection: deselected calendars stop theirs, selected ones sync and watch.
  const watchResource = updated.provider === 'microsoft' ? 'graph_calendar' : 'gcal_channel';
  for (const calendar of deselecting) {
    if (updated.provider !== 'demo') {
      await enqueueWatch(rt, updated, {
        resource: watchResource,
        calendarId: calendar.id,
        mode: 'stop',
        correlationId: input.correlationId,
        bucket: origin,
      });
    }
    consequences.add('calendar_events_hidden');
  }
  if (after.calendar_read) {
    for (const calendar of selecting) {
      await enqueueResourceSync(rt, updated, 'calendar', 'manual', {
        calendarId: calendar.id,
        correlationId: input.correlationId,
      });
      if (updated.provider !== 'demo') {
        await enqueueWatch(rt, updated, {
          resource: watchResource,
          calendarId: calendar.id,
          mode: 'create',
          correlationId: input.correlationId,
          bucket: origin,
        });
      }
      consequences.add('sync_started');
    }
  }

  const changed = [
    ...changedKeys,
    ...(input.calendars !== undefined && input.calendars.length > 0 ? ['calendars'] : []),
    ...(input.defaultWriteCalendarId !== undefined ? ['default_write_calendar_id'] : []),
  ];
  if (changed.length > 0) {
    await rt.audit.append({
      actorType: 'user',
      actorId: input.userId,
      action: 'user.integration.data_sources_updated',
      targetType: 'connected_account',
      targetId: account.id,
      targetUserId: input.userId,
      result: 'success',
      details: { changed_keys: changed.join(',') },
      correlationId: input.correlationId,
    });
  }
  if (consequences.has('sync_started')) await rt.poke('integration_data_sources');
  const fresh = (await rt.store.getAccount(account.id)) ?? updated;
  return {
    account: await summaryOf(rt, fresh),
    calendars: await calendarViews(rt, fresh),
    consequences: [...consequences],
  };
}

export interface ManualSyncResult {
  readonly jobs: JobRefData[];
  readonly next_allowed_at: string;
}

/** The reasons a forced analysis ("Analiz et", M-MAIL-03) asks `email_analysis` for. */
export const FORCED_ANALYSIS_REASONS = ['summary', 'key_points', 'deadline'] as const;

/**
 * API-INT-04 body extension (`message_ids` + `force_analysis`): enqueue JOB-11 `email_analysis` for
 * those messages of this account with `force: true`, which bypasses the explicit-rule skip of
 * triage (a muted sender's mail, `t0_final` + `explicit_rule`). The AI budget still applies inside
 * the job: an exhausted budget marks the message `skipped_budget`. One forced run per message per
 * UTC day (the key), so a repeated tap returns the same job.
 */
export async function requestForcedAnalysis(
  rt: IntegrationRuntime,
  input: {
    userId: string;
    accountId: string;
    messageIds: readonly string[];
    correlationId: string;
  },
): Promise<ManualSyncResult> {
  const account = await ownedAccount(rt, input.userId, input.accountId);
  if (account.status === 'needs_reauth')
    throw new AppError('PROVIDER_REAUTH_REQUIRED', {
      details: { account_id: account.id, provider: account.provider },
    });
  if (account.status === 'disconnected')
    throw new AppError('STATE_CONFLICT', { details: { reason: 'account_disconnected' } });
  const toggles = togglesOf(account);
  if (!account.capabilities_granted.includes('mail_read') || !toggles.mail_read)
    throw new AppError('DATA_SOURCE_DISABLED', { details: { account_id: account.id } });
  const ids = [...new Set(input.messageIds)];
  for (const id of ids) {
    const message = await rt.store.getMessage(id);
    if (
      message === null ||
      message.user_id !== input.userId ||
      message.connected_account_id !== account.id ||
      message.provider_deleted_at !== null
    )
      throw new AppError('NOT_FOUND', { details: { resource: 'email_message' } });
  }
  const day = rt.now().toISOString().slice(0, 10);
  const jobIds: string[] = [];
  for (const id of ids)
    jobIds.push(
      await rt.enqueue({
        type: 'email_analysis',
        idempotencyKey: `email_analysis:${id}:force:${day}`,
        payload: {
          email_message_id: id,
          connected_account_id: account.id,
          reasons: [...FORCED_ANALYSIS_REASONS],
          force: true,
        },
        userId: input.userId,
        accountId: account.id,
        correlationId: input.correlationId,
      }),
    );
  const statuses = new Map(
    (await rt.store.jobStatuses(jobIds)).map((j) => [j.id, j.status] as const),
  );
  await rt.poke('integration_force_analysis');
  return {
    jobs: jobIds.map((id) => jobRef(id, statuses.get(id) ?? 'queued')),
    next_allowed_at: new Date(rt.now().getTime() + 60_000).toISOString(),
  };
}

/** API-INT-04 (the 1 / 60 s per-account limit is enforced by the route). */
export async function requestManualSync(
  rt: IntegrationRuntime,
  input: {
    userId: string;
    accountId: string;
    resources?: readonly SyncResourceKind[];
    correlationId: string;
  },
): Promise<ManualSyncResult> {
  const account = await ownedAccount(rt, input.userId, input.accountId);
  if (account.status === 'needs_reauth')
    throw new AppError('PROVIDER_REAUTH_REQUIRED', {
      details: { account_id: account.id, provider: account.provider },
    });
  if (account.status === 'admin_consent_required') {
    throw new AppError('PROVIDER_ADMIN_CONSENT_REQUIRED', {
      details: { account_id: account.id, provider: account.provider },
    });
  }
  if (account.status === 'disconnected')
    throw new AppError('STATE_CONFLICT', { details: { reason: 'account_disconnected' } });
  if (account.provider === 'apple_device' || account.provider === 'android_device') {
    throw fieldError('accountId', 'device_account_syncs_on_device');
  }
  const toggles = togglesOf(account);
  const wanted = input.resources ?? ['mail', 'calendar', 'tasks'];
  const allowed = wanted.filter((r) => {
    const cap = r === 'mail' ? 'mail_read' : r === 'calendar' ? 'calendar_read' : 'tasks_read';
    return account.capabilities_granted.includes(cap) && toggles[cap];
  });
  if (allowed.length === 0)
    throw new AppError('DATA_SOURCE_DISABLED', { details: { account_id: account.id } });
  const ids: string[] = [];
  for (const resource of allowed)
    ids.push(
      await enqueueResourceSync(rt, account, resource, 'manual', {
        correlationId: input.correlationId,
      }),
    );
  const statuses = new Map((await rt.store.jobStatuses(ids)).map((j) => [j.id, j.status] as const));
  await rt.poke('integration_manual_sync');
  return {
    jobs: ids.map((id) => jobRef(id, statuses.get(id) ?? 'queued')),
    next_allowed_at: new Date(rt.now().getTime() + 60_000).toISOString(),
  };
}
