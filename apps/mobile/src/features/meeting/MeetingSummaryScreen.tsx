/**
 * M-MEET-03 · 2 Dakikalık Özet: the "Nerede kalmıştınız?" reading view of the prep's grounded
 * summary (from the M-MEET-01 cache, so it works offline) with its sources, read aloud paragraph by
 * paragraph with the device voice (`expo-speech`: no seek, so "Önceki/Sonraki bölüm" skip
 * paragraphs; speeds 1.0 → 1.25 → 1.5). Closing stops the audio.
 *
 * Premium audio (T-8.14, API-MEET-04): for Pro users online, `POST /meetings/:eventId/prep/audio`
 * with the prep's `source_hash`; `premium` → the signed file is downloaded (the briefing audio
 * cache, deleted at logout) and played with expo-audio like the briefing Listen screen (chapter
 * skips, 1.0/1.25/1.5×, lock-screen controls). `native` (flag off, no credential, still
 * generating: polled) or any error keeps the device voice. The server stays authoritative.
 */
import {
  meetingPrepAudioQueryOptions,
  meetingPrepQueryOptions,
  useApiClient,
} from '@da/api-client/react';
import {
  Button,
  EditorialParagraph,
  EmptyState,
  IconButton,
  PressableScale,
  SkeletonBlock,
  SourceChip,
  ChipWrap,
  SpeedPill,
  Text,
  useTheme,
  useToast,
  type IconName,
} from '@da/ui';
import type { MeetingPrepView } from '@da/validation/api/meetings';
import { useQuery } from '@tanstack/react-query';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Speech from 'expo-speech';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { useFormats, useSessionContext } from '../../lib/data/session';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { openMenu } from '../actions/sheets';
import { downloadAudio } from '../briefing/audio-cache';
import { DetailScreen, useBack } from '../actions/ui';
import { prepSourcePath } from './data';

const SPEEDS = [1, 1.25, 1.5] as const;
type Speed = (typeof SPEEDS)[number];
type SourceRef = MeetingPrepView['talking_points'][number]['sources'][number];

export function summaryParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

function speedLabel(speed: Speed): '1' | '1.25' | '1.5' {
  return speed === 1 ? '1' : speed === 1.25 ? '1.25' : '1.5';
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

/** Polls a `native` answer while JOB-30 renders the premium file. */
const PREMIUM_POLL_MS = 5_000;

interface PremiumChapter {
  readonly index: number;
  readonly title: string;
  readonly start_s: number;
}

/** The start of the chapter before / after `position` (chapter skips, like the Listen screen). */
export function chapterSkip(
  chapters: readonly PremiumChapter[],
  position: number,
  direction: -1 | 1,
): number {
  const starts = [...new Set([0, ...chapters.map((c) => c.start_s)])].sort((a, b) => a - b);
  if (direction === 1) return starts.find((s) => s > position + 0.5) ?? position;
  // Back: the current chapter's start, or the previous one when within its first 2 s.
  const before = starts.filter((s) => s <= position - 2);
  return before[before.length - 1] ?? 0;
}

/** The premium file player (expo-audio), in the reading view's footer. */
function PremiumSummaryPlayer({
  uri,
  title,
  chapters,
  durationS,
}: {
  readonly uri: string;
  readonly title: string;
  readonly chapters: readonly PremiumChapter[];
  readonly durationS: number;
}) {
  const t = useTranslations('meeting.summaryScreen');
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const [speed, setSpeed] = useState<Speed>(1);
  const played = useRef(false);
  const duration = status.duration > 0 ? status.duration : durationS;
  const position = status.currentTime;

  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
    player.setActiveForLockScreen(true, { title, artist: 'Dijital Asistan' });
    // Set up once per file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (!played.current) {
      played.current = true;
      track('meeting_summary_audio_played', { engine: 'premium', speed: speedLabel(speed) });
    }
    if (status.didJustFinish || (duration > 0 && position >= duration)) void player.seekTo(0);
    player.play();
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} testID="summary.premium">
      <IconButton
        icon="arrow_back"
        variant="plain"
        accessibilityLabel={t('previous')}
        disabled={position < 1}
        onPress={() => {
          void player.seekTo(chapterSkip(chapters, position, -1));
        }}
        testID="summary.premium.prev"
      />
      <IconButton
        icon={status.playing ? 'pause' : 'play_arrow'}
        variant="play"
        accessibilityLabel={status.playing ? t('pause') : t('listen')}
        disabled={!status.isLoaded}
        onPress={toggle}
        testID="summary.premium.playPause"
      />
      <IconButton
        icon="arrow_forward"
        variant="plain"
        accessibilityLabel={t('next')}
        disabled={chapterSkip(chapters, position, 1) === position}
        onPress={() => {
          void player.seekTo(chapterSkip(chapters, position, 1));
        }}
        testID="summary.premium.next"
      />
      <View style={{ flex: 1 }} />
      <Text variant="meta" tone="secondary" numeric>
        {t('premiumProgress', { position: clock(position), duration: clock(duration) })}
      </Text>
      <SpeedPill
        label={t('speed', { speed: speedLabel(speed) })}
        accessibilityLabel={t('speedA11y', { speed: speedLabel(speed) })}
        onPress={() => {
          const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;
          setSpeed(next);
          player.setPlaybackRate(next, 'high');
        }}
        testID="summary.premium.speed"
      />
    </View>
  );
}

export function MeetingSummaryScreen() {
  const t = useTranslations('meeting.summaryScreen');
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const client = useApiClient();
  const formats = useFormats();
  const session = useSessionContext();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const back = useBack(`/meeting/${eventId}/prep` as Href);
  const prep = useQuery({ ...meetingPrepQueryOptions(client, eventId), enabled: session.isPro });
  const view = prep.data?.prep;
  const summary = view?.two_minute_summary ?? null;
  const paragraphs = summary === null ? [] : summaryParagraphs(summary.text);
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [speed, setSpeed] = useState<Speed>(1);
  // Each utterance belongs to a run; callbacks from a stopped run are ignored.
  const run = useRef(0);
  const online = useOnline();
  const audio = useQuery({
    ...meetingPrepAudioQueryOptions(client, eventId, view?.source_hash ?? ''),
    enabled: session.isPro && online && view?.status === 'ready' && summary !== null,
    refetchInterval: (q) =>
      q.state.data?.mode === 'native' && q.state.data.premium_status === 'generating'
        ? PREMIUM_POLL_MS
        : false,
  });
  const premiumAudio = audio.data?.mode === 'premium' ? audio.data : null;
  const [premiumUri, setPremiumUri] = useState<string | null>(null);
  const signedUrl = premiumAudio?.signed_url ?? null;
  const prepId = view?.id ?? null;
  useEffect(() => {
    if (signedUrl === null || prepId === null) return;
    let live = true;
    downloadAudio(`meeting-${prepId}`, signedUrl).then(
      (uri) => {
        if (live) setPremiumUri(uri);
      },
      () => undefined, // A failed download keeps the device voice.
    );
    return () => {
      live = false;
    };
  }, [signedUrl, prepId]);
  // Premium takes over only before the device voice started (no switch mid-reading).
  const premium = premiumUri !== null && premiumAudio !== null && !playing && index === 0;
  const generating = audio.data?.mode === 'native' && audio.data.premium_status === 'generating';

  useEffect(() => {
    track('meeting_summary_opened');
    return () => {
      run.current += 1;
      void Speech.stop();
    };
  }, []);

  const speakFrom = (at: number, rate: Speed) => {
    run.current += 1;
    const current = run.current;
    void Speech.stop();
    const text = paragraphs[at];
    if (text === undefined) {
      setPlaying(false);
      setIndex(0);
      return;
    }
    setIndex(at);
    setPlaying(true);
    Speech.speak(text, {
      language: session.locale === 'en' ? 'en-US' : 'tr-TR',
      rate,
      onDone: () => {
        if (run.current !== current) return;
        speakFrom(at + 1, rate);
      },
      onError: () => {
        if (run.current !== current) return;
        setPlaying(false);
      },
    });
  };

  const play = async () => {
    const wanted = session.locale === 'en' ? 'en' : 'tr';
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      if (voices.length > 0 && !voices.some((v) => v.language.toLowerCase().startsWith(wanted))) {
        toast.show({
          message: Platform.OS === 'ios' ? t('noVoiceIos') : t('noVoiceAndroid'),
          kind: 'neutral',
        });
        return;
      }
    } catch {
      // Voice listing is best effort; speaking still reports its own errors.
    }
    track('meeting_summary_audio_played', { engine: 'native', speed: speedLabel(speed) });
    speakFrom(index, speed);
  };

  const pause = () => {
    run.current += 1;
    setPlaying(false);
    void Speech.stop();
  };

  const openSources = (refs: readonly SourceRef[], type: SourceRef['source_type']) => {
    const openable = refs.filter((ref) => prepSourcePath(ref, isScreenAvailable) !== null);
    const go = (ref: SourceRef) => {
      const path = prepSourcePath(ref, isScreenAvailable);
      if (path === null) return;
      pause();
      track('meeting_summary_source_opened', { type });
      router.push(path);
    };
    const [only] = openable;
    if (openable.length === 1 && only !== undefined) {
      go(only);
      return;
    }
    openMenu({
      title: t('sources'),
      options: openable.map((ref, i) => ({
        key: String(i),
        label: ref.label ?? formats.dayMonth(ref.source_timestamp),
        onPress: () => {
          go(ref);
        },
      })),
    });
  };

  const sources = summary?.sources ?? [];
  const groups = [
    {
      type: 'email_message' as const,
      icon: 'mail' as IconName,
      label: (n: number) => t('mailCount', { count: n }),
    },
    {
      type: 'meeting_note' as const,
      icon: 'edit_note' as IconName,
      label: (n: number) => t('noteCount', { count: n }),
    },
    {
      type: 'calendar_event' as const,
      icon: 'event' as IconName,
      label: (n: number) => t('eventCount', { count: n }),
    },
    {
      type: 'capture' as const,
      icon: 'description' as IconName,
      label: (n: number) => t('fileCount', { count: n }),
    },
  ]
    .map((g) => ({ ...g, refs: sources.filter((s) => s.source_type === g.type) }))
    .filter((g) => g.refs.length > 0);

  const person = view?.people[0]?.name ?? view?.event.title ?? '';
  const failed = view?.status === 'failed' || (view?.status === 'ready' && summary === null);

  return (
    <DetailScreen
      kicker={t('kicker')}
      leading="close"
      onLeadingPress={() => {
        pause();
        back();
      }}
      trailing={
        paragraphs.length === 0 || premium ? undefined : (
          <IconButton
            icon={playing ? 'pause' : 'headphones'}
            variant="plain"
            accessibilityLabel={playing ? t('pause') : t('listen')}
            accessibilityHint={t('listenHint')}
            onPress={() => {
              if (playing) pause();
              else void play();
            }}
            testID="summary.listen"
          />
        )
      }
      {...(premium
        ? {
            footer: (
              <PremiumSummaryPlayer
                uri={premiumUri}
                title={t('kicker')}
                chapters={premiumAudio.chapters}
                durationS={premiumAudio.duration_s}
              />
            ),
          }
        : paragraphs.length === 0 || (!playing && index === 0)
          ? {}
          : {
              footer: (
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                  testID="summary.player"
                >
                  <IconButton
                    icon="arrow_back"
                    variant="plain"
                    accessibilityLabel={t('previous')}
                    disabled={index === 0}
                    onPress={() => {
                      speakFrom(Math.max(0, index - 1), speed);
                    }}
                    testID="summary.prev"
                  />
                  <IconButton
                    icon={playing ? 'pause' : 'play_arrow'}
                    variant="play"
                    accessibilityLabel={playing ? t('pause') : t('listen')}
                    onPress={() => {
                      if (playing) pause();
                      else void play();
                    }}
                    testID="summary.playPause"
                  />
                  <IconButton
                    icon="arrow_forward"
                    variant="plain"
                    accessibilityLabel={t('next')}
                    disabled={index >= paragraphs.length - 1}
                    onPress={() => {
                      speakFrom(Math.min(paragraphs.length - 1, index + 1), speed);
                    }}
                    testID="summary.next"
                  />
                  <View style={{ flex: 1 }} />
                  <Text variant="meta" tone="secondary" numeric>
                    {t('progress', { current: index + 1, total: paragraphs.length })}
                  </Text>
                  <SpeedPill
                    label={t('speed', { speed: speedLabel(speed) })}
                    accessibilityLabel={t('speedA11y', { speed: speedLabel(speed) })}
                    onPress={() => {
                      const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;
                      setSpeed(next);
                      if (playing) speakFrom(index, next);
                    }}
                    testID="summary.speed"
                  />
                </View>
              ),
            })}
      testID="summary.screen"
    >
      {view === undefined || view.status === 'generating' ? (
        <View style={{ gap: 12 }} testID="summary.loading">
          <SkeletonBlock height={30} width="70%" />
          <SkeletonBlock height={120} />
          <SkeletonBlock height={120} />
        </View>
      ) : failed ? (
        <EmptyState
          icon="error"
          tone="neutral"
          title={t('failed')}
          action={{ label: t('backToPrep'), onPress: back }}
          testID="summary.failed"
        />
      ) : (
        <View style={{ gap: 16 }}>
          <View style={{ gap: 6 }}>
            <Text variant="editorialQuote" tone="secondary">
              {[person, formats.time(view.event.start)].filter((p) => p !== '').join(' · ')}
            </Text>
            <Text variant="editorialTitle" heading>
              {t('title')}
            </Text>
          </View>
          {paragraphs.map((paragraph, i) => {
            const active = playing && i === index;
            return (
              <PressableScale
                key={`p-${String(i)}`}
                feedback="none"
                onLongPress={() => {
                  openSources(sources, 'email_message');
                }}
                accessibilityHint={t('showSource')}
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: active ? theme.color.brand.primary : 'transparent',
                  paddingLeft: 10,
                }}
                testID={`summary.paragraph.${String(i)}`}
              >
                <EditorialParagraph spans={[{ key: 'p', text: paragraph }]} variant="reading" />
              </PressableScale>
            );
          })}
          {groups.length === 0 ? null : (
            <View style={{ gap: 8 }}>
              <Text variant="kicker" tone="secondary">
                {t('sources')}
              </Text>
              <ChipWrap>
                {groups.map((group) => (
                  <SourceChip
                    key={group.type}
                    icon={group.icon}
                    label={group.label(group.refs.length)}
                    onPress={() => {
                      openSources(group.refs, group.type);
                    }}
                    testID={`summary.source.${group.type}`}
                  />
                ))}
              </ChipWrap>
            </View>
          )}
          <Text variant="meta" tone="secondary" testID="summary.voiceNotice">
            {premium ? t('premiumVoice') : generating ? t('premiumGenerating') : t('deviceVoice')}
          </Text>
          {!playing && index > 0 ? (
            <Button
              label={t('restart')}
              variant="text"
              onPress={() => {
                speakFrom(0, speed);
              }}
            />
          ) : null}
        </View>
      )}
    </DetailScreen>
  );
}
