/**
 * Briefing audio files (M-BR-02 premium mode): the signed file is downloaded once per briefing
 * version to `cacheDirectory/briefing-audio/{briefing}/{version}.mp3` so a briefing can be
 * replayed offline; the last file per briefing is remembered in the encrypted preferences. Logout
 * deletes the directory and the on-device synthesized chapters of `da-tts` (T-8.27)
 * (`LOGOUT_HOOKS.audioCache`, CTL-3.13 step 7).
 */
import * as FileSystem from 'expo-file-system/legacy';

import { clearTtsCache } from '../../../modules/da-tts/src';
import { LOGOUT_HOOKS, registerLogoutCleanup } from '../../lib/auth/logout';
import { encryptedStorage, isEncryptedStorageOpen } from '../../lib/storage';

const DIR = 'briefing-audio/';
const KEY = (id: string) => `audio.file.${id}`;

function root(): string | null {
  return FileSystem.cacheDirectory === null ? null : `${FileSystem.cacheDirectory}${DIR}`;
}

/** The file name of a signed URL (`…/{version}.mp3?token=…` → `{version}.mp3`). */
export function fileNameOf(url: string): string {
  const path = url.split(/[?#]/)[0] ?? url;
  const name = path.slice(path.lastIndexOf('/') + 1);
  return /^[A-Za-z0-9._-]{1,80}$/.test(name) ? name : 'audio.mp3';
}

export function cachedAudioFile(briefingId: string): string | null {
  if (!isEncryptedStorageOpen()) return null;
  return encryptedStorage().prefs.getString(KEY(briefingId)) ?? null;
}

/** Downloads (or reuses) the file for this signed URL; returns its local URI. */
export async function downloadAudio(briefingId: string, url: string): Promise<string> {
  const base = root();
  if (base === null) return url;
  const dir = `${base}${briefingId}/`;
  const target = `${dir}${fileNameOf(url)}`;
  const info = await FileSystem.getInfoAsync(target);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    await FileSystem.downloadAsync(url, target);
  }
  if (isEncryptedStorageOpen()) encryptedStorage().prefs.set(KEY(briefingId), target);
  return target;
}

export async function clearAudioCache(): Promise<void> {
  const base = root();
  if (base !== null) await FileSystem.deleteAsync(base, { idempotent: true });
  await clearTtsCache();
}

registerLogoutCleanup(LOGOUT_HOOKS.audioCache, clearAudioCache);
