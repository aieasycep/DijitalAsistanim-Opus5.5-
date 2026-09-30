/**
 * Feature flags and kill switches (R-10, API_CONTRACTS §4.4, DATABASE_AND_RLS_PLAN §4.7).
 *
 * - Per user: `private.evaluate_flags(p_user, p_platform, p_app_version)` (targeting, rollout,
 *   overrides), cached 30 s per isolate — the evaluator `GET /me/bootstrap` and server gates share.
 * - System work without a user (probes, batch collection): the global `feature_flags.enabled`
 *   values, cached 30 s.
 * Unknown keys evaluate to `false` except the AI kill switches, whose documented default is on only
 * when the flag row exists and is enabled.
 */
import type { DbClient } from '../db/clients.ts';
import { DB_FN, rpc } from '../db/functions.ts';
import { mapDbError } from '../errors.ts';

export type FlagMap = Readonly<Record<string, boolean>>;

export interface FlagSource {
  forUser(
    userId: string,
    platform: 'ios' | 'android' | null,
    appVersion: string | null,
  ): Promise<FlagMap>;
  global(): Promise<FlagMap>;
}

/** `evaluate_flags` returns `{key: boolean}` (or `{key: {enabled}}`); both shapes are accepted. */
export function normalizeFlagMap(raw: unknown): FlagMap {
  const out: Record<string, boolean> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'boolean') out[key] = value;
    else if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { enabled?: unknown }).enabled === 'boolean'
    ) {
      out[key] = (value as { enabled: boolean }).enabled;
    }
  }
  return out;
}

export function isOn(flags: FlagMap, key: string): boolean {
  return flags[key] === true;
}

export function supabaseFlagSource(
  client: DbClient,
  options: { ttlMs?: number; now?: () => number } = {},
): FlagSource {
  const ttl = options.ttlMs ?? 30_000;
  const now = options.now ?? Date.now;
  const users = new Map<string, { at: number; flags: FlagMap }>();
  let global: { at: number; flags: FlagMap } | null = null;
  return {
    async forUser(userId, platform, appVersion) {
      const cacheKey = `${userId}|${platform ?? ''}|${appVersion ?? ''}`;
      const hit = users.get(cacheKey);
      if (hit !== undefined && now() - hit.at < ttl) return hit.flags;
      const raw = await rpc<unknown>(client, DB_FN.evaluateFlags, {
        p_user: userId,
        p_platform: platform,
        p_app_version: appVersion,
      });
      const flags = normalizeFlagMap(raw);
      if (users.size > 500) users.clear();
      users.set(cacheKey, { at: now(), flags });
      return flags;
    },
    async global() {
      if (global !== null && now() - global.at < ttl) return global.flags;
      const { data, error } = await client.from('feature_flags').select('key,enabled');
      if (error !== null) throw mapDbError(error);
      const flags: Record<string, boolean> = {};
      for (const row of (data ?? []) as { key: string; enabled: boolean }[])
        flags[row.key] = row.enabled;
      global = { at: now(), flags };
      return flags;
    },
  };
}

export function staticFlagSource(flags: FlagMap): FlagSource {
  return { forUser: () => Promise.resolve(flags), global: () => Promise.resolve(flags) };
}
