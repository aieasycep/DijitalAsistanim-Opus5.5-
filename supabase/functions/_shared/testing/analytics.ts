/** In-memory server analytics (API_CONTRACTS §17.1) for tests: the rows written and opted-out users. */
import { createLogger, type Logger, memorySink } from '../logging/logger.ts';
import {
  createServerAnalytics,
  type ServerAnalytics,
  type ServerAnalyticsRow,
} from '../services/analytics/emit.ts';

export interface MemoryServerAnalytics {
  readonly analytics: ServerAnalytics;
  readonly rows: ServerAnalyticsRow[];
  readonly optOut: Set<string>;
  /** Event names written, in order. */
  names(): string[];
}

export function memoryServerAnalytics(
  options: { readonly log?: Logger; readonly now?: () => Date } = {},
): MemoryServerAnalytics {
  const rows: ServerAnalyticsRow[] = [];
  const optOut = new Set<string>();
  const analytics = createServerAnalytics(
    {
      optedOut: (userId) => Promise.resolve(optOut.has(userId)),
      insert: (row) => Promise.resolve(void rows.push(row)),
    },
    {
      log: options.log ?? createLogger({ fn: 'test', sink: memorySink().sink }),
      ...(options.now === undefined ? {} : { now: options.now }),
    },
  );
  return { analytics, rows, optOut, names: () => rows.map((r) => r.event_name) };
}
