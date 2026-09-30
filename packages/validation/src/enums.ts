import { z } from 'zod';
import { DB_ENUMS, type DbEnumName } from '@da/domain';

/** zod enum for any canonical Postgres enum, e.g. `dbEnum('approval_status')`. */
export function dbEnum<N extends DbEnumName>(
  name: N,
): z.ZodEnum<{ [K in (typeof DB_ENUMS)[N][number]]: K }> {
  return z.enum(DB_ENUMS[name] as unknown as [string, ...string[]]) as unknown as z.ZodEnum<{
    [K in (typeof DB_ENUMS)[N][number]]: K;
  }>;
}
