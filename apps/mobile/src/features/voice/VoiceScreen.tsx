/**
 * M-VOICE-01 Ses Modu (`/voice`, full-screen modal on the `night` gradient; params `origin`,
 * `threadId`, `contactId`): hands-free questions over the user's data (M§25). Tap the orb to
 * speak (barge-in stops the spoken answer); the transcript goes to the same answer stream as chat
 * with `input_mode:'voice'`; the answer is spoken with `expo-speech` (off by default with a screen
 * reader, "Yanıtı oku" instead). Any write arrives as a compact approval card approved ONLY by a
 * tap (`approved_via='voice_card'`, R-03, C-07): a spoken "onayla" never approves — it is answered
 * with "Onaylamak için ekrandaki Onayla'ya dokun." "Brifingimi oku." is a deterministic intent
 * (Pro: the briefing player; Free: the Pro gate).
 */
import { useBootstrap } from '@da/api-client/react';
import { foldForSearch, toUpper } from '@da/i18n';
import {
  Button,
  ChipWrap,
  DetailHeader,
  GradientSurface,
  Text,
  TextAction,
  TranscriptText,
  VoiceOrb,
  VoicePromptChip,
  VoiceWaveform,
  useTheme,
  useUiPreferences,
} from '@da/ui';
import * as Speech from 'expo-speech';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { isUuid } from '@da/domain';
import { getSupabase } from '../../lib/auth/supabase';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { sheets } from '../../providers/SheetHost';
import { APPROVAL_EDITOR_SHEET } from '../approvals/editor-key';
import type { ApprovalModel } from '../approvals/model';
import { ContextualGate, isPro } from '../pro-gate/ProGate';
import { AnswerParts } from '../assistant/AnswerParts';
import { useChatStream } from '../assistant/stream';
import { speechEngine, useSpeechInput, type SpeechError } from './speech';

type VoicePhase = 'idle' | 'listening' | 'processing' | 'answering' | 'error';

const APPROVE_WORDS = ['onayla', 'onaylıyorum', 'onayladım', 'evet onayla', 'approve'];

/** A spoken "onayla" (TR casefold) — never an approval (R-03). */
export function isSpokenApproval(text: string): boolean {
  const folded = foldForSearch(text)
    .replace(/[.!?,]/g, '')
    .trim();
  return APPROVE_WORDS.some((word) => folded === foldForSearch(word));
}

/** "Brifingimi oku." and close variants (deterministic, not LLM). */
export function isBriefingIntent(text: string): boolean {
  const folded = foldForSearch(text);
  return folded.includes('brifing') && (folded.includes('oku') || folded.includes('dinle'));
}

function durationBucket(ms: number): '<5s' | '5-15s' | '15-60s' | '>60s' {
  if (ms < 5_000) return '<5s';
  if (ms < 15_000) return '5-15s';
  return ms < 60_000 ? '15-60s' : '>60s';
}

async function latestBriefingId(): Promise<string | null> {
  const { data } = (await getSupabase()
    .from('briefings')
    .select('id')
    .in('status', ['ready', 'delivered'])
    .order('generated_at', { ascending: false })
    .limit(1)) as { data: { id: string }[] | null };
  return data?.[0]?.id ?? null;
}

const ORIGINS = ['assistant', 'today', 'widget', 'deeplink', 'briefing'] as const;

export function VoiceScreen() {
  const params = useLocalSearchParams<{ origin?: string; threadId?: string; contactId?: string }>();
  const t = useTranslations('voice');
  const common = useTranslations('common');
  const states = useTranslations('states');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const bootstrap = useBootstrap();
  const { screenReaderEnabled } = useUiPreferences();
  const serverAllowed =
    bootstrap.data?.flags['voice.stt_server'] !== false &&
    bootstrap.data?.flags['feature.voice'] !== false;
  const engine = speechEngine(serverAllowed);
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<SpeechError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [briefingGate, setBriefingGate] = useState(false);
  const threadId =
    params.threadId !== undefined && isUuid(params.threadId) ? params.threadId : null;
  const contactId =
    params.contactId !== undefined && isUuid(params.contactId) ? params.contactId : null;
  const stream = useChatStream({ threadId, contactId, screen: 'M-VOICE-01' });
  const live = stream.live;
  const spoken = useRef<string | null>(null);
  const origin = (ORIGINS as readonly (string | undefined)[]).includes(params.origin)
    ? (params.origin as (typeof ORIGINS)[number])
    : 'deeplink';

  useEffect(() => {
    track('voice_session_started', { origin });
    return () => {
      void Speech.stop();
    };
  }, [origin]);

  const speak = (text: string) => {
    if (screenReaderEnabled) return;
    void Speech.stop();
    Speech.speak(text, { language: 'tr-TR' });
    track('voice_tts_played', { engine: 'native' });
  };

  const pendingApproval = (live?.approvals ?? []).some((a) => a.status === 'pending');

  const handleText = async (text: string) => {
    setTranscript(text);
    if (isSpokenApproval(text)) {
      // R-03 / C-07: a spoken approval is never executed.
      track('voice_intent', { kind: 'action' });
      const reply = t('tapToApproveSpoken');
      setNotice(reply);
      speak(reply);
      setPhase(pendingApproval ? 'answering' : 'idle');
      return;
    }
    if (isBriefingIntent(text)) {
      track('voice_intent', { kind: 'briefing' });
      if (!isPro()) {
        setBriefingGate(true);
        setPhase('idle');
        return;
      }
      const id = await latestBriefingId();
      if (id !== null && isScreenAvailable(`/briefing/${id}/listen`)) {
        router.replace(`/briefing/${id}/listen`);
      }
      return;
    }
    if (!online) {
      setNotice(t('offline'));
      setPhase('error');
      return;
    }
    track('voice_intent', { kind: 'question' });
    setPhase('processing');
    await stream.send(text, {
      inputMode: 'voice',
      ...(contactId === null ? {} : { entity: { type: 'contact', id: contactId } }),
    });
  };

  const speech = useSpeechInput(engine, {
    onFinal: (text, used, durationMs) => {
      track('voice_stt_completed', {
        engine: used,
        success: true,
        duration_bucket: durationBucket(durationMs),
      });
      void handleText(text);
    },
    onError: (next) => {
      track('voice_stt_completed', {
        engine: engine === 'server' ? 'server' : 'on_device',
        success: false,
        duration_bucket: '<5s',
      });
      if (next === 'permission') track('voice_permission_result', { granted: false, kind: 'mic' });
      setError(next);
      setPhase('error');
    },
  });

  useEffect(() => {
    if (live === null) return;
    if (live.phase === 'complete' && live.text !== '' && spoken.current !== live.clientMessageId) {
      spoken.current = live.clientMessageId;
      speak(live.text);
    }
    // Speak each completed answer once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.phase, live?.text, live?.clientMessageId]);

  const tapOrb = () => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    void Speech.stop();
    setError(null);
    setNotice(null);
    setBriefingGate(false);
    void speech.start().then((ok) => {
      if (ok) {
        track('voice_permission_result', { granted: true, kind: 'mic' });
        setPhase('listening');
      }
    });
  };

  const close = () => {
    speech.abort();
    stream.stop();
    void Speech.stop();
    if (router.canGoBack()) router.back();
    else router.replace('/assistant');
  };

  const editApproval = (model: ApprovalModel) => {
    // C-07: "Düzenle" leaves voice mode for the typed editor.
    close();
    sheets.open(APPROVAL_EDITOR_SHEET, { approvalId: model.id, mode: 'edit' });
  };

  const answered = live !== null && (live.phase === 'complete' || live.phase === 'error');
  const status =
    phase === 'listening' || speech.listening
      ? t('listening')
      : phase === 'processing' && !answered
        ? t('processing')
        : phase === 'answering' || answered
          ? t('answering')
          : t('idle');

  const errorText =
    error === 'permission'
      ? t('permission.title')
      : error === 'no_speech'
        ? t('noSpeech')
        : error === 'unavailable'
          ? t('unavailable')
          : error === 'network'
            ? t('network')
            : error === 'interrupted'
              ? t('interrupted')
              : error === 'failed'
                ? t('notUnderstood')
                : null;

  const chips = [t('chips.today'), t('chips.briefing'), t('chips.tomorrow')];
  const lang: 'tr' | 'en' = 'tr';
  return (
    <GradientSurface
      gradient="night"
      radius="none"
      style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}
      testID="screen.voice"
    >
      <DetailHeader
        leading="close"
        onLeadingPress={close}
        leadingAccessibilityLabel={common('actions.close')}
        kicker={toUpper(t('kicker'), lang)}
        onGradient
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenX }]}
      >
        <View style={styles.orb}>
          <VoiceOrb
            listening={speech.listening}
            level={speech.level}
            onPress={tapOrb}
            accessibilityLabel={speech.listening ? t('stopListening') : t('startListening')}
            testID="voice.orb"
          />
          <VoiceWaveform active={speech.listening} />
          <Text
            variant="secondary"
            tone="onGradientSecondary"
            accessibilityLiveRegion="polite"
            testID="voice.status"
          >
            {status}
          </Text>
        </View>
        {speech.interim !== '' || transcript !== '' ? (
          <TranscriptText
            text={speech.listening ? speech.interim : transcript}
            testID="voice.transcript"
          />
        ) : null}
        {errorText !== null ? (
          <View style={styles.block} testID="voice.error">
            <Text variant="body" tone="onGradient" accessibilityRole="alert">
              {errorText}
            </Text>
            {error === 'permission' ? (
              <Button
                label={common('actions.openSettings')}
                variant="inverse"
                onPress={() => {
                  void Linking.openSettings();
                }}
                testID="voice.openSettings"
              />
            ) : null}
            {error === 'permission' || error === 'unavailable' || error === 'failed' ? (
              <TextAction
                label={t('askWithText')}
                onPress={() => {
                  close();
                  router.push(
                    transcript === ''
                      ? '/chat/new'
                      : `/chat/new?prompt=${encodeURIComponent(transcript)}`,
                  );
                }}
                testID="voice.askWithText"
              />
            ) : null}
          </View>
        ) : null}
        {notice !== null ? (
          <Text
            variant="body"
            tone="onGradient"
            accessibilityLiveRegion="assertive"
            testID="voice.notice"
          >
            {notice}
          </Text>
        ) : null}
        {briefingGate ? (
          <View style={styles.block}>
            <ContextualGate
              feature="voice_briefing"
              title={t('briefingGate.title')}
              body={t('briefingGate.body')}
              testID="voice.briefingGate"
            />
          </View>
        ) : null}
        {live !== null && live.text !== '' ? (
          <View style={styles.block} testID="voice.answer">
            <Text variant="body" tone="onGradient" accessibilityLiveRegion="polite">
              {live.text}
            </Text>
            {screenReaderEnabled ? (
              <TextAction
                label={t('readAnswer')}
                onPress={() => {
                  Speech.speak(live.text, { language: 'tr-TR' });
                }}
                testID="voice.readAnswer"
              />
            ) : null}
          </View>
        ) : null}
        {live?.phase === 'error' ? (
          <Text
            variant="body"
            tone="onGradient"
            accessibilityRole="alert"
            testID="voice.streamError"
          >
            {live.error?.kind === 'ai_unavailable'
              ? states('error.aiUnavailable.title')
              : live.error?.kind === 'ai_limit'
                ? states('limit.ai.title')
                : t('network')}
          </Text>
        ) : null}
        {live !== null ? (
          <AnswerParts
            citations={live.citations}
            cards={live.cards}
            approvals={live.approvals}
            via="voice_card"
            variant="compact"
            rejectReason="user_cancel"
            approvalHint={t('tapToApprove')}
            onEditApproval={editApproval}
            testID="voice.parts"
          />
        ) : null}
        {live !== null && stream.threadId() !== null && isScreenAvailable('/chat/:threadId') ? (
          <TextAction
            label={t('continueWithText')}
            onPress={() => {
              const id = stream.threadId();
              close();
              if (id !== null) router.push(`/chat/${id}`);
            }}
            testID="voice.continueText"
          />
        ) : null}
        {phase === 'idle' && live === null ? (
          <ChipWrap>
            {chips.map((chip) => (
              <VoicePromptChip
                key={chip}
                label={chip}
                onPress={() => {
                  void handleText(chip);
                }}
                testID={`voice.chip.${chip}`}
              />
            ))}
          </ChipWrap>
        ) : null}
      </ScrollView>
    </GradientSurface>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 18, paddingBottom: 24 },
  orb: { alignItems: 'center', gap: 14, paddingVertical: 24 },
  block: { gap: 10 },
});
