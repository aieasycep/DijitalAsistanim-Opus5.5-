/**
 * M-BR-02 audio briefing player (`briefing/[id]/listen`, full-screen modal, `?autoplay=1`).
 * `POST /briefings/:id/audio` (API-BRF-01, used as a query; 402 for Free → the gate):
 * - premium: the signed file is downloaded (cached per version) and played with expo-audio —
 *   play/pause, exact ±15 s seeks, scrubbing, 1.0/1.25/1.5×, chapters, lock-screen controls;
 * - native: the chapter script is read with expo-speech sentence by sentence (D-19: estimated
 *   positions, ±15 s by sentences, Android pause = stop and resume from the sentence), with the
 *   honest notice "Cihaz sesiyle okunuyor". The on-device synth-to-file module is T-8.27.
 * A failed file offers the device voice (`prefer:'native'`); offline plays a cached file.
 */
import { briefingAudioQueryOptions, useApiClient } from '@da/api-client/react';
import { formatDatePattern } from '@da/i18n';
import { useQuery } from '@tanstack/react-query';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale, useTranslations } from 'use-intl';
import { Button, ErrorCard, FullPlayer, GradientSurface, Spinner, Text, useTheme } from '@da/ui';

import { track } from '../../lib/events';
import { cachedBootstrap } from '../../lib/postgrest';
import { useOnline } from '../../lib/query/online-manager';
import { ContextualGate, isPro } from '../pro-gate/ProGate';
import { cachedAudioFile, downloadAudio } from './audio-cache';
import { useBriefing } from './data';
import {
  buildQueue,
  chapterStart,
  sentenceAt,
  skip as skipSentences,
  totalDuration,
} from './tts-queue';

export const SKIP_S = 15;
export const RATES = [1, 1.25, 1.5] as const;
type Rate = (typeof RATES)[number];

export function clampSeek(position: number, delta: number, duration: number): number {
  return Math.max(0, Math.min(duration, position + delta));
}

export function nextRate(rate: Rate): Rate {
  const index = RATES.indexOf(rate);
  return RATES[(index + 1) % RATES.length] ?? 1;
}

function bucketOf(position: number, duration: number): 0 | 25 | 50 | 75 | 100 {
  if (duration <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, position / duration));
  const value = Math.round(ratio * 4) * 25;
  return value as 0 | 25 | 50 | 75 | 100;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

interface Chapter {
  readonly key: string;
  readonly title: string;
  readonly startS: number;
  readonly durationS: number;
}

interface PlayerChrome {
  readonly kicker: string;
  readonly title: string;
  readonly date: string;
  readonly kind: 'morning' | 'midday' | 'evening' | 'weekly';
  readonly onClose: () => void;
}

function PremiumPlayer({
  chrome,
  uri,
  chapters,
  durationS,
  autoplay,
}: {
  readonly chrome: PlayerChrome;
  readonly uri: string;
  readonly chapters: readonly Chapter[];
  readonly durationS: number;
  readonly autoplay: boolean;
}) {
  const t = useTranslations('briefing.audio');
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const [rate, setRate] = useState<Rate>(1);
  const position = status.currentTime;
  const duration = status.duration > 0 ? status.duration : durationS;
  const positionRef = useRef(0);
  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
    player.setActiveForLockScreen(
      true,
      { title: chrome.title, artist: 'Dijital Asistan' },
      {
        showSeekForward: true,
        showSeekBackward: true,
      },
    );
    if (autoplay) player.play();
    return () => {
      track('briefing_audio_played', {
        kind: chrome.kind,
        mode: 'premium_tts',
        completion_bucket: bucketOf(positionRef.current, duration),
      });
    };
    // Set up once per file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  const seek = (seconds: number, method: 'skip' | 'scrub' | 'chapter') => {
    track('briefing_audio_seek', { method });
    void player.seekTo(Math.max(0, Math.min(duration, seconds)));
  };
  const active = [...chapters].reverse().find((c) => c.startS <= position) ?? chapters[0];
  return (
    <FullPlayer
      kicker={chrome.kicker}
      title={chrome.title}
      meta={[chrome.date, clock(duration), active?.title ?? ''].filter((p) => p !== '').join(' · ')}
      onCollapse={chrome.onClose}
      collapseLabel={t('close')}
      speed={{
        label: t('rateLabel', { rate: rate === 1 ? '1.0' : String(rate) }),
        accessibilityLabel: t('speedA11y', { rate: String(rate) }),
        onPress: () => {
          const next = nextRate(rate);
          setRate(next);
          player.setPlaybackRate(next, 'high');
          track('briefing_audio_speed_changed', { rate: next === 1 ? '1' : String(next) });
        },
      }}
      progress={duration > 0 ? position / duration : 0}
      playing={status.playing}
      scrubber={{
        positionS: position,
        durationS: duration,
        onSeek: (seconds) => {
          seek(seconds, 'scrub');
        },
        valueText: t('seekA11y', { position: clock(position), duration: clock(duration) }),
        accessibilityLabel: t('scrubber'),
        step: SKIP_S,
      }}
      transport={{
        playing: status.playing,
        loading: !status.isLoaded,
        onPlayPause: () => {
          if (status.playing) {
            player.pause();
            track('briefing_audio_pause');
          } else {
            if (status.didJustFinish || (duration > 0 && position >= duration))
              void player.seekTo(0);
            player.play();
          }
        },
        onSkipBack: () => {
          seek(clampSeek(position, -SKIP_S, duration), 'skip');
        },
        onSkipForward: () => {
          seek(clampSeek(position, SKIP_S, duration), 'skip');
        },
        playLabel: t('play'),
        pauseLabel: t('pause'),
        skipBackLabel: t('back15'),
        skipForwardLabel: t('forward15'),
        skipCaption: String(SKIP_S),
      }}
      chapters={{
        chapters: chapters.map((c, i) => ({
          key: c.key,
          index: String(i + 1),
          title: c.title,
          duration: clock(c.durationS),
        })),
        ...(active === undefined ? {} : { activeKey: active.key }),
        onSelect: (key) => {
          const chapter = chapters.find((c) => c.key === key);
          if (chapter !== undefined) seek(chapter.startS, 'chapter');
        },
        playingLabel: t('nowPlaying'),
      }}
      testID="player.premium"
    />
  );
}

function NativePlayer({
  chrome,
  chapters,
  language,
  autoplay,
}: {
  readonly chrome: PlayerChrome;
  readonly chapters: readonly { index: number; title: string; text: string }[];
  readonly language: string;
  readonly autoplay: boolean;
}) {
  const t = useTranslations('briefing.audio');
  const queue = useMemo(() => buildQueue(chapters), [chapters]);
  const duration = totalDuration(queue);
  const [index, setIndex] = useState(0);
  const startPlaying = autoplay && queue.length > 0;
  const [playing, setPlaying] = useState(startPlaying);
  const [rate, setRate] = useState<Rate>(1);
  const indexRef = useRef(0);
  const playingRef = useRef(startPlaying);
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
        language,
        rate,
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
      track('briefing_audio_played', {
        kind: chrome.kind,
        mode: 'native_tts',
        completion_bucket: bucketOf(queue[indexRef.current]?.startS ?? 0, duration),
      });
    };
    // Start once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jump = (target: number, method: 'skip' | 'scrub' | 'chapter') => {
    track('briefing_audio_seek', { method });
    indexRef.current = target;
    setIndex(target);
    if (playingRef.current) speakFrom(target);
  };
  const position = queue[index]?.startS ?? 0;
  const activeChapter = queue[index]?.chapter ?? chapters[0]?.index ?? 0;
  return (
    <FullPlayer
      kicker={chrome.kicker}
      title={chrome.title}
      meta={[
        chrome.date,
        clock(duration),
        chapters.find((c) => c.index === activeChapter)?.title ?? '',
      ]
        .filter((p) => p !== '')
        .join(' · ')}
      onCollapse={chrome.onClose}
      collapseLabel={t('close')}
      notice={t('nativeNotice')}
      speed={{
        label: t('rateLabel', { rate: rate === 1 ? '1.0' : String(rate) }),
        accessibilityLabel: t('speedA11y', { rate: String(rate) }),
        onPress: () => {
          const next = nextRate(rate);
          setRate(next);
          track('briefing_audio_speed_changed', { rate: next === 1 ? '1' : String(next) });
        },
      }}
      progress={duration > 0 ? position / duration : 0}
      playing={playing}
      scrubber={{
        positionS: position,
        durationS: duration,
        onSeek: (seconds) => {
          jump(sentenceAt(queue, seconds), 'scrub');
        },
        valueText: t('seekA11y', { position: clock(position), duration: clock(duration) }),
        accessibilityLabel: t('scrubber'),
        step: SKIP_S,
      }}
      transport={{
        playing,
        onPlayPause: () => {
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
        onSkipBack: () => {
          jump(skipSentences(queue, index, -SKIP_S), 'skip');
        },
        onSkipForward: () => {
          jump(skipSentences(queue, index, SKIP_S), 'skip');
        },
        playLabel: t('play'),
        pauseLabel: t('pause'),
        skipBackLabel: t('back15'),
        skipForwardLabel: t('forward15'),
        skipCaption: String(SKIP_S),
      }}
      chapters={{
        chapters: chapters.map((c, i) => ({
          key: String(c.index),
          index: String(i + 1),
          title: c.title,
          duration: clock(
            queue.filter((s) => s.chapter === c.index).reduce((sum, s) => sum + s.durationS, 0),
          ),
        })),
        activeKey: String(activeChapter),
        onSelect: (key) => {
          jump(chapterStart(queue, Number(key)), 'chapter');
        },
        playingLabel: t('nowPlaying'),
      }}
      testID="player.native"
    />
  );
}

export function ListenScreen() {
  const t = useTranslations('briefing');
  const common = useTranslations('common');
  const locale = useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApiClient();
  const online = useOnline();
  const params = useLocalSearchParams<{ id: string; autoplay?: string }>();
  const id = params.id;
  const autoplay = params.autoplay === '1';
  const pro = isPro();
  const [prefer, setPrefer] = useState<'premium' | 'native'>('premium');
  const briefing = useBriefing(id);
  const audio = useQuery({ ...briefingAudioQueryOptions(api, id, prefer), enabled: pro && online });
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [cachedUri, setCachedUri] = useState<string | null>(null);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace(`/briefing/${id}`);
  };

  useEffect(() => {
    const data = audio.data;
    if (data?.mode !== 'premium') return;
    let active = true;
    const attempt = (retries: number) => {
      downloadAudio(id, data.url).then(
        (uri) => {
          if (active) setFileUri(uri);
        },
        () => {
          if (!active) return;
          if (retries > 0) attempt(retries - 1);
          else {
            setDownloadFailed(true);
            track('briefing_audio_fallback', { reason: 'network' });
          }
        },
      );
    };
    attempt(1);
    return () => {
      active = false;
    };
  }, [audio.data, id]);

  useEffect(() => {
    if (online) return;
    const path = cachedAudioFile(id);
    if (path === null) return;
    void FileSystem.getInfoAsync(path).then((info) => {
      if (info.exists) setCachedUri(path);
    });
  }, [id, online]);

  const row = briefing.data?.briefing;
  const kind = row?.kind ?? 'morning';
  const lang = locale === 'en' ? 'en' : 'tr';
  const chrome: PlayerChrome = {
    kicker: t('audio.title'),
    title: t(`kinds.${kind}`),
    date:
      row === undefined
        ? ''
        : formatDatePattern(`${row.local_date}T12:00:00Z`, 'dayMonth', {
            locale: lang,
            ...(cachedBootstrap()?.preferences.timezone === undefined
              ? {}
              : { timeZone: cachedBootstrap()?.preferences.timezone }),
          }),
    kind,
    onClose: close,
  };

  let body;
  if (!pro) {
    body = <ContextualGate feature="voice_briefing" onDismiss={close} testID="listen.gate" />;
  } else if (!online && cachedUri !== null) {
    body = (
      <PremiumPlayer
        chrome={chrome}
        uri={cachedUri}
        chapters={[]}
        durationS={row?.audio_duration_s ?? 0}
        autoplay={autoplay}
      />
    );
  } else if (!online) {
    body = (
      <ErrorCard
        icon="wifi_off"
        tone="neutral"
        title={t('audio.offline')}
        testID="listen.offline"
      />
    );
  } else if (audio.isError || downloadFailed) {
    body = (
      <ErrorCard
        icon="error"
        tone="neutral"
        title={t('audio.failed')}
        primaryAction={{
          label: t('audio.useDevice'),
          onPress: () => {
            setDownloadFailed(false);
            track('briefing_audio_fallback', { reason: 'generation_failed' });
            setPrefer('native');
          },
        }}
        testID="listen.failed"
      />
    );
  } else if (audio.data === undefined || (audio.data.mode === 'premium' && fileUri === null)) {
    body = (
      <View
        style={styles.loading}
        accessible
        accessibilityLabel={t('audio.preparing')}
        testID="listen.loading"
      >
        <Spinner tone="onGradient" size={22} />
        <Text variant="body" tone="onGradient">
          {t('audio.preparing')}
        </Text>
      </View>
    );
  } else if (audio.data.mode === 'premium' && fileUri !== null) {
    body = (
      <PremiumPlayer
        chrome={chrome}
        uri={fileUri}
        chapters={audio.data.chapters.map((c) => ({
          key: String(c.index),
          title: c.title,
          startS: c.start_s,
          durationS: c.duration_s,
        }))}
        durationS={audio.data.duration_s}
        autoplay={autoplay}
      />
    );
  } else if (audio.data.mode === 'native') {
    body = (
      <NativePlayer
        chrome={chrome}
        chapters={audio.data.chapters}
        language={audio.data.language}
        autoplay={autoplay}
      />
    );
  }

  return (
    <GradientSurface gradient="night" radius="none" style={styles.fill}>
      <View
        style={[
          styles.fill,
          {
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            paddingHorizontal: theme.layout.screenX,
          },
        ]}
        testID="screen.listen"
      >
        {pro &&
        body !== undefined &&
        (audio.data !== undefined || cachedUri !== null) &&
        !audio.isError &&
        !downloadFailed ? null : (
          <Button
            label={common('actions.close')}
            variant="ghost"
            onPress={close}
            testID="listen.close"
          />
        )}
        {body}
      </View>
    </GradientSurface>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});
