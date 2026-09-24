import { z } from '../lib/zod.ts';
import {
  EnvError,
  blankToUndefined,
  booleanFlag,
  formatIssues,
  optionalString,
  optionalUrl,
  type Source,
} from './shared.ts';

/** Browser-safe env schema (`NEXT_PUBLIC_*` only). Imported by `client.ts` and re-exported by `schema.ts`. */
const clientShape = z.object({
  NEXT_PUBLIC_SITE_URL: z.preprocess(
    blankToUndefined,
    z
      .url({ protocol: /^https?$/ })
      .transform((value) => value.replace(/\/+$/, ''))
      .default('https://dijitalasistan.app'),
  ),
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.preprocess(
    blankToUndefined,
    z
      .string()
      .refine((key) => !key.startsWith('sb_secret_'), {
        message: 'A Supabase secret key must never reach the web bundle',
      })
      .optional(),
  ),
  NEXT_PUBLIC_ANALYTICS_ENABLED: booleanFlag(false),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalString,
});

export type ClientEnv = z.infer<typeof clientShape>;

export function parseClientEnv(source: Source): ClientEnv {
  const result = clientShape.safeParse(source);
  if (!result.success) throw new EnvError(`Invalid web client env:\n${formatIssues(result.error)}`);
  return result.data;
}
