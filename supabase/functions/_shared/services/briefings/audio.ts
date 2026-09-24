/**
 * Briefing and meeting-prep audio (IMPLEMENTATION_PLAN T-5.09, T-5.10; AI_PIPELINE_PLAN §12.7,
 * §14.2; API-BRF-01, API-MEET-04, JOB-30; M§9, M§25).
 *
 * Chapters follow the master order — 01 "Genel bakış" (hero line + narrative), then one chapter
 * per non-empty section with the section rows read as "{title}, {meta}." — and are renumbered when
 * sections are empty. Native mode returns the chapter scripts for on-device synthesis (`expo-speech`,
 * tr-TR). Premium mode (Pro + `voice.tts_premium` + a usable `(profile, 'tts')` route) renders one
 * MP3 per briefing version in the private `briefing-audio` bucket and serves a 300 s signed URL.
 */
import type { BriefingItemRow } from '../intel/types.ts';
import { isOn } from '../flags.ts';
import { type CopyLocale, message } from '../copy.ts';
import type { AiRuntime } from '../../ai/call.ts';
import type { AiUser } from '../ai/runtime.ts';
import type { AudioChapter, BriefingAudioRow } from '../assist/store.ts';
import { speechAvailable, synthesizeSpeech } from '../voice/speech.ts';

/** ≈130 words per minute (AI_PIPELINE_PLAN §12.7: ~300 words ≈ 2 min 14 s). */
const WORDS_PER_SECOND = 130 / 60;
const CHAPTER_TEXT_MAX = 4000;

export interface ChapterScript {
  readonly index: number;
  readonly title: string;
  readonly text: string;
  readonly est_duration_s: number;
}

export const NATIVE_FALLBACK_NOTICE = 'audio.native_fallback';

function estSeconds(text: string): number {
  const words = text.split(/\s+/).filter((w) => w !== '').length;
  return Math.max(1, Math.round(words / WORDS_PER_SECOND));
}

function sectionTitle(locale: CopyLocale, key: string): string {
  try {
    return message(locale, `briefing.sections.${key}`);
  } catch {
    return key;
  }
}

/** The chapter scripts of a briefing in section order; empty sections are skipped. */
export function briefingChapters(
  briefing: BriefingAudioRow,
  items: readonly BriefingItemRow[],
  locale: CopyLocale,
): ChapterScript[] {
  const scripts: { title: string; text: string }[] = [];
  const overview = [briefing.hero_line ?? '', briefing.narrative ?? '']
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .join(' ');
  if (overview !== '') {
    scripts.push({ title: message(locale, 'briefing.generated.audio.overview'), text: overview });
  }
  const order =
    briefing.sections.length > 0 ? briefing.sections : [...new Set(items.map((i) => i.section))];
  for (const section of order) {
    const rows = items
      .filter((i) => i.section === section)
      .sort((a, b) => a.position - b.position)
      .map((i) =>
        i.meta === null || i.meta.trim() === '' ? `${i.title}.` : `${i.title}, ${i.meta}.`,
      );
    if (rows.length === 0) continue;
    scripts.push({ title: sectionTitle(locale, section), text: rows.join(' ') });
  }
  return scripts.map((s, i) => ({
    index: i + 1,
    title: s.title,
    text: s.text.slice(0, CHAPTER_TEXT_MAX),
    est_duration_s: estSeconds(s.text),
  }));
}

/** JOB-30 idempotency keys (API_CONTRACTS §11.4). */
export function briefingAudioKey(
  target: 'briefing' | 'meeting_prep',
  id: string,
  version: string,
): string {
  return target === 'briefing'
    ? `briefing_audio:${id}:${version}`
    : `briefing_audio:mp:${id}:${version}`;
}

export function briefingAudioPath(userId: string, briefingId: string, version: number): string {
  return `${userId}/${briefingId}/${version}.mp3`;
}

export function meetingAudioPath(userId: string, prepId: string, hash: string): string {
  return `${userId}/meeting_prep/${prepId}/${hash}.mp3`;
}

/** Premium TTS applies: Pro, `voice.tts_premium` on and a usable TTS route with credentials. */
export async function premiumTtsAvailable(runtime: AiRuntime, user: AiUser): Promise<boolean> {
  if (!user.isPro || !isOn(user.flags, 'voice.tts_premium')) return false;
  return await speechAvailable(
    runtime,
    { userId: user.userId, profile: user.profile, flags: user.flags },
    'tts',
  );
}

export type RenderOutcome =
  | {
      readonly kind: 'ok';
      readonly bytes: Uint8Array;
      readonly chapters: AudioChapter[];
      readonly durationS: number;
    }
  | { readonly kind: 'unavailable'; readonly reason: string; readonly retryable: boolean };

/** Synthesizes every chapter through the `(profile, 'tts')` route and joins the MP3 frames. */
export async function renderChapters(
  runtime: AiRuntime,
  user: AiUser,
  chapters: readonly { title: string; text: string }[],
  meta: { correlationId: string; jobId: string | null; signal?: AbortSignal },
): Promise<RenderOutcome> {
  const parts: Uint8Array[] = [];
  const out: AudioChapter[] = [];
  let at = 0;
  for (const [i, chapter] of chapters.entries()) {
    const result = await synthesizeSpeech(
      runtime,
      {
        userId: user.userId,
        plan: user.plan,
        profile: user.profile,
        flags: user.flags,
        correlationId: meta.correlationId,
        jobId: meta.jobId,
        ...(meta.signal === undefined ? {} : { signal: meta.signal }),
      },
      { text: chapter.text, language: user.locale === 'en' ? 'en-US' : 'tr-TR' },
    );
    if (result.kind !== 'ok') return result;
    parts.push(result.bytes);
    const duration = estSeconds(chapter.text);
    out.push({ index: i + 1, title: chapter.title, start_s: at, duration_s: duration });
    at += duration;
  }
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.byteLength;
  }
  return { kind: 'ok', bytes, chapters: out, durationS: at };
}

/** Chapter offsets of a rendered paragraph list (same estimate as the renderer). */
export function paragraphChapters(paragraphs: readonly string[]): AudioChapter[] {
  let at = 0;
  return paragraphs.map((text, i) => {
    const duration = estSeconds(text);
    const chapter = { index: i + 1, title: String(i + 1), start_s: at, duration_s: duration };
    at += duration;
    return chapter;
  });
}
