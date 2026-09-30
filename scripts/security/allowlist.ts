/**
 * Exceptions for the security-nightly gates (`security/*-allowlist.json`): every entry names what it
 * excuses, why (a sentence, not a word) and until when. An entry stops applying at the start of its
 * `expires` day (UTC), and an expired entry fails its gate, so each exception is reviewed on time.
 */
import { readFileSync } from 'node:fs';

export interface AllowEntryBase {
  readonly reason: string;
  /** ISO date YYYY-MM-DD. */
  readonly expires: string;
}

export type AllowEntry<K extends string> = AllowEntryBase & Readonly<Record<K, string>>;

export function parseAllowlist<K extends string>(
  raw: unknown,
  keys: readonly K[],
  label: string,
): AllowEntry<K>[] {
  if (!Array.isArray(raw)) throw new Error(`${label} allow-list: expected a JSON array`);
  return raw.map((entry: unknown, i) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    for (const key of [...keys, 'reason', 'expires']) {
      const value = e[key];
      if (typeof value !== 'string' || value.trim() === '')
        throw new Error(`${label} allow-list entry ${String(i)}: missing ${key}`);
    }
    const expires = String(e.expires);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || Number.isNaN(Date.parse(`${expires}T00:00:00Z`)))
      throw new Error(`${label} allow-list entry ${String(i)}: expires must be YYYY-MM-DD`);
    if (String(e.reason).trim().length < 20)
      throw new Error(
        `${label} allow-list entry ${String(i)}: the reason must explain the exception`,
      );
    return e as AllowEntry<K>;
  });
}

export function readAllowlist<K extends string>(
  path: string,
  keys: readonly K[],
  label: string,
): AllowEntry<K>[] {
  return parseAllowlist(JSON.parse(readFileSync(path, 'utf8')) as unknown, keys, label);
}

export function splitByExpiry<T extends AllowEntryBase>(
  entries: readonly T[],
  now: Date,
): { live: T[]; expired: T[] } {
  const live = entries.filter((e) => Date.parse(`${e.expires}T00:00:00Z`) > now.getTime());
  return { live, expired: entries.filter((e) => !live.includes(e)) };
}
