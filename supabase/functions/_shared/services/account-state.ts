/**
 * Account-state and client-version gates for `api` (API_CONTRACTS §2.3, §3):
 * 1. `profiles.disabled_at` set (or `state='disabled'`) → `ACCOUNT_DISABLED`;
 * 2. an account deletion in progress (`state='deletion_pending'`) → `ACCOUNT_DELETION_PENDING`;
 * 3. `X-DA-Client` below `app_settings['app.min_supported_version']` → `CLIENT_UPGRADE_REQUIRED`.
 * `GET /me/bootstrap` reports these in its body instead of failing.
 */
import type { MiddlewareHandler } from 'hono';
import type { UserState } from '@da/domain';
import { APP_SETTING_DEFAULTS, APP_SETTING_KEYS } from '../config.ts';
import type { DbClient } from '../db/clients.ts';
import { AppError, mapDbError } from '../errors.ts';
import type { AppEnv } from '../http/context.ts';

export interface AccountState {
  readonly state: UserState;
  readonly disabledAt: string | null;
}

export interface AccountStateRepo {
  get(userId: string): Promise<AccountState | null>;
}

export interface MinVersions {
  readonly ios: string;
  readonly android: string;
}

export interface AppSettingsRepo {
  minSupportedVersion(): Promise<MinVersions>;
  referralRewardDays(): Promise<number>;
}

export function effectiveAccountState(state: AccountState | null): UserState {
  if (state === null) return 'active';
  if (state.disabledAt !== null || state.state === 'disabled') return 'disabled';
  return state.state;
}

/** Semver comparison of `x.y.z` strings (non-numeric parts compare as 0). */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split('.').map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function upgradeRequired(
  client: { platform: 'ios' | 'android' | null; version: string | null },
  min: MinVersions,
): boolean {
  if (client.platform === null || client.version === null) return false;
  return compareSemver(client.version, min[client.platform]) < 0;
}

export interface GateOptions {
  readonly accounts: AccountStateRepo;
  readonly settings: AppSettingsRepo;
}

/** Runs after `requireUser`. */
export function requireActiveAccount(options: GateOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (auth === undefined)
      throw new AppError('AUTH_REQUIRED', { details: { reason: 'missing_token' } });
    const state = await options.accounts.get(auth.userId);
    if (state === null) throw new AppError('FORBIDDEN', { details: { reason: 'profile_missing' } });
    const effective = effectiveAccountState(state);
    if (effective === 'disabled') throw new AppError('ACCOUNT_DISABLED');
    if (effective === 'deletion_pending') throw new AppError('ACCOUNT_DELETION_PENDING');
    if (upgradeRequired(c.get('client'), await options.settings.minSupportedVersion())) {
      throw new AppError('CLIENT_UPGRADE_REQUIRED');
    }
    await next();
  };
}

// ── supabase-backed repositories (service client; `profiles` and `app_settings`) ──

export function supabaseAccountStateRepo(client: DbClient): AccountStateRepo {
  return {
    async get(userId) {
      const { data, error } = await client
        .from('profiles')
        .select('state,disabled_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (error !== null) throw mapDbError(error);
      if (data === null) return null;
      const row = data as { state: UserState; disabled_at: string | null };
      return { state: row.state, disabledAt: row.disabled_at };
    },
  };
}

function isSemver(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
}

export function supabaseAppSettingsRepo(
  client: DbClient,
  options: { ttlMs?: number; now?: () => number } = {},
): AppSettingsRepo {
  const ttl = options.ttlMs ?? 60_000;
  const now = options.now ?? Date.now;
  let cache: { at: number; values: Map<string, unknown> } | null = null;
  const load = async (): Promise<Map<string, unknown>> => {
    if (cache !== null && now() - cache.at < ttl) return cache.values;
    const { data, error } = await client
      .from('app_settings')
      .select('key,value')
      .in('key', [APP_SETTING_KEYS.minSupportedVersion, APP_SETTING_KEYS.referralRewardDays]);
    if (error !== null) throw mapDbError(error);
    const values = new Map<string, unknown>();
    for (const row of (data ?? []) as { key: string; value: unknown }[])
      values.set(row.key, row.value);
    cache = { at: now(), values };
    return values;
  };
  return {
    async minSupportedVersion() {
      const value = (await load()).get(APP_SETTING_KEYS.minSupportedVersion) as
        { ios?: unknown; android?: unknown } | undefined;
      return {
        ios: isSemver(value?.ios) ? value.ios : APP_SETTING_DEFAULTS.minSupportedVersion.ios,
        android: isSemver(value?.android)
          ? value.android
          : APP_SETTING_DEFAULTS.minSupportedVersion.android,
      };
    },
    async referralRewardDays() {
      const value = (await load()).get(APP_SETTING_KEYS.referralRewardDays);
      return typeof value === 'number' && Number.isInteger(value)
        ? value
        : APP_SETTING_DEFAULTS.referralRewardDays;
    },
  };
}
