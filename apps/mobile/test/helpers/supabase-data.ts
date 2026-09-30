/**
 * PostgREST / RPC double for screen tests: `rpc(name, args)` answers from per-name handlers (with
 * empty defaults for the feeds the tab roots read on open), and `from(table)` returns a chainable,
 * thenable query builder over in-memory rows (`eq` / `in` / `is` filter them; `single` /
 * `maybeSingle` pick one). Every call is recorded for assertions. No network, no Supabase.
 */
import { jest } from '@jest/globals';

type Row = Record<string, unknown>;
export type RpcHandler = (args: Record<string, unknown>) => unknown;

export interface DataCall {
  readonly kind: 'rpc' | 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  readonly target: string;
  readonly args?: unknown;
  readonly filters: readonly (readonly [string, string, unknown])[];
}

export interface DataRoutes {
  readonly rpc?: Readonly<Record<string, RpcHandler>>;
  readonly tables?: Readonly<Record<string, readonly Row[]>>;
  /** Makes an RPC (by name) or a table read fail with this PostgREST error message. */
  readonly failures?: Readonly<Record<string, string>>;
}

const EMPTY_META = { total: 0, important: 0, last_analysis_at: null, accounts: [] };

/** Answers for the reads every tab root makes when it opens, so a bare harness renders empty states. */
export const DEFAULT_RPC: Readonly<Record<string, RpcHandler>> = {
  flow_feed: () => ({ items: [], next_cursor: null, meta: EMPTY_META }),
  mail_intelligence: (args) => ({
    local_date: typeof args.p_local_date === 'string' ? args.p_local_date : '2026-09-24',
    total: 0,
    attention: 0,
    counts: {},
    rows: [],
    next_cursor: null,
  }),
  plan_range: () => ({ items: [] }),
  plan_week_density: () => [],
};

function matches(row: Row, filters: readonly (readonly [string, string, unknown])[]): boolean {
  return filters.every(([op, column, value]) => {
    const cell = row[column];
    switch (op) {
      case 'eq':
        return cell === value;
      case 'neq':
        return cell !== value;
      case 'in':
        return Array.isArray(value) && value.includes(cell);
      case 'is':
        return cell === value || (value === null && cell === undefined);
      default:
        return true;
    }
  });
}

export interface FakeData {
  readonly rpc: jest.Mock<(name: string, args?: Record<string, unknown>) => Promise<unknown>>;
  readonly from: (table: string) => unknown;
  readonly calls: DataCall[];
  /** Replaces the routes (e.g. per test). */
  set(next: DataRoutes): void;
}

export function fakeData(initial: DataRoutes = {}): FakeData {
  let routes = initial;
  const calls: DataCall[] = [];
  const error = (message: string) => ({
    data: null,
    error: { message, code: 'P0001', details: '', hint: '' },
  });

  const rpc = jest.fn((name: string, args: Record<string, unknown> = {}) => {
    calls.push({ kind: 'rpc', target: name, args, filters: [] });
    const failure = routes.failures?.[name];
    if (failure !== undefined) return Promise.resolve(error(failure));
    const handler = routes.rpc?.[name] ?? DEFAULT_RPC[name];
    return Promise.resolve({ data: handler === undefined ? null : handler(args), error: null });
  });

  const from = (table: string) => {
    const filters: (readonly [string, string, unknown])[] = [];
    let kind: DataCall['kind'] = 'select';
    let payload: unknown;
    let pick: 'many' | 'single' | 'maybe' = 'many';
    let limit: number | null = null;
    const result = () => {
      calls.push({ kind, target: table, args: payload, filters: [...filters] });
      const failure = routes.failures?.[table];
      if (failure !== undefined) return error(failure);
      if (kind !== 'select') {
        const rows: readonly unknown[] =
          kind === 'delete' ? [] : Array.isArray(payload) ? (payload as unknown[]) : [payload];
        return { data: pick === 'many' ? rows : (rows[0] ?? null), error: null };
      }
      const rows = (routes.tables?.[table] ?? []).filter((r) => matches(r, filters));
      const limited = limit === null ? rows : rows.slice(0, limit);
      if (pick === 'single') {
        return limited[0] === undefined
          ? { data: null, error: { message: 'no rows', code: 'PGRST116', details: '', hint: '' } }
          : { data: limited[0], error: null };
      }
      if (pick === 'maybe') return { data: limited[0] ?? null, error: null };
      return { data: limited, error: null };
    };
    const builder: Record<string, unknown> = {};
    const chain = (name: string, apply?: (...a: unknown[]) => void) => {
      builder[name] = (...a: unknown[]) => {
        apply?.(...a);
        return builder;
      };
    };
    chain('select');
    chain('order');
    chain('range');
    chain('not');
    chain('or');
    chain('filter');
    chain('contains');
    chain('overlaps');
    chain('gte');
    chain('gt');
    chain('lte');
    chain('lt');
    chain('ilike');
    chain('limit', (n) => {
      limit = typeof n === 'number' ? n : null;
    });
    for (const op of ['eq', 'neq', 'in', 'is'] as const) {
      chain(op, (column, value) => {
        filters.push([op, String(column), value]);
      });
    }
    for (const op of ['insert', 'update', 'upsert'] as const) {
      chain(op, (value) => {
        kind = op;
        payload = value;
      });
    }
    chain('delete', () => {
      kind = 'delete';
    });
    chain('single', () => {
      pick = 'single';
    });
    chain('maybeSingle', () => {
      pick = 'maybe';
    });
    builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return builder;
  };

  return {
    rpc,
    from,
    calls,
    set(next) {
      routes = next;
    },
  };
}
