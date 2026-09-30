/**
 * Voice availability (KNOWN_PLATFORM_LIMITATIONS KPL-24, KPL-25): what this device can do for
 * Turkish speech, read from the OS through `expo-speech-recognition` and `expo-speech`.
 *
 * Recognition (`onDeviceRecognition`):
 * - `available`: an on-device recognizer that handles the locale (iOS: `supportsOnDeviceRecognition`;
 *   Android 12+: `isOnDeviceRecognitionAvailable`, and on Android 13+ the locale is among the
 *   installed offline models);
 * - `downloadable` (Android 13+): the on-device recognizer supports the locale but its offline model
 *   is not installed — `downloadOfflineModel()` hands off to the system download;
 * - `unavailable`: a recognizer exists but not on the device for this locale;
 * - `none`: no speech recognition service at all (nothing to hand off to on the device);
 * - `unknown`: the native module is missing or the probe failed.
 * The app never uses the platform's network recognizer (`requiresOnDeviceRecognition` is always
 * set), so audio reaches a server only through the documented `POST /assistant/transcribe` path.
 *
 * Synthesis (`hasTurkishVoice`): whether a `tr` voice is installed; without one the players offer
 * the engine's voice-data install (Android `INSTALL_TTS_DATA`) or the iOS Settings path.
 */
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Linking, Platform } from 'react-native';

export type OnDeviceRecognition = 'available' | 'downloadable' | 'unavailable' | 'none' | 'unknown';

/** `tr-TR`, `tr_TR`, `tr` all match `tr-TR`. */
export function matchesLocale(candidate: string, locale: string): boolean {
  const norm = (value: string) => value.replace('_', '-').toLowerCase();
  const want = norm(locale);
  const have = norm(candidate);
  return have === want || have === want.split('-')[0] || want === have.split('-')[0];
}

function recognizerExists(): boolean | null {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return null;
  }
}

function onDeviceSupported(): boolean | null {
  try {
    return ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
  } catch {
    return null;
  }
}

export async function onDeviceRecognition(locale = 'tr-TR'): Promise<OnDeviceRecognition> {
  const exists = recognizerExists();
  const onDevice = onDeviceSupported();
  if (exists === null || onDevice === null) return 'unknown';
  if (!onDevice) return exists ? 'unavailable' : 'none';
  // Android 13+ lists the offline models; below that (and on iOS) the recognizer answers for
  // itself when a session starts.
  if (Platform.OS !== 'android' || Platform.Version < 33) return 'available';
  try {
    const { locales, installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({});
    if (installedLocales.some((l) => matchesLocale(l, locale))) return 'available';
    if (locales.some((l) => matchesLocale(l, locale))) return 'downloadable';
    return 'unavailable';
  } catch {
    return 'unknown';
  }
}

export type ModelDownload = 'downloaded' | 'dialog' | 'scheduled' | 'failed';

/** Android 13+: asks the on-device recognizer to download the locale's offline model. */
export async function downloadOfflineModel(locale = 'tr-TR'): Promise<ModelDownload> {
  if (Platform.OS !== 'android') return 'failed';
  try {
    const result = await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale });
    if (result.status === 'download_success') return 'downloaded';
    return result.status === 'opened_dialog' ? 'dialog' : 'scheduled';
  } catch {
    return 'failed';
  }
}

/** Google's speech services (recognition and synthesis) on the Play Store. */
export const SPEECH_SERVICES_PACKAGE = 'com.google.android.tts';

/**
 * Android without any recognition service: the Play Store page of the speech services (the Play
 * app when present, else the web page). The user installs it there; nothing is installed for them.
 */
export async function openSpeechServicesInstall(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  for (const url of [
    `market://details?id=${SPEECH_SERVICES_PACKAGE}`,
    `https://play.google.com/store/apps/details?id=${SPEECH_SERVICES_PACKAGE}`,
  ]) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // Try the next target.
    }
  }
  return false;
}

/** Whether a Turkish text-to-speech voice is installed (`expo-speech` voice list). */
export async function hasTurkishVoice(): Promise<boolean> {
  const voices = await Speech.getAvailableVoicesAsync();
  return voices.some((voice) => matchesLocale(voice.language, 'tr-TR'));
}

/**
 * Android: the text-to-speech engine's voice-data install screen
 * (`TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA`). iOS has no such screen; its players show the
 * Settings path instead.
 */
export async function openVoiceDataInstall(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    await Linking.sendIntent('android.speech.tts.engine.INSTALL_TTS_DATA');
    return true;
  } catch {
    return false;
  }
}
