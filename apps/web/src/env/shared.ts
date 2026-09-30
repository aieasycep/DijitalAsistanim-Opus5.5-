import { z } from '../lib/zod.ts';

/**
 * Helpers shared by the web client and server env schemas. Kept separate so the client bundle
 * never contains the server schema (and with it the names of server-side variables).
 */

export type Source = Readonly<Record<string, string | undefined>>;

export const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const optionalString = z.preprocess(blankToUndefined, z.string().trim().min(1).optional());

export const optionalUrl = z.preprocess(
  blankToUndefined,
  z
    .url({ protocol: /^https?$/ })
    .transform((value) => value.replace(/\/+$/, ''))
    .optional(),
);

export const booleanFlag = (fallback: boolean) =>
  z.preprocess((value) => {
    const v = blankToUndefined(value);
    if (v === undefined) return fallback;
    if (typeof v === 'string') return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
    return v;
  }, z.boolean());

export class EnvError extends Error {
  override readonly name = 'EnvError';
}

export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}
