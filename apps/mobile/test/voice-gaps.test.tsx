/**
 * Voice gaps (KNOWN_PLATFORM_LIMITATIONS KPL-23/24/25): the on-device recognizer probe and the
 * Android offline-model download, the speech-services install handoff, the server-STT privacy
 * notice, the Turkish voice note of the device-voice player, and the paste affordance of the
 * capture composer (the iOS system paste control; the chip that reads after the tap elsewhere).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Clipboard from 'expo-clipboard';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Linking, Platform } from 'react-native';

import {
  SPEECH_SERVICES_PACKAGE,
  downloadOfflineModel,
  hasTurkishVoice,
  matchesLocale,
  onDeviceRecognition,
  openSpeechServicesInstall,
  openVoiceDataInstall,
} from '../src/features/voice/availability';
import { engineFor } from '../src/features/voice/speech';
import { encryptedStorage } from '../src/lib/storage';
import { json, resetAppState } from './helpers/app';
import { ok } from './helpers/fixtures';
import { ID, appRouter, openApp, proBootstrap } from './helpers/journeys';
import { asAndroid, restorePlatform } from './helpers/ni';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

const recognition = jest.mocked(ExpoSpeechRecognitionModule);
const ORIGINAL_VERSION = Platform.Version;
const clipboard = Clipboard as { isPasteButtonAvailable: boolean };

function androidVersion(version: number): void {
  asAndroid();
  Object.defineProperty(Platform, 'Version', { value: version, configurable: true });
}

beforeEach(async () => {
  await resetAppState();
  jest.clearAllMocks();
  recognition.isRecognitionAvailable.mockReturnValue(true);
  recognition.supportsOnDeviceRecognition.mockReturnValue(true);
  recognition.getSupportedLocales.mockResolvedValue({
    locales: ['tr-TR', 'en-US'],
    installedLocales: ['tr-TR', 'en-US'],
  });
});

afterEach(() => {
  restorePlatform();
  Object.defineProperty(Platform, 'Version', { value: ORIGINAL_VERSION, configurable: true });
  clipboard.isPasteButtonAvailable = false;
});

describe('on-device recognition probe (KPL-24)', () => {
  it('matches locale spellings', () => {
    expect(matchesLocale('tr_TR', 'tr-TR')).toBe(true);
    expect(matchesLocale('tr', 'tr-TR')).toBe(true);
    expect(matchesLocale('tr-TR', 'tr')).toBe(true);
    expect(matchesLocale('en-US', 'tr-TR')).toBe(false);
  });

  it('reads the iOS recognizer and every failure as its own state', async () => {
    expect(await onDeviceRecognition()).toBe('available');
    recognition.supportsOnDeviceRecognition.mockReturnValue(false);
    expect(await onDeviceRecognition()).toBe('unavailable');
    recognition.isRecognitionAvailable.mockReturnValue(false);
    expect(await onDeviceRecognition()).toBe('none');
    recognition.isRecognitionAvailable.mockImplementation(() => {
      throw new Error('missing module');
    });
    expect(await onDeviceRecognition()).toBe('unknown');
  });

  it('checks the Android 13+ offline models', async () => {
    androidVersion(34);
    expect(await onDeviceRecognition('tr-TR')).toBe('available');
    recognition.getSupportedLocales.mockResolvedValue({ locales: ['tr-TR'], installedLocales: [] });
    expect(await onDeviceRecognition('tr-TR')).toBe('downloadable');
    recognition.getSupportedLocales.mockResolvedValue({ locales: ['en-US'], installedLocales: [] });
    expect(await onDeviceRecognition('tr-TR')).toBe('unavailable');
    recognition.getSupportedLocales.mockRejectedValue(new Error('service'));
    expect(await onDeviceRecognition('tr-TR')).toBe('unknown');
    androidVersion(31);
    expect(await onDeviceRecognition('tr-TR')).toBe('available');
  });

  it('maps the offline-model download result', async () => {
    expect(await downloadOfflineModel()).toBe('failed');
    androidVersion(34);
    recognition.androidTriggerOfflineModelDownload.mockResolvedValueOnce({
      status: 'download_success',
      message: '',
    });
    expect(await downloadOfflineModel()).toBe('downloaded');
    recognition.androidTriggerOfflineModelDownload.mockResolvedValueOnce({
      status: 'opened_dialog',
      message: '',
    });
    expect(await downloadOfflineModel()).toBe('dialog');
    recognition.androidTriggerOfflineModelDownload.mockResolvedValueOnce({
      status: 'download_scheduled',
      message: '',
    });
    expect(await downloadOfflineModel()).toBe('scheduled');
    recognition.androidTriggerOfflineModelDownload.mockRejectedValueOnce(new Error('x'));
    expect(await downloadOfflineModel()).toBe('failed');
  });

  it('picks the engine from the probe', () => {
    expect(engineFor('available', true)).toBe('on_device');
    expect(engineFor('downloadable', true)).toBe('server');
    expect(engineFor('none', false)).toBe('none');
    expect(engineFor('unknown', true)).toBe('on_device');
  });
});

describe('install handoffs (KPL-24, KPL-25)', () => {
  it('opens the speech services store page, the web page as the fallback', async () => {
    expect(await openSpeechServicesInstall()).toBe(false);
    asAndroid();
    const openURL = jest.spyOn(Linking, 'openURL');
    openURL.mockRejectedValueOnce(new Error('no market')).mockResolvedValueOnce(true);
    expect(await openSpeechServicesInstall()).toBe(true);
    expect(openURL).toHaveBeenLastCalledWith(
      `https://play.google.com/store/apps/details?id=${SPEECH_SERVICES_PACKAGE}`,
    );
    openURL.mockRejectedValue(new Error('nothing'));
    expect(await openSpeechServicesInstall()).toBe(false);
    openURL.mockRestore();
  });

  it('reads the installed voices and opens the Android voice-data install', async () => {
    expect(await hasTurkishVoice()).toBe(true);
    jest.mocked(Speech.getAvailableVoicesAsync).mockResolvedValueOnce([]);
    expect(await hasTurkishVoice()).toBe(false);
    expect(await openVoiceDataInstall()).toBe(false);
    asAndroid();
    const sendIntent = jest.spyOn(Linking, 'sendIntent').mockResolvedValueOnce(undefined);
    expect(await openVoiceDataInstall()).toBe(true);
    expect(sendIntent).toHaveBeenCalledWith('android.speech.tts.engine.INSTALL_TTS_DATA');
    sendIntent.mockRejectedValueOnce(new Error('no engine'));
    expect(await openVoiceDataInstall()).toBe(false);
    sendIntent.mockRestore();
  });
});

describe('voice screen availability (KPL-24)', () => {
  it('states the server path until it was used once', async () => {
    recognition.supportsOnDeviceRecognition.mockReturnValue(false);
    await openApp({ path: '/voice?origin=assistant' });
    expect(await screen.findByTestId('voice.serverNotice')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Bu cihazda Türkçe konuşma tanıma cihaz üzerinde çalışmıyor. Sesin, metne çevrilmek için güvenli bağlantıyla sunucumuza gönderilir ve hemen silinir.',
      ),
    ).toBeOnTheScreen();
  });

  it('hides the notice once seen and on devices that recognise on the device', async () => {
    recognition.supportsOnDeviceRecognition.mockReturnValue(false);
    await openApp({ path: '/today' });
    encryptedStorage().prefs.set('voice.server_notice_seen', true);
    await act(async () => {
      appRouter.push('/voice?origin=assistant');
      await Promise.resolve();
    });
    await screen.findByTestId('screen.voice');
    expect(screen.queryByTestId('voice.serverNotice')).toBeNull();
  });

  it('offers the Turkish model download on Android 13+', async () => {
    androidVersion(34);
    recognition.getSupportedLocales.mockResolvedValue({ locales: ['tr-TR'], installedLocales: [] });
    recognition.androidTriggerOfflineModelDownload.mockResolvedValueOnce({
      status: 'download_scheduled',
      message: '',
    });
    await openApp({ path: '/voice?origin=assistant' });
    await screen.findByTestId('voice.model');
    await fireEvent.press(screen.getByText('Türkçe modeli indir'));
    expect(recognition.androidTriggerOfflineModelDownload.mock.calls.at(-1)).toEqual([
      { locale: 'tr-TR' },
    ]);
    expect(
      await screen.findByText('İndirme başladı. Bittiğinde sesli giriş cihazında çalışır.'),
    ).toBeOnTheScreen();
    // Until the model is there, the server path carries the notice.
    expect(screen.getByTestId('voice.serverNotice')).toBeOnTheScreen();
  });

  it('offers the speech services install where Android has no recognizer', async () => {
    androidVersion(34);
    recognition.isRecognitionAvailable.mockReturnValue(false);
    recognition.supportsOnDeviceRecognition.mockReturnValue(false);
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await openApp({ path: '/voice?origin=assistant' });
    await screen.findByTestId('voice.noRecognizer');
    await fireEvent.press(screen.getByText('Konuşma hizmetini yükle'));
    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith(`market://details?id=${SPEECH_SERVICES_PACKAGE}`);
    });
    openURL.mockRestore();
  });
});

describe('device voice note (KPL-25)', () => {
  const CHAPTERS = [{ index: 0, title: 'Öncelikler', text: 'Bugün üç önemli konu var.' }];
  const openNativeListen = () =>
    openApp({
      data: proBootstrap(),
      path: `/briefing/${ID.briefing}/listen?autoplay=1`,
      routes: {
        [`POST /briefings/${ID.briefing}/audio`]: () =>
          json(
            200,
            ok({
              mode: 'native',
              language: 'tr-TR',
              chapters: CHAPTERS.map((c) => ({ ...c, est_duration_s: 10 })),
              notice_key: null,
              premium_status: 'unavailable',
            }),
          ),
      },
      setup: (db) => {
        db.setTable('briefings', []);
        db.setTable('briefing_items', []);
      },
    });

  it('explains the missing Turkish voice with the iOS Settings path', async () => {
    jest.mocked(Speech.getAvailableVoicesAsync).mockResolvedValue([]);
    await openNativeListen();
    await screen.findByTestId('listen.noTurkishVoice');
    expect(screen.getByText(/Ayarlar → Erişilebilirlik/)).toBeOnTheScreen();
    expect(screen.queryByTestId('listen.installVoice')).toBeNull();
  });

  it('shows nothing when a Turkish voice is installed', async () => {
    jest
      .mocked(Speech.getAvailableVoicesAsync)
      .mockResolvedValue([
        { identifier: 'tr', name: 'Yelda', quality: 'Default', language: 'tr-TR' },
      ] as never);
    await openNativeListen();
    await screen.findByTestId('player.native');
    expect(screen.queryByTestId('listen.noTurkishVoice')).toBeNull();
  });
});

describe('composer paste (KPL-23)', () => {
  const openComposer = (path = '/capture?entry=assistant') =>
    openApp({ data: proBootstrap(), path });

  it('reads the clipboard only after the tap and appends the text', async () => {
    jest.mocked(Clipboard.getStringAsync).mockResolvedValueOnce('Faturayı öde');
    await openComposer();
    await screen.findByTestId('capture.text');
    expect(Clipboard.getStringAsync).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('capture.paste'));
    await waitFor(() => {
      expect(screen.getByTestId('capture.text').props.value).toBe('Faturayı öde');
    });
  });

  it('says so when the clipboard is empty', async () => {
    await openComposer();
    await fireEvent.press(await screen.findByTestId('capture.paste'));
    expect(await screen.findByText('Panoda yapıştırılacak metin yok.')).toBeOnTheScreen();
  });

  it('uses the iOS system paste control where available', async () => {
    clipboard.isPasteButtonAvailable = true;
    await openComposer();
    await screen.findByTestId('capture.paste.system');
    expect(screen.queryByTestId('capture.paste')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('capture.text'), '');
    await fireEvent(screen.getByTestId('system-paste-button'), 'touchEnd');
    await waitFor(() => {
      expect(screen.getByTestId('capture.text').props.value).toBe('https://example.com/pasted');
    });
    expect(Clipboard.getStringAsync).not.toHaveBeenCalled();
  });

  it('pastes a link into the link field', async () => {
    jest.mocked(Clipboard.getStringAsync).mockResolvedValueOnce(' https://example.com/a ');
    await openComposer('/capture?entry=assistant&kind=link');
    await fireEvent.press(await screen.findByTestId('capture.url.paste'));
    await screen.findByTestId('capture.url.clear');
    expect(screen.getByTestId('capture.url').props.value).toBe('https://example.com/a');
  });
});
