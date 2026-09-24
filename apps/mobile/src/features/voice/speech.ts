/**
 * Speech input for Voice mode (M-VOICE-01): on-device `expo-speech-recognition` (tr-TR, interim
 * results, 1.2 s silence end-pointing by the recognizer, max 60 s) first; when the device has no
 * on-device recognizer and the server fallback is enabled (`voice.stt_server`), the utterance is
 * recorded with `expo-audio` (AAC) and sent to `POST /assistant/transcribe` (API-AST-03, multipart;
 * the audio is deleted server-side after transcription). Without either engine, voice input is
 * reported unavailable and the screen offers "Metinle sor".
 */
import { apiBaseUrl } from '@da/api-client';
import { TranscribeResponse } from '@da/validation/api/assistant';
import { RecordingPresets, requestRecordingPermissionsAsync, useAudioRecorder } from 'expo-audio';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';

import { currentAccessToken } from '../../lib/auth/supabase';
import { installationId } from '../../lib/auth/first-run-purge';
import { clientHeader } from '../../lib/device';
import { getClientEnv } from '../../lib/env';
import { now } from '../../lib/clock';

export const MAX_UTTERANCE_MS = 60_000;

export type SpeechEngine = 'on_device' | 'server' | 'none';

export type SpeechError =
  'permission' | 'no_speech' | 'unavailable' | 'network' | 'interrupted' | 'failed';

export interface SpeechCallbacks {
  readonly onFinal: (text: string, engine: 'on_device' | 'server', durationMs: number) => void;
  readonly onError: (error: SpeechError) => void;
}

/** Which engine this device can use; `serverAllowed` is the `voice.stt_server` flag. */
export function speechEngine(serverAllowed: boolean): SpeechEngine {
  try {
    if (
      ExpoSpeechRecognitionModule.isRecognitionAvailable() &&
      ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()
    ) {
      return 'on_device';
    }
  } catch {
    // The native module is missing (e.g. a web preview): fall through.
  }
  return serverAllowed ? 'server' : 'none';
}

/** Uploads one recording to API-AST-03 and returns the transcript. */
export async function transcribe(uri: string, durationMs: number): Promise<string> {
  const env = getClientEnv();
  const token = await currentAccessToken();
  const headers: Record<string, string> = {
    apikey: env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    'X-DA-Client': clientHeader(),
    'X-Correlation-Id': Crypto.randomUUID(),
    'Accept-Language': 'tr-TR',
  };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const installation = installationId();
  if (installation !== null) headers['X-DA-Installation-Id'] = installation;
  const response = await FileSystem.uploadAsync(
    `${apiBaseUrl(env.EXPO_PUBLIC_SUPABASE_URL)}/assistant/transcribe`,
    uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'audio',
      mimeType: 'audio/m4a',
      parameters: {
        language: 'tr-TR',
        purpose: 'assistant',
        duration_ms: String(Math.max(1, Math.min(durationMs, MAX_UTTERANCE_MS))),
      },
      headers,
    },
  );
  if (response.status < 200 || response.status >= 300)
    throw new Error(`transcribe_${String(response.status)}`);
  const parsed = TranscribeResponse.safeParse(JSON.parse(response.body));
  if (!parsed.success) throw new Error('transcribe_invalid');
  return parsed.data.data.text;
}

/** The speech input state machine used by Voice mode. */
export function useSpeechInput(engine: SpeechEngine, callbacks: SpeechCallbacks) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [level, setLevel] = useState(0);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const startedAt = useRef(0);
  const finalText = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef(callbacks);
  useEffect(() => {
    cb.current = callbacks;
  }, [callbacks]);

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript ?? '';
    setInterim(transcript);
    if (event.isFinal) finalText.current = transcript;
  });
  useSpeechRecognitionEvent('volumechange', (event) => {
    setLevel(Math.max(0, Math.min(1, (event.value + 2) / 12)));
  });
  useSpeechRecognitionEvent('end', () => {
    if (engine !== 'on_device') return;
    setListening(false);
    if (timer.current !== null) clearTimeout(timer.current);
    const text = finalText.current.trim();
    if (text !== '') cb.current.onFinal(text, 'on_device', now().getTime() - startedAt.current);
  });
  useSpeechRecognitionEvent('error', (event) => {
    setListening(false);
    const map: Record<string, SpeechError> = {
      'not-allowed': 'permission',
      'no-speech': 'no_speech',
      'speech-timeout': 'no_speech',
      'service-not-allowed': 'unavailable',
      'language-not-supported': 'unavailable',
      network: 'network',
      interrupted: 'interrupted',
      aborted: 'interrupted',
    };
    if (event.error === 'aborted') return;
    cb.current.onError(map[event.error] ?? 'failed');
  });

  const stopServer = async () => {
    if (timer.current !== null) clearTimeout(timer.current);
    setListening(false);
    const duration = now().getTime() - startedAt.current;
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (uri === null) {
        cb.current.onError('no_speech');
        return;
      }
      const text = (await transcribe(uri, duration)).trim();
      if (text === '') cb.current.onError('no_speech');
      else cb.current.onFinal(text, 'server', duration);
    } catch {
      cb.current.onError('network');
    }
  };

  const start = async (): Promise<boolean> => {
    finalText.current = '';
    setInterim('');
    startedAt.current = now().getTime();
    if (engine === 'none') {
      cb.current.onError('unavailable');
      return false;
    }
    if (engine === 'on_device') {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        cb.current.onError('permission');
        return false;
      }
      ExpoSpeechRecognitionModule.start({
        lang: 'tr-TR',
        interimResults: true,
        continuous: false,
        requiresOnDeviceRecognition: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
      });
      setListening(true);
      timer.current = setTimeout(() => {
        ExpoSpeechRecognitionModule.stop();
      }, MAX_UTTERANCE_MS);
      return true;
    }
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      cb.current.onError('permission');
      return false;
    }
    await recorder.prepareToRecordAsync();
    recorder.record();
    setListening(true);
    timer.current = setTimeout(() => {
      void stopServer();
    }, MAX_UTTERANCE_MS);
    return true;
  };

  const stop = () => {
    if (engine === 'on_device') ExpoSpeechRecognitionModule.stop();
    else if (engine === 'server' && listening) void stopServer();
  };

  const abort = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    setListening(false);
    if (engine === 'on_device') ExpoSpeechRecognitionModule.abort();
    else if (listening) void recorder.stop().catch(() => undefined);
  };

  return { listening, interim, level, start, stop, abort };
}
