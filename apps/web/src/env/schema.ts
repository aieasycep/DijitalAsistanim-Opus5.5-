import { z } from '../lib/zod.ts';
import { DEFAULT_APP_ID, DEFAULT_PRIVACY_EMAIL } from '../lib/site.ts';

/**
 * Environment schema for apps/web (INTEGRATION_PLAN §15 names; SCREEN_AND_FLOW_MAP Part 5 §17 and
 * registry R-17). Pure functions so the rules are unit-tested; `server.ts` and `client.ts` apply
 * them to `process.env`.
 *
 * The web holds no secret: every value here is public (store IDs, the publishable key, the
 * public API origin) or a build-time identifier. A Supabase secret key is rejected outright.
 */

type Source = Readonly<Record<string, string | undefined>>;

const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(blankToUndefined, z.string().trim().min(1).optional());

const optionalUrl = z.preprocess(
  blankToUndefined,
  z
    .url({ protocol: /^https?$/ })
    .transform((value) => value.replace(/\/+$/, ''))
    .optional(),
);

const booleanFlag = (fallback: boolean) =>
  z.preprocess((value) => {
    const v = blankToUndefined(value);
    if (v === undefined) return fallback;
    if (typeof v === 'string') return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
    return v;
  }, z.boolean());

export const APP_ENV_VALUES = ['development', 'test', 'preview', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENV_VALUES)[number];

const SHA256_FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export const EMAIL_PROVIDER_VALUES = ['resend', 'postmark', 'ses', 'smtp'] as const;

const serverShape = z.object({
  APP_ENV: z.preprocess(blankToUndefined, z.enum(APP_ENV_VALUES).default('development')),
  VERCEL_ENV: z.preprocess(
    blankToUndefined,
    z.enum(['production', 'preview', 'development']).optional(),
  ),
  SITE_INDEXABLE: booleanFlag(false),
  API_PUBLIC_BASE_URL: optionalUrl,
  APPLE_TEAM_ID: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[A-Z0-9]{10}$/, 'APPLE_TEAM_ID is the 10-character Apple Developer Team ID')
      .optional(),
  ),
  IOS_BUNDLE_IDENTIFIER: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/)
      .default(DEFAULT_APP_ID),
  ),
  ANDROID_PACKAGE: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)
      .default(DEFAULT_APP_ID),
  ),
  ANDROID_SHA256_CERT_FINGERPRINTS: z.preprocess(
    (value) => {
      const v = blankToUndefined(value);
      if (typeof v !== 'string') return v;
      return v
        .split(',')
        .map((part) => part.trim().toUpperCase())
        .filter((part) => part !== '');
    },
    z
      .array(z.string().regex(SHA256_FINGERPRINT, 'SHA-256 fingerprints use the AA:BB:… form'))
      .min(1)
      .optional(),
  ),
  MICROSOFT_CLIENT_ID: z.preprocess(blankToUndefined, z.uuid().optional()),
  IOS_APP_STORE_ID: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^\d{6,12}$/, 'IOS_APP_STORE_ID is the numeric App Store app ID')
      .optional(),
  ),
  APP_STORE_PROVIDER_TOKEN: z.preprocess(blankToUndefined, z.string().regex(/^\d+$/).optional()),
  DATA_REGION_LABEL: optionalString,
  SENTRY_REGION_LABEL: optionalString,
  BACKUP_RETENTION_DAYS: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(365).optional(),
  ),
  EMAIL_PROVIDER: z.preprocess(blankToUndefined, z.enum(EMAIL_PROVIDER_VALUES).optional()),
  COMPANY_LEGAL_NAME: optionalString,
  COMPANY_ADDRESS: optionalString,
  COMPANY_MERSIS_NO: optionalString,
  COMPANY_KEP_ADDRESS: optionalString,
  PRIVACY_CONTACT_EMAIL: z.preprocess(blankToUndefined, z.email().default(DEFAULT_PRIVACY_EMAIL)),
  EU_REPRESENTATIVE: optionalString,
});

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

export type ServerEnv = z.infer<typeof serverShape> & {
  /** Search engines may index the site (production deployment with `SITE_INDEXABLE=true`). */
  readonly indexable: boolean;
};
export type ClientEnv = z.infer<typeof clientShape>;

export class EnvError extends Error {
  override readonly name = 'EnvError';
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

export function parseClientEnv(source: Source): ClientEnv {
  const result = clientShape.safeParse(source);
  if (!result.success) throw new EnvError(`Invalid web client env:\n${formatIssues(result.error)}`);
  return result.data;
}

/** Keys a production, indexable deployment cannot launch without (Part 5 §17, §16 env test). */
export const INDEXABLE_PRODUCTION_REQUIRED = [
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'API_PUBLIC_BASE_URL',
  'IOS_APP_STORE_ID',
  'COMPANY_LEGAL_NAME',
  'COMPANY_ADDRESS',
  'COMPANY_MERSIS_NO',
  'COMPANY_KEP_ADDRESS',
] as const;

export function parseServerEnv(source: Source): ServerEnv {
  const result = serverShape.safeParse(source);
  if (!result.success) throw new EnvError(`Invalid web server env:\n${formatIssues(result.error)}`);
  const env = result.data;
  const isProductionDeployment =
    env.APP_ENV === 'production' &&
    (env.VERCEL_ENV === undefined || env.VERCEL_ENV === 'production');
  const indexable = env.SITE_INDEXABLE && isProductionDeployment;
  if (indexable) {
    const missing = INDEXABLE_PRODUCTION_REQUIRED.filter(
      (key) => blankToUndefined(source[key]) === undefined,
    );
    if (missing.length > 0) {
      throw new EnvError(
        `SITE_INDEXABLE=true in production requires: ${missing.join(', ')} (External credential required / Manual external step)`,
      );
    }
  }
  return { ...env, indexable };
}

/** Env keys that are unset but that a complete public launch needs; shown only outside production. */
export function missingLaunchKeys(source: Source): string[] {
  return INDEXABLE_PRODUCTION_REQUIRED.filter((key) => blankToUndefined(source[key]) === undefined);
}
