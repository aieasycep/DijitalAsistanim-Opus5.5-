/**
 * Native-TTS fallback timeline (M-BR-02, D-19): each chapter is split into sentences whose position
 * and duration are estimated at 14.5 characters per second at 1.0×. Skips move by estimated
 * sentences (±15 s snaps to a sentence boundary), chapters jump to their first sentence, and the
 * position shown is the start of the sentence being spoken. Pure; the speech driver lives in the
 * player screen.
 */
export const CHARS_PER_SECOND = 14.5;

export interface TtsChapterInput {
  readonly index: number;
  readonly title: string;
  readonly text: string;
}

export interface TtsSentence {
  readonly chapter: number;
  readonly text: string;
  readonly startS: number;
  readonly durationS: number;
}

export function splitSentences(text: string): readonly string[] {
  return (text.match(/[^.!?…]+[.!?…]*/g) ?? []).map((s) => s.trim()).filter((s) => s !== '');
}

export function buildQueue(chapters: readonly TtsChapterInput[]): readonly TtsSentence[] {
  const queue: TtsSentence[] = [];
  let at = 0;
  for (const chapter of chapters) {
    for (const sentence of splitSentences(chapter.text)) {
      const durationS = Math.max(1, sentence.length / CHARS_PER_SECOND);
      queue.push({ chapter: chapter.index, text: sentence, startS: at, durationS });
      at += durationS;
    }
  }
  return queue;
}

export function totalDuration(queue: readonly TtsSentence[]): number {
  const last = queue.at(-1);
  return last === undefined ? 0 : last.startS + last.durationS;
}

/** The sentence playing at `positionS`. */
export function sentenceAt(queue: readonly TtsSentence[], positionS: number): number {
  if (queue.length === 0) return 0;
  let index = 0;
  for (let i = 0; i < queue.length; i++) {
    if ((queue[i]?.startS ?? 0) <= positionS) index = i;
    else break;
  }
  return index;
}

/** ±`deltaS` from the current sentence, snapped to the sentence that contains the target. */
export function skip(queue: readonly TtsSentence[], current: number, deltaS: number): number {
  const start = queue[current]?.startS ?? 0;
  const target = Math.max(0, Math.min(totalDuration(queue), start + deltaS));
  return sentenceAt(queue, target);
}

export function chapterStart(queue: readonly TtsSentence[], chapter: number): number {
  const index = queue.findIndex((s) => s.chapter === chapter);
  return index === -1 ? 0 : index;
}
