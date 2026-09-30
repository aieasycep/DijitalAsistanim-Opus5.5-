/**
 * `AudioPlayerHost` (SCREEN_AND_FLOW_MAP M-BR-02 / M-GL-14): mounted once in the root layout, it
 * owns the players of the current audio briefing session (`store.ts`), so playback survives the
 * full-screen player being collapsed. One engine per source:
 * - premium file: `expo-audio` player — exact seeks, 1.0/1.25/1.5×, chapters, lock-screen controls;
 * - synthesized chapter files (`da-tts`): an `expo-audio` playlist with the same controls;
 * - expo-speech sentences (the last resort, D-19): estimated positions, ±15 s by sentences,
 *   Android pause = stop and resume from the sentence.
 * Each engine publishes its state and controls to the store and renders nothing. Ending a session
 * (closing the mini player, sign-out, another briefing) unmounts it, which releases the players;
 * `briefing_audio_played` reports the completion bucket then.
 */
import type { BriefingKind } from '@da/domain';
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioPlaylist,
  useAudioPlaylistStatus,
  type AudioPlaylist,
} from 'expo-audio';
import * as Speech from 'expo-speech';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import type { TtsTrack } from '../../../../modules/da-tts/src';
import { LOGOUT_HOOKS, registerLogoutCleanup } from '../../../lib/auth/logout';
import { track } from '../../../lib/events';
import {
  buildQueue,
  chapterStart,
  sentenceAt,
  skip as skipSentences,
  totalDuration,
} from '../tts-queue';
import {
  clampSeek,
  nextRate,
  publishStatus,
  registerControls,
  stopSession,
  usePlayerSession,
  type PlayerChapter,
  type PlayerControls,
  type PlayerSession,
  type PlayerSource,
  type Rate,
} from './store';

function bucketOf(position: number, duration: number): 0 | 25 | 50 | 75 | 100 {
  if (duration <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, position / duration));
  return (Math.round(ratio * 4) * 25) as 0 | 25 | 50 | 75 | 100;
}

function activeChapter(chapters: readonly PlayerChapter[], position: number) {
  return [...chapters].reverse().find((c) => c.startS <= position) ?? chapters[0];
}

/** Start of each synthesized file on the briefing timeline. */
export function trackOffsets(tracks: readonly TtsTrack[]): number[] {
  const offsets: number[] = [];
  let at = 0;
  for (const item of tracks) {
    offsets.push(at);
    at += item.durationS;
  }
  return offsets;
}

/** The file and the position inside it for a position on the whole timeline. */
export function locateTrack(
  tracks: readonly TtsTrack[],
  seconds: number,
): { index: number; offset: number } {
  const offsets = trackOffsets(tracks);
  let index = 0;
  for (let i = 0; i < tracks.length; i++) {
    if ((offsets[i] ?? 0) <= seconds) index = i;
    else break;
  }
  const durationS = tracks[index]?.durationS ?? 0;
  return { index, offset: Math.max(0, Math.min(durationS, seconds - (offsets[index] ?? 0))) };
}

/** The playlist speed is a property of the native shared object. */
function setPlaylistRate(playlist: AudioPlaylist, rate: number): void {
  playlist.playbackRate = rate;
}

function backgroundAudio(): void {
  void setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  });
}

/** Registers stable controls that always act on the latest render's handlers. */
function useControls(session: PlayerSession, controls: PlayerControls): void {
  const latest = useRef(controls);
  useEffect(() => {
    latest.current = controls;
  });
  useEffect(() => {
    registerControls(session.id, {
      toggle: () => {
        latest.current.toggle();
      },
      seek: (seconds, method) => {
        latest.current.seek(seconds, method);
      },
      skip: (deltaS) => {
        latest.current.skip(deltaS);
      },
      cycleRate: () => {
        latest.current.cycleRate();
      },
      selectChapter: (key) => {
        latest.current.selectChapter(key);
      },
      stop: () => {
        latest.current.stop();
      },
    });
  }, [session.id]);
}

function playedEvent(kind: BriefingKind, mode: 'premium_tts' | 'native_tts', bucket: number) {
  track('briefing_audio_played', {
    kind,
    mode,
    completion_bucket: bucket,
  });
}

function FileEngine({
  session,
  source,
}: {
  readonly session: PlayerSession;
  readonly source: Extract<PlayerSource, { kind: 'file' }>;
}) {
  const player = useAudioPlayer({ uri: source.uri });
  const status = useAudioPlayerStatus(player);
  const [rate, setRate] = useState<Rate>(1);
  const duration = status.duration > 0 ? status.duration : source.durationS;
  const position = status.currentTime;
  const progress = useRef({ position: 0, duration });
  useEffect(() => {
    progress.current = { position, duration };
  });

  useEffect(() => {
    backgroundAudio();
    player.setActiveForLockScreen(
      true,
      { title: session.title, artist: 'Dijital Asistan' },
      { showSeekForward: true, showSeekBackward: true },
    );
    if (session.autoplay) player.play();
    return () => {
      playedEvent(
        session.kind,
        'premium_tts',
        bucketOf(progress.current.position, progress.current.duration),
      );
    };
    // Set up once per file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  const active = activeChapter(source.chapters, position);
  useEffect(() => {
    publishStatus(session.id, {
      loaded: status.isLoaded,
      playing: status.playing,
      positionS: position,
      durationS: duration,
      rate,
      chapters: source.chapters,
      activeKey: active?.key ?? null,
    });
  });

  const seek = (seconds: number, method: 'skip' | 'scrub' | 'chapter') => {
    track('briefing_audio_seek', { method });
    void player.seekTo(Math.max(0, Math.min(duration, seconds)));
  };
  useControls(session, {
    toggle: () => {
      if (status.playing) {
        player.pause();
        track('briefing_audio_pause');
      } else {
        if (status.didJustFinish || (duration > 0 && position >= duration)) void player.seekTo(0);
        player.play();
      }
    },
    seek,
    skip: (delta) => {
      seek(clampSeek(position, delta, duration), 'skip');
    },
    cycleRate: () => {
      const next = nextRate(rate);
      setRate(next);
      player.setPlaybackRate(next, 'high');
      track('briefing_audio_speed_changed', { rate: next === 1 ? '1' : String(next) });
    },
    selectChapter: (key) => {
      const chapter = source.chapters.find((c) => c.key === key);
      if (chapter !== undefined) seek(chapter.startS, 'chapter');
    },
    stop: () => {
      player.pause();
      player.clearLockScreenControls();
    },
  });
  return null;
}

function TracksEngine({
  session,
  source,
}: {
  readonly session: PlayerSession;
  readonly source: Extract<PlayerSource, { kind: 'tracks' }>;
}) {
  const tracks = source.tracks;
  const sources = useMemo(() => tracks.map((item) => ({ uri: item.uri })), [tracks]);
  const playlist = useAudioPlaylist({ sources });
  const status = useAudioPlaylistStatus(playlist);
  const [rate, setRate] = useState<Rate>(1);
  const offsets = useMemo(() => trackOffsets(tracks), [tracks]);
  const duration = tracks.reduce((sum, item) => sum + item.durationS, 0);
  const position = Math.min(duration, (offsets[status.currentIndex] ?? 0) + status.currentTime);
  const progress = useRef({ position: 0, duration });
  useEffect(() => {
    progress.current = { position, duration };
  });

  useEffect(() => {
    backgroundAudio();
    if (session.autoplay) playlist.play();
    return () => {
      playedEvent(
        session.kind,
        'native_tts',
        bucketOf(progress.current.position, progress.current.duration),
      );
    };
    // Set up once per playlist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist]);

  const chapters = useMemo((): PlayerChapter[] => {
    const keys = [...new Set(tracks.map((item) => item.chapter))];
    return keys.map((chapter) => {
      const first = tracks.findIndex((item) => item.chapter === chapter);
      return {
        key: String(chapter),
        title: source.chapterTitles[chapter] ?? '',
        startS: offsets[first] ?? 0,
        durationS: tracks
          .filter((item) => item.chapter === chapter)
          .reduce((sum, item) => sum + item.durationS, 0),
      };
    });
  }, [tracks, offsets, source.chapterTitles]);
  const active = activeChapter(chapters, position);
  useEffect(() => {
    publishStatus(session.id, {
      loaded: status.isLoaded,
      playing: status.playing,
      positionS: position,
      durationS: duration,
      rate,
      chapters,
      activeKey: active?.key ?? null,
    });
  });

  const atEnd =
    status.currentIndex === tracks.length - 1 &&
    (status.didJustFinish || (duration > 0 && position >= duration - 0.25));
  const seek = (seconds: number, method: 'skip' | 'scrub' | 'chapter') => {
    track('briefing_audio_seek', { method });
    const target = locateTrack(tracks, Math.max(0, Math.min(duration, seconds)));
    if (target.index !== status.currentIndex) playlist.skipTo(target.index);
    void playlist.seekTo(target.offset);
  };
  useControls(session, {
    toggle: () => {
      if (status.playing) {
        playlist.pause();
        track('briefing_audio_pause');
      } else {
        if (atEnd) {
          playlist.skipTo(0);
          void playlist.seekTo(0);
        }
        playlist.play();
      }
    },
    seek,
    skip: (delta) => {
      seek(clampSeek(position, delta, duration), 'skip');
    },
    cycleRate: () => {
      const next = nextRate(rate);
      setRate(next);
      setPlaylistRate(playlist, next);
      track('briefing_audio_speed_changed', { rate: next === 1 ? '1' : String(next) });
    },
    selectChapter: (key) => {
      const chapter = chapters.find((c) => c.key === key);
      if (chapter !== undefined) seek(chapter.startS, 'chapter');
    },
    stop: () => {
      playlist.pause();
    },
  });
  return null;
}

function SpeechEngine({
  session,
  source,
}: {
  readonly session: PlayerSession;
  readonly source: Extract<PlayerSource, { kind: 'speech' }>;
}) {
  const queue = useMemo(() => buildQueue(source.chapters), [source.chapters]);
  const duration = totalDuration(queue);
  const [index, setIndex] = useState(0);
  const startPlaying = session.autoplay && queue.length > 0;
  const [playing, setPlaying] = useState(startPlaying);
  const [rate, setRate] = useState<Rate>(1);
  const indexRef = useRef(0);
  const playingRef = useRef(startPlaying);
  const rateRef = useRef<Rate>(1);
  const token = useRef(0);

  const speakFrom = (start: number) => {
    token.current += 1;
    const run = token.current;
    void Speech.stop();
    const speakAt = (i: number) => {
      const sentence = queue[i];
      if (sentence === undefined || run !== token.current) {
        if (sentence === undefined) {
          playingRef.current = false;
          setPlaying(false);
        }
        return;
      }
      indexRef.current = i;
      setIndex(i);
      Speech.speak(sentence.text, {
        language: source.language,
        rate: rateRef.current,
        onDone: () => {
          if (run === token.current && playingRef.current) speakAt(i + 1);
        },
      });
    };
    speakAt(start);
  };

  useEffect(() => {
    if (startPlaying) speakFrom(0);
    return () => {
      token.current += 1;
      void Speech.stop();
      playedEvent(
        session.kind,
        'native_tts',
        bucketOf(queue[indexRef.current]?.startS ?? 0, duration),
      );
    };
    // Start once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chapters = useMemo(
    (): PlayerChapter[] =>
      source.chapters.map((c) => ({
        key: String(c.index),
        title: c.title,
        startS: queue.find((s) => s.chapter === c.index)?.startS ?? 0,
        durationS: queue
          .filter((s) => s.chapter === c.index)
          .reduce((sum, s) => sum + s.durationS, 0),
      })),
    [queue, source.chapters],
  );
  const position = queue[index]?.startS ?? 0;
  const activeIndex = queue[index]?.chapter ?? source.chapters[0]?.index ?? 0;
  useEffect(() => {
    publishStatus(session.id, {
      loaded: true,
      playing,
      positionS: position,
      durationS: duration,
      rate,
      chapters,
      activeKey: String(activeIndex),
    });
  });

  const jump = (target: number, method: 'skip' | 'scrub' | 'chapter') => {
    track('briefing_audio_seek', { method });
    indexRef.current = target;
    setIndex(target);
    if (playingRef.current) speakFrom(target);
  };
  useControls(session, {
    toggle: () => {
      if (playing) {
        playingRef.current = false;
        setPlaying(false);
        track('briefing_audio_pause');
        if (Platform.OS === 'ios') void Speech.pause();
        else {
          token.current += 1;
          void Speech.stop();
        }
      } else {
        playingRef.current = true;
        setPlaying(true);
        if (Platform.OS === 'ios' && index > 0) void Speech.resume();
        else speakFrom(indexRef.current >= queue.length ? 0 : indexRef.current);
      }
    },
    seek: (seconds, method) => {
      jump(sentenceAt(queue, seconds), method);
    },
    skip: (delta) => {
      jump(skipSentences(queue, index, delta), 'skip');
    },
    cycleRate: () => {
      const next = nextRate(rate);
      setRate(next);
      rateRef.current = next;
      track('briefing_audio_speed_changed', { rate: next === 1 ? '1' : String(next) });
    },
    selectChapter: (key) => {
      jump(chapterStart(queue, Number(key)), 'chapter');
    },
    stop: () => {
      playingRef.current = false;
      token.current += 1;
      void Speech.stop();
    },
  });
  return null;
}

export function AudioPlayerHost(): React.JSX.Element | null {
  const session = usePlayerSession();
  if (session === null) return null;
  switch (session.source.kind) {
    case 'file':
      return <FileEngine key={session.id} session={session} source={session.source} />;
    case 'tracks':
      return <TracksEngine key={session.id} session={session} source={session.source} />;
    case 'speech':
      return <SpeechEngine key={session.id} session={session} source={session.source} />;
  }
}

/** Sign-out ends playback before the audio caches are deleted. */
registerLogoutCleanup(LOGOUT_HOOKS.audioPlayer, stopSession, 'before_sign_out');
