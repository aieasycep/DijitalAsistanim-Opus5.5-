/** Approval helpers (API-APR-01…05, API-MAIL-02/05): drafts, proposals, approvals and execution. */
import { assertEquals } from '@std/assert';
import { call, db, drain, json, one, q, releaseJobs, type TestUser } from './mod.ts';
import { syncedGoogle, syncedMicrosoft } from './sync.ts';

export const AHMET = '18f2a0c1d0000001';

export interface MailSetup {
  readonly accountId: string;
  readonly messageId: string;
  readonly threadId: string;
}

/** A Google (or Microsoft) account with the canon mailbox synced; the Ahmet message is the target. */
export async function mailSetup(
  user: TestUser,
  capabilities: string[] = ['mail_read', 'mail_send'],
  provider: 'google' | 'microsoft' = 'google',
): Promise<MailSetup> {
  const accountId =
    provider === 'google'
      ? await syncedGoogle(user, capabilities)
      : await syncedMicrosoft(user, capabilities);
  const row = await one<{ id: string; thread_id: string }>(
    `select id, thread_id from public.email_messages where connected_account_id = $1 and direction = 'inbound'
      order by (provider_message_id = $2) desc, received_at desc limit 1`,
    [accountId, provider === 'google' ? AHMET : 'AAMkAGI2THVSAAA1'],
  );
  return { accountId, messageId: row.id, threadId: row.thread_id };
}

export async function draftAndSubmit(
  user: TestUser,
  messageId: string,
): Promise<{ draftId: string; approval: Record<string, unknown> }> {
  const created = await call('api', 'POST', `/mail/${messageId}/reply-drafts`, {
    jwt: user.jwt,
    key: crypto.randomUUID(),
    body: { tone: 'short' },
  });
  const draft = await json<{ data: { id: string; version: number } }>(created);
  assertEquals(created.status, 201, JSON.stringify(draft));
  const submitted = await call('api', 'POST', `/reply-drafts/${draft.data.id}/submit`, {
    jwt: user.jwt,
    key: crypto.randomUUID(),
    body: { expected_version: draft.data.version },
  });
  const out = await json<{ data: { approval: Record<string, unknown> } }>(submitted);
  assertEquals([200, 201].includes(submitted.status), true, JSON.stringify(out));
  return { draftId: draft.data.id, approval: out.data.approval };
}

export async function approve(
  user: TestUser,
  approvalId: string,
  payloadVersion: number,
  options: { via?: string; key?: string; idempotencyKey?: string; installation?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  // The body key is the approval's own `approval:{id}:v{n}` key (API-APR-03); the header is the
  // HTTP idempotency key of this request.
  const row = await q<{ idempotency_key: string }>(
    `select idempotency_key from public.approval_actions where id = $1`,
    [approvalId],
  );
  const idempotencyKey =
    options.idempotencyKey ??
    row[0]?.idempotency_key ??
    `approval:${approvalId}:v${payloadVersion}`;
  const res = await call('api', 'POST', `/approvals/${approvalId}/approve`, {
    jwt: user.jwt,
    key: options.key ?? crypto.randomUUID(),
    ...(options.installation === undefined
      ? {}
      : { headers: { 'X-DA-Installation-Id': options.installation } }),
    body: {
      idempotency_key: idempotencyKey,
      payload_version: payloadVersion,
      approved_via: options.via ?? 'approval_center',
    },
  });
  return { status: res.status, body: await json(res) };
}

export async function propose(
  user: TestUser,
  payload: Record<string, unknown>,
  options: { origin?: string; batchId?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await call('api', 'POST', '/approvals', {
    jwt: user.jwt,
    key: crypto.randomUUID(),
    body: {
      payload,
      origin: options.origin ?? 'manual',
      origin_ref_id: null,
      ...(options.batchId === undefined ? {} : { batch_id: options.batchId }),
    },
  });
  return { status: res.status, body: await json(res) };
}

export async function approval(id: string): Promise<Record<string, unknown>> {
  return await one(`select * from public.approval_actions where id = $1`, [id]);
}

export async function transitions(id: string): Promise<string[]> {
  const rows = await q<{ from_status: string | null; to_status: string }>(
    `select from_status, to_status from public.approval_events where approval_action_id = $1 order by created_at, id`,
    [id],
  );
  return rows.map((r) => `${r.from_status ?? '∅'}→${r.to_status}`);
}

export async function execute(): Promise<void> {
  await releaseJobs();
  await drain();
}

/** A provider calendar target (Google or Microsoft) with the default calendar synced. */
export async function calendarSetup(
  user: TestUser,
  provider: 'google' | 'microsoft' = 'google',
  capabilities: string[] = ['calendar_read', 'calendar_write'],
): Promise<{ accountId: string; calendarId: string }> {
  const accountId =
    provider === 'google'
      ? await syncedGoogle(user, capabilities, { mailbox: [] })
      : await syncedMicrosoft(user, capabilities);
  const cal = await one<{ id: string }>(
    `select id from public.calendars where connected_account_id = $1 order by is_primary desc limit 1`,
    [accountId],
  );
  return { accountId, calendarId: cal.id };
}

/** A tasks-capable account (Google Tasks or To Do) with its default list synced. */
export async function tasksSetup(
  user: TestUser,
  provider: 'google' | 'microsoft',
): Promise<{ accountId: string; listId: string }> {
  const accountId =
    provider === 'google'
      ? await syncedGoogle(user, ['tasks_read', 'tasks_write'], { mailbox: [] })
      : await syncedMicrosoft(user, ['tasks_read', 'tasks_write']);
  const list = await one<{ resource_key: string }>(
    `select resource_key from public.sync_states where connected_account_id = $1 and resource in ('google_tasks', 'todo_list') limit 1`,
    [accountId],
  );
  return { accountId, listId: list.resource_key };
}

export function timed(startInHours: number, minutes = 60) {
  const start = new Date(Date.now() + startInHours * 3_600_000);
  start.setUTCSeconds(0, 0);
  const end = new Date(start.getTime() + minutes * 60_000);
  return {
    kind: 'timed',
    start: start.toISOString(),
    end: end.toISOString(),
    time_zone: 'Europe/Istanbul',
  };
}

/** Puts an approval back to `executing` with its job queued again: a worker that died after the
 * provider accepted the write and before the database recorded it. */
export async function simulateCrashAfterProviderWrite(approvalId: string): Promise<void> {
  await db().begin(async (tx) => {
    await tx.unsafe(`set local da.approval_tx = 'on'`);
    await tx.unsafe(
      `update public.approval_actions set status = 'executing', executed_at = null, result = null where id = $1`,
      [approvalId],
    );
  });
  await q(
    `update public.jobs set status = 'retrying', run_after = now(), completed_at = null, result = null,
       lease_owner = null, lease_expires_at = null
      where type = 'approval_execute' and payload ->> 'approval_id' = $1`,
    [approvalId],
  );
}
