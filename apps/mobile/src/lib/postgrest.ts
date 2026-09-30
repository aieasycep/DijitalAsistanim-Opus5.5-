/**
 * PostgREST access as the signed-in user (RLS; ADR-04): typed RPC calls (API_CONTRACTS §15,
 * RPC-01…RPC-23) and the owner-scoped table writes of §15 ("Direct owner-scoped table writes"),
 * with errors normalised to `DataError`. An RPC that needs Pro raises `ENTITLEMENT_REQUIRED:<feature>`;
 * `entitlementFeatureOf` reads that, and the `402 ENTITLEMENT_REQUIRED` of the Edge API, in one place.
 */
import { isApiError, qk, type Database } from '@da/api-client';
import type { BootstrapData } from '@da/validation/api/bootstrap';

import { getSupabase } from './auth/supabase';
import { getQueryClient } from './query/client';

type Functions = Database['public']['Functions'];
export type RpcName = keyof Functions;
export type RpcArgs<N extends RpcName> = Functions[N]['Args'];

export class DataError extends Error {
  override readonly name = 'DataError';
  /** The first segment of `code:detail` messages (`ENTITLEMENT_REQUIRED`, `VALIDATION_FAILED`, …). */
  readonly code: string;
  readonly detail: string | null;

  constructor(code: string, detail: string | null, message?: string) {
    super(message ?? code);
    this.code = code;
    this.detail = detail;
  }
}

/** Converts a PostgREST error (`{message, code}`) into a `DataError`. */
export function toDataError(error: {
  readonly message?: string;
  readonly code?: string;
}): DataError {
  const message = error.message ?? '';
  const match = /^([A-Z][A-Z_]+):?(.*)$/.exec(message);
  if (match !== null) {
    const detail = (match[2] ?? '').trim();
    return new DataError(match[1] ?? 'UNKNOWN', detail === '' ? null : detail, message);
  }
  return new DataError(error.code ?? 'UNKNOWN', null, message);
}

/** Calls an RPC and returns its data, throwing `DataError` on failure. */
export async function rpc<N extends RpcName>(
  name: N,
  args: RpcArgs<N>,
): Promise<Functions[N]['Returns']> {
  const { data, error } = await (
    getSupabase().rpc as unknown as (
      fn: string,
      a: unknown,
    ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>
  )(name, args);
  if (error !== null) throw toDataError(error);
  return data as Functions[N]['Returns'];
}

/** The Pro feature a failed call needs, or null (RPC `ENTITLEMENT_REQUIRED:x` or API 402). */
export function entitlementFeatureOf(error: unknown): string | null {
  if (error instanceof DataError && error.code === 'ENTITLEMENT_REQUIRED') {
    return error.detail ?? 'pro';
  }
  if (isApiError(error) && error.code === 'ENTITLEMENT_REQUIRED') {
    const feature = error.details.feature;
    return typeof feature === 'string' ? feature : 'pro';
  }
  return null;
}

/** The cached bootstrap (the guards keep it loaded while signed in). */
export function cachedBootstrap(): BootstrapData | undefined {
  return getQueryClient().getQueryData<BootstrapData>(qk.me.bootstrap());
}

/** Applies a change to the cached bootstrap (optimistic preference writes). */
export function patchBootstrapCache(update: (data: BootstrapData) => BootstrapData): void {
  getQueryClient().setQueryData<BootstrapData>(qk.me.bootstrap(), (data) =>
    data === undefined ? data : update(data),
  );
}

type Tables = Database['public']['Tables'];
export type ProfilePatch = Partial<
  Pick<
    Tables['profiles']['Update'],
    'display_name' | 'locale' | 'onboarding_step' | 'onboarding_completed_at' | 'terms_accepted_at'
  > & { terms_version: string | null }
>;
export type UserPreferencesPatch = Partial<Tables['user_preferences']['Update']>;
export type NotificationPreferencesPatch = Partial<Tables['notification_preferences']['Update']>;

async function updateOwnRow(
  table: 'profiles' | 'user_preferences' | 'notification_preferences',
  patch: Readonly<Record<string, unknown>>,
  userId?: string,
): Promise<void> {
  const id = userId ?? cachedBootstrap()?.profile.id;
  if (id === undefined) throw new DataError('AUTH_REQUIRED', null);
  const query = getSupabase()
    .from(table)
    .update(patch as never)
    .eq('user_id', id);
  const { error } = (await query) as { error: { message?: string; code?: string } | null };
  if (error !== null) throw toDataError(error);
}

/** `PATCH profiles` (owner row; columns per API_CONTRACTS §15). */
export function updateProfile(patch: ProfilePatch, userId?: string): Promise<void> {
  return updateOwnRow('profiles', patch, userId);
}

/** `PATCH user_preferences` (owner row). */
export function updateUserPreferences(patch: UserPreferencesPatch): Promise<void> {
  return updateOwnRow('user_preferences', patch);
}

/** `PATCH notification_preferences` (owner row). */
export function updateNotificationPreferences(patch: NotificationPreferencesPatch): Promise<void> {
  return updateOwnRow('notification_preferences', patch);
}
