/**
 * The audio briefing player's session (M-BR-02, M-GL-14; SCREEN_AND_FLOW_MAP `usePlayerStore`).
 * Playback lives outside the full-screen player: the listen screen starts a session with the
 * source it prepared (premium file, synthesized chapter files or expo-speech sentences); the
 * `AudioPlayerHost` in the root layout owns the players for that session and publishes their
 * state and controls here; the full player and the mini player only read the state and call the
 * controls. Collapsing the full player therefore keeps playback running (the mini player docks
 * above the tab bar and on the briefing screen); closing the mini player stops the session.
 */
import type { BriefingKind } from '@da/domain';
import { useSyncExternalStore } from 'react';

import type { TtsTrack } from '../../../../modules/da-tts/src';

export const RATES = [1, 1.25, 1.5] as const;
export type Rate = (typeof RATES)[number];
export const SKIP_S = 15;

export interface PlayerChapter {
  readonly key: string;
  readonly title: string;
  readonly startS: number;
  readonly durationS: number;
}

export type PlayerSource =
  | {
      /** Premium (server) audio or a cached file. */
      readonly kind: 'file';
      readonly uri: string;
      readonly chapters: readonly PlayerChapter[];
      readonly durationS: number;
    }
  | {
      /** Device voice synthesized to one file per chapter part (`da-tts`). */
      readonly kind: 'tracks';
      readonly tracks: readonly TtsTrack[];
      readonly chapterTitles: Readonly<Record<number, string>>;
    }
  | {
      /** expo-speech, sentence by sentence (the last resort). */
      readonly kind: 'speech';
      readonly chapters: readonly { index: number; title: string; text: string }[];
      readonly language: string;
    };

export interface PlayerSession {
  /** Changes with every new session: the host remounts its engine on it. */
  readonly id: number;
  readonly briefingId: string;
  readonly kind: BriefingKind;
  /** "Sabah Brifingi" (the kind label; the mini player adds the chapter). */
  readonly title: string;
  readonly source: PlayerSource;
  readonly autoplay: boolean;
}

export interface PlayerStatus {
  readonly loaded: boolean;
  readonly playing: boolean;
  readonly positionS: number;
  readonly durationS: number;
  readonly rate: Rate;
  readonly chapters: readonly PlayerChapter[];
  readonly activeKey: string | null;
}

export interface PlayerControls {
  readonly toggle: () => void;
  readonly seek: (seconds: number, method: 'skip' | 'scrub' | 'chapter') => void;
  readonly skip: (deltaS: number) => void;
  readonly cycleRate: () => void;
  readonly selectChapter: (key: string) => void;
  /** Pauses and releases the lock-screen controls (the session is ending). */
  readonly stop: () => void;
}

export const IDLE_STATUS: PlayerStatus = {
  loaded: false,
  playing: false,
  positionS: 0,
  durationS: 0,
  rate: 1,
  chapters: [],
  activeKey: null,
};

export function nextRate(rate: Rate): Rate {
  const index = RATES.indexOf(rate);
  return RATES[(index + 1) % RATES.length] ?? 1;
}

export function clampSeek(position: number, delta: number, duration: number): number {
  return Math.max(0, Math.min(duration, position + delta));
}

/** "0:42" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

/** Stable identity of a source: an unchanged source keeps the running session. */
export function sourceKey(source: PlayerSource): string {
  switch (source.kind) {
    case 'file':
      return `file:${source.uri}`;
    case 'tracks':
      return `tracks:${source.tracks.map((t) => t.uri).join('|')}`;
    case 'speech':
      return `speech:${source.language}:${String(source.chapters.length)}`;
  }
}

let session: PlayerSession | null = null;
let status: PlayerStatus = IDLE_STATUS;
let controls: PlayerControls | null = null;
let counter = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentSession(): PlayerSession | null {
  return session;
}

export function currentStatus(): PlayerStatus {
  return status;
}

export function currentControls(): PlayerControls | null {
  return controls;
}

/**
 * Starts playback of a briefing. The same briefing with the same source keeps the running session
 * (re-opening the full player from the mini player); anything else replaces it.
 */
export function startSession(input: Omit<PlayerSession, 'id'>): PlayerSession {
  if (
    session !== null &&
    session.briefingId === input.briefingId &&
    sourceKey(session.source) === sourceKey(input.source)
  ) {
    return session;
  }
  controls?.stop();
  counter += 1;
  session = { ...input, id: counter };
  status = IDLE_STATUS;
  controls = null;
  emit();
  return session;
}

/** Ends the session: the host unmounts the engine, which releases its players. */
export function stopSession(): void {
  if (session === null) return;
  controls?.stop();
  session = null;
  status = IDLE_STATUS;
  controls = null;
  emit();
}

function same(a: PlayerStatus, b: PlayerStatus): boolean {
  return (
    a.loaded === b.loaded &&
    a.playing === b.playing &&
    Math.abs(a.positionS - b.positionS) < 0.05 &&
    Math.abs(a.durationS - b.durationS) < 0.05 &&
    a.rate === b.rate &&
    a.chapters === b.chapters &&
    a.activeKey === b.activeKey
  );
}

/** Called by the engine of session `id` (a stale engine's updates are ignored). */
export function publishStatus(id: number, next: PlayerStatus): void {
  if (session?.id !== id || same(status, next)) return;
  status = next;
  emit();
}

export function registerControls(id: number, next: PlayerControls | null): void {
  if (session?.id !== id) return;
  controls = next;
  emit();
}

export function usePlayerSession(): PlayerSession | null {
  return useSyncExternalStore(subscribe, currentSession, currentSession);
}

export function usePlayerStatus(): PlayerStatus {
  return useSyncExternalStore(subscribe, currentStatus, currentStatus);
}

export function usePlayerControls(): PlayerControls | null {
  return useSyncExternalStore(subscribe, currentControls, currentControls);
}

/** Test seam. */
export function resetPlayerForTests(): void {
  session = null;
  status = IDLE_STATUS;
  controls = null;
  emit();
}
