/**
 * `da-tts` (T-8.27): the module's JS interface against a native double (voice selection, input
 * splitting, one file per chapter, manifest reuse, cache pruning and cleanup, failure cleanup) and
 * the briefing player's native mode (synthesized files as a playlist; expo-speech as the last
 * resort when synthesis fails).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from 'expo-router/testing-library';

import {
  TTS_CACHE_DIR,
  clearTtsCache,
  isTtsAvailable,
  selectVoice,
  splitForSynthesis,
  synthesizeChapters,
  type TtsVoice,
} from '../modules/da-tts/src';
import { clearAudioCache } from '../src/features/briefing/audio-cache';
import { locateTrack, trackOffsets } from '../src/features/briefing/ListenScreen';
import { json, resetAppState } from './helpers/app';
import { ok } from './helpers/fixtures';
import { ID, events, openApp, proBootstrap } from './helpers/journeys';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

type Synthesize = (
  text: string,
  options: { voice: string | null; language: string; uri: string },
) => Promise<{ uri: string; durationMs: number }>;

interface TtsDouble {
  maxInputLength?: number;
  getVoices: jest.Mock<() => Promise<TtsVoice[]>>;
  synthesizeToFile: jest.Mock<Synthesize>;
}

const nativeModule = jest.requireMock<{ nativeTts: jest.Mock }>('../modules/da-tts/src/native');
const FS = jest.requireMock<Record<string, jest.Mock>>('expo-file-system/legacy');

const VOICES: TtsVoice[] = [
  {
    identifier: 'en-1',
    name: 'Samantha',
    language: 'en-US',
    quality: 'premium',
    networkRequired: false,
  },
  {
    identifier: 'tr-net',
    name: 'Bulut',
    language: 'tr-TR',
    quality: 'premium',
    networkRequired: true,
  },
  {
    identifier: 'tr-enh',
    name: 'Yelda',
    language: 'tr-TR',
    quality: 'enhanced',
    networkRequired: false,
  },
  {
    identifier: 'tr-def',
    name: 'Cem',
    language: 'tr_TR',
    quality: 'default',
    networkRequired: false,
  },
];

function installTts(overrides: Partial<TtsDouble> = {}): TtsDouble {
  const double: TtsDouble = {
    getVoices: jest.fn(() => Promise.resolve(VOICES)),
    synthesizeToFile: jest.fn<Synthesize>((_text, options) =>
      Promise.resolve({ uri: options.uri, durationMs: 10_000 }),
    ),
    ...overrides,
  };
  nativeModule.nativeTts.mockReturnValue(double);
  return double;
}

const CHAPTERS = [
  { index: 0, title: 'Öncelikler', text: 'Bugün üç önemli konu var. İlki revize teklif.' },
  { index: 1, title: 'Toplantılar', text: 'Saat on dörtte müşteri toplantın var.' },
];

beforeEach(async () => {
  await resetAppState();
  nativeModule.nativeTts.mockReturnValue(null);
  FS.getInfoAsync?.mockImplementation(() => Promise.resolve({ exists: false }));
  FS.readDirectoryAsync?.mockImplementation(() => Promise.resolve([]));
  for (const name of ['deleteAsync', 'writeAsStringAsync', 'makeDirectoryAsync'])
    FS[name]?.mockClear();
});

describe('voice selection and input splitting', () => {
  it('prefers an offline tr-TR voice, then quality; falls back to the language family', () => {
    expect(selectVoice(VOICES, 'tr-TR')?.identifier).toBe('tr-enh');
    const regionless = VOICES.map((v) =>
      v.identifier === 'tr-enh' ? { ...v, language: 'tr' } : v,
    ).filter((v) => v.identifier !== 'tr-net' && v.identifier !== 'tr-def');
    expect(selectVoice(regionless, 'tr-TR')?.identifier).toBe('tr-enh');
    expect(selectVoice(VOICES.slice(0, 1), 'tr-TR')).toBeNull();
    expect(selectVoice(VOICES, 'en-US')?.identifier).toBe('en-1');
  });

  it('splits long text at sentence ends without cutting words', () => {
    const sentence = 'Bu cümle tam olarak otuz sekiz harf. ';
    const parts = splitForSynthesis(sentence.repeat(20), 120);
    expect(parts.length).toBeGreaterThan(5);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(120);
      expect(part.endsWith('.')).toBe(true);
    }
    expect(parts.join(' ')).toBe(sentence.repeat(20).trim());
    expect(splitForSynthesis('   ', 120)).toEqual([]);
  });
});

describe('synthesizeChapters (native double)', () => {
  it('is unavailable without the native module', async () => {
    expect(isTtsAvailable()).toBe(false);
    await expect(
      synthesizeChapters({ key: ID.briefing, language: 'tr-TR', chapters: CHAPTERS }),
    ).rejects.toThrow('tts_unavailable');
  });

  it('writes one file per chapter with the Turkish voice and a manifest, pruning old folders', async () => {
    const tts = installTts();
    FS.readDirectoryAsync?.mockImplementation(() => Promise.resolve(['old-briefing-1234abcd']));
    FS.getInfoAsync?.mockImplementation((path) =>
      Promise.resolve({ exists: path === `file:///cache/${TTS_CACHE_DIR}` }),
    );
    const result = await synthesizeChapters({
      key: ID.briefing,
      language: 'tr-TR',
      chapters: CHAPTERS,
    });
    expect(result.cached).toBe(false);
    expect(result.voice?.identifier).toBe('tr-enh');
    expect(tts.synthesizeToFile).toHaveBeenCalledTimes(2);
    const [text, options] = tts.synthesizeToFile.mock.calls[0] ?? [];
    expect(text).toBe(CHAPTERS[0]?.text);
    expect(options).toMatchObject({ voice: 'tr-enh', language: 'tr-TR' });
    expect(options?.uri).toMatch(
      new RegExp(`^file:///cache/${TTS_CACHE_DIR}${ID.briefing}-[0-9a-f]{8}/0-0\\.caf$`),
    );
    expect(result.tracks.map((t) => [t.chapter, t.durationS])).toEqual([
      [0, 10],
      [1, 10],
    ]);
    expect(FS.writeAsStringAsync).toHaveBeenCalledWith(
      expect.stringMatching(/manifest\.json$/),
      expect.stringContaining('"v":1'),
    );
    expect(FS.deleteAsync).toHaveBeenCalledWith(
      `file:///cache/${TTS_CACHE_DIR}old-briefing-1234abcd`,
      { idempotent: true },
    );
  });

  it('splits a chapter longer than the engine limit into consecutive files', async () => {
    const tts = installTts({ maxInputLength: 300 });
    const long = 'Bu brifingde uzun bir bölüm var. '.repeat(20);
    const result = await synthesizeChapters({
      key: ID.briefing,
      language: 'tr-TR',
      chapters: [{ index: 3, title: 'Uzun', text: long }],
    });
    expect(tts.synthesizeToFile.mock.calls.length).toBeGreaterThan(2);
    expect(tts.synthesizeToFile.mock.calls.every(([text]) => text.length <= 200)).toBe(true);
    expect(new Set(result.tracks.map((t) => t.chapter))).toEqual(new Set([3]));
  });

  it('reuses the files of an unchanged script', async () => {
    const tts = installTts();
    const tracks = [{ chapter: 0, uri: 'file:///cache/briefing-tts/x/0-0.caf', durationS: 12 }];
    FS.getInfoAsync?.mockImplementation(() => Promise.resolve({ exists: true }));
    FS.readAsStringAsync?.mockImplementationOnce(() =>
      Promise.resolve(JSON.stringify({ v: 1, tracks })),
    );
    const result = await synthesizeChapters({
      key: ID.briefing,
      language: 'tr-TR',
      chapters: CHAPTERS,
    });
    expect(result).toMatchObject({ cached: true, tracks });
    expect(tts.synthesizeToFile).not.toHaveBeenCalled();
  });

  it('deletes a partial folder when synthesis fails', async () => {
    installTts({
      synthesizeToFile: jest.fn<Synthesize>(() => Promise.reject(new Error('ERR_TTS_SYNTHESIS'))),
    });
    await expect(
      synthesizeChapters({ key: ID.briefing, language: 'tr-TR', chapters: CHAPTERS }),
    ).rejects.toThrow('ERR_TTS_SYNTHESIS');
    expect(FS.deleteAsync).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`${ID.briefing}-[0-9a-f]{8}/$`)),
      { idempotent: true },
    );
  });

  it('is wiped on logout together with the downloaded audio', async () => {
    await clearAudioCache();
    expect(FS.deleteAsync).toHaveBeenCalledWith('file:///cache/briefing-audio/', {
      idempotent: true,
    });
    expect(FS.deleteAsync).toHaveBeenCalledWith(`file:///cache/${TTS_CACHE_DIR}`, {
      idempotent: true,
    });
    FS.deleteAsync?.mockClear();
    await clearTtsCache();
    expect(FS.deleteAsync).toHaveBeenCalledTimes(1);
  });
});

describe('player timeline over chapter files', () => {
  const tracks = [
    { chapter: 0, uri: 'a', durationS: 10 },
    { chapter: 0, uri: 'b', durationS: 5 },
    { chapter: 1, uri: 'c', durationS: 20 },
  ];

  it('maps a timeline position to a file and an offset', () => {
    expect(trackOffsets(tracks)).toEqual([0, 10, 15]);
    expect(locateTrack(tracks, 0)).toEqual({ index: 0, offset: 0 });
    expect(locateTrack(tracks, 12)).toEqual({ index: 1, offset: 2 });
    expect(locateTrack(tracks, 30)).toEqual({ index: 2, offset: 15 });
    expect(locateTrack(tracks, 99)).toEqual({ index: 2, offset: 20 });
  });
});

interface PlaylistMock {
  readonly __playlist: {
    play: jest.Mock;
    skipTo: jest.Mock;
    seekTo: jest.Mock;
    playbackRate: number;
  };
}

async function openNativeListen() {
  return openApp({
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
}

describe('briefing player native mode (M-BR-02 + T-8.27)', () => {
  it('plays the synthesized chapter files with exact seeks and speeds', async () => {
    const tts = installTts();
    const audio = jest.requireMock<PlaylistMock>('expo-audio');
    audio.__playlist.play.mockClear();
    audio.__playlist.skipTo.mockClear();
    audio.__playlist.seekTo.mockClear();
    await openNativeListen();
    expect(await screen.findByTestId('player.synthesized')).toBeOnTheScreen();
    expect(tts.synthesizeToFile).toHaveBeenCalledTimes(2);
    expect(audio.__playlist.play).toHaveBeenCalled();
    expect(screen.getByText('Cihaz sesiyle okunuyor')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('15 sn ileri'));
    expect(audio.__playlist.skipTo).toHaveBeenLastCalledWith(1);
    expect(audio.__playlist.seekTo).toHaveBeenLastCalledWith(5);
    await fireEvent.press(screen.getByLabelText('Hız, 1 kat'));
    expect(audio.__playlist.playbackRate).toBe(1.25);
    await fireEvent.press(screen.getByText('Toplantılar'));
    expect(audio.__playlist.seekTo).toHaveBeenLastCalledWith(0);
    expect(events('briefing_audio_seek').map((e) => e.props)).toEqual([
      { method: 'skip' },
      { method: 'chapter' },
    ]);
    audio.__playlist.playbackRate = 1;
  });

  it('falls back to the device speech engine when synthesis fails', async () => {
    installTts({
      synthesizeToFile: jest.fn<Synthesize>(() => Promise.reject(new Error('no voice data'))),
    });
    await openNativeListen();
    expect(await screen.findByTestId('player.native')).toBeOnTheScreen();
    expect(events('briefing_audio_fallback').map((e) => e.props)).toEqual([
      { reason: 'tts_unavailable' },
    ]);
  });
});
