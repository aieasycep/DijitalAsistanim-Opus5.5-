/**
 * Local recent queries (M-SRCH-01 `search.recents`, M-MEM-01 `memory.recents`): at most 8, newest
 * first, in the encrypted MMKV prefs store (wiped on sign-out with the store). Never sent anywhere.
 */
import { encryptedStorage, isEncryptedStorageOpen } from '../../lib/storage';

export type RecentsKey = 'search.recents' | 'memory.recents';
const MAX = 8;

export function readRecents(key: RecentsKey): readonly string[] {
  if (!isEncryptedStorageOpen()) return [];
  const raw = encryptedStorage().prefs.getString(key);
  if (raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function pushRecent(key: RecentsKey, query: string): readonly string[] {
  const value = query.trim();
  if (value === '') return readRecents(key);
  const next = [value, ...readRecents(key).filter((q) => q !== value)].slice(0, MAX);
  if (isEncryptedStorageOpen()) encryptedStorage().prefs.set(key, JSON.stringify(next));
  return next;
}

export function clearRecents(key: RecentsKey): void {
  if (isEncryptedStorageOpen()) encryptedStorage().prefs.remove(key);
}
