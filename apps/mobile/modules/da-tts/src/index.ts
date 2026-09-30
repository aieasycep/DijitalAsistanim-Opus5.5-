/**
 * `da-tts` JS interface (T-8.27; SCREEN_AND_FLOW_MAP M-BR-02 native mode). The chapters of a
 * native-mode briefing are synthesized on the device into one file per chapter (a chapter longer
 * than the engine's input limit becomes several consecutive files), so the player gets real seek
 * and speed control. Files live in `cacheDirectory/briefing-tts/{briefing}-{fingerprint}/` with a
 * manifest; a replay of the same script and voice reuses them, and every other folder is deleted
 * (only the current briefing is kept). Logout deletes the whole directory.
 *
 * Voice: the best offline `tr-TR` voice, then any Turkish voice, otherwise the platform default for
 * the language. A module that is missing or fails lets the player fall back to expo-speech.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { nativeTts, type NativeVoice } from './native';

export type { NativeVoice as TtsVoice } from './native';

export const TTS_CACHE_DIR = 'briefing-tts/';
const MANIFEST = 'manifest.json';
/** Kept below the engine limit (Android: 4,000 characters). */
const INPUT_MARGIN = 100;

export interface TtsChapter {
  readonly index: number;
  readonly title: string;
  readonly text: string;
}

export interface TtsTrack {
  readonly chapter: number;
  readonly uri: string;
  readonly durationS: number;
}

export interface TtsResult {
  readonly voice: NativeVoice | null;
  readonly tracks: readonly TtsTrack[];
  readonly cached: boolean;
}

export function isTtsAvailable(): boolean {
  return nativeTts() !== null;
}

function languageTag(tag: string): string {
  return tag.replace(/_/g, '-').toLowerCase();
}

const QUALITY_RANK: Readonly<Record<NativeVoice['quality'], number>> = {
  default: 0,
  enhanced: 1,
  premium: 2,
};

/** The best voice for `language`: exact region first, offline before network, then quality. */
export function selectVoice(voices: readonly NativeVoice[], language: string): NativeVoice | null {
  const wanted = languageTag(language);
  const base = wanted.split('-')[0] ?? wanted;
  const exact = voices.filter((v) => languageTag(v.language) === wanted);
  const family = voices.filter((v) => languageTag(v.language).split('-')[0] === base);
  const pool = exact.length > 0 ? exact : family;
  const score = (v: NativeVoice) => (v.networkRequired ? 0 : 10) + QUALITY_RANK[v.quality];
  return [...pool].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Splits at sentence ends into parts of at most `max` characters (words are never cut). */
export function splitForSynthesis(text: string, max: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean === '') return [];
  if (clean.length <= max) return [clean];
  const units = clean.match(/[^.!?…]+[.!?…]*\s*/g) ?? [clean];
  const parts: string[] = [];
  let current = '';
  const push = () => {
    if (current.trim() !== '') parts.push(current.trim());
    current = '';
  };
  for (const unit of units) {
    if ((current + unit).length <= max) {
      current += unit;
      continue;
    }
    push();
    if (unit.length <= max) {
      current = unit;
      continue;
    }
    for (const word of unit.split(' ')) {
      if ((current + word).length + 1 > max) push();
      current += `${word} `;
    }
  }
  push();
  return parts;
}

/** FNV-1a 32-bit, hex: the cache fingerprint of a script + voice. */
export function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function cacheRoot(): string | null {
  return FileSystem.cacheDirectory === null ? null : `${FileSystem.cacheDirectory}${TTS_CACHE_DIR}`;
}

async function readManifest(dir: string): Promise<TtsTrack[] | null> {
  try {
    const info = await FileSystem.getInfoAsync(`${dir}${MANIFEST}`);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(`${dir}${MANIFEST}`)) as {
      v?: unknown;
      tracks?: TtsTrack[];
    };
    if (parsed.v !== 1 || !Array.isArray(parsed.tracks) || parsed.tracks.length === 0) return null;
    for (const track of parsed.tracks) {
      if (!(await FileSystem.getInfoAsync(track.uri)).exists) return null;
    }
    return parsed.tracks;
  } catch {
    return null;
  }
}

/** Deletes every cached folder except `keep` (the briefing being played). */
export async function pruneTtsCache(keep: string | null): Promise<void> {
  const root = cacheRoot();
  if (root === null || !(await FileSystem.getInfoAsync(root)).exists) return;
  for (const entry of await FileSystem.readDirectoryAsync(root)) {
    if (entry !== keep) await FileSystem.deleteAsync(`${root}${entry}`, { idempotent: true });
  }
}

/** Logout (CTL-3.13): every synthesized file goes. */
export async function clearTtsCache(): Promise<void> {
  const root = cacheRoot();
  if (root !== null) await FileSystem.deleteAsync(root, { idempotent: true });
}

export interface SynthesizeInput {
  /** The briefing id (cache folder prefix). */
  readonly key: string;
  readonly language: string;
  readonly chapters: readonly TtsChapter[];
}

/** Synthesizes (or reuses) one file per chapter part; throws when the module is unavailable. */
export async function synthesizeChapters(input: SynthesizeInput): Promise<TtsResult> {
  const native = nativeTts();
  const root = cacheRoot();
  if (native === null || root === null) throw new Error('tts_unavailable');
  const voice = selectVoice(await native.getVoices(), input.language);
  const script = input.chapters.map((c) => [c.index, c.text]);
  const folder = `${input.key.replace(/[^A-Za-z0-9-]/g, '')}-${fingerprint(
    JSON.stringify([input.language, voice?.identifier ?? null, script]),
  )}`;
  const dir = `${root}${folder}/`;
  await pruneTtsCache(folder);
  const cached = await readManifest(dir);
  if (cached !== null) return { voice, tracks: cached, cached: true };

  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const extension = Platform.OS === 'ios' ? 'caf' : 'wav';
  const limit = native.maxInputLength;
  const max = limit !== undefined && limit > INPUT_MARGIN * 2 ? limit - INPUT_MARGIN : 100_000;
  const tracks: TtsTrack[] = [];
  try {
    for (const chapter of input.chapters) {
      const parts = splitForSynthesis(chapter.text, max);
      for (const [part, text] of parts.entries()) {
        const out = await native.synthesizeToFile(text, {
          voice: voice?.identifier ?? null,
          language: input.language,
          uri: `${dir}${String(chapter.index)}-${String(part)}.${extension}`,
        });
        tracks.push({
          chapter: chapter.index,
          uri: out.uri,
          durationS: Math.max(0, out.durationMs / 1000),
        });
      }
    }
    if (tracks.length === 0) throw new Error('tts_empty_script');
    await FileSystem.writeAsStringAsync(`${dir}${MANIFEST}`, JSON.stringify({ v: 1, tracks }));
  } catch (error) {
    await FileSystem.deleteAsync(dir, { idempotent: true });
    throw error;
  }
  return { voice, tracks, cached: false };
}
