/**
 * Native module doubles for Jest (setupFiles). Each keeps the real module's contract so the code
 * under test runs unchanged: SecureStore is an in-memory keychain that records the accessibility
 * option, expo-crypto uses Node's crypto, MMKV uses its own built-in test implementation
 * (`createMockMMKV`), and the libraries that ship Jest mocks (NetInfo, keyboard-controller,
 * gesture-handler) use them.
 */
import { jest } from '@jest/globals';
import type * as NodeCrypto from 'node:crypto';
import type * as React from 'react';
import type * as ReactNative from 'react-native';
// The kit's gestures and sheets.
import 'react-native-gesture-handler/jestSetup';

jest.mock('react-native-keyboard-controller', () =>
  jest.requireActual('react-native-keyboard-controller/jest'),
);

jest.mock('@react-native-community/netinfo', () =>
  jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

/**
 * MMKV's own in-memory test instance, plus what the storage tests assert: the encryption each
 * instance was opened with and every re-key (`encrypt`). `__instances` maps ids to the latest one.
 */
jest.mock('react-native-mmkv', () => {
  const { createMockMMKV } = jest.requireActual<{
    createMockMMKV: (config?: { id: string }) => Record<string, unknown>;
  }>('react-native-mmkv/lib/createMMKV/createMockMMKV');
  const instances = new Map<string, Record<string, unknown>>();
  return {
    __instances: instances,
    createMMKV: jest.fn(
      (
        config: { id: string; encryptionKey?: string; encryptionType?: string } = {
          id: 'mmkv.default',
        },
      ) => {
        const base = createMockMMKV(config);
        const instance = Object.assign(base, {
          __encryptionKey: config.encryptionKey ?? null,
          __encryptionType: config.encryptionType ?? null,
          encrypt(key: string, type?: string) {
            instance.__encryptionKey = key;
            instance.__encryptionType = type ?? 'AES-128';
          },
        });
        instances.set(config.id, instance);
        return instance;
      },
    ),
  };
});

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  const accessibility = new Map<string, unknown>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    __store: store,
    __accessibility: accessibility,
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn(
      (key: string, value: string, options?: { keychainAccessible?: unknown }) => {
        store.set(key, value);
        accessibility.set(key, options?.keychainAccessible);
        return Promise.resolve();
      },
    ),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      accessibility.delete(key);
      return Promise.resolve();
    }),
  };
});

jest.mock('expo-crypto', () => {
  const nodeCrypto = jest.requireActual<typeof NodeCrypto>('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    getRandomBytes: jest.fn((count: number) => new Uint8Array(nodeCrypto.randomBytes(count))),
    randomUUID: jest.fn(() => nodeCrypto.randomUUID()),
    digestStringAsync: jest.fn((_algorithm: string, data: string) =>
      Promise.resolve(nodeCrypto.createHash('sha256').update(data).digest('hex')),
    ),
    // T-8.17 capture uploads hash the file bytes.
    digest: jest.fn((_algorithm: string, data: Uint8Array) => {
      const hash = nodeCrypto.createHash('sha256').update(data).digest();
      return Promise.resolve(hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength));
    }),
  };
});

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '42',
  applicationId: 'com.dijitalasistan.app.dev',
}));

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(() => Promise.resolve({ type: 'opened' })),
  openAuthSessionAsync: jest.fn(() => Promise.resolve({ type: 'cancel' })),
}));

jest.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light' },
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-notifications', () => ({
  IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3 },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'undetermined' })),
  unregisterForNotificationsAsync: jest.fn(() => Promise.resolve()),
  cancelAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve()),
  // T-8.06 notification step
  AndroidImportance: { HIGH: 4, DEFAULT: 3, LOW: 2 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  // T-8.18 device-local reminder notifications (until T-8.24 owns them).
  SchedulableTriggerInputTypes: { DATE: 'date' },
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('reminder')),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[test]' })),
}));

jest.mock('expo-apple-authentication', () => {
  const { View } = jest.requireActual<typeof ReactNative>('react-native');
  const { createElement } = jest.requireActual<typeof React>('react');
  return {
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    signInAsync: jest.fn(),
    formatFullName: jest.fn((name: { givenName?: string | null; familyName?: string | null }) =>
      [name.givenName, name.familyName].filter(Boolean).join(' '),
    ),
    AppleAuthenticationButton: (props: { onPress: () => void }) =>
      createElement(View, {
        accessible: true,
        accessibilityRole: 'button',
        accessibilityLabel: 'Apple',
        onTouchEnd: props.onPress,
        testID: 'apple-native-button',
      }),
  };
});

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(() => Promise.resolve(true)),
    signIn: jest.fn(),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
    SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
  },
  isErrorWithCode: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error,
  isSuccessResponse: (response: { type: string }) => response.type === 'success',
}));

// ── T-8.07 / T-8.09 native doubles ─────────────────────────────────────────────────────────

jest.mock('expo-calendar/legacy', () => ({
  EntityTypes: { EVENT: 'event', REMINDER: 'reminder' },
  CalendarType: { LOCAL: 'local', SUBSCRIBED: 'subscribed', BIRTHDAYS: 'birthdays' },
  EventStatus: { CONFIRMED: 'confirmed', TENTATIVE: 'tentative', CANCELED: 'canceled' },
  getCalendarPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'undetermined', canAskAgain: true, granted: false }),
  ),
  requestCalendarPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted', canAskAgain: true, granted: true }),
  ),
  getCalendarsAsync: jest.fn(() => Promise.resolve([])),
  getEventsAsync: jest.fn(() => Promise.resolve([])),
  // T-8.18 device executor (EventKit / CalendarContract / Apple Reminders).
  getRemindersPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'undetermined', canAskAgain: true, granted: false }),
  ),
  requestRemindersPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted', canAskAgain: true, granted: true }),
  ),
  createEventAsync: jest.fn(() => Promise.resolve('device-event-1')),
  createReminderAsync: jest.fn(() => Promise.resolve('device-reminder-1')),
  getRemindersAsync: jest.fn(() => Promise.resolve([])),
}));

jest.mock('expo-audio', () => {
  const player = {
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(() => Promise.resolve()),
    setPlaybackRate: jest.fn(),
    setActiveForLockScreen: jest.fn(),
    updateLockScreenMetadata: jest.fn(),
    remove: jest.fn(),
  };
  const status = {
    currentTime: 0,
    duration: 0,
    playing: false,
    isLoaded: true,
    didJustFinish: false,
  };
  return {
    __player: player,
    __status: status,
    setAudioModeAsync: jest.fn(() => Promise.resolve()),
    useAudioPlayer: jest.fn(() => player),
    useAudioPlayerStatus: jest.fn(() => ({ ...status })),
    // T-8.15 voice server-STT fallback recorder.
    RecordingPresets: { HIGH_QUALITY: {} },
    requestRecordingPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
    useAudioRecorder: jest.fn(() => ({
      prepareToRecordAsync: jest.fn(() => Promise.resolve()),
      record: jest.fn(),
      stop: jest.fn(() => Promise.resolve()),
      uri: 'file:///cache/voice.m4a',
    })),
  };
});

jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(() => Promise.resolve()),
  pause: jest.fn(() => Promise.resolve()),
  resume: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: false })),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  downloadAsync: jest.fn((_url: string, target: string) =>
    Promise.resolve({ uri: target, status: 200 }),
  ),
  deleteAsync: jest.fn(() => Promise.resolve()),
  // T-8.15 transcribe upload, T-8.17 capture uploads and share staging.
  FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  readAsStringAsync: jest.fn(() => Promise.resolve('aGVsbG8=')),
  copyAsync: jest.fn(() => Promise.resolve()),
  uploadAsync: jest.fn(() =>
    Promise.resolve({ status: 200, body: '{}', headers: {}, mimeType: 'application/json' }),
  ),
  createUploadTask: jest.fn(
    (
      _url: string,
      _uri: string,
      _options: unknown,
      callback?: (p: { totalBytesSent: number; totalBytesExpectedToSend: number }) => void,
    ) => ({
      uploadAsync: jest.fn(() => {
        callback?.({ totalBytesSent: 5, totalBytesExpectedToSend: 5 });
        return Promise.resolve({ status: 200, body: '', headers: {}, mimeType: null });
      }),
    }),
  ),
}));

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(() => Promise.resolve('file:///cache/share.png')),
}));

// ── T-8.15…T-8.18 native doubles ───────────────────────────────────────────────────────────

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: jest.fn(() => true),
    supportsOnDeviceRecognition: jest.fn(() => true),
    requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, status: 'granted' })),
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
  },
  useSpeechRecognitionEvent: jest.fn(),
}));

jest.mock('expo-share-intent', () => {
  const state = {
    hasShareIntent: false,
    shareIntent: { text: null, webUrl: null, files: null, type: null },
  };
  return {
    __state: state,
    useShareIntent: jest.fn(() => ({
      isReady: true,
      hasShareIntent: state.hasShareIntent,
      shareIntent: state.shareIntent,
      resetShareIntent: jest.fn(() => {
        state.hasShareIntent = false;
      }),
      error: null,
    })),
  };
});

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(() =>
    Promise.resolve({ granted: true, status: 'granted' }),
  ),
  launchCameraAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: null })),
  launchImageLibraryAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: null })),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: null })),
}));
