/**
 * Dictation for meeting notes and post-meeting capture (M-MEET-02 / M-MEET-04): on-device speech
 * recognition through `expo-speech-recognition` ("Mic = dictation, not voice mode"). Recording never
 * starts on its own; final results are handed to the caller, interim text is shown live. Mic or
 * speech-recognition permission denial switches to `denied` (typing keeps working). Drafts that
 * must survive backgrounding are kept in the encrypted MMKV cache (`draft.meeting_note.{id}`,
 * `draft.post_meeting.{id}`).
 */
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useRef, useState } from 'react';

import { useSessionContext } from '../../lib/data/session';
import { track } from '../../lib/events';
import { encryptedStorage, isEncryptedStorageOpen } from '../../lib/storage';

export type DictationState = 'idle' | 'requesting' | 'listening' | 'denied' | 'error';

export interface Dictation {
  readonly state: DictationState;
  /** Interim (not yet final) transcript. */
  readonly partial: string;
  /** Whether on-device recognition exists; false hides the mic. */
  readonly available: boolean;
  readonly start: () => void;
  readonly stop: () => void;
  readonly toggle: () => void;
}

function recognitionAvailable(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

export function useDictation(
  onFinal: (text: string, confidence: number | undefined) => void,
): Dictation {
  const { locale } = useSessionContext();
  const [state, setState] = useState<DictationState>('idle');
  const [partial, setPartial] = useState('');
  const [available] = useState(recognitionAvailable);
  // Recognition events are global; only the hook that started a session handles them.
  const owner = useRef(false);

  useSpeechRecognitionEvent('start', () => {
    if (owner.current) setState('listening');
  });
  useSpeechRecognitionEvent('end', () => {
    if (!owner.current) return;
    owner.current = false;
    setPartial('');
    setState((s) => (s === 'listening' || s === 'requesting' ? 'idle' : s));
  });
  useSpeechRecognitionEvent('result', (event) => {
    if (!owner.current) return;
    const best = event.results[0];
    if (best === undefined) return;
    if (event.isFinal) {
      setPartial('');
      if (best.transcript.trim() !== '') {
        track('speech_input_used', { engine: 'on_device', success: true });
        onFinal(best.transcript.trim(), best.confidence >= 0 ? best.confidence : undefined);
      }
    } else {
      setPartial(best.transcript);
    }
  });
  useSpeechRecognitionEvent('error', (event) => {
    if (!owner.current) return;
    owner.current = false;
    setPartial('');
    if (event.error === 'aborted') {
      setState('idle');
      return;
    }
    track('speech_input_used', { engine: 'on_device', success: false });
    setState(
      event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'denied' : 'error',
    );
  });

  const stop = () => {
    if (!owner.current) return;
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      owner.current = false;
      setState('idle');
    }
  };

  const start = () => {
    if (!available || owner.current) return;
    setState('requesting');
    void (async () => {
      try {
        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!permission.granted) {
          setState('denied');
          return;
        }
        owner.current = true;
        ExpoSpeechRecognitionModule.start({
          lang: locale === 'en' ? 'en-US' : 'tr-TR',
          interimResults: true,
          continuous: true,
          addsPunctuation: true,
        });
      } catch {
        owner.current = false;
        setState('error');
      }
    })();
  };

  return {
    state,
    partial,
    available,
    start,
    stop,
    toggle: () => {
      if (state === 'listening' || state === 'requesting') stop();
      else start();
    },
  };
}

// ── Encrypted local drafts ─────────────────────────────────────────────────────────────────

export function readDraft(key: string): string {
  if (!isEncryptedStorageOpen()) return '';
  return encryptedStorage().cache.getString(key) ?? '';
}

export function writeDraft(key: string, text: string): void {
  if (!isEncryptedStorageOpen()) return;
  if (text.trim() === '') encryptedStorage().cache.remove(key);
  else encryptedStorage().cache.set(key, text);
}
