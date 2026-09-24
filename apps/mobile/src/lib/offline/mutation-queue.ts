/**
 * The offline mutation queue engine (T-8.23; SCREEN_AND_FLOW_MAP §0.5 and Part 4 §14.2–§14.3,
 * API_CONTRACTS §2.16). One ordered, persisted queue holds the internal, idempotent writes the specs
 * allow offline; everything with an external side effect (approvals, sends, provider writes,
 * purchases, privacy) is blocked before the call and never reaches it.
 *
 * Rules implemented here:
 * - **Typed entries.** Every entry names a kind of the handler map and carries its arguments, a
 *   serialisation scope, an idempotency key fixed at enqueue time (reused by every replay) and the
 *   user that queued it.
 * - **Order.** Entries replay FIFO within their scope; different scopes run in parallel, at most
 *   four at a time. A scope stops at its first entry that must wait, so nothing overtakes it.
 * - **Last write wins.** A kind with a `coalesceKey` merges into the queued entry of the same key
 *   (a settings table, an insight's status) instead of appending.
 * - **Session first.** An `AUTH_REQUIRED` stops the replay and keeps the queue; entries queued by
 *   another user are discarded, never replayed as the current one.
 * - **Failures.** Network, timeout, 5xx and retryable codes stay queued with exponential back-off
 *   (1 s … 60 s); a terminal 4xx (validation, entitlement, not found, …) drops the entry, refreshes
 *   the affected queries (the optimistic value reverts to the server's) and reports the drop.
 * - **Bounds.** At most 200 entries and 7 days; older or overflowing entries are dropped the same
 *   way.
 */
import { isApiError } from '@da/api-client';
import type { QueryKey } from '@tanstack/react-query';

export const QUEUE_MAX_ENTRIES = 200;
export const QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const QUEUE_MAX_PARALLEL_SCOPES = 4;
/** Unknown failures are retried this many times before the entry is dropped. */
export const QUEUE_MAX_ATTEMPTS = 8;
export const QUEUE_BACKOFF_MAX_MS = 60_000;

export interface QueueEntry<Kind extends string = string, Args = unknown> {
  readonly id: string;
  readonly kind: Kind;
  readonly args: Args;
  readonly scope: string;
  /** Last-write-wins key (`null`: every entry is kept). */
  readonly key: string | null;
  readonly idempotencyKey: string;
  readonly userId: string | null;
  readonly createdAt: number;
  readonly attempts: number;
  readonly nextAttemptAt: number;
}

export type DropReason = 'rejected' | 'expired' | 'overflow' | 'foreign_user';

export interface MutationHandler<Args> {
  /** Serialisation scope: FIFO inside, parallel across scopes. */
  readonly scope: (args: Args) => string;
  /** Entries with the same key merge (last write wins). */
  readonly coalesceKey?: (args: Args) => string | null;
  /** Combines a queued entry with a newer one of the same key (default: the newer one). */
  readonly merge?: (queued: Args, next: Args) => Args;
  readonly run: (args: Args, idempotencyKey: string) => Promise<unknown>;
  /** Queries refreshed after a replay and after a drop (the revert). */
  readonly invalidate?: (args: Args) => readonly QueryKey[];
  /** After a queued entry was delivered. */
  readonly onReplayed?: (args: Args, result: unknown) => void;
  /** After an entry was dropped without being delivered. */
  readonly onDropped?: (args: Args, reason: DropReason) => void;
}

export type HandlerMap<M> = { readonly [K in keyof M & string]: MutationHandler<M[K]> };

export interface QueueStorage {
  read(): string | undefined;
  write(value: string | null): void;
}

export interface QueueDeps {
  /** Persistent storage, or `null` while the encrypted store is not open (memory only). */
  readonly storage: () => QueueStorage | null;
  readonly isOnline: () => boolean;
  /** The signed-in user (`null` while unknown). */
  readonly currentUserId: () => string | null;
  readonly newId: () => string;
  readonly now?: () => number;
  readonly invalidate?: (keys: readonly QueryKey[]) => void;
  /** User-visible report of dropped writes (the "could not be saved" toast). */
  readonly reportDropped?: (count: number) => void;
  readonly setTimer?: (run: () => void, ms: number) => () => void;
}

export type ReplayOutcome = 'done' | 'retry' | 'auth' | 'terminal';

const RETRY_MESSAGE = /network|fetch|timed? ?out|abort|connection/i;

/** How one failed delivery is handled (Part 4 §14.3 rule 3, API_CONTRACTS §14.5). */
export function classifyReplayError(error: unknown): Exclude<ReplayOutcome, 'done'> | 'done' {
  if (isApiError(error)) {
    if (error.kind === 'offline' || error.kind === 'network' || error.kind === 'timeout') {
      return 'retry';
    }
    if (error.code === 'AUTH_REQUIRED') return 'auth';
    if (error.code === 'IDEMPOTENCY_REPLAY') {
      return error.details.reason === 'in_progress' ? 'retry' : 'done';
    }
    if ((error.status ?? 0) >= 500 || error.retryable) return 'retry';
    return 'terminal';
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String(error.code);
    const message = error instanceof Error ? error.message : '';
    if (code === 'AUTH_REQUIRED' || code === 'PGRST301' || code === 'PGRST303') return 'auth';
    if (RETRY_MESSAGE.test(message) || code === '' || code === 'UNKNOWN') return 'retry';
    // Postgres connection, resource and operator-intervention classes are transient.
    if (/^(08|53|57|58)/.test(code)) return 'retry';
    return 'terminal';
  }
  return 'retry';
}

export function backoffMs(attempts: number): number {
  return Math.min(QUEUE_BACKOFF_MAX_MS, 1000 * 2 ** Math.max(0, attempts - 1));
}

export type RunResult<R = unknown> =
  | { readonly status: 'saved'; readonly result: R }
  | { readonly status: 'queued'; readonly entryId: string }
  | { readonly status: 'failed'; readonly error: unknown };

function isEntry(value: unknown): value is QueueEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.kind === 'string' &&
    typeof e.scope === 'string' &&
    typeof e.idempotencyKey === 'string' &&
    typeof e.createdAt === 'number'
  );
}

export function createMutationQueue<M>(handlers: HandlerMap<M>, deps: QueueDeps) {
  type Kind = keyof M & string;
  const now = deps.now ?? Date.now;
  const setTimer =
    deps.setTimer ??
    ((run: () => void, ms: number) => {
      const handle = setTimeout(run, ms);
      return () => {
        clearTimeout(handle);
      };
    });
  let memory: QueueEntry[] = [];
  let loadedFrom: QueueStorage | null = null;
  let flushing: Promise<void> | null = null;
  let cancelTimer: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const handler = (kind: string): MutationHandler<unknown> | undefined =>
    (handlers as Readonly<Record<string, MutationHandler<unknown> | undefined>>)[kind];

  function read(): QueueEntry[] {
    const storage = deps.storage();
    if (storage === null || storage === loadedFrom) return memory;
    // First read after the store opened: adopt what was persisted, keep what was queued before.
    loadedFrom = storage;
    let persisted: QueueEntry[] = [];
    const raw = storage.read();
    if (raw !== undefined) {
      try {
        const value: unknown = JSON.parse(raw);
        persisted = Array.isArray(value) ? value.filter(isEntry) : [];
      } catch {
        persisted = [];
      }
    }
    const known = new Set(persisted.map((e) => e.id));
    memory = [...persisted, ...memory.filter((e) => !known.has(e.id))];
    return memory;
  }

  function write(entries: readonly QueueEntry[]): void {
    memory = [...entries];
    const storage = deps.storage();
    if (storage !== null) {
      loadedFrom = storage;
      storage.write(entries.length === 0 ? null : JSON.stringify(entries));
    }
    for (const listener of listeners) listener();
  }

  function drop(entries: readonly QueueEntry[], reason: DropReason, report: boolean): void {
    if (entries.length === 0) return;
    for (const entry of entries) {
      const h = handler(entry.kind);
      h?.onDropped?.(entry.args, reason);
      const keys = h?.invalidate?.(entry.args) ?? [];
      if (keys.length > 0) deps.invalidate?.(keys);
    }
    if (report) deps.reportDropped?.(entries.length);
  }

  /** Enforces the age and size bounds; returns the kept entries. */
  function bounded(entries: readonly QueueEntry[]): QueueEntry[] {
    const cutoff = now() - QUEUE_MAX_AGE_MS;
    const expired = entries.filter((e) => e.createdAt < cutoff);
    let kept = entries.filter((e) => e.createdAt >= cutoff);
    const overflow =
      kept.length > QUEUE_MAX_ENTRIES ? kept.slice(0, kept.length - QUEUE_MAX_ENTRIES) : [];
    if (overflow.length > 0) kept = kept.slice(overflow.length);
    drop(expired, 'expired', true);
    drop(overflow, 'overflow', true);
    return kept;
  }

  function enqueue<K extends Kind>(
    kind: K,
    args: M[K],
    options: { readonly idempotencyKey?: string } = {},
  ): QueueEntry<K, M[K]> {
    const h = handler(kind);
    if (h === undefined) throw new Error(`[mutation-queue] unknown kind ${kind}`);
    const entries = read();
    const scope = h.scope(args);
    const key = h.coalesceKey?.(args) ?? null;
    const userId = deps.currentUserId();
    if (key !== null) {
      const index = entries.findIndex(
        (e) => e.kind === kind && e.key === key && e.userId === userId,
      );
      const queued = entries[index];
      if (queued !== undefined) {
        const merged: QueueEntry = {
          ...queued,
          args: h.merge === undefined ? args : h.merge(queued.args, args),
        };
        const next = [...entries];
        next[index] = merged;
        write(next);
        return merged as QueueEntry<K, M[K]>;
      }
    }
    const at = now();
    const id = deps.newId();
    const entry: QueueEntry<K, M[K]> = {
      id,
      kind,
      args,
      scope,
      key,
      idempotencyKey: options.idempotencyKey ?? id,
      userId,
      createdAt: at,
      attempts: 0,
      nextAttemptAt: at,
    };
    write(bounded([...entries, entry]));
    return entry;
  }

  function hasPendingScope(scope: string): boolean {
    return read().some((e) => e.scope === scope);
  }

  /**
   * Runs a write now when online and nothing of its scope is waiting; otherwise queues it (a
   * network failure also queues it). A terminal failure is returned to the caller, who reverts.
   */
  async function runOrQueue<K extends Kind>(
    kind: K,
    args: M[K],
    options: { readonly idempotencyKey?: string } = {},
  ): Promise<RunResult> {
    const h = handler(kind);
    if (h === undefined) throw new Error(`[mutation-queue] unknown kind ${kind}`);
    const idempotencyKey = options.idempotencyKey ?? deps.newId();
    if (!deps.isOnline() || hasPendingScope(h.scope(args))) {
      const entry = enqueue(kind, args, { idempotencyKey });
      if (deps.isOnline()) void flush();
      return { status: 'queued', entryId: entry.id };
    }
    try {
      const result = await h.run(args, idempotencyKey);
      const keys = h.invalidate?.(args) ?? [];
      if (keys.length > 0) deps.invalidate?.(keys);
      return { status: 'saved', result };
    } catch (error) {
      const outcome = classifyReplayError(error);
      if (outcome === 'done') return { status: 'saved', result: null };
      if (outcome === 'terminal') return { status: 'failed', error };
      const entry = enqueue(kind, args, { idempotencyKey });
      schedule(backoffMs(1));
      return { status: 'queued', entryId: entry.id };
    }
  }

  function schedule(ms: number): void {
    cancelTimer?.();
    cancelTimer = setTimer(
      () => {
        cancelTimer = null;
        void flush();
      },
      Math.max(0, ms),
    );
  }

  function update(id: string, change: (entry: QueueEntry) => QueueEntry | null): void {
    const next: QueueEntry[] = [];
    for (const entry of read()) {
      if (entry.id !== id) next.push(entry);
      else {
        const changed = change(entry);
        if (changed !== null) next.push(changed);
      }
    }
    write(next);
  }

  /** Replays one scope in order; resolves `false` when the whole replay must stop (auth). */
  async function replayScope(scope: string): Promise<boolean> {
    for (;;) {
      if (!deps.isOnline()) return true;
      const entry = read().find((e) => e.scope === scope);
      if (entry === undefined) return true;
      if (entry.nextAttemptAt > now()) {
        schedule(entry.nextAttemptAt - now());
        return true;
      }
      const h = handler(entry.kind);
      if (h === undefined) {
        update(entry.id, () => null);
        continue;
      }
      let outcome: ReplayOutcome;
      let result: unknown = null;
      try {
        result = await h.run(entry.args, entry.idempotencyKey);
        outcome = 'done';
      } catch (error) {
        outcome = classifyReplayError(error);
        if (outcome === 'retry' && entry.attempts + 1 >= QUEUE_MAX_ATTEMPTS) outcome = 'terminal';
      }
      if (outcome === 'auth') return false;
      if (outcome === 'retry') {
        const attempts = entry.attempts + 1;
        update(entry.id, (e) => ({ ...e, attempts, nextAttemptAt: now() + backoffMs(attempts) }));
        schedule(backoffMs(attempts));
        return true;
      }
      update(entry.id, () => null);
      if (outcome === 'terminal') {
        drop([entry], 'rejected', true);
        continue;
      }
      const keys = h.invalidate?.(entry.args) ?? [];
      if (keys.length > 0) deps.invalidate?.(keys);
      h.onReplayed?.(entry.args, result);
    }
  }

  async function replay(): Promise<void> {
    const user = deps.currentUserId();
    const current = read();
    const all = bounded(current);
    // Entries of another account are never replayed as this one (§14.3 rule 2).
    const foreign = all.filter((e) => user !== null && e.userId !== null && e.userId !== user);
    const own = all
      .filter((e) => !foreign.includes(e))
      .map((e) => (e.userId === null && user !== null ? { ...e, userId: user } : e));
    drop(foreign, 'foreign_user', false);
    if (JSON.stringify(own) !== JSON.stringify(current)) write(own);
    const scopes = [...new Set(own.map((e) => e.scope))];
    let stop = false;
    let cursor = 0;
    const worker = async () => {
      while (!stop && cursor < scopes.length) {
        const scope = scopes[cursor];
        cursor += 1;
        if (scope === undefined) break;
        const ok = await replayScope(scope);
        if (!ok) stop = true;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(QUEUE_MAX_PARALLEL_SCOPES, scopes.length) }, worker),
    );
  }

  /** Replays the queue once (concurrent calls share the run). */
  function flush(): Promise<void> {
    if (!deps.isOnline()) return Promise.resolve();
    if (flushing !== null) return flushing;
    flushing = replay().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  /** Removes a queued entry that has not been delivered (undo inside the queue). */
  function cancel(entryId: string): boolean {
    const before = read();
    const after = before.filter((e) => e.id !== entryId);
    if (after.length === before.length) return false;
    write(after);
    return true;
  }

  function entries(): readonly QueueEntry[] {
    return read();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /** Empties the queue (logout); nothing is reported. */
  function clear(): void {
    cancelTimer?.();
    cancelTimer = null;
    write([]);
  }

  /** Test seam: forget the in-memory state and the storage binding. */
  function reset(): void {
    cancelTimer?.();
    cancelTimer = null;
    memory = [];
    loadedFrom = null;
    flushing = null;
  }

  return { enqueue, runOrQueue, flush, cancel, entries, subscribe, clear, reset };
}

export type MutationQueue<M> = ReturnType<typeof createMutationQueue<M>>;
