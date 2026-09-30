/**
 * Push watches (API_CONTRACTS JOB-07 `watch_renewal`, JOB-08 `reconciliation`, JOB-09
 * `provider_webhook`; INTEGRATION_PLAN §3.10–§3.12, §5.4) over the memory integration store with
 * recording provider adapters: TEST_PLAN IT-SYNC-07 (Gmail watch renewal), IT-SYNC-10 (calendar
 * channel renewal), IT-SYNC-14 (Graph lifecycle: reauthorize / recreate / missed → reconciliation),
 * IT-SYNC-02 (webhook → coalesced sync) and IT-SYNC-18 (no push configuration → polling).
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import {
  type CalendarProvider,
  type MailProvider,
  type OAuthProvider,
  ProviderError,
  type WatchHandle,
} from '@da/domain';
import { encryptToken } from '../../crypto/token-cipher.ts';
import { JobError } from '../../jobs/types.ts';
import { integrationHarness, type IntegrationHarness } from '../../testing/integrations.ts';
import { USER_A } from '../../testing/jwt.ts';
import type { SyncRun } from './sync-common.ts';
import type { AccountRecord } from './types.ts';
import { runProviderWebhook, runReconciliation, runWatchRenewal } from './watches.ts';

const EXPIRES = '2026-10-01T07:30:00.000Z';

interface Recorder {
  calls: string[];
  fail: Partial<Record<'watch' | 'renew' | 'stop' | 'reauth', ProviderError>>;
}

function fakeAdapters(rec: Recorder) {
  let n = 0;
  const handle = (resourceKey: string): WatchHandle => ({
    resource: 'x',
    resourceKey,
    watchId: `w-${String(++n)}`,
    providerResourceId: `res-${String(n)}`,
    expiresAt: EXPIRES,
    tokenHash: 'ab'.repeat(32),
  });
  const run = (op: keyof Recorder['fail'], label: string): Promise<void> => {
    rec.calls.push(label);
    const f = rec.fail[op];
    return f === undefined ? Promise.resolve() : Promise.reject(f);
  };
  const watcher = {
    async watch(_ctx: unknown, key: string) {
      await run('watch', `watch:${key}`);
      return handle(key);
    },
    async renewWatch(_ctx: unknown, h: WatchHandle) {
      await run('renew', `renew:${h.watchId}`);
      return { ...h, expiresAt: '2026-10-02T07:30:00.000Z' };
    },
    async stopWatch(_ctx: unknown, h: WatchHandle) {
      await run('stop', `stop:${h.watchId}:${h.resourceKey}`);
    },
    async reauthorizeWatch(_ctx: unknown, h: WatchHandle) {
      await run('reauth', `reauth:${h.watchId}`);
    },
  };
  const oauth = {
    capabilitiesFromGrantedScope: () => ['mail_read', 'calendar_read'],
    refresh: () => Promise.reject(new Error('no refresh in tests')),
  } as unknown as OAuthProvider;
  return {
    available: () => ['google', 'microsoft'] as ('google' | 'microsoft')[],
    resolve: () => ({
      oauth,
      mail: watcher as unknown as MailProvider,
      calendar: watcher as unknown as CalendarProvider,
    }),
  };
}

async function setup(
  provider: 'google' | 'microsoft' = 'google',
  status: AccountRecord['status'] = 'healthy',
) {
  const h = await integrationHarness();
  const rec: Recorder = { calls: [], fail: {} };
  const rt = { ...h.runtime, providers: fakeAdapters(rec) };
  const account = h.store.addAccount({
    user_id: USER_A,
    provider,
    status,
    account_email: provider === 'google' ? 'yunus@gmail.com' : 'yunus@contoso.example',
    capabilities_granted: ['mail_read', 'calendar_read'],
  });
  const run: SyncRun = {
    rt,
    owner: 'job:test',
    correlationId: 'corr-w',
    log: h.runtime.log,
    deadline: Date.now() + 60_000,
  };
  return { h, rec, run, account };
}

async function calendarOf(h: IntegrationHarness, account: AccountRecord, selected = true) {
  await h.store.upsertCalendars(account.id, [
    {
      provider_calendar_id: 'primary',
      name: 'Takvim',
      color: null,
      time_zone: 'Europe/Istanbul',
      access_role: 'owner',
      is_primary: true,
      can_write: true,
      kind: 'default',
    },
  ] as never);
  const cal = [...h.store.calendars.values()].find((c) => c.connected_account_id === account.id)!;
  cal.selected = selected;
  return cal;
}

Deno.test(
  'watch renewal (IT-SYNC-07): a Gmail watch is created, stored with history id and renewed a day early',
  async () => {
    const { h, rec, run, account } = await setup();
    assertEquals(
      await runWatchRenewal(run, {
        connected_account_id: account.id,
        resource: 'gmail',
        mode: 'create',
      }),
      { created: true },
    );
    const state = [...h.store.syncStates.values()].find((s) => s.resource === 'gmail_mailbox')!;
    assertEquals(
      [
        state.watch_kind,
        state.watch_id,
        state.watch_history_id,
        state.watch_resource_id,
        state.watch_expires_at,
      ],
      ['gmail_watch', 'w-1', 'res-1', null, EXPIRES],
    );
    assertEquals(
      state.watch_renew_after,
      '2026-09-25T07:30:00.000Z',
      'renewal is due a day after now, well before expiry',
    );
    assertEquals(await runWatchRenewal(run, { sync_state_id: state.id, mode: 'create' }), {
      skipped: 'already_watching',
    });
    assertEquals(await runWatchRenewal(run, { sync_state_id: state.id }), { renewed: true });
    assertEquals(h.store.syncStates.get(state.id)?.watch_expires_at, '2026-10-02T07:30:00.000Z');
    assertEquals(rec.calls, ['watch:inbox', 'renew:w-1']);
  },
);

Deno.test(
  'watch renewal (IT-SYNC-10): a calendar channel follows its calendar; deselect stops it',
  async () => {
    const { h, rec, run, account } = await setup();
    const cal = await calendarOf(h, account);
    assertEquals(
      await runWatchRenewal(run, {
        connected_account_id: account.id,
        resource: 'gcal_channel',
        calendar_id: cal.id,
        mode: 'renew',
      }),
      { created: true },
    );
    const state = [...h.store.syncStates.values()].find((s) => s.resource === 'google_calendar')!;
    assertEquals(
      [state.watch_kind, state.watch_resource_id, state.calendar_id],
      ['gcal_channel', 'res-1', cal.id],
    );
    cal.selected = false;
    assertEquals(await runWatchRenewal(run, { sync_state_id: state.id }), { stopped: true });
    assertEquals(rec.calls, ['watch:primary', 'stop:w-1:primary']);
    const cleared = h.store.syncStates.get(state.id)!;
    assertEquals(
      [cleared.watch_kind, cleared.watch_id, cleared.watch_expires_at],
      ['none', null, null],
    );
    // Stopping again has nothing to stop.
    assertEquals(await runWatchRenewal(run, { sync_state_id: state.id, mode: 'stop' }), {
      stopped: true,
    });
    assertEquals(rec.calls.length, 2);
  },
);

Deno.test(
  'watch renewal: guard rails — missing ids, inactive or demo accounts, foreign calendars',
  async () => {
    const { h, run, account } = await setup();
    assertEquals(await runWatchRenewal(run, {}), { skipped: 'no_account' });
    assertEquals(await runWatchRenewal(run, { sync_state_id: crypto.randomUUID() }), {
      skipped: 'sync_state_gone',
    });
    assertEquals(
      await runWatchRenewal(run, { connected_account_id: crypto.randomUUID(), resource: 'gmail' }),
      { skipped: 'account_gone' },
    );
    assertEquals(await runWatchRenewal(run, { connected_account_id: account.id }), {
      skipped: 'no_resource',
    });
    assertEquals(
      await runWatchRenewal(run, { connected_account_id: account.id, resource: 'gcal_channel' }),
      { skipped: 'no_calendar' },
    );
    assertEquals(
      await runWatchRenewal(run, {
        connected_account_id: account.id,
        resource: 'graph_calendar',
        calendar_id: crypto.randomUUID(),
      }),
      { skipped: 'calendar_gone' },
    );
    const other = h.store.addAccount({ user_id: USER_A, provider: 'google', status: 'healthy' });
    const foreign = await calendarOf(h, other);
    assertEquals(
      await runWatchRenewal(run, {
        connected_account_id: account.id,
        resource: 'gcal_channel',
        calendar_id: foreign.id,
      }),
      { skipped: 'calendar_gone' },
    );

    const reauth = await setup('google', 'needs_reauth');
    assertEquals(
      await runWatchRenewal(reauth.run, {
        connected_account_id: reauth.account.id,
        resource: 'gmail',
      }),
      { skipped: 'account_needs_reauth' },
    );
    const demo = h.store.addAccount({ user_id: USER_A, provider: 'demo', status: 'healthy' });
    assertEquals(await runWatchRenewal(run, { connected_account_id: demo.id, resource: 'gmail' }), {
      skipped: 'demo_polls',
    });
    const tasksState = await h.store.ensureSyncState({
      userId: USER_A,
      accountId: account.id,
      resource: 'google_tasks',
      resourceKey: 'l1',
    } as never);
    assertEquals(await runWatchRenewal(run, { sync_state_id: tasksState.id }), {
      skipped: 'not_watchable',
    });
  },
);

Deno.test(
  'watch renewal: an expired channel (404 on renew) is recreated; other provider errors fail the job',
  async () => {
    const { h, rec, run, account } = await setup('microsoft');
    await runWatchRenewal(run, {
      connected_account_id: account.id,
      resource: 'graph_mail_inbox',
      mode: 'create',
    });
    const state = [...h.store.syncStates.values()].find((s) => s.resource === 'graph_mail_inbox')!;
    assertEquals(state.watch_kind, 'graph_subscription');
    rec.fail.renew = new ProviderError('not_found', 404, null, 'ResourceNotFound');
    assertEquals(await runWatchRenewal(run, { sync_state_id: state.id }), { renewed: true });
    assertEquals(rec.calls, ['watch:inbox', 'renew:w-1', 'watch:inbox']);
    rec.fail.renew = new ProviderError('auth_invalid_grant', 400, null, 'invalid_grant');
    await assertRejects(() => runWatchRenewal(run, { sync_state_id: state.id }), JobError);
    assertEquals(h.store.accounts.get(account.id)?.status, 'needs_reauth');
  },
);

Deno.test(
  'watch renewal (IT-SYNC-18): without push configuration the resource is polled instead',
  async () => {
    const { h, rec, run, account } = await setup();
    rec.fail.watch = new ProviderError(
      'external_credential_required',
      null,
      null,
      'pubsub_not_configured',
    );
    assertEquals(
      await runWatchRenewal(run, {
        connected_account_id: account.id,
        resource: 'gmail',
        mode: 'create',
      }),
      { skipped: 'not_configured' },
    );
    const polls = [...h.jobs.jobs.values()].filter((j) => j.type === 'gmail_sync');
    assertEquals(polls.length, 1);
    assert(
      Date.parse(polls[0]!.run_after) > h.runtime.now().getTime(),
      'the poll is scheduled in the future',
    );
  },
);

Deno.test(
  'watch renewal (IT-SYNC-14): reauthorize at most once per 10 minutes; recreate resyncs the folder',
  async () => {
    const { h, rec, run, account } = await setup('microsoft');
    await runWatchRenewal(run, {
      connected_account_id: account.id,
      resource: 'graph_mail_sent',
      mode: 'create',
    });
    const state = [...h.store.syncStates.values()].find(
      (s) => s.resource === 'graph_mail_sentitems',
    )!;
    assertEquals(rec.calls, ['watch:sentitems']);
    assertEquals(await runWatchRenewal(run, { sync_state_id: state.id, mode: 'reauthorize' }), {
      reauthorized: true,
    });
    assertEquals(rec.calls.slice(1), ['reauth:w-1', 'renew:w-1']);
    assertEquals(await runWatchRenewal(run, { sync_state_id: state.id, mode: 'reauthorize' }), {
      skipped: 'reauth_guard',
    });
    h.setNow(new Date(h.runtime.now().getTime() + 11 * 60_000));
    assertEquals(await runWatchRenewal(run, { sync_state_id: state.id, mode: 'reauthorize' }), {
      reauthorized: true,
    });

    assertEquals(await runWatchRenewal(run, { sync_state_id: state.id, mode: 'recreate' }), {
      recreated: true,
    });
    assertEquals(rec.calls.slice(-2), ['stop:w-1:sentitems', 'watch:sentitems']);
    const resync = [...h.jobs.jobs.values()].filter((j) => j.type === 'outlook_sync');
    assertEquals(resync.length, 1);
    assertEquals((resync[0]!.payload as { folder?: string }).folder, 'sentitems');
    // A stop of a subscription Graph already removed is not an error.
    rec.fail.stop = new ProviderError('not_found', 404, null, null);
    assertEquals(await runWatchRenewal(run, { sync_state_id: state.id, mode: 'stop' }), {
      stopped: true,
    });
  },
);

async function credentials(h: IntegrationHarness, account: AccountRecord) {
  for (const kind of ['refresh', 'access'] as const) {
    await h.store.saveCredential(account, {
      kind,
      token: await encryptToken(h.keyring, `${kind}-token`, {
        account: account.id,
        provider: account.provider,
        kind,
      }),
      accessExpiresAt:
        kind === 'access' ? new Date(h.runtime.now().getTime() + 3_600_000).toISOString() : null,
      scopeSnapshot: null,
    });
  }
}

Deno.test(
  'reconciliation (JOB-08): token health, missing/expiring watches, orphan channels, stale catch-up',
  async () => {
    const { h, run, account } = await setup();
    await credentials(h, account);
    const now = h.runtime.now();
    const mailbox = await h.store.ensureSyncState({
      userId: USER_A,
      accountId: account.id,
      resource: 'gmail_mailbox',
      resourceKey: '',
    });
    await h.store.updateSyncState(mailbox.id, {
      watch_kind: 'gmail_watch',
      watch_id: 'g1',
      watch_expires_at: new Date(now.getTime() + 3_600_000).toISOString(),
      last_success_at: now.toISOString(),
    });
    const selected = await calendarOf(h, account);
    await h.store.ensureSyncState({
      userId: USER_A,
      accountId: account.id,
      resource: 'google_calendar',
      resourceKey: selected.id,
      calendarId: selected.id,
    });
    await h.store.upsertCalendars(account.id, [
      {
        provider_calendar_id: 'team',
        name: 'Ekip',
        color: null,
        time_zone: null,
        access_role: 'writer',
        is_primary: false,
        can_write: true,
        kind: 'other',
      },
    ] as never);
    const team = [...h.store.calendars.values()].find((c) => c.provider_calendar_id === 'team')!;
    team.selected = false;
    const orphan = await h.store.ensureSyncState({
      userId: USER_A,
      accountId: account.id,
      resource: 'google_calendar',
      resourceKey: team.id,
      calendarId: team.id,
    });
    await h.store.updateSyncState(orphan.id, {
      watch_kind: 'gcal_channel',
      watch_id: 'c-old',
      watch_expires_at: EXPIRES,
    });

    const result = await runReconciliation(run, { connected_account_id: account.id });
    assertEquals(result, {
      reason: 'daily',
      orphans_stopped: 1,
      watches_enqueued: 2,
      sync_calendar: true,
    });
    const watches = [...h.jobs.jobs.values()]
      .filter((j) => j.type === 'watch_renewal')
      .map((j) => j.payload as { resource: string; mode: string });
    assertEquals(watches.map((w) => `${w.resource}:${w.mode}`).sort(), [
      'gcal_channel:create',
      'gcal_channel:stop',
      'gmail:renew',
    ]);
    assertEquals(
      [...h.jobs.jobs.values()].filter((j) => j.type === 'calendar_sync').length,
      1,
      'the never-synced calendar is caught up',
    );

    const missed = (await runReconciliation(run, {
      account_id: account.id,
      reason: 'missed',
    })) as Record<string, unknown>;
    assertEquals([missed.reason, missed.sync_mail, missed.sync_calendar], ['missed', true, true]);
    assertEquals(await runReconciliation(run, {}), { skipped: 'no_account' });
    const gone = await runReconciliation(run, { connected_account_id: crypto.randomUUID() });
    assertEquals(gone, { skipped: 'account_gone' });
  },
);

Deno.test(
  'reconciliation: a lost refresh token fails the job with the reauth mapping',
  async () => {
    const { h, run, account } = await setup();
    await assertRejects(
      () => runReconciliation(run, { connected_account_id: account.id }),
      JobError,
    );
    assert(['needs_reauth', 'error'].includes(h.store.accounts.get(account.id)?.status ?? ''));
  },
);

Deno.test(
  'provider webhook (IT-SYNC-02/14): events become coalesced syncs, watch jobs or reconciliation',
  async () => {
    const { h, run, account } = await setup('microsoft');
    const marks: string[] = [];
    const mark = (id: string, status: string, jobId: string | null) => {
      marks.push(`${id}:${status}:${jobId === null ? 'null' : 'job'}`);
      return Promise.resolve();
    };
    const hook = (source: string, data: Record<string, unknown>) =>
      runProviderWebhook(
        run,
        {
          webhook_event_id: `we-${source}`,
          source,
          connected_account_id: account.id,
          data,
        } as never,
        mark,
      );

    assert('job_id' in ((await hook('gmail_pubsub', { history_id: '123' })) ?? {}));
    assert('job_id' in ((await hook('gcal_channel', { calendar_id: 'cal' })) ?? {}));
    await hook('graph_notification', { folder: 'sentitems' });
    await hook('graph_notification', { calendar_id: 'cal2' });
    const types = [...h.jobs.jobs.values()].map((j) => j.type);
    assert(types.includes('outlook_sync') && types.includes('calendar_sync'));

    await runWatchRenewal(run, {
      connected_account_id: account.id,
      resource: 'graph_mail_inbox',
      mode: 'create',
    });
    const state = [...h.store.syncStates.values()].find((s) => s.resource === 'graph_mail_inbox')!;
    await hook('graph_lifecycle', {
      lifecycle_event: 'reauthorizationRequired',
      sync_state_id: state.id,
    });
    await hook('graph_lifecycle', {
      lifecycle_event: 'subscriptionRemoved',
      sync_state_id: state.id,
    });
    await hook('graph_lifecycle', { lifecycle_event: 'missed' });
    const modes = [...h.jobs.jobs.values()]
      .filter((j) => j.type === 'watch_renewal')
      .map((j) => (j.payload as { mode: string }).mode);
    assertEquals(modes.sort(), ['reauthorize', 'recreate']);
    const reasons = [...h.jobs.jobs.values()]
      .filter((j) => j.type === 'reconciliation')
      .map((j) => (j.payload as { reason: string }).reason);
    assertEquals(reasons.sort(), ['missed', 'subscription_removed']);
    assertEquals(h.pokes.filter((p) => p === 'provider_webhook').length, 7);
    assert(marks.every((m) => m.endsWith(':enqueued:job')));

    const inactive = await setup('microsoft', 'disconnected');
    const out = await runProviderWebhook(
      inactive.run,
      {
        webhook_event_id: 'we-x',
        source: 'gmail_pubsub',
        connected_account_id: inactive.account.id,
        data: {},
      },
      mark,
    );
    assertEquals(out, { skipped: 'account_disconnected' });
    assertEquals(marks.at(-1), 'we-x:ignored:null');
  },
);
