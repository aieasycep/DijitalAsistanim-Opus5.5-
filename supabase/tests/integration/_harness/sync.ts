/** Sync helpers: seeded connects, Pub/Sub pushes, Graph notifications and sync-state readers. */
import { assertEquals } from '@std/assert';
import { call, drain, env, mock, one, q, releaseJobs, type TestUser } from './mod.ts';
import { connect } from './flows.ts';

export const MAILBOX = 'gmail/mailbox_canon.json';

/** Connects Google with the canon mailbox (and optional calendar events) and drains the first pass. */
export async function syncedGoogle(
  user: TestUser,
  capabilities: string[] = ['mail_read'],
  options: {
    mailbox?: string[];
    events?: Record<string, unknown>[];
    drainTypes?: string[];
    overrides?: Record<string, string | undefined>;
  } = {},
): Promise<string> {
  await mock.google({ op: 'mailbox', fixtures: options.mailbox ?? [MAILBOX] });
  if (options.events !== undefined) await mock.google({ op: 'events', events: options.events });
  const { accountId } = await connect(user, 'google', capabilities);
  await releaseJobs();
  await drain({
    ...(options.drainTypes === undefined ? {} : { types: options.drainTypes }),
    ...(options.overrides === undefined ? {} : { overrides: options.overrides }),
  });
  return accountId;
}

export async function syncedMicrosoft(
  user: TestUser,
  capabilities: string[] = ['mail_read'],
  options: { drainTypes?: string[] } = {},
): Promise<string> {
  const { accountId } = await connect(user, 'microsoft', capabilities);
  await releaseJobs();
  await drain(options.drainTypes === undefined ? {} : { types: options.drainTypes });
  return accountId;
}

/** WH-01: an authenticated Pub/Sub push for the mailbox at its current history id. */
export async function gmailPush(
  email: string,
  historyId: number | string,
  messageId = crypto.randomUUID(),
): Promise<Response> {
  const { token } = await mock.google<{ token: string }>({
    op: 'pubsub_token',
    audience: env('GOOGLE_PUBSUB_PUSH_AUDIENCE'),
    email: env('GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT'),
  });
  const data = btoa(JSON.stringify({ emailAddress: email, historyId: Number(historyId) }));
  return await call('webhooks-google', 'POST', '/gmail', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    rawBody: JSON.stringify({
      message: { data, messageId, message_id: messageId, publishTime: new Date().toISOString() },
      subscription: 'projects/da-integration-test/subscriptions/gmail-push',
    }),
  });
}

export async function mailboxState(): Promise<{ history_id: number; messages: { id: string }[] }> {
  return await mock.google({ op: 'state' });
}

export async function syncState(
  accountId: string,
  resource: string,
): Promise<Record<string, unknown>> {
  return await one(
    `select * from public.sync_states where connected_account_id = $1 and resource = $2 order by created_at limit 1`,
    [accountId, resource],
  );
}

export async function messagesOf(accountId: string): Promise<Record<string, unknown>[]> {
  return await q(
    `select * from public.email_messages where connected_account_id = $1 order by received_at`,
    [accountId],
  );
}

export async function accountEmail(accountId: string): Promise<string> {
  const row = await one<{ account_email: string }>(
    `select account_email from public.connected_accounts where id = $1`,
    [accountId],
  );
  return row.account_email;
}

export async function pushAndDrain(accountId: string): Promise<void> {
  const state = await mailboxState();
  const res = await gmailPush(await accountEmail(accountId), state.history_id);
  await res.body?.cancel();
  assertEquals(res.status, 204);
  await releaseJobs();
  await drain();
}
