import { z } from 'zod';
import { IsoDateTime, UsageDelta } from './common.ts';

/** Success-envelope `meta` (docs/API_CONTRACTS.md §2.4, §2.8, §4.2, §8.11). */
export const Meta = z.object({
  correlation_id: z.string(),
  request_id: z.string(),
  server_time: IsoDateTime,
  next_cursor: z.string().nullable().optional(),
  idempotency_replayed: z.boolean().optional(),
  poll_after_ms: z.int().min(250).optional(),
  usage: UsageDelta.optional(),
  /** Search on Free: types dropped behind the Pro gate (API-SRCH-01). */
  locked_types: z.array(z.string()).optional(),
  /** Search degraded to FTS because the semantic quota is used up (API-SRCH-01). */
  degraded: z.boolean().optional(),
  /** `false` on responses that must never be persisted client-side (API-MAIL-01). */
  persist: z.boolean().optional(),
});
export type Meta = z.infer<typeof Meta>;

/** `{ data, meta }` success envelope for every 2xx JSON response (§2.4). */
export function Success<T extends z.ZodType>(data: T) {
  return z.object({ data, meta: Meta });
}

/** Backoffice page meta (§2.8): `{page, page_size, total, total_is_estimate}`. */
export const PageMeta = Meta.extend({
  page: z.int().min(1),
  page_size: z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]),
  total: z.int().min(0),
  total_is_estimate: z.boolean(),
});
export type PageMeta = z.infer<typeof PageMeta>;

/** Backoffice list envelope: `Success(z.array(Row))` with page meta (§12.3). */
export function PagedSuccess<T extends z.ZodType>(row: T) {
  return z.object({ data: z.array(row), meta: PageMeta });
}

/** Mobile list query (§2.8): `?limit=` 1–50 (default 20) and an opaque `?cursor=`. */
export const CursorPageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z
    .string()
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
