/**
 * M-MEET-03 · 2 Dakikalık Özet: the "Nerede kalmıştınız?" reading view of the prep's grounded
 * summary (from the M-MEET-01 cache, so it works offline) with its sources, read aloud paragraph by
 * paragraph with the device voice (`expo-speech`: no seek, so "Önceki/Sonraki bölüm" skip
 * paragraphs; speeds 1.0 → 1.25 → 1.5). Closing stops the audio.
 */
import { meetingPrepQueryOptions, useApiClient } from '@da/api-client/react';
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
import * as Speech from 'expo-speech';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { useFormats, useSessionContext } from '../../lib/data/session';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { openMenu } from '../actions/sheets';
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
        paragraphs.length === 0 ? undefined : (
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
      {...(paragraphs.length === 0 || (!playing && index === 0)
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
          <Text variant="meta" tone="secondary">
            {t('deviceVoice')}
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
