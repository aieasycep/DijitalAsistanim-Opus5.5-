/**
 * PostgREST double for the fake Supabase client: `rpc(name, args)` answers from per-name handlers
 * (RPC-04 `today_overview` defaults to an empty overview), and `from(table)` returns a chainable
 * builder that filters the table's rows by `eq`/`neq`/`in`, honours `maybeSingle`/`single`, and
 * records every write (`update`, `insert`, `delete`). Every call is recorded for assertions.
 */
import { jest } from '@jest/globals';

type Row = Readonly<Record<string, unknown>>;
export interface DbResult {
  readonly data: unknown;
  readonly error: { readonly message: string; readonly code?: string } | null;
}
export type RpcHandler = (args: Readonly<Record<string, unknown>>) => DbResult | Promise<DbResult>;

export interface DbWrite {
  readonly table: string;
  readonly op: 'update' | 'insert' | 'delete' | 'upsert';
  readonly values: unknown;
  readonly filters: readonly (readonly [string, string, unknown])[];
}

export interface PostgrestFake {
  readonly rpc: jest.Mock<(name: string, args?: Record<string, unknown>) => Promise<DbResult>>;
  readonly from: jest.Mock<(table: string) => unknown>;
  readonly rpcCalls: { name: string; args: Readonly<Record<string, unknown>> }[];
  readonly writes: DbWrite[];
  setRpc(name: string, handler: unknown): void;
  setTable(table: string, rows: readonly Row[]): void;
  /** Makes writes to a table fail with this error message. */
  failWrites(table: string, message: string | null): void;
}

export function emptyTodayOverview(localDate: string) {
  return {
    local_date: localDate,
    time_zone: 'Europe/Istanbul',
    hero_count: 0,
    priorities: [],
    next_meeting: null,
    deadlines: [],
    follow_ups: [],
    life_intel: [],
    pending_approvals_count: 0,
    briefing: null,
  };
}

export function fakePostgrest(): PostgrestFake {
  const rpcs = new Map<string, RpcHandler>();
  const tables = new Map<string, readonly Row[]>();
  const failing = new Map<string, string>();
  const rpcCalls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
  const writes: DbWrite[] = [];

  rpcs.set('today_overview', (args) => ({
    data: emptyTodayOverview(
      typeof args.p_local_date === 'string' ? args.p_local_date : '2026-09-24',
    ),
    error: null,
  }));

  const rpc = jest.fn(async (name: string, args: Record<string, unknown> = {}) => {
    rpcCalls.push({ name, args });
    const handler = rpcs.get(name);
    if (handler === undefined) return { data: null, error: null };
    return handler(args);
  });

  const from = jest.fn((table: string) => {
    const filters: [string, string, unknown][] = [];
    let op: DbWrite['op'] | null = null;
    let values: unknown = null;
    let single: 'maybe' | 'one' | null = null;
    let range: [number, number] | null = null;
    const builder: Record<string, unknown> = {};
    const chain = (name: string, fn?: (...args: unknown[]) => void) => {
      builder[name] = (...args: unknown[]) => {
        fn?.(...args);
        return builder;
      };
    };
    chain('select');
    chain('order');
    chain('limit');
    chain('eq', (col, value) => filters.push([String(col), 'eq', value]));
    chain('neq', (col, value) => filters.push([String(col), 'neq', value]));
    chain('in', (col, value) => filters.push([String(col), 'in', value]));
    chain('range', (a, b) => {
      range = [Number(a), Number(b)];
    });
    chain('maybeSingle', () => {
      single = 'maybe';
    });
    chain('single', () => {
      single = 'one';
    });
    for (const write of ['update', 'insert', 'delete', 'upsert'] as const) {
      chain(write, (v) => {
        op = write;
        values = v ?? null;
      });
    }
    const resolve = (): DbResult => {
      if (op !== null) {
        writes.push({ table, op, values, filters: [...filters] });
        const message = failing.get(table);
        return message === undefined
          ? { data: null, error: null }
          : { data: null, error: { message } };
      }
      let rows = [...(tables.get(table) ?? [])].filter((row) =>
        filters.every(([col, kind, value]) => {
          if (kind === 'eq') return row[col] === value;
          if (kind === 'neq') return row[col] !== value;
          return Array.isArray(value) && value.includes(row[col]);
        }),
      );
      if (range !== null) rows = rows.slice(range[0], range[1] + 1);
      if (single !== null) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    };
    builder.then = (onFulfilled: (v: DbResult) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected);
    return builder;
  });

  return {
    rpc,
    from,
    rpcCalls,
    writes,
    setRpc(name, handler) {
      rpcs.set(
        name,
        typeof handler === 'function'
          ? (handler as RpcHandler)
          : () => ({ data: handler, error: null }),
      );
    },
    setTable(table, rows) {
      tables.set(table, rows);
    },
    failWrites(table, message) {
      if (message === null) failing.delete(table);
      else failing.set(table, message);
    },
  };
}
