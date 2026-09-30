/**
 * M-BR-02 audio briefing player (`briefing/[id]/listen`, full-screen modal, `?autoplay=1`).
 * `POST /briefings/:id/audio` (API-BRF-01, used as a query; 402 for Free → the gate) decides the
 * source, which this screen prepares and hands to the player session (`player/store.ts`):
 * - premium: the signed file is downloaded (cached per version) and played with expo-audio —
 *   play/pause, exact ±15 s seeks, scrubbing, 1.0/1.25/1.5×, chapters, lock-screen controls;
 * - native: the chapter script is synthesized on the device into one file per chapter
 *   (`da-tts`, T-8.27: tr-TR voice, cached per briefing) and played as an expo-audio playlist with
 *   exact seeks, speeds and chapters; when the module is missing or synthesis fails
 *   (`briefing_audio_fallback{reason:'tts_unavailable'}`) the script is read with expo-speech
 *   sentence by sentence as the last resort (D-19: estimated positions, ±15 s by sentences,
 *   Android pause = stop and resume from the sentence). Both carry the honest notice "Cihaz
 *   sesiyle okunuyor"; without a Turkish voice the KPL-25 note offers the voice-data install
 *   (Android) or the Settings path (iOS).
 * A failed file offers the device voice (`prefer:'native'`); offline plays a cached file.
 * The players live in `AudioPlayerHost` (root layout): collapsing this screen keeps playback
 * running and docks the mini player (M-GL-14); re-opening it from the mini player shows the
 * running session instead of starting over.
 */
import { briefingAudioQueryOptions, useApiClient } from '@da/api-client/react';
import { formatDatePattern } from '@da/i18n';
import {
  Button,
  ErrorCard,
  FullPlayer,
  GradientSurface,
  Spinner,
  Text,
  TextAction,
  useTheme,
} from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale, useTranslations } from 'use-intl';

import { isTtsAvailable, synthesizeChapters } from '../../../modules/da-tts/src';
import { track } from '../../lib/events';
import { cachedBootstrap } from '../../lib/postgrest';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { ContextualGate, isPro } from '../pro-gate/ProGate';
import { hasTurkishVoice, openVoiceDataInstall } from '../voice/availability';
import { cachedAudioFile, downloadAudio } from './audio-cache';
import { useBriefing } from './data';
import {
  clock,
  currentSession,
  SKIP_S,
  startSession,
  usePlayerControls,
  usePlayerSession,
  usePlayerStatus,
  type PlayerSession,
  type PlayerSource,
} from './player/store';

export { locateTrack, trackOffsets } from './player/AudioPlayerHost';
export { clampSeek, nextRate, RATES, SKIP_S } from './player/store';

interface PlayerChrome {
  readonly kicker: string;
  readonly date: string;
  readonly onClose: () => void;
}

/** The full player over the running session (every control acts on the session's engine). */
function PlayerView({
  session,
  chrome,
}: {
  readonly session: PlayerSession;
  readonly chrome: PlayerChrome;
}) {
  const t = useTranslations('briefing.audio');
  const status = usePlayerStatus();
  const controls = usePlayerControls();
  const device = session.source.kind !== 'file';
  const active = status.chapters.find((c) => c.key === status.activeKey) ?? status.chapters[0];
  const rateText = status.rate === 1 ? '1.0' : String(status.rate);
  return (
    <FullPlayer
      kicker={chrome.kicker}
      title={session.title}
      meta={[chrome.date, clock(status.durationS), active?.title ?? '']
        .filter((p) => p !== '')
        .join(' · ')}
      onCollapse={chrome.onClose}
      collapseLabel={t('close')}
      {...(device ? { notice: t('nativeNotice') } : {})}
      speed={{
        label: t('rateLabel', { rate: rateText }),
        accessibilityLabel: t('speedA11y', { rate: String(status.rate) }),
        onPress: () => controls?.cycleRate(),
      }}
      progress={status.durationS > 0 ? status.positionS / status.durationS : 0}
      playing={status.playing}
      scrubber={{
        positionS: status.positionS,
        durationS: status.durationS,
        onSeek: (seconds) => controls?.seek(seconds, 'scrub'),
        valueText: t('seekA11y', {
          position: clock(status.positionS),
          duration: clock(status.durationS),
        }),
        accessibilityLabel: t('scrubber'),
        step: SKIP_S,
      }}
      transport={{
        playing: status.playing,
        loading: controls === null || !status.loaded,
        onPlayPause: () => controls?.toggle(),
        onSkipBack: () => controls?.skip(-SKIP_S),
        onSkipForward: () => controls?.skip(SKIP_S),
        playLabel: t('play'),
        pauseLabel: t('pause'),
        skipBackLabel: t('back15'),
        skipForwardLabel: t('forward15'),
        skipCaption: String(SKIP_S),
      }}
      chapters={{
        chapters: status.chapters.map((c, i) => ({
          key: c.key,
          index: String(i + 1),
          title: c.title,
          duration: clock(c.durationS),
        })),
        ...(active === undefined ? {} : { activeKey: active.key }),
        onSelect: (key) => controls?.selectChapter(key),
        playingLabel: t('nowPlaying'),
      }}
      testID={
        session.source.kind === 'file'
          ? 'player.premium'
          : session.source.kind === 'tracks'
            ? 'player.synthesized'
            : 'player.native'
      }
    />
  );
}

/** Hands a prepared source to the player session once. */
function Begin({
  source,
  onBegin,
  label,
}: {
  readonly source: PlayerSource;
  readonly onBegin: (source: PlayerSource) => void;
  readonly label: string;
}) {
  useEffect(() => {
    onBegin(source);
    // Start once per prepared source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
  return <Preparing label={label} />;
}

function Preparing({ label, onClose }: { readonly label: string; readonly onClose?: () => void }) {
  const common = useTranslations('common');
  return (
    <View style={styles.loading} accessible accessibilityLabel={label} testID="listen.loading">
      <Spinner tone="onGradient" size={22} />
      <Text variant="body" tone="onGradient">
        {label}
      </Text>
      {onClose === undefined ? null : (
        <Button
          label={common('actions.close')}
          variant="ghost"
          onPress={onClose}
          testID="listen.synthesizing.close"
        />
      )}
    </View>
  );
}

type DeviceVoiceState =
  | { readonly kind: 'synthesizing' }
  | { readonly kind: 'files'; readonly source: PlayerSource }
  | { readonly kind: 'speech'; readonly source: PlayerSource };

/**
 * Native mode: synthesized files when `da-tts` is linked (T-8.27), expo-speech as the last resort.
 */
function DeviceVoiceSource({
  briefingId,
  chapters,
  language,
  onBegin,
  onClose,
}: {
  readonly briefingId: string;
  readonly chapters: readonly { index: number; title: string; text: string }[];
  readonly language: string;
  readonly onBegin: (source: PlayerSource) => void;
  readonly onClose: () => void;
}) {
  const t = useTranslations('briefing');
  const speech = useMemo(
    (): PlayerSource => ({ kind: 'speech', chapters, language }),
    [chapters, language],
  );
  const [state, setState] = useState<DeviceVoiceState>(() =>
    isTtsAvailable() && chapters.length > 0
      ? { kind: 'synthesizing' }
      : { kind: 'speech', source: speech },
  );

  useEffect(() => {
    if (state.kind !== 'synthesizing') return;
    let active = true;
    synthesizeChapters({ key: briefingId, language, chapters }).then(
      (result) => {
        if (!active) return;
        setState({
          kind: 'files',
          source: {
            kind: 'tracks',
            tracks: result.tracks,
            chapterTitles: Object.fromEntries(chapters.map((c) => [c.index, c.title])),
          },
        });
      },
      () => {
        if (!active) return;
        track('briefing_audio_fallback', { reason: 'tts_unavailable' });
        setState({ kind: 'speech', source: speech });
      },
    );
    return () => {
      active = false;
    };
  }, [state.kind, briefingId, language, chapters, speech]);

  if (state.kind === 'synthesizing') {
    return (
      <View testID="listen.synthesizing" style={styles.fill}>
        <Preparing label={t('audio.preparing')} onClose={onClose} />
      </View>
    );
  }
  return <Begin source={state.source} onBegin={onBegin} label={t('audio.preparing')} />;
}

/**
 * KPL-25: without an installed Turkish voice the device voice is poor or silent. Android offers
 * the engine's voice-data install; iOS explains the Settings path (there is no install screen).
 */
function TurkishVoiceNote() {
  const t = useTranslations('briefing.audio.voice');
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let active = true;
    hasTurkishVoice().then(
      (has) => {
        if (active) setMissing(!has);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);
  if (!missing) return null;
  return (
    <View style={styles.voiceNote} testID="listen.noTurkishVoice">
      <Text variant="bodyXs" tone="onGradientSecondary" accessibilityRole="alert">
        {Platform.OS === 'android' ? t('missing') : `${t('missing')} ${t('iosHelp')}`}
      </Text>
      {Platform.OS === 'android' ? (
        <TextAction
          label={t('install')}
          onPress={() => {
            void openVoiceDataInstall().then((opened) => {
              if (!opened) showToast({ message: t('installFailed'), kind: 'error' });
            });
          }}
          testID="listen.installVoice"
        />
      ) : null}
    </View>
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
  const session = usePlayerSession();
  // Re-opened from the mini player: the running session is shown as it is.
  const [attached] = useState(() => currentSession()?.briefingId === id);
  const live = session !== null && session.briefingId === id ? session : null;
  const [prefer, setPrefer] = useState<'premium' | 'native'>('premium');
  const briefing = useBriefing(id);
  const audio = useQuery({
    ...briefingAudioQueryOptions(api, id, prefer),
    enabled: pro && online && !attached,
  });
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
  const kind = row?.kind ?? live?.kind ?? 'morning';
  const lang = locale === 'en' ? 'en' : 'tr';
  const chrome: PlayerChrome = {
    kicker: t('audio.title'),
    date:
      row === undefined
        ? ''
        : formatDatePattern(`${row.local_date}T12:00:00Z`, 'dayMonth', {
            locale: lang,
            ...(cachedBootstrap()?.preferences.timezone === undefined
              ? {}
              : { timeZone: cachedBootstrap()?.preferences.timezone }),
          }),
    onClose: close,
  };
  const begin = (source: PlayerSource) => {
    startSession({ briefingId: id, kind, title: t(`kinds.${kind}`), source, autoplay });
  };

  let body;
  if (!pro) {
    body = <ContextualGate feature="voice_briefing" onDismiss={close} testID="listen.gate" />;
  } else if (live !== null) {
    body = (
      <>
        <PlayerView session={live} chrome={chrome} />
        {live.source.kind === 'file' ? null : <TurkishVoiceNote />}
      </>
    );
  } else if (!online && cachedUri !== null) {
    body = (
      <Begin
        source={{
          kind: 'file',
          uri: cachedUri,
          chapters: [],
          durationS: row?.audio_duration_s ?? 0,
        }}
        onBegin={begin}
        label={t('audio.preparing')}
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
    body = <Preparing label={t('audio.preparing')} />;
  } else if (audio.data.mode === 'premium' && fileUri !== null) {
    body = (
      <Begin
        source={{
          kind: 'file',
          uri: fileUri,
          chapters: audio.data.chapters.map((c) => ({
            key: String(c.index),
            title: c.title,
            startS: c.start_s,
            durationS: c.duration_s,
          })),
          durationS: audio.data.duration_s,
        }}
        onBegin={begin}
        label={t('audio.preparing')}
      />
    );
  } else if (audio.data.mode === 'native') {
    body = (
      <DeviceVoiceSource
        briefingId={id}
        chapters={audio.data.chapters}
        language={audio.data.language}
        onBegin={begin}
        onClose={close}
      />
    );
  }

  // The full player has its own collapse control; every other state offers "Kapat".
  const hideClose =
    pro &&
    body !== undefined &&
    (live !== null || audio.data !== undefined || cachedUri !== null) &&
    !audio.isError &&
    !downloadFailed;
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
        {hideClose ? null : (
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
  voiceNote: { gap: 6, paddingBottom: 12 },
});
