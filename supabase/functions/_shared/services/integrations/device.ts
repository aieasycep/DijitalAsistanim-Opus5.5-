/**
 * Device calendar ingest (API_CONTRACTS API-INT-06, JOB-06; ADR-07; T-4.11). Apple EventKit /
 * Android CalendarContract calendars (and Apple Reminders) are read on the device; the app uploads a
 * minimal normalised snapshot. The accepted snapshot is staged (`private.device_snapshot_uploads`,
 * keyed by content hash, because `jobs.payload` holds ≤ 8 KiB) and `device_calendar_ingest` applies
 * it once: calendars upserted by hash, unselected / over-limit calendars dropped, a window diff of
 * events, reminders → tasks, and non-allow-listed meeting URLs stripped.
 */
import type { Capability } from '@da/domain';
import { AppError } from '../../errors.ts';
import type { JobResult } from '../../jobs/types.ts';
import { enqueueInsightRefresh, jobRef, type JobRefData } from './enqueue.ts';
import { conferenceUrlOf } from './rows.ts';
import type { IntegrationRuntime } from './runtime.ts';

export interface DeviceSnapshot {
  readonly snapshot_id: string;
  readonly provider: 'apple_device' | 'android_device';
  readonly installation_id: string;
  readonly window: { readonly start: string; readonly end: string };
  readonly snapshot_at: string;
  readonly content_hash: string;
  readonly calendars: readonly {
    device_calendar_hash: string;
    title: string;
    source_title: string;
    color: string | null;
    allows_modifications: boolean;
    selected: boolean;
  }[];
  readonly events: readonly {
    event_key_hash: string;
    device_calendar_hash: string;
    title: string;
    start_at: string;
    end_at: string;
    all_day: boolean;
    location: string | null;
    attendee_count: number;
    organizer_is_self: boolean | null;
    meeting_url: string | null;
    status: 'confirmed' | 'tentative' | 'cancelled';
    last_modified_at: string | null;
  }[];
  readonly reminders?: readonly {
    reminder_key_hash: string;
    list_hash: string;
    title: string;
    due_at: string | null;
    completed: boolean;
  }[];
}

export interface SnapshotAccepted {
  readonly job: JobRefData;
  readonly connected_account_id: string;
}

/** API-INT-06. */
export async function acceptDeviceSnapshot(
  rt: IntegrationRuntime,
  input: { userId: string; snapshot: DeviceSnapshot; correlationId: string },
): Promise<SnapshotAccepted> {
  const s = input.snapshot;
  const capabilities: Capability[] =
    s.provider === 'apple_device' && s.reminders !== undefined
      ? ['calendar_read', 'tasks_read']
      : ['calendar_read'];
  const { accountId, created } = await rt.store.upsertDeviceAccount(
    input.userId,
    s.provider,
    s.installation_id,
    capabilities,
  );
  const sanitized: DeviceSnapshot = {
    ...s,
    events: s.events.map((e) => ({ ...e, meeting_url: conferenceUrlOf(e.meeting_url) })),
  };
  await rt.store.stageDeviceSnapshot(accountId, sanitized as unknown as Record<string, unknown>);
  const jobId = await rt.enqueue({
    type: 'device_calendar_ingest',
    idempotencyKey: `device_ingest:${accountId}:${s.content_hash}`,
    payload: {
      connected_account_id: accountId,
      content_hash: s.content_hash,
      snapshot_id: s.snapshot_id,
    },
    userId: input.userId,
    accountId,
    priority: 40,
    maxAttempts: 4,
    correlationId: input.correlationId,
  });
  if (created) {
    await rt.audit.append({
      actorType: 'user',
      actorId: input.userId,
      action: 'user.integration.connected',
      targetType: 'connected_account',
      targetId: accountId,
      targetUserId: input.userId,
      result: 'success',
      details: { provider: s.provider },
      correlationId: input.correlationId,
    });
  }
  await rt.poke('device_calendar_ingest');
  const statuses = await rt.store.jobStatuses([jobId]);
  return { job: jobRef(jobId, statuses[0]?.status ?? 'queued'), connected_account_id: accountId };
}

export interface DeviceIngestPayload {
  readonly connected_account_id: string;
  readonly content_hash: string;
  readonly snapshot_id?: string;
}

/** JOB-06. */
export async function runDeviceIngest(
  rt: IntegrationRuntime,
  payload: DeviceIngestPayload,
): Promise<JobResult> {
  const account = await rt.store.getAccount(payload.connected_account_id);
  if (account === null) return { skipped: 'account_gone' };
  if (account.status === 'disconnected') return { skipped: 'account_disconnected' };
  if (account.provider !== 'apple_device' && account.provider !== 'android_device') {
    throw new AppError('VALIDATION_FAILED', { details: { reason: 'not_a_device_account' } });
  }
  const result = await rt.store.applyStagedDeviceSnapshot(account.id, payload.content_hash);
  if (result.skipped === undefined)
    await enqueueInsightRefresh(rt, account, 'calendar', 'device_calendar_ingest');
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(result)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    )
      out[key] = value;
  }
  return out;
}
