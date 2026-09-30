/**
 * UT-MB-06 offline queue (T-8.23; SCREEN_AND_FLOW_MAP §0.5, Part 4 §14.2–§14.3, §14.6): FIFO per
 * scope, last write wins, one delivery per intent with a stable idempotency key, back-off on
 * network/5xx, drop and revert on a terminal 4xx, session first, user switch discards, bounds,
 * persistence across restarts, the queue class map (approvals never queued) and the app wiring
 * (reconnect replay, persisted-key refresh, legacy queue migration).
 */
import { ApiError, qk } from '@da/api-client';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';

import { logout } from '../src/lib/auth/logout';
import { DataError } from '../src/lib/postgrest';
import { getQueryClient } from '../src/lib/query/client';
import {
  QUEUE_MAX_AGE_MS,
  QUEUE_MAX_ENTRIES,
  backoffMs,
  classifyReplayError,
  createMutationQueue,
  type HandlerMap,
  type QueueStorage,
} from '../src/lib/offline/mutation-queue';
import {
  MUTATION_CLASSES,
  QUEUE_STORAGE_KEY,
  bindMutationQueue,
  flushMutationQueue,
  migrateLegacyQueues,
  onOwnRowReplayed,
  queuedMutations,
  resetMutationQueueForTests,
  runOrQueue,
} from '../src/lib/offline/mutations';
import { encryptedStorage } from '../src/lib/storage';
import { installFakeSupabase, resetAppState } from './helpers/app';
import { bootstrap, session, uuid } from './helpers/fixtures';

interface Args {
  readonly note: { readonly id: string; readonly value: string };
  readonly setting: { readonly table: string; readonly patch: Record<string, unknown> };
}

type Run = (args: unknown, key: string) => Promise<unknown>;

function memoryStorage(): QueueStorage & { value: string | undefined } {
  const store = {
    value: undefined as string | undefined,
    read: () => store.value,
    write: (next: string | null) => {
      store.value = next ?? undefined;
    },
  };
  return store;
}

function harness(
  options: {
    readonly run?: Run;
    readonly online?: () => boolean;
    readonly user?: () => string | null;
    readonly storage?: QueueStorage;
    readonly now?: () => number;
  } = {},
) {
  const calls: { kind: string; args: unknown; key: string }[] = [];
  const invalidated: unknown[] = [];
  const dropped: number[] = [];
  const replayed: unknown[] = [];
  const reverted: unknown[] = [];
  const run: Run = options.run ?? (() => Promise.resolve({ ok: true }));
  let n = 0;
  const handlers: HandlerMap<Args> = {
    note: {
      scope: (a) => `note:${a.id}`,
      run: (a, key) => {
        calls.push({ kind: 'note', args: a, key });
        return run(a, key);
      },
      invalidate: (a) => [['notes', a.id]],
      onReplayed: (a) => {
        replayed.push(a);
      },
      onDropped: (a) => {
        reverted.push(a);
      },
    },
    setting: {
      scope: (a) => `settings:${a.table}`,
      coalesceKey: (a) => `setting:${a.table}`,
      merge: (queued, next) => ({ table: next.table, patch: { ...queued.patch, ...next.patch } }),
      run: (a, key) => {
        calls.push({ kind: 'setting', args: a, key });
        return run(a, key);
      },
    },
  };
  const storage = options.storage ?? memoryStorage();
  const timers: (() => void)[] = [];
  const queue = createMutationQueue<Args>(handlers, {
    storage: () => storage,
    isOnline: options.online ?? (() => true),
    currentUserId: options.user ?? (() => uuid(1)),
    newId: () => {
      n += 1;
      return uuid(1000 + n);
    },
    ...(options.now === undefined ? {} : { now: options.now }),
    invalidate: (keys) => {
      invalidated.push(...keys);
    },
    reportDropped: (count) => {
      dropped.push(count);
    },
    setTimer: (fn) => {
      timers.push(fn);
      return () => undefined;
    },
  });
  return { queue, calls, invalidated, dropped, replayed, reverted, storage, timers };
}

const network = () => new ApiError({ code: 'SERVICE_UNAVAILABLE', kind: 'network', status: null });

describe('error classes (Part 4 §14.3 rule 3)', () => {
  it('retries transport and server failures, stops on auth, drops terminal 4xx', () => {
    expect(classifyReplayError(network())).toBe('retry');
    expect(
      classifyReplayError(new ApiError({ code: 'INTERNAL_ERROR', kind: 'server', status: 500 })),
    ).toBe('retry');
    expect(
      classifyReplayError(new ApiError({ code: 'AUTH_REQUIRED', kind: 'server', status: 401 })),
    ).toBe('auth');
    expect(
      classifyReplayError(
        new ApiError({ code: 'VALIDATION_FAILED', kind: 'server', status: 422, retryable: false }),
      ),
    ).toBe('terminal');
    expect(
      classifyReplayError(
        new ApiError({
          code: 'IDEMPOTENCY_REPLAY',
          kind: 'server',
          status: 409,
          details: { reason: 'in_progress' },
        }),
      ),
    ).toBe('retry');
    expect(
      classifyReplayError(
        new ApiError({ code: 'IDEMPOTENCY_REPLAY', kind: 'server', status: 409 }),
      ),
    ).toBe('done');
    expect(classifyReplayError(new DataError('ENTITLEMENT_REQUIRED', 'vip'))).toBe('terminal');
    expect(classifyReplayError(new DataError('AUTH_REQUIRED', null))).toBe('auth');
    expect(classifyReplayError(new DataError('UNKNOWN', null, 'Network request failed'))).toBe(
      'retry',
    );
    expect(classifyReplayError(new TypeError('Network request failed'))).toBe('retry');
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(20)).toBe(60_000);
  });
});

describe('queue engine', () => {
  it('replays FIFO within a scope, once, with the key fixed at enqueue time', async () => {
    let online = false;
    const h = harness({ online: () => online });
    const first = h.queue.enqueue('note', { id: 'a', value: '1' });
    h.queue.enqueue('note', { id: 'a', value: '2' });
    h.queue.enqueue('note', { id: 'b', value: '3' });
    await h.queue.flush();
    expect(h.calls).toHaveLength(0);
    online = true;
    await h.queue.flush();
    await h.queue.flush();
    expect(h.calls.filter((c) => (c.args as { id: string }).id === 'a').map((c) => c.args)).toEqual(
      [
        { id: 'a', value: '1' },
        { id: 'a', value: '2' },
      ],
    );
    expect(h.calls).toHaveLength(3);
    expect(h.calls[0]?.key).toBe(first.idempotencyKey);
    expect(h.queue.entries()).toHaveLength(0);
    expect(h.replayed).toHaveLength(3);
    expect(h.invalidated).toContainEqual(['notes', 'a']);
  });

  it('merges writes of the same key (last write wins)', async () => {
    let online = false;
    const h = harness({ online: () => online });
    h.queue.enqueue('setting', { table: 'user_preferences', patch: { theme: 'dark' } });
    h.queue.enqueue('setting', { table: 'user_preferences', patch: { theme: 'light', hz: 1 } });
    expect(h.queue.entries()).toHaveLength(1);
    online = true;
    await h.queue.flush();
    expect(h.calls.map((c) => c.args)).toEqual([
      { table: 'user_preferences', patch: { theme: 'light', hz: 1 } },
    ]);
  });

  it('keeps a failed delivery with back-off and sends it once when it succeeds (no duplicate)', async () => {
    let fail = true;
    const h = harness({
      run: () => (fail ? Promise.reject(network()) : Promise.resolve({ ok: true })),
      now: () => 0,
    });
    const entry = h.queue.enqueue('note', { id: 'a', value: '1' });
    await h.queue.flush();
    expect(h.queue.entries()[0]).toMatchObject({ attempts: 1, nextAttemptAt: 1000 });
    fail = false;
    // Still waiting for its back-off: nothing is sent.
    await h.queue.flush();
    expect(h.calls).toHaveLength(1);
    const later = harness({ storage: h.storage, now: () => 5_000 });
    await later.queue.flush();
    expect(later.calls.map((c) => c.key)).toEqual([entry.idempotencyKey]);
    expect(later.queue.entries()).toHaveLength(0);
  });

  it('drops a terminal failure, reverts it and reports it; the scope continues', async () => {
    const h = harness({
      run: (a) =>
        (a as { value: string }).value === 'bad'
          ? Promise.reject(new DataError('VALIDATION_FAILED', null))
          : Promise.resolve(null),
    });
    h.queue.enqueue('note', { id: 'a', value: 'bad' });
    h.queue.enqueue('note', { id: 'a', value: 'good' });
    await h.queue.flush();
    expect(h.reverted).toEqual([{ id: 'a', value: 'bad' }]);
    expect(h.dropped).toEqual([1]);
    expect(h.replayed).toEqual([{ id: 'a', value: 'good' }]);
    expect(h.queue.entries()).toHaveLength(0);
  });

  it('stops on AUTH_REQUIRED and keeps the queue for the same user', async () => {
    const h = harness({ run: () => Promise.reject(new DataError('AUTH_REQUIRED', null)) });
    h.queue.enqueue('note', { id: 'a', value: '1' });
    await h.queue.flush();
    expect(h.queue.entries()).toHaveLength(1);
    expect(h.dropped).toEqual([]);
  });

  it("discards another user's entries instead of replaying them", async () => {
    let user = uuid(1);
    const h = harness({ user: () => user });
    h.queue.enqueue('note', { id: 'a', value: 'mine' });
    user = uuid(2);
    await h.queue.flush();
    expect(h.calls).toHaveLength(0);
    expect(h.queue.entries()).toHaveLength(0);
  });

  it('bounds the queue to 200 entries and 7 days', () => {
    let clock = 0;
    const h = harness({ online: () => false, now: () => clock });
    for (let i = 0; i < QUEUE_MAX_ENTRIES + 5; i += 1) {
      h.queue.enqueue('note', { id: String(i), value: 'x' });
    }
    expect(h.queue.entries()).toHaveLength(QUEUE_MAX_ENTRIES);
    expect(h.queue.entries()[0]?.args).toEqual({ id: '5', value: 'x' });
    clock = QUEUE_MAX_AGE_MS + 1;
    h.queue.enqueue('note', { id: 'new', value: 'x' });
    expect(h.queue.entries().map((e) => (e.args as { id: string }).id)).toEqual(['new']);
    expect(h.dropped.reduce((a, b) => a + b, 0)).toBe(QUEUE_MAX_ENTRIES + 5);
  });

  it('survives a restart through its storage and removes an undone entry', () => {
    const storage = memoryStorage();
    const first = harness({ storage, online: () => false });
    const kept = first.queue.enqueue('note', { id: 'a', value: '1' });
    const undone = first.queue.enqueue('note', { id: 'b', value: '2' });
    expect(first.queue.cancel(undone.id)).toBe(true);
    const restarted = harness({ storage, online: () => false });
    expect(restarted.queue.entries().map((e) => e.id)).toEqual([kept.id]);
  });

  it('runs a write at once online, queues it behind waiting writes of its scope', async () => {
    let online = true;
    const h = harness({ online: () => online });
    expect(await h.queue.runOrQueue('note', { id: 'a', value: 'now' })).toMatchObject({
      status: 'saved',
    });
    online = false;
    expect(await h.queue.runOrQueue('note', { id: 'a', value: 'later' })).toMatchObject({
      status: 'queued',
    });
    online = true;
    const behind = await h.queue.runOrQueue('note', { id: 'a', value: 'behind' });
    expect(behind.status).toBe('queued');
    await h.queue.flush();
    expect(h.calls.map((c) => (c.args as { value: string }).value)).toEqual([
      'now',
      'later',
      'behind',
    ]);
  });
});

describe('the app queue', () => {
  beforeEach(async () => {
    await resetAppState();
    resetMutationQueueForTests();
  });

  it('classes every queued kind; approvals, sends and provider writes are not queueable', () => {
    expect(MUTATION_CLASSES).toEqual({
      insight_status: 'queued_lww',
      insight_feedback: 'queued_idempotent',
      commitment_status: 'queued_lww',
      own_row: 'queued_lww',
      feedback: 'queued_idempotent',
      reminder_create: 'queued_idempotent',
      reminder_cancel: 'queued_idempotent',
      briefing_opened: 'queued_idempotent',
      notification_opened: 'queued_idempotent',
      vip_set: 'queued_lww',
      // T-8.29 completion pass: meeting notes are queueable (API_CONTRACTS §2.16).
      meeting_note: 'queued_idempotent',
    });
    for (const kind of Object.keys(MUTATION_CLASSES)) {
      expect(kind).not.toMatch(/approv|send|reply|purchase|export|delete|integration|connect/);
    }
  });

  it('queues an insight status offline and replays it once on reconnect (NetInfo → onlineManager)', async () => {
    const fake = installFakeSupabase(session());
    bindMutationQueue();
    onlineManager.setOnline(false);
    const result = await runOrQueue('insight_status', { insightId: uuid(5), status: 'done' });
    expect(result.status).toBe('queued');
    expect(fake.db.rpcCalls).toHaveLength(0);
    expect(encryptedStorage().prefs.getString(QUEUE_STORAGE_KEY)).toContain(uuid(5));
    onlineManager.setOnline(true);
    await flushMutationQueue();
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await flushMutationQueue();
    const calls = fake.db.rpcCalls.filter((c) => c.name === 'set_insight_status');
    expect(calls).toEqual([
      { name: 'set_insight_status', args: { p_insight_id: uuid(5), p_status: 'done' } },
    ]);
    expect(queuedMutations()).toHaveLength(0);
  });

  it('tells own-row listeners which table a replay wrote (widget refresh, T-8.25)', async () => {
    installFakeSupabase(session());
    // The replayed write needs the signed-in profile (the queue's current user).
    getQueryClient().setQueryData(qk.me.bootstrap(), bootstrap());
    bindMutationQueue();
    const tables: string[] = [];
    const stop = onOwnRowReplayed((table) => tables.push(table));
    onlineManager.setOnline(false);
    await runOrQueue('own_row', { table: 'profiles', patch: { locale: 'en-US' } });
    expect(tables).toEqual([]);
    onlineManager.setOnline(true);
    await flushMutationQueue();
    expect(tables).toEqual(['profiles']);
    stop();
    onlineManager.setOnline(false);
    await runOrQueue('own_row', { table: 'notification_preferences', patch: { daily_cap: 4 } });
    onlineManager.setOnline(true);
    await flushMutationQueue();
    expect(tables).toEqual(['profiles']);
  });

  it('adopts the pre-T-8.23 settings patches and feedback outbox', () => {
    const prefs = encryptedStorage().prefs;
    prefs.set('settings.pending_writes', JSON.stringify({ user_preferences: { theme: 'dark' } }));
    prefs.set(
      'feedback.outbox',
      JSON.stringify([
        {
          body: { type: 'general', message: 'x', include_diagnostics: false },
          idempotencyKey: uuid(9),
        },
      ]),
    );
    onlineManager.setOnline(false);
    migrateLegacyQueues();
    expect(queuedMutations().map((e) => [e.kind, e.idempotencyKey === uuid(9)])).toEqual([
      ['own_row', false],
      ['feedback', true],
    ]);
    expect(prefs.getString('settings.pending_writes')).toBeUndefined();
    expect(prefs.getString('feedback.outbox')).toBeUndefined();
    onlineManager.setOnline(true);
  });

  it('is emptied by logout', async () => {
    onlineManager.setOnline(false);
    await runOrQueue('briefing_opened', { briefingId: uuid(3) });
    expect(queuedMutations()).toHaveLength(1);
    await logout(
      {},
      {
        api: { call: jest.fn(() => Promise.resolve({ data: {} })) } as never,
        supabase: installFakeSupabase(null).client,
        installationId: () => uuid(99),
        wipeStorage: () => Promise.resolve(),
        unregisterPush: () => Promise.resolve(),
        cancelLocalNotifications: () => Promise.resolve(),
        isOffline: () => true,
      },
    );
    expect(queuedMutations()).toHaveLength(0);
    onlineManager.setOnline(true);
  });
});
